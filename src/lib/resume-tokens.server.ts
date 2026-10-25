import { cardLinkFresh } from "@/lib/card-link-cache";

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
 *
 * Recovery and session links are capped separately (see trimLiveTokens):
 * anyone who knows an applicant's email can ask for recovery links, so a
 * recovery mint may only ever retire older recovery links, never the session
 * token in the applicant's open tab.
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

/** How many live links one application may have out at once, per kind. */
export const MAX_LIVE_TOKENS = 5;

/**
 * Card-on-file links are 72 hours. That stays above the 1-hour recovery
 * window, so a card link is never mistaken for a single-use recovery link.
 * The lifetime is also how a card row is recognised: the table has no purpose
 * column, and this code does not add one.
 */
export const CARD_LINK_MS = 72 * 60 * 60 * 1000;

/**
 * '.' is outside base64url, so a resume token can never start with this.
 * The hash covers the whole string, prefix included.
 */
export const CARD_TOKEN_PREFIX = "card.";

/**
 * What a token row is, read from its lifetime alone (the table has no purpose
 * column): card = exactly 72 hours, recovery = 1 hour or less, session = the
 * rest (14-day resume links). Each kind has its own cap of live links.
 */
export type TokenKind = "card" | "session" | "recovery";

export function tokenKindOf(row: { created_at: string | Date; expires_at: string | Date }): TokenKind {
  if (isCardRow(row)) return "card";
  const created = instantMs(row.created_at as string);
  const expires = instantMs(row.expires_at as string);
  if (Number.isFinite(created) && Number.isFinite(expires) && expires - created <= RECOVERY_MAX_MS) {
    return "recovery";
  }
  return "session";
}

type TokenRow = {
  id: string;
  application_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
};

/**
 * Plaintext of card links this process has minted. The table stores only the
 * hash, so a still-valid card link can be handed out again only while this
 * process remembers it. A different process mints another card link; that
 * mint trims card links only and never a resume link.
 */
const cardPlaintext = new Map<string, { raw: string; expiresAt: number }>();
const cardInflight = new Map<string, Promise<string>>();

function assertAboveRecoveryWindow(ttlMs: number) {
  if (!(ttlMs > RECOVERY_MAX_MS)) {
    throw new Error("Card link lifetime must be longer than one hour.");
  }
}

function instantMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** True only for a row whose lifetime is exactly 72 hours. Resume is 14 days. Recovery is 30 minutes. */
export function isCardRow(row: { created_at: string | Date; expires_at: string | Date }): boolean {
  const created = instantMs(row.created_at as string);
  const expires = instantMs(row.expires_at as string);
  return Number.isFinite(created) && Number.isFinite(expires) && expires - created === CARD_LINK_MS;
}

