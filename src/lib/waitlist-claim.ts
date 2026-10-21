/**
 * Dark gate for a real waitlist claim link and for Coming Soon signups
 * that go through joinWaitlist.
 *
 * false: the opening email is the current /apply link, a failed send still
 * marks the row Notified, and Coming Soon still inserts from the browser.
 * true: the email carries a single-use claim link bound to that row's email,
 * Notified is written only after the send succeeds, and Coming Soon calls
 * joinWaitlist behind a rate limit.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that, and until the
 * proposed claim_token_hash column exists. A missing signing secret fails
 * closed: no link, no send, no Notified stamp.
 *
 * Typed as boolean so the enabled branch stays visible to the type checker.
 */
export const WAITLIST_CLAIM_ENABLED: boolean = false;

/** Dedicated HMAC secret. Never the service-role key. */
export const WAITLIST_CLAIM_SECRET_NAME = "WAITLIST_CLAIM_SECRET";

/** Coming Soon attempts, counted inside one hour, including the current one. */
export const COMING_SOON_EMAIL_LIMIT = 5;
export const COMING_SOON_IP_LIMIT = 20;
export const COMING_SOON_WINDOW_MS = 60 * 60 * 1000;
export const COMING_SOON_LIMIT_ERROR = "Please try again later.";
export const COMING_SOON_ATTEMPT_ACTION = "waitlist.coming_soon_attempt";

/** Fourteen days. Not an application resume token. */
export const WAITLIST_CLAIM_TTL_SECONDS = 14 * 24 * 60 * 60;

const APPLY_SEARCH_KEYS = ["t", "city", "pickup", "vehicle", "vehicle_type"] as const;

/** Search keys /apply keeps. `claim` is recognized only while the flag is on. */
export function applySearchKeys(enabled: boolean): readonly string[] {
  if (!enabled) return APPLY_SEARCH_KEYS;
  return [...APPLY_SEARCH_KEYS, "claim"];
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
          <p style="font-size:13px;line-height:1.6;color:#666">This link is only for this email and it expires in 14 days.</p>
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

/** A claim link plus the hash the row must store before the link will open. */
export type ClaimLink = { href: string; tokenHash: string };

/**
 * Sends one opening email per row. The caller supplies send and markNotified,
 * so tests never touch a mail provider. claimUrl is not called while the
 * flag is off.
 *
 * Flag off: a failed send still marks Notified, and the hash is null so the
 * caller must not write claim_token_hash. Flag on: no hash and no successful
 * send means no Notified write.
 */
export async function deliverOpeningEmails<T extends OpeningRow>(args: {
  enabled: boolean;
  rows: readonly T[];
  origin: string;
  companyPhone: string;
  claimUrl: (row: T) => Promise<ClaimLink | null>;
  send: (message: { to: string; subject: string; html: string }) => Promise<{ ok: boolean }>;
  markNotified: (id: string, tokenHash: string | null) => Promise<void | boolean>;
}): Promise<{ sent: number }> {
  let sent = 0;
  for (const row of args.rows) {
    let href = `${args.origin}/apply`;
    let tokenHash: string | null = null;
    if (args.enabled) {
      const claim = await args.claimUrl(row);
      // No secret, no link: do not send and do not mark Notified.
      if (!claim?.href || !claim.tokenHash) continue;
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
    if (args.enabled) {
      if (!res?.ok) continue;
      const marked = await args.markNotified(row.id, tokenHash);
      if (marked === false) continue;
      sent += 1;
      continue;
    }
    if (res?.ok) sent += 1;
    await args.markNotified(row.id, null);
  }
  return { sent };
}

/**
 * Drop a claim token from a stored landing page or referrer.
 * The value may be a path (`/apply?claim=…`) or an absolute URL.
 * Other query params stay. A value with no claim param is returned as-is.
 */
export function landingPageWithoutClaim(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value);
  if (!raw) return raw;
  const q = raw.indexOf("?");
  if (q === -1) return raw;
  const hashAt = raw.indexOf("#", q);
  const query = raw.slice(q + 1, hashAt === -1 ? undefined : hashAt);
  const params = new URLSearchParams(query);
  if (!params.has("claim")) return raw;
  params.delete("claim");
  const next = params.toString();
  const suffix = hashAt === -1 ? "" : raw.slice(hashAt);
  return `${raw.slice(0, q)}${next ? `?${next}` : ""}${suffix}`;
}

export function normalizeClaimEmail(email: string | null | undefined): string | null {
  const norm = String(email ?? "").trim().toLowerCase();
  if (!norm || norm.includes("|") || norm.includes("\n") || norm.includes("\r")) return null;
  return norm;
}

/**
 * Coming Soon rate decision. Counts include the attempt being judged.
 * A missing client address fails closed. The message is the same for every
 * refusal so the endpoint does not describe which limit fired.
 */
export function comingSoonRateDecision(input: {
  emailAttempts: number;
  ipAttempts: number;
  ipKnown: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!input.ipKnown || !Number.isFinite(input.emailAttempts) || !Number.isFinite(input.ipAttempts)) {
    return { ok: false, error: COMING_SOON_LIMIT_ERROR };
  }
  if (input.emailAttempts > COMING_SOON_EMAIL_LIMIT || input.ipAttempts > COMING_SOON_IP_LIMIT) {
    return { ok: false, error: COMING_SOON_LIMIT_ERROR };
  }
  return { ok: true };
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

export type ComingSoonJoin = {
  full_name: string;
  email: string;
  phone: string;
  market_id: string | null;
  city: string;
  source: "homepage_waitlist";
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
};

/** Coming Soon payload. Off matches the browser insert. On is a joinWaitlist input. */
export function comingSoonSignup(enabled: boolean, fields: ComingSoonFields):
  | { mode: "insert"; row: ComingSoonInsert }
  | { mode: "join"; input: ComingSoonJoin } {
  if (!enabled) {
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
  return {
    mode: "join",
    input: {
      full_name: fields.full_name,
      email: fields.email,
      phone: fields.phone,
      market_id: fields.market_id,
      city: fields.city,
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

/** What a verified claim may show. Promoted rows do not start another application. */
export function claimPrefillFromRow(row: ClaimRow | null):
  | { ok: true; prefill: WaitlistClaimPrefill }
  | { ok: false; error: string } {
  if (!row || (row.status !== "waiting" && row.status !== "notified" && row.status !== "promoted")) {
    return { ok: false, error: "This link is not valid." };
  }
  if (row.status === "promoted") {
    return { ok: false, error: "This waitlist spot already has an application." };
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
