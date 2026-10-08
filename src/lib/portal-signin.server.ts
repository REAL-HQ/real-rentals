/**
 * Passwordless Driver Portal sign-in (unified identity, Phase 2).
 *
 * One identity per person = one auth user keyed by the verified email. Typing
 * an email creates nothing and reveals nothing: the public response is the
 * same for known and unknown addresses. Only after the code/link proves inbox
 * control is an auth user found or created (flagged app_metadata.portal_verified
 * so approval can safely adopt it), linked to an unambiguous application, and
 * handed a normal Supabase session through the existing auth system.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient<any>;

export const CODE_MINUTES = 10;
const RESEND_GAP_S = 60;
const PER_EMAIL_HOUR = 5;
const PER_IP_HOUR = 20;
const MAX_ATTEMPTS = 5;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function hmac(value: string): Promise<string> {
  // Server-only pepper so a leaked row cannot be brute-forced offline.
  const pepper = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "portal-signin";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

/** ilike pattern that matches the literal address only (escape % _ \\). */
export function exactLike(e: string): string {
  return e.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function normEmail(e: string): string {
  return String(e ?? "").trim().toLowerCase();
}

function randomCode(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, "0");
}
function randomToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function clientIpHash(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const ip = req?.headers.get("cf-connecting-ip") || req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return ip ? await hmac(`ip|${ip}`) : null;
  } catch {
    return null;
  }
}

export async function findAuthUser(admin: Admin, email: string): Promise<any | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const hit = users.find((u: any) => normEmail(u.email) === email);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

async function isStaff(admin: Admin, userId: string): Promise<boolean> {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).some((r: any) => ["admin", "team", "coordinator", "partner"].includes(String(r.role)));
}

/** Someone we have a record for: an account, an application or a waitlist entry. */
async function isEligible(admin: Admin, email: string): Promise<boolean> {
  const user = await findAuthUser(admin, email);
  if (user) return !(await isStaff(admin, user.id)); // staff keep password sign-in on /admin
  const { count: apps } = await admin.from("applications").select("id", { count: "exact", head: true }).ilike("email", exactLike(email)).is("deleted_at", null);
  if ((apps ?? 0) > 0) return true;
  const { count: wl } = await admin.from("waitlist").select("id", { count: "exact", head: true }).ilike("email", exactLike(email));
  return (wl ?? 0) > 0;
}

export type RequestOutcome = { retryAfter: number };

/**
 * Same answer for every address. Rows are written for unknown emails too, so
 * the throttle (and its countdown) behaves identically and cannot leak.
 */
