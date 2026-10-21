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

export async function signWaitlistClaim(entryId: string, exp: number, secret: string): Promise<string> {
  const payload = `${entryId}.${exp}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifyWaitlistClaim(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<{ entryId: string; exp: number } | null> {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [entryId, expText, sig] = parts;
  if (!UUID.test(entryId) || !/^\d+$/.test(expText) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp) || exp * 1000 <= now) return null;
  const expected = await hmacHex(secret, `${entryId}.${expText}`);
  if (!hexEqual(expected, sig)) return null;
  return { entryId, exp };
}

/** Full /apply?claim= URL. A missing secret returns null and must not send. */
export async function waitlistClaimUrl(
  entryId: string,
  options?: { secret?: string; origin?: string; now?: number },
): Promise<string | null> {
  const secret = options?.secret ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!secret) return null;
  const now = options?.now ?? Date.now();
  const exp = Math.floor(now / 1000) + WAITLIST_CLAIM_TTL_SECONDS;
  const token = await signWaitlistClaim(entryId, exp, secret);
  const origin = options?.origin ?? (process.env.SITE_URL || "https://drivereal.com");
  return `${origin}/apply?claim=${token}`;
}
