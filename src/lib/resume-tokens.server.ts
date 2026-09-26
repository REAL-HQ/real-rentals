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

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function hashResumeToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return hex(new Uint8Array(digest));
}

function newRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url: URL-safe, and shorter than hex for the same 256 bits.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** How many unexpired links one application may have out at once. */
const MAX_LIVE_TOKENS = 5;

/**
 * Mint a resume token for an application.
 *
 * Deliberately additive rather than rotating. Only the hash is stored, so a
 * token cannot be recalled once minted — which means "reissue" can only ever
 * mean "mint another". If every issue revoked the previous one, a recovery
 * email sent by the nightly cron would kill the link in the tab the applicant
 * already had open, and their next autosave would fail mid-sentence.
 *
 * Exposure is bounded instead: the oldest live tokens are revoked once an
 * application has more than MAX_LIVE_TOKENS out, and every one of them expires
 * on its own. Deliberate rotation is revokeResumeTokens() followed by this.
 *
 * Returns the raw token. This is the only moment it exists in plaintext.
 */
export async function issueResumeToken(admin: AdminClient, applicationId: string): Promise<string> {
  const raw = newRawToken();
  const expires = new Date(Date.now() + RESUME_TOKEN_DAYS * 86400_000).toISOString();

  const { error } = await admin.from("application_resume_tokens").insert({
    application_id: applicationId,
    token_hash: await hashResumeToken(raw),
    expires_at: expires,
  });
  if (error) throw new Error(error.message);

  // Trim the tail. Best-effort: failing to tidy up must not fail the issue.
  const { data: live } = await admin
    .from("application_resume_tokens")
    .select("id")
    .eq("application_id", applicationId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  const excess = (live ?? []).slice(MAX_LIVE_TOKENS).map((r: { id: string }) => r.id);
  if (excess.length) {
    await admin
      .from("application_resume_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .in("id", excess);
  }

  return raw;
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

  const { data: row } = await admin
    .from("application_resume_tokens")
    .select("id,application_id,expires_at,revoked_at")
    .eq("token_hash", await hashResumeToken(raw))
    .maybeSingle();

  if (!row) throw new Error(generic);
  if (row.revoked_at) throw new Error(generic);
  if (new Date(row.expires_at as string).getTime() < Date.now()) throw new Error(generic);

  // Best-effort; a failed timestamp must not deny a valid applicant.
  await admin
    .from("application_resume_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id);

  return row.application_id as string;
}
