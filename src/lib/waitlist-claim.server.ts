/**
 * Stateless waitlist claim links. The token is entryId.exp.hexsig.
 * A UUID has hyphens, not dots, so the three parts split on ".".
 * This is not an application resume token and it does not read that table.
 */
import { WAITLIST_CLAIM_TTL_SECONDS } from "@/lib/waitlist-claim";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** SHA-256 of the trimmed, lower-cased email. Bound into the signature, not the URL. */
export async function claimEmailHash(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return hex(new Uint8Array(digest));
}

/** Structure and expiry only. The signature is checked once the row email is known. */
export function peekWaitlistClaim(token: string, now = Date.now()): { entryId: string; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [entryId, expText, sig] = parts;
  if (!UUID.test(entryId) || !/^\d+$/.test(expText) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp) || exp * 1000 <= now) return null;
  return { entryId, exp };
}

/** Signs entryId.exp.sha256(lower(trim(email))). The token stays entryId.exp.sig. */
export async function signWaitlistClaim(entryId: string, exp: number, email: string, secret: string): Promise<string> {
  const payload = `${entryId}.${exp}.${await claimEmailHash(email)}`;
  return `${entryId}.${exp}.${await hmacHex(secret, payload)}`;
}

export async function verifyWaitlistClaim(
  token: string,
  secret: string,
  email: string,
  now = Date.now(),
): Promise<{ entryId: string; exp: number } | null> {
  if (!secret || !email.trim()) return null;
  const peeked = peekWaitlistClaim(token, now);
  if (!peeked) return null;
  const expText = token.split(".")[1];
  const sig = token.split(".")[2];
  const expected = await hmacHex(secret, `${peeked.entryId}.${expText}.${await claimEmailHash(email)}`);
  if (!hexEqual(expected, sig)) return null;
  return peeked;
}

/** Full /apply?claim= URL. A missing WAITLIST_CLAIM_SECRET returns null and must not send. */
export async function waitlistClaimUrl(
  entryId: string,
  email: string,
  options?: { secret?: string; origin?: string; now?: number },
): Promise<string | null> {
  const secret = options?.secret ?? process.env.WAITLIST_CLAIM_SECRET ?? "";
  if (!secret || !email.trim()) return null;
  const now = options?.now ?? Date.now();
  const exp = Math.floor(now / 1000) + WAITLIST_CLAIM_TTL_SECONDS;
  const token = await signWaitlistClaim(entryId, exp, email, secret);
  const origin = options?.origin ?? (process.env.SITE_URL || "https://drivereal.com");
  return `${origin}/apply?claim=${token}`;
}
