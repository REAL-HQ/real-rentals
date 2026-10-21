/**
 * Dark gate for a real waitlist claim link.
 * Coming Soon stays on its browser insert and does not follow this flag.
 *
 * false: the opening email is the current /apply link, and a failed send still
 * marks the row Notified.
 * true: the email carries a claim link, and Notified is written only after
 * the send succeeds.
 * Coming Soon stays on the browser insert either way, including driver_status.
 * It does not call joinWaitlist.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding, and it needs a new WAITLIST_CLAIM_SECRET: at least 32
 * characters, and not the service-role key. Without that secret the enabled
 * path sends no link and does not mark Notified. Leave the flag false until
 * an owner does both.
 *
 * Typed as boolean so the enabled branch stays visible to the type checker.
 */
export const WAITLIST_CLAIM_ENABLED: boolean = false;

/** Dedicated signer. Never the service-role key. */
export const WAITLIST_CLAIM_SECRET_NAME = "WAITLIST_CLAIM_SECRET";

/** 72 hours. Not an application resume token. */
export const WAITLIST_CLAIM_TTL_SECONDS = 72 * 60 * 60;

const APPLY_SEARCH_KEYS = ["t", "city", "pickup", "vehicle", "vehicle_type"] as const;

/**
 * Search keys /apply keeps. The claim token is a URL fragment, never one of
 * these keys, so a query string cannot carry it into landing_page or gtag.
 */
export function applySearchKeys(_enabled: boolean): readonly string[] {
  return APPLY_SEARCH_KEYS;
}

