/**
 * Stateless waitlist claim links, plus the Coming Soon rate-limit check.
 *
 * The token is entryId.exp.nonce.hexsig. A UUID has hyphens, not dots, and
 * the nonce and signature are hex, so the four parts split on ".".
 * The signed payload is entryId|email|exp|nonce. The email is not in the
 * URL. The row stores only the SHA-256 of the nonce, and the first successful
 * open clears it, so the same link cannot be opened twice.
 *
 * The HMAC key is WAITLIST_CLAIM_SECRET. The service-role key is refused.
 * A missing or too-short secret fails closed.
 *
 * This is not an application resume token and it does not read that table.
 */
import {
  COMING_SOON_ATTEMPT_ACTION,
  COMING_SOON_LIMIT_ERROR,
  COMING_SOON_WINDOW_MS,
  WAITLIST_CLAIM_SECRET_NAME,
  WAITLIST_CLAIM_TTL_SECONDS,
  claimPrefillFromRow,
  comingSoonRateDecision,
  normalizeClaimEmail,
  type WaitlistClaimPrefill,
} from "@/lib/waitlist-claim";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/;
const MIN_SECRET = 32;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
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

type SecretEnv = Record<string, string | undefined>;

/**
 * The dedicated claim secret, or null. Empty, short, and the service-role
 * key all fail closed so a claim link is never signed with a reused key.
 */
export function readClaimSecret(env: SecretEnv = process.env): string | null {
  const dedicated = env[WAITLIST_CLAIM_SECRET_NAME]?.trim() ?? "";
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (dedicated.length < MIN_SECRET) return null;
  if (service && dedicated === service) return null;
  return dedicated;
}

function claimPayload(entryId: string, email: string, exp: number, nonce: string): string {
  return `${entryId}|${email}|${exp}|${nonce}`;
}

export type ParsedClaim = { entryId: string; exp: number; nonce: string; sig: string };

export function parseWaitlistClaim(token: string): ParsedClaim | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [entryId, expText, nonce, sig] = parts;
  if (!UUID.test(entryId) || !/^\d+$/.test(expText) || !HEX_64.test(nonce) || !HEX_64.test(sig)) return null;
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp)) return null;
  return { entryId, exp, nonce, sig };
}

export async function signWaitlistClaim(args: {
  entryId: string;
  email: string;
  exp: number;
  nonce: string;
  secret: string;
}): Promise<string | null> {
  const email = normalizeClaimEmail(args.email);
  if (!email || !args.secret || !UUID.test(args.entryId) || !HEX_64.test(args.nonce)) return null;
  if (!Number.isSafeInteger(args.exp)) return null;
  const sig = await hmacHex(args.secret, claimPayload(args.entryId, email, args.exp, args.nonce));
  return `${args.entryId}.${args.exp}.${args.nonce}.${sig}`;
}

/**
 * Verify the signature against this email. A token minted for another
 * address, another secret, or a past expiry returns null.
 */
export async function verifyWaitlistClaim(
  token: string,
  secret: string,
  email: string,
  now = Date.now(),
): Promise<{ entryId: string; exp: number; nonce: string } | null> {
  if (!secret) return null;
  const parsed = parseWaitlistClaim(token);
  const norm = normalizeClaimEmail(email);
  if (!parsed || !norm) return null;
  if (parsed.exp * 1000 <= now) return null;
  const expected = await hmacHex(secret, claimPayload(parsed.entryId, norm, parsed.exp, parsed.nonce));
  if (!hexEqual(expected, parsed.sig)) return null;
  return { entryId: parsed.entryId, exp: parsed.exp, nonce: parsed.nonce };
}

/** Full /apply?claim= URL. A missing secret returns null and must not send. */
export async function waitlistClaimUrl(input: {
  entryId: string;
  email: string;
  secret?: string;
  origin?: string;
  now?: number;
  nonce?: string;
  env?: SecretEnv;
}): Promise<{ href: string; tokenHash: string } | null> {
  const env = input.env ?? process.env;
  const secret = input.secret ?? readClaimSecret(env);
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!secret || (service && secret === service)) return null;
  const email = normalizeClaimEmail(input.email);
  if (!email) return null;
  const now = input.now ?? Date.now();
  const exp = Math.floor(now / 1000) + WAITLIST_CLAIM_TTL_SECONDS;
  const nonce = input.nonce ?? newClaimNonce();
  const token = await signWaitlistClaim({ entryId: input.entryId, email, exp, nonce, secret });
  if (!token) return null;
  const origin = input.origin ?? (env.SITE_URL || "https://drivereal.com");
  return { href: `${origin}/apply?claim=${token}`, tokenHash: await claimTokenHash(nonce) };
}

export type ClaimStoreRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  pickup_date: string | null;
  market_id: string | null;
  status: string;
  claim_token_hash: string | null;
};

