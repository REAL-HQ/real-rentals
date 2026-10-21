/**
 * Waitlist claim links. The token is entryId.exp.nonce.sig.
 * The signature covers the applicant email and the nonce. The row stores
 * only the SHA-256 of the nonce. The first successful open clears that hash.
 * This is not an application resume token and it does not read that table.
 *
 * Web Crypto only. The signer is WAITLIST_CLAIM_SECRET, never the service-role key.
 */
import { WAITLIST_CLAIM_SECRET_NAME, WAITLIST_CLAIM_TTL_SECONDS, claimPrefillFromRow, type WaitlistClaimPrefill } from "@/lib/waitlist-claim";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_SECRET = 32;

export type ClaimRow = WaitlistClaimPrefill & { status: string; claim_token_hash: string | null };

export type ClaimStore = {
  load: (entryId: string) => Promise<{ error: true } | { error?: false; row: ClaimRow | null }>;
  consume: (entryId: string, tokenHash: string) => Promise<boolean>;
};

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/** Trimmed and lower-cased. A pipe or newline would split the signed payload, so those addresses are refused. */
export function normalizeClaimEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized || /[|\r\n]/.test(normalized)) return null;
  return normalized;
}

export function acceptClaimSecret(secret: string, serviceRole = ""): string | null {
  if (secret.length < MIN_SECRET) return null;
  if (serviceRole && secret === serviceRole) return null;
  return secret;
}

/** Fail closed: missing, short, or equal to the service-role key. */
export function readClaimSecret(env: Record<string, string | undefined> = process.env): string | null {
  return acceptClaimSecret(env[WAITLIST_CLAIM_SECRET_NAME] ?? "", env.SUPABASE_SERVICE_ROLE_KEY ?? "");
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return hex(new Uint8Array(sig));
}

export async function claimTokenHash(nonce: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  return hex(new Uint8Array(digest));
}

export function newClaimNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

export function peekWaitlistClaim(token: string, now = Date.now()): { entryId: string; exp: number; nonce: string } | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [entryId, expText, nonce, sig] = parts;
  if (!UUID.test(entryId) || !/^\d+$/.test(expText) || !/^[0-9a-f]{64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp) || exp * 1000 <= now) return null;
  return { entryId, exp, nonce };
}

export async function signWaitlistClaim(entryId: string, exp: number, email: string, nonce: string, secret: string): Promise<string | null> {
  const normalized = normalizeClaimEmail(email);
  if (!normalized || !acceptClaimSecret(secret)) return null;
  const payload = `${entryId}|${normalized}|${exp}|${nonce}`;
  return `${entryId}.${exp}.${nonce}.${await hmacHex(secret, payload)}`;
}

export async function verifyWaitlistClaim(
  token: string,
  secret: string,
  email: string,
  now = Date.now(),
): Promise<{ entryId: string; exp: number; nonce: string; tokenHash: string } | null> {
  if (!acceptClaimSecret(secret)) return null;
  const peeked = peekWaitlistClaim(token, now);
  const normalized = normalizeClaimEmail(email);
  if (!peeked || !normalized) return null;
  const expected = await hmacHex(secret, `${peeked.entryId}|${normalized}|${peeked.exp}|${peeked.nonce}`);
  const sig = token.split(".")[3] ?? "";
  if (!hexEqual(expected, sig)) return null;
  return { ...peeked, tokenHash: await claimTokenHash(peeked.nonce) };
}

/** Fragment URL. A bad secret returns null and must not send. The email is not in the URL. */
export async function waitlistClaimUrl(input: {
  entryId: string;
  email: string;
  secret?: string;
  origin?: string;
  now?: number;
  nonce?: string;
  env?: Record<string, string | undefined>;
}): Promise<{ href: string; tokenHash: string } | null> {
  const env = input.env ?? process.env;
  const secret = input.secret ?? readClaimSecret(env) ?? "";
  if (!acceptClaimSecret(secret, input.secret ? (env.SUPABASE_SERVICE_ROLE_KEY ?? "") : "")) return null;
  const now = input.now ?? Date.now();
  const exp = Math.floor(now / 1000) + WAITLIST_CLAIM_TTL_SECONDS;
  const nonce = input.nonce ?? newClaimNonce();
  const token = await signWaitlistClaim(input.entryId, exp, input.email, nonce, secret);
  if (!token) return null;
  const origin = input.origin ?? (env.SITE_URL || "https://drivereal.com");
  return { href: `${origin}/apply#claim=${token}`, tokenHash: await claimTokenHash(nonce) };
}

/**
 * Verify the token against the row email, then clear the stored nonce hash.
 * A missing column, a second open, or a wrong email fails closed and does not prefill.
 */
export async function openWaitlistClaim(
  store: ClaimStore,
  token: string,
  secret: string,
  now = Date.now(),
): Promise<{ ok: true; prefill: WaitlistClaimPrefill } | { ok: false; error: string }> {
  if (!acceptClaimSecret(secret)) return { ok: false, error: "This link is not valid." };
  const peeked = peekWaitlistClaim(token, now);
  if (!peeked) return { ok: false, error: "This link is not valid." };
  const loaded = await store.load(peeked.entryId);
  if (loaded.error) return { ok: false, error: "This link is not valid." };
  const row = loaded.row;
  if (!row?.email) return { ok: false, error: "This link is not valid." };
  const verified = await verifyWaitlistClaim(token, secret, row.email, now);
  if (!verified || !row.claim_token_hash || !hexEqual(row.claim_token_hash, verified.tokenHash)) {
    return { ok: false, error: "This link is not valid." };
  }
  const prefill = claimPrefillFromRow(row);
  if (!prefill.ok) return prefill;
  const consumed = await store.consume(verified.entryId, verified.tokenHash);
  if (!consumed) return { ok: false, error: "This link is not valid." };
  return prefill;
}

const CLAIM_ROW = "id,full_name,email,phone,city,state,pickup_date,market_id,status,claim_token_hash";

/** Service-role reader. Selecting the hash fails closed when the proposed column is not there yet. */
export function claimStoreFromSupabase(admin: { from: (table: string) => any }): ClaimStore {
  return {
    async load(entryId) {
      const { data, error } = await admin.from("waitlist").select(CLAIM_ROW).eq("id", entryId).maybeSingle();
      if (error) return { error: true };
      return { row: (data as ClaimRow | null) ?? null };
    },
    async consume(entryId, tokenHash) {
      const { data, error } = await admin
        .from("waitlist")
        .update({ claim_token_hash: null })
        .eq("id", entryId)
        .eq("claim_token_hash", tokenHash)
        .in("status", ["waiting", "notified"])
        .select("id");
      return !error && Array.isArray(data) && data.length === 1;
    },
  };
}