const CLAIM_QUERY = /(?:^|[?&])claim=([^&#]*)/;
const CLAIM_HASH = /(?:^|[#&])claim=([^&#]*)/;

/** A claim value from the query or fragment. `reclaim=` is a different key. */
export function claimTokenFromUrl(search: string, hash: string): string | null {
  const query = CLAIM_QUERY.exec(search);
  const frag = CLAIM_HASH.exec(hash);
  const raw = frag?.[1] || query?.[1] || "";
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function shouldMarkNotified(enabled: boolean, sendOk: boolean): boolean {
  // Off: mark every attempt, including a failed send. On: only a successful send.
  return enabled ? sendOk : true;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const OPENING_SUBJECT = "A car just opened up — you're next";

export function openingEmail(input: {
  enabled: boolean;
  fullName: string | null;
  city: string | null;
  href: string;
  companyPhone: string;
}): { subject: string; html: string } {
  const first = escapeHtml(String(input.fullName ?? "").split(" ")[0]);
  const where = input.city ? ` in ${escapeHtml(input.city)}` : "";
  const phone = escapeHtml(input.companyPhone);
  const href = input.href;
  // The disabled copy is the email notifyWaitlistTop sends today, including
  // its whitespace. The enabled copy does not say an application already
  // exists and does not say the person stays at the top of the list.
  const html = input.enabled
    ? `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
          <p style="font-size:15px;line-height:1.6">Hi ${first},</p>
          <p style="font-size:15px;line-height:1.6">Good news — a car just became available${where}. This link opens a new application with the name, email, and phone from your waitlist spot. It does not hold the car.</p>
          <p style="margin:28px 0">
            <a href="${href}" style="background:#D03020;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">Claim it — finish your application</a>
          </p>
          <p style="font-size:13px;line-height:1.6;color:#666">This link is only for this email and it expires in 72 hours.</p>
          <p style="color:#888;font-size:12px;margin-top:24px">REAL RENTALS · team@drivereal.com · ${phone}</p>
        </div>`
    : `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
          <p style="font-size:15px;line-height:1.6">Hi ${first},</p>
          <p style="font-size:15px;line-height:1.6">Good news — a car just became available${where}. You were at the top of the waitlist, so it's yours to claim before we offer it to anyone else.</p>
          <p style="margin:28px 0">
            <a href="${href}" style="background:#D03020;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">Claim it — finish your application</a>
          </p>
          <p style="font-size:13px;line-height:1.6;color:#666">This link takes you straight into the application you started. If the car has already been claimed, you stay at the top of the list for the next one.</p>
          <p style="color:#888;font-size:12px;margin-top:24px">REAL RENTALS · team@drivereal.com · ${phone}</p>
        </div>`;
  return { subject: OPENING_SUBJECT, html };
}

type OpeningRow = { id: string; full_name?: string | null; email: string; city?: string | null };
export type ClaimLink = { href: string; tokenHash: string };

/**
 * Sends one opening email per row. The caller supplies send and markNotified,
 * so tests never touch a mail provider. claimUrl is not called while the
 * flag is off. While the flag is on, reserve must store the nonce hash before
 * the send; a failed reserve sends nothing and marks nobody.
 */
export async function deliverOpeningEmails<T extends OpeningRow>(args: {
  enabled: boolean;
  rows: readonly T[];
  origin: string;
  companyPhone: string;
  claimUrl: (row: T) => Promise<ClaimLink | null>;
  reserve?: (id: string, tokenHash: string) => Promise<boolean>;
  release?: (id: string, tokenHash: string) => Promise<void>;
  send: (message: { to: string; subject: string; html: string }) => Promise<{ ok: boolean }>;
  markNotified: (id: string, tokenHash: string | null) => Promise<boolean | void>;
}): Promise<{ sent: number }> {
  let sent = 0;
  for (const row of args.rows) {
    let href = `${args.origin}/apply`;
    let tokenHash: string | null = null;
    if (args.enabled) {
      const claim = await args.claimUrl(row);
      // No secret, or the hash could not be stored: do not send and do not mark Notified.
      if (!claim) continue;
      if (args.reserve && !(await args.reserve(row.id, claim.tokenHash))) continue;
      href = claim.href;
      tokenHash = claim.tokenHash;
    }
    const message = openingEmail({
      enabled: args.enabled,
      fullName: row.full_name ?? null,
      city: row.city ?? null,
      href,
      companyPhone: args.companyPhone,
    });
    const res = await args.send({ to: row.email, subject: message.subject, html: message.html });
    if (!res.ok && args.enabled && tokenHash && args.release) await args.release(row.id, tokenHash);
    if (!shouldMarkNotified(args.enabled, res.ok)) continue;
    const marked = await args.markNotified(row.id, tokenHash);
    if (res.ok && marked !== false) sent += 1;
  }
  return { sent };
}

export type ComingSoonFields = {
  market_id: string | null;
  full_name: string;
  email: string;
  phone: string;
  driver_status: string;
  city: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
};

export type ComingSoonInsert = {
  market_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  driver_status: string;
  source: "homepage_waitlist";
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
};

/**
 * Coming Soon payload. The claim flag does not change this. Both values
 * return the existing browser insert, including driver_status, so the signup
 * does not go through joinWaitlist.
 */
export function comingSoonSignup(_enabled: boolean, fields: ComingSoonFields): { mode: "insert"; row: ComingSoonInsert } {
  return {
    mode: "insert",
    row: {
      market_id: fields.market_id,
      full_name: fields.full_name,
      email: fields.email,
      phone: fields.phone || null,
      driver_status: fields.driver_status,
      source: "homepage_waitlist",
      utm_source: fields.utm_source,
      utm_medium: fields.utm_medium,
      utm_campaign: fields.utm_campaign,
      utm_term: fields.utm_term,
      utm_content: fields.utm_content,
      gclid: fields.gclid,
    },
  };
}

export type WaitlistClaimPrefill = {
  full_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  pickup_date: string | null;
  market_id: string | null;
};

type ClaimRow = WaitlistClaimPrefill & { status: string };

/** What a verified claim may show. Only a waiting or notified row may prefill. */
export function claimPrefillFromRow(row: ClaimRow | null):
  | { ok: true; prefill: WaitlistClaimPrefill }
  | { ok: false; error: string } {
  if (!row) return { ok: false, error: "This link is not valid." };
  if (row.status === "promoted") {
    return { ok: false, error: "This waitlist spot already has an application." };
  }
  if (row.status !== "waiting" && row.status !== "notified") {
    return { ok: false, error: "This link is not valid." };
  }
  return {
    ok: true,
    prefill: {
      full_name: row.full_name,
      email: row.email,
      phone: row.phone,
      city: row.city,
      state: row.state,
      pickup_date: row.pickup_date,
      market_id: row.market_id,
    },
  };
}