export type ClaimStore = {
  load: (entryId: string) => Promise<ClaimStoreRow | null>;
  consume: (entryId: string, tokenHash: string) => Promise<ClaimStoreRow | null>;
};

const INVALID = { ok: false as const, error: "This link is not valid." };

/**
 * Open a claim. The prefill is returned only after the stored hash is
 * cleared, so a second open of the same token loses. A missing secret does
 * not read the row.
 */
export async function openWaitlistClaim(
  store: ClaimStore,
  token: string,
  secret: string | null,
  now = Date.now(),
): Promise<{ ok: true; prefill: WaitlistClaimPrefill } | { ok: false; error: string }> {
  if (!secret) return INVALID;
  const parsed = parseWaitlistClaim(token);
  if (!parsed || parsed.exp * 1000 <= now) return INVALID;
  const row = await store.load(parsed.entryId);
  if (!row) return INVALID;
  const verified = await verifyWaitlistClaim(token, secret, row.email, now);
  if (!verified) return INVALID;
  const hash = await claimTokenHash(verified.nonce);
  if (!row.claim_token_hash || !hexEqual(row.claim_token_hash, hash)) return INVALID;
  const prefill = claimPrefillFromRow(row);
  if (!prefill.ok) return prefill;
  const won = await store.consume(row.id, hash);
  if (!won) return INVALID;
  return claimPrefillFromRow(won);
}

const CLAIM_ROW =
  "id,full_name,email,phone,city,state,pickup_date,market_id,status,claim_token_hash";

/** Supabase adapter. The consume update matches one unused hash and clears it. */
export function claimStoreFromSupabase(admin: { from: (table: string) => any }): ClaimStore {
  return {
    async load(entryId) {
      const { data, error } = await admin
        .from("waitlist")
        .select(CLAIM_ROW)
        .eq("id", entryId)
        .maybeSingle();
      if (error || !data) return null;
      return data as ClaimStoreRow;
    },
    async consume(entryId, tokenHash) {
      const { data, error } = await admin
        .from("waitlist")
        .update({ claim_token_hash: null })
        .eq("id", entryId)
        .eq("claim_token_hash", tokenHash)
        .in("status", ["waiting", "notified"])
        .select(CLAIM_ROW);
      if (error || !Array.isArray(data) || data.length !== 1) return null;
      return data[0] as ClaimStoreRow;
    },
  };
}

async function attemptCount(
  admin: { from: (table: string) => any },
  field: "email_hash" | "ip_hash",
  value: string,
  since: string,
): Promise<number | null> {
  const { count, error } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", COMING_SOON_ATTEMPT_ACTION)
    .gte("created_at", since)
    .contains("metadata", { [field]: value });
  if (error || typeof count !== "number") return null;
  return count;
}

async function clientIp(secret: string): Promise<string | null> {
  try {
    const serverSpec = "@tanstack/react-start/server";
    const { getRequest } = await import(serverSpec);
    const req = getRequest();
    const ip =
      req?.headers?.get("cf-connecting-ip") ||
      req?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "";
    if (!ip) return null;
    return hmacHex(secret, `coming-soon-ip|${ip}`);
  } catch {
    return null;
  }
}

/**
 * Record one Coming Soon attempt and refuse when this email or address is
 * over the hour window. A missing secret or address does not insert a
 * waitlist row. The audit row stores hashes, not the email or the IP.
 */
export async function enforceComingSoonRate(
  admin: { from: (table: string) => any },
  email: string,
  env: SecretEnv = process.env,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = readClaimSecret(env);
  const norm = normalizeClaimEmail(email);
  if (!secret || !norm) return { ok: false, error: COMING_SOON_LIMIT_ERROR };
  const ipHash = await clientIp(secret);
  if (!ipHash) return { ok: false, error: COMING_SOON_LIMIT_ERROR };
  const emailHash = await hmacHex(secret, `coming-soon-email|${norm}`);
  const { error: insertError } = await admin.from("audit_log").insert({
    actor_user_id: null,
    actor_email: null,
    actor_role: null,
    action: COMING_SOON_ATTEMPT_ACTION,
    entity_type: "waitlist",
    entity_id: null,
    summary: "Coming Soon waitlist signup attempt",
    metadata: { email_hash: emailHash, ip_hash: ipHash },
    ip: null,
    user_agent: null,
  });
  if (insertError) return { ok: false, error: COMING_SOON_LIMIT_ERROR };
  const since = new Date(Date.now() - COMING_SOON_WINDOW_MS).toISOString();
  const [emailAttempts, ipAttempts] = await Promise.all([
    attemptCount(admin, "email_hash", emailHash, since),
    attemptCount(admin, "ip_hash", ipHash, since),
  ]);
  if (emailAttempts == null || ipAttempts == null) return { ok: false, error: COMING_SOON_LIMIT_ERROR };
  return comingSoonRateDecision({ emailAttempts, ipAttempts, ipKnown: true });
}
