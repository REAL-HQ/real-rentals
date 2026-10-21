// Applicant resume credentials.
//
// The application UUID used to be the credential: getApplicationForWizard and
// updateApplicationStep had no auth at all, so anyone holding the id could read
// the application and write to it, including flipping its status. That was
// tolerable while the id only travelled in a redirect inside the applicant's
// own browser. It is not tolerable as the basis for "come back and finish"
// links sent by email and SMS, which get forwarded, logged by gateways, and
// sit in inboxes indefinitely.
//
// So: a separate, purpose-made token.
//
//   - 32 bytes from the CSPRNG, base64url — not guessable, not derived from
//     anything about the applicant
//   - only the SHA-256 hash is stored, so this table leaking yields no
//     working links
//   - bound to one application, expiring, revocable, and reissuable
//   - multi-use within its window, because the whole point is that the
//     applicant can come back more than once during Part 2
//
// There is deliberately no UUID fallback. An old ?id= link does not work.

/*
 * Web Crypto, not node:crypto.
 *
 * A static `import "node:crypto"` here pulled the whole module into the client
 * bundle through the server functions that use it, and the browser build
 * replaced it with a stub that exports nothing. The same globals are available
 * on both runtimes, and agreements.functions.ts already hashes its signing
 * tokens exactly this way.
 */

/** The service-role client, typed from the module that creates it. */
type AdminClient = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/** Matches the storage upload window in application_accepts_uploads(). */
export const RESUME_TOKEN_DAYS = 14;
/**
 * Recovery links (emailed to someone coming back) are short-lived and
 * single-use: the first open exchanges them for a fresh 14-day session token
 * kept in that tab, and the emailed link dies. A recovery token is recognised
 * by its lifetime (<= 1 hour), so no schema change was needed and every
 * existing 14-day link keeps working exactly as before.
 */
export const RECOVERY_TOKEN_MINUTES = 30;
const RECOVERY_MAX_MS = 60 * 60_000;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function hashResumeToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return hex(new Uint8Array(digest));
}

export function newRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url: URL-safe, and shorter than hex for the same 256 bits.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** How many unexpired links one application may have out at once, per purpose. */
const MAX_LIVE_TOKENS = 5;

/**
 * Card-on-file links are 72 hours. That stays above the 1-hour recovery
 * window, so a card link is never mistaken for a single-use recovery link.
 */
export const CARD_LINK_MS = 72 * 60 * 60 * 1000;

type TokenPurpose = "card" | "resume";

type TokenRow = {
  id: string;
  application_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  purpose?: string | null;
};

/**
 * Plaintext of card links this process has minted. The table stores only the
 * hash, so a still-valid card link can be handed out again only while this
 * process remembers it. A different process mints another card link; that
 * mint trims card links only and never a resume link.
 */
const cardPlaintext = new Map<string, { raw: string; expiresAt: number }>();
const cardInflight = new Map<string, Promise<string>>();

function missingPurposeColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    (message.includes("purpose") && (message.includes("does not exist") || message.includes("schema cache")))
  );
}

function assertAboveRecoveryWindow(ttlMs: number) {
  if (!(ttlMs > RECOVERY_MAX_MS)) {
    throw new Error("Card link lifetime must be longer than one hour.");
  }
}

async function loadToken(admin: AdminClient, raw: string): Promise<TokenRow | null> {
  const hash = await hashResumeToken(raw);
  const scoped = await admin
    .from("application_resume_tokens")
    .select("id,application_id,created_at,expires_at,revoked_at,purpose" as "*")
    .eq("token_hash", hash)
    .maybeSingle();
  if (scoped.error && missingPurposeColumn(scoped.error)) {
    const fallback = await admin
      .from("application_resume_tokens")
      .select("id,application_id,created_at,expires_at,revoked_at")
      .eq("token_hash", hash)
      .maybeSingle();
    if (fallback.error || !fallback.data) return null;
    return fallback.data as TokenRow;
  }
  if (scoped.error || !scoped.data) return null;
  // purpose is proposed and is not in the generated row type yet.
  return scoped.data as unknown as TokenRow;
}