async function loadToken(admin: AdminClient, raw: string): Promise<TokenRow | null> {
  const hash = await hashResumeToken(raw);
  const loaded = await admin
    .from("application_resume_tokens")
    .select("id,application_id,created_at,expires_at,revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (loaded.error || !loaded.data) return null;
  return loaded.data as TokenRow;
}

/**
 * Revoke the oldest live tokens of ONE kind once an application has more than
 * MAX_LIVE_TOKENS of that kind.
 *
 * Per kind, deliberately. This used to count recovery and session tokens
 * together, so anybody who knew an applicant's email could request a handful
 * of recovery links and push the applicant's open-tab session token off the
 * end of the list — their next autosave then failed with "link no longer
 * valid". Now a recovery mint only ever retires recovery tokens, a card mint
 * only card tokens, and a session mint only session tokens.
 *
 * Expired tokens do not count toward the cap: they already open nothing, and
 * counting them meant an application with a few stale links revoked a live
 * one earlier than it had to.
 */
async function trimLiveTokens(
  admin: AdminClient,
  applicationId: string,
  keepId: string | undefined,
  kind: TokenKind,
) {
  const loaded = await admin
    .from("application_resume_tokens")
    .select("id,created_at,expires_at")
    .eq("application_id", applicationId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (loaded.error) return;
  const rows = (loaded.data ?? []) as { id: string; created_at: string; expires_at: string }[];
  const excess = rows
    .filter((row) => tokenKindOf(row) === kind)
    .map((row) => row.id)
    .filter((id) => id !== keepId)
    .slice(MAX_LIVE_TOKENS - 1);
  if (!excess.length) return;
  await admin
    .from("application_resume_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .in("id", excess)
    .is("revoked_at", null);
}

/** The expiry this process remembers for a card link, or null once it is too old or revoked. */
export function rememberedCardExpiry(applicationId: string): number | null {
  const cached = cardPlaintext.get(applicationId);
  if (!cached || !cardLinkFresh(cached.expiresAt)) return null;
  return cached.expiresAt;
}

async function reuseCardLink(admin: AdminClient, applicationId: string): Promise<string | null> {
  const cached = cardPlaintext.get(applicationId);
  // A revoked or nearly-spent link is forgotten. About 71 hours is the handoff limit.
  if (!cached || !cardLinkFresh(cached.expiresAt) || !cached.raw.startsWith(CARD_TOKEN_PREFIX)) {
    cardPlaintext.delete(applicationId);
    return null;
  }
  const row = await loadToken(admin, cached.raw);
  if (!row || row.revoked_at || !isCardRow(row) || row.application_id !== applicationId) {
    cardPlaintext.delete(applicationId);
    return null;
  }
  if (!cardLinkFresh(instantMs(row.expires_at))) {
    cardPlaintext.delete(applicationId);
    return null;
  }
  return cached.raw;
}

async function mintToken(
  admin: AdminClient,
  applicationId: string,
  kind: "card" | "resume",
  ttlMs?: number,
): Promise<string> {
  const now = Date.now();
  const raw = kind === "card" ? CARD_TOKEN_PREFIX + newRawToken() : newRawToken();
  const token_hash = await hashResumeToken(raw);
  const lifetime = kind === "card" ? CARD_LINK_MS : ttlMs;
  if (lifetime == null) throw new Error("A resume link needs a lifetime.");
  const inserted =
    kind === "card"
      ? await admin
          .from("application_resume_tokens")
          .insert({
            application_id: applicationId,
            token_hash,
            created_at: new Date(now).toISOString(),
            expires_at: new Date(now + lifetime).toISOString(),
          })
          .select("id")
          .single()
      : await admin
          .from("application_resume_tokens")
          .insert({
            application_id: applicationId,
            token_hash,
            expires_at: new Date(now + lifetime).toISOString(),
          })
          .select("id")
          .single();
  const { data, error } = inserted;
  if (error) throw new Error(error.message);
  if (kind === "card") cardPlaintext.set(applicationId, { raw, expiresAt: now + CARD_LINK_MS });
  // The kind is read back from the lifetime just stored, so a recovery mint
  // trims recovery tokens and a 14-day mint trims session tokens.
  const trimKind: TokenKind =
    kind === "card" ? "card" : lifetime <= RECOVERY_MAX_MS ? "recovery" : "session";
  await trimLiveTokens(admin, applicationId, data?.id, trimKind);
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
 * Exposure is bounded instead: the oldest live tokens of the same kind are
 * revoked once an application has more than MAX_LIVE_TOKENS of that kind
 * out, and every one of them expires on its own. Kinds are card, recovery
 * and session: a card link never revokes a resume link, and a recovery link
 * (which anyone who knows the email can request) never revokes a session
 * token. Deliberate rotation is revokeResumeTokens() followed by this.
 *
 * purpose "card" is the caller's request only — it is not a column. A card
 * row lasts exactly CARD_LINK_MS. A caller-supplied ttlMs is not read.
 * A resume link refuses ttlMs of CARD_LINK_MS, so it cannot be stored with
 * the lifetime that marks a card row. No migration.
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
    const pending = cardInflight.get(applicationId);
    if (pending) return pending;
    const job = (async () => {
      const reused = await reuseCardLink(admin, applicationId);
      if (reused) return reused;
      return mintToken(admin, applicationId, "card");
    })();
    cardInflight.set(applicationId, job);
    try {
      return await job;
    } finally {
      cardInflight.delete(applicationId);
    }
  }
  if (opts.ttlMs === CARD_LINK_MS) {
    throw new Error("A resume link cannot last 72 hours.");
  }
  if (opts.ttlMs != null) assertAboveRecoveryWindow(opts.ttlMs);
  const ttl = opts.recovery
    ? RECOVERY_TOKEN_MINUTES * 60_000
    : opts.ttlMs ?? RESUME_TOKEN_DAYS * 86400_000;
  return mintToken(admin, applicationId, "resume", ttl);
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

  if (raw.startsWith(CARD_TOKEN_PREFIX)) throw new Error(generic);
  const row = await loadToken(admin, raw);
  // A card row opens /card only, even if the raw token was rewritten.
  if (!row || isCardRow(row)) throw new Error(generic);
  return acceptResumeRow(admin, row, generic);
}

/**
 * The application id behind a card-on-file link. The raw token must start
 * with CARD_TOKEN_PREFIX and the row must last exactly CARD_LINK_MS. Resume
 * and recovery rows fail both checks.
 */
export async function resolveCardToken(admin: AdminClient, raw: string): Promise<string> {
  const generic = "This link is no longer valid. Ask us for a new one and we'll send it over.";
  if (!raw || raw.length < 20 || raw.length > 200 || !raw.startsWith(CARD_TOKEN_PREFIX)) throw new Error(generic);
  const row = await loadToken(admin, raw);
  if (!row || row.revoked_at || !isCardRow(row)) throw new Error(generic);
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
  if (raw.startsWith(CARD_TOKEN_PREFIX)) throw new Error(generic);
  const row = await loadToken(admin, raw);
  // A card link is not an application session. /thank-you and the wizard refuse it.
  if (!row || row.revoked_at || isCardRow(row)) throw new Error(generic);
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