export async function requestSignIn(admin: Admin, rawEmail: string, origin: string): Promise<RequestOutcome> {
  const email = normEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { retryAfter: RESEND_GAP_S };
  const ipHash = await clientIpHash();
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();

  const { data: recent } = await admin
    .from("portal_signin_challenges")
    .select("created_at")
    .eq("email", email)
    .gte("created_at", hourAgo)
    .order("created_at", { ascending: false });
  const last = recent?.[0]?.created_at ? new Date(recent[0].created_at).getTime() : 0;
  const gap = Math.ceil((last + RESEND_GAP_S * 1000 - Date.now()) / 1000);
  if (gap > 0) return { retryAfter: gap };
  if ((recent?.length ?? 0) >= PER_EMAIL_HOUR) {
    const oldest = new Date(recent![recent!.length - 1].created_at).getTime();
    return { retryAfter: Math.max(60, Math.ceil((oldest + 3600_000 - Date.now()) / 1000)) };
  }
  if (ipHash) {
    const { count } = await admin.from("portal_signin_challenges").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", hourAgo);
    if ((count ?? 0) >= PER_IP_HOUR) return { retryAfter: 600 };
  }

  const eligible = await isEligible(admin, email);
  const code = randomCode();
  const token = randomToken();
  const { data: row, error } = await admin
    .from("portal_signin_challenges")
    .insert({
      email,
      code_hash: await hmac(`code|${email}|${code}`),
      link_hash: await hmac(`link|${token}`),
      eligible,
      ip_hash: ipHash,
      expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error("Could not start sign-in");

  if (eligible) {
    const { sendPortalSignInEmail } = await import("@/lib/email.server");
    const link = `${origin}/login?signin=${encodeURIComponent(token)}`;
    const res = await sendPortalSignInEmail({ to: email, code, link, minutes: CODE_MINUTES });
    await admin.from("portal_signin_challenges").update({ send_state: res.ok ? "sent" : "failed" }).eq("id", row.id);
  }
  return { retryAfter: RESEND_GAP_S };
}

export type VerifyResult =
  | { ok: true; tokenHash: string; linked: "linked" | "already" | "none" | "review" }
  | { ok: false; error: string };

const BAD = { ok: false as const, error: "That code or link is invalid or has expired. Request a new one." };

/** Consume a code or link exactly once, then establish the unified identity. */
export async function verifySignIn(admin: Admin, input: { email?: string; code?: string; token?: string }): Promise<VerifyResult> {
  let challenge: any = null;
  const now = new Date().toISOString();

  if (input.token) {
    const { data } = await admin
      .from("portal_signin_challenges")
      .update({ used_at: now })
      .eq("link_hash", await hmac(`link|${input.token}`))
      .is("used_at", null)
      .gt("expires_at", now)
      .eq("eligible", true)
      .select("id,email")
      .maybeSingle();
    challenge = data;
  } else if (input.email && input.code && /^\d{6}$/.test(input.code)) {
    const email = normEmail(input.email);
    const { data: latest } = await admin
      .from("portal_signin_challenges")
      .select("id,email,code_hash,attempts,eligible")
      .eq("email", email)
      .is("used_at", null)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest || latest.attempts >= MAX_ATTEMPTS) return BAD;
    // Count the attempt before comparing, so parallel guesses still burn tries.
    await admin.from("portal_signin_challenges").update({ attempts: latest.attempts + 1 }).eq("id", latest.id).eq("attempts", latest.attempts);
    if (!latest.eligible || latest.code_hash !== (await hmac(`code|${email}|${input.code}`))) return BAD;
    const { data } = await admin
      .from("portal_signin_challenges")
      .update({ used_at: now })
      .eq("id", latest.id)
      .is("used_at", null)
      .select("id,email")
      .maybeSingle();
    challenge = data;
  }
  if (!challenge) return BAD;
  const email: string = challenge.email;

  // Identity: the verified email IS the person. Create only now, after proof.
  let user = await findAuthUser(admin, email);
  if (user && (await isStaff(admin, user.id))) return BAD;
  if (!user) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { portal_verified: true },
    });
    if (error || !created?.user) return { ok: false, error: "Sign-in is unavailable right now. Please try again." };
    user = created.user;
  } else if (!user.app_metadata?.portal_verified) {
    await admin.auth.admin.updateUserById(user.id, { app_metadata: { ...(user.app_metadata ?? {}), portal_verified: true } });
  }

  const linked = await linkVerifiedApplication(admin, user.id, email);

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = (link as any)?.properties?.hashed_token;
  if (linkErr || !tokenHash) return { ok: false, error: "Sign-in is unavailable right now. Please try again." };

  const { logAudit } = await import("@/lib/audit.server");
  await logAudit(null, {
    action: "portal.passwordless_signin",
    summary: `Passwordless portal sign-in (${input.token ? "link" : "code"})`,
    entityType: "auth_user",
    entityId: user.id,
    metadata: { method: input.token ? "link" : "code", application_link: linked },
  });
  return { ok: true, tokenHash, linked };
}

/**
 * Link exactly one unambiguous application to a verified identity. Never
 * relinks an application owned by someone else, never picks between several,
 * never matches on phone. Ambiguity is flagged for staff instead.
 */
export async function linkVerifiedApplication(admin: Admin, userId: string, email: string): Promise<"linked" | "already" | "none" | "review"> {
  const { data: apps } = await admin
    .from("applications")
    .select("id,email,user_id,ai_flags")
    .ilike("email", exactLike(email))
    .is("deleted_at", null);
  const list = (apps ?? []).filter((a: any) => normEmail(a.email) === email);
  if (list.some((a: any) => a.user_id === userId)) return "already";
  if (list.length === 0) return "none";
  const foreign = list.filter((a: any) => a.user_id && a.user_id !== userId);
  const free = list.filter((a: any) => !a.user_id);
  if (foreign.length > 0 || free.length !== 1) {
    const note = "Identity review: verified portal sign-in matched more than one record — not linked automatically";
    for (const a of free) {
      const flags = Array.isArray(a.ai_flags) ? a.ai_flags : [];
      if (!flags.includes(note)) await admin.from("applications").update({ ai_flags: [...flags, note] }).eq("id", a.id);
    }
    return "review";
  }
  const { error } = await admin.from("applications").update({ user_id: userId }).eq("id", free[0].id).is("user_id", null);
  return error ? "review" : "linked";
}