async function trimLiveTokens(
  admin: AdminClient,
  applicationId: string,
  keepId: string | undefined,
  purpose: TokenPurpose,
) {
  const scoped = await admin
    .from("application_resume_tokens")
    .select("id,purpose" as "*")
    .eq("application_id", applicationId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  let rows = (scoped.data ?? []) as unknown as { id: string; purpose?: string | null }[];
  if (scoped.error && missingPurposeColumn(scoped.error) && purpose === "resume") {
    const fallback = await admin
      .from("application_resume_tokens")
      .select("id")
      .eq("application_id", applicationId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    rows = (fallback.data ?? []) as { id: string }[];
  } else if (scoped.error) {
    return;
  }
  const excess = rows
    .filter((row) => (purpose === "card" ? row.purpose === "card" : row.purpose !== "card"))
    .map((row) => row.id)
    .filter((id) => id !== keepId)
    .slice(MAX_LIVE_TOKENS - 1);
  if (!excess.length) return;
  await admin
    .from("application_resume_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .in("id", excess);
}

async function reuseCardLink(admin: AdminClient, applicationId: string): Promise<string | null> {
  const cached = cardPlaintext.get(applicationId);
  if (!cached || cached.expiresAt <= Date.now()) {
    cardPlaintext.delete(applicationId);
    return null;
  }
  const row = await loadToken(admin, cached.raw);
  if (!row || row.revoked_at || row.purpose !== "card" || row.application_id !== applicationId) {
    cardPlaintext.delete(applicationId);
    return null;
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    cardPlaintext.delete(applicationId);
    return null;
  }
  return cached.raw;
}

async function mintToken(
  admin: AdminClient,
  applicationId: string,
  ttlMs: number,
  purpose: TokenPurpose,
): Promise<string> {
  const raw = newRawToken();
  const expiresAt = Date.now() + ttlMs;
  const row: {
    application_id: string;
    token_hash: string;
    expires_at: string;
    purpose?: "card";
  } = {
    application_id: applicationId,
    token_hash: await hashResumeToken(raw),
    expires_at: new Date(expiresAt).toISOString(),
  };
  // Resume inserts omit purpose so they keep working before the column exists.
  if (purpose === "card") row.purpose = "card";
  const { data: inserted, error } = await admin
    .from("application_resume_tokens")
    // purpose is not in the generated types until proposed/card-link-purpose-v1.sql is installed.
    .insert(row as never)
    .select("id")
    .single();
  if (error) {
    if (purpose === "card" && missingPurposeColumn(error)) {
      throw new Error("Card links are not available until the card-purpose column is installed.");
    }
    throw new Error(error.message);
  }
  if (purpose === "card") cardPlaintext.set(applicationId, { raw, expiresAt });
  await trimLiveTokens(admin, applicationId, inserted?.id as string | undefined, purpose);
  return raw;
}

/**
 * Mint a resume token for an application.
 *
 * Deliberately additive rather than rotating. Only the hash is stored, so a
 * token cannot be recalled once minted — which means "reissue" can only ever
 * mean "mint another". If every issue revoked the previous one, a recovery
 * email sent by the nightly cron would kill the link in the tab the applicant
 * already had open, and their next autosave would fail mid-sentence.
 *
 * Exposure is bounded instead: the oldest live tokens of the same purpose are
 * revoked once an application has more than MAX_LIVE_TOKENS of that purpose
 * out, and every one of them expires on its own. A card link never revokes a
 * resume link. Deliberate rotation is revokeResumeTokens() followed by this.
 *
 * `ttlMs` must stay above the one-hour recovery window. Card links pass
 * purpose "card" and 72 hours. Until the purpose column exists, a card issue
 * fails and does not fall back to an unscoped token.
 *
 * Returns the raw token. This is the only moment it exists in plaintext,
 * except a card link re-read from this process's memory while it is still valid.
 */
export async function issueResumeToken(
  admin: AdminClient,
  applicationId: string,
  opts: { recovery?: boolean; ttlMs?: number; purpose?: "card" } = {},
): Promise<string> {
  if (opts.purpose === "card") {
    const ttl = opts.ttlMs ?? CARD_LINK_MS;
    assertAboveRecoveryWindow(ttl);
    const pending = cardInflight.get(applicationId);
    if (pending) return pending;
    const job = (async () => {
      const reused = await reuseCardLink(admin, applicationId);
      if (reused) return reused;
      return mintToken(admin, applicationId, ttl, "card");
    })();
    cardInflight.set(applicationId, job);
    try {
      return await job;
    } finally {
      cardInflight.delete(applicationId);
    }
  }
  if (opts.ttlMs != null) assertAboveRecoveryWindow(opts.ttlMs);
  const ttl = opts.recovery
    ? RECOVERY_TOKEN_MINUTES * 60_000
    : opts.ttlMs ?? RESUME_TOKEN_DAYS * 86400_000;
  return mintToken(admin, applicationId, ttl, "resume");
}

/** Kill every live link for an application. Returns how many were revoked. */
export async function revokeResumeTokens(
  admin: AdminClient,
  applicationId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("application_resume_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("application_id", applicationId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

/** The link we put in an email or hand to a staff member. */
export function resumeUrl(rawToken: string, path: "/apply" | "/thank-you" = "/thank-you"): string {
  return `https://drivereal.com${path}?t=${encodeURIComponent(rawToken)}`;
}

/** Mint a token and return the link in one step, for the email senders. */
export async function issueResumeUrl(
  admin: AdminClient,
  applicationId: string,
  path: "/apply" | "/thank-you" = "/thank-you",
): Promise<string> {
  return resumeUrl(await issueResumeToken(admin, applicationId), path);
}

/**
 * Exchange a presented token for the application id it unlocks.
 *
 * Throws the same message for every failure — unknown, expired, revoked — so
 * the error cannot be used to probe which tokens exist.
 */
export async function resolveResumeToken(admin: AdminClient, raw: string): Promise<string> {
  const generic = "This link is no longer valid. Ask us for a new one and we'll send it over.";
  if (!raw || raw.length < 20 || raw.length > 200) throw new Error(generic);

  const row = await loadToken(admin, raw);
  // purpose "card" opens the card page only. A missing purpose is a resume
  // token, including every row written before the column exists.
  if (!row || row.purpose === "card") throw new Error(generic);
  return acceptResumeRow(admin, row, generic);
}

/**
 * The application id behind a card-on-file link. Resume tokens and recovery
 * tokens are refused. Without the purpose column this fails closed: a link
 * that can open /thank-you must not also be treated as a card link.
 */
export async function resolveCardToken(admin: AdminClient, raw: string): Promise<string> {
  const generic = "This link is no longer valid. Ask us for a new one and we'll send it over.";
  if (!raw || raw.length < 20 || raw.length > 200) throw new Error(generic);
  const row = await loadToken(admin, raw);
  if (!row || row.revoked_at || row.purpose !== "card") throw new Error(generic);
  const expires = new Date(row.expires_at).getTime();
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(expires) || !Number.isFinite(created) || expires <= Date.now()) throw new Error(generic);
  if (expires - created <= RECOVERY_MAX_MS) throw new Error(generic);
  await admin
    .from("application_resume_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);
  return row.application_id;
}

async function acceptResumeRow(admin: AdminClient, row: TokenRow, generic: string): Promise<string> {
  if (row.revoked_at) throw new Error(generic);
  const expires = new Date(row.expires_at).getTime();
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(expires) || !Number.isFinite(created) || expires <= Date.now())
    throw new Error(generic);
  // Recovery credentials must be consumed by exchangeResumeToken before any
  // applicant read/write/upload handler can use them as a session credential.
  if (expires - created <= RECOVERY_MAX_MS) throw new Error(generic);

  // Best-effort; a failed timestamp must not deny a valid applicant.
  await admin
    .from("application_resume_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);

  return row.application_id as string;
}


/**
 * Open a link. A recovery link is consumed atomically (only the first open
 * wins — the conditional update is the lock) and swapped for a new session
 * token; any other valid token is returned unchanged. Same generic error for
 * every failure.
 */
export async function exchangeResumeToken(admin: AdminClient, raw: string): Promise<string> {
  const generic = "This link is no longer valid. Ask us for a new one and we'll send it over.";
  if (!raw || raw.length < 20 || raw.length > 200) throw new Error(generic);
  const row = await loadToken(admin, raw);
  // A card link is not an application session. /thank-you refuses it.
  if (!row || row.revoked_at || row.purpose === "card") throw new Error(generic);
  const exp = new Date(row.expires_at).getTime();
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(exp) || !Number.isFinite(created) || exp <= Date.now())
    throw new Error(generic);
  const isRecovery = exp - created <= RECOVERY_MAX_MS;
  if (!isRecovery) return raw;
  const now = new Date().toISOString();
  const { data: claimed } = await admin
    .from("application_resume_tokens")
    .update({ revoked_at: now, last_used_at: now })
    .eq("id", row.id)
    .is("revoked_at", null)
    .gt("expires_at", now)
    .select("id");
  if (!claimed || claimed.length === 0) throw new Error(generic);
  return issueResumeToken(admin, row.application_id as string);
}
