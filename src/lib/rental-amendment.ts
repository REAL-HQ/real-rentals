/**
 * Updated / amended rental agreements for an ACTIVE rental (weekly rate
 * change). Client-safe: limits, parsing, dates and the amendment wording.
 * Server logic: rental-amendment.server.ts. Docs: docs/fleet-amend-agreement.md.
 *
 * Rules (Dolmar via FLEET, Nov 16 2026):
 *   - The new rate is only PENDING until the renter signs the amended
 *     agreement. Nothing about the rental, Stripe or billing changes before.
 *   - It takes effect from the effective date, or from the next rent week if
 *     the renter signs after that date. Never retroactively.
 *   - A rate increase needs logged renter consent plus the signature.
 *   - FLEET may only propose $200–$1,000/week; anything else is for staff.
 */
import { fmtContractDate } from "@/lib/agreement-dates";
import { PAYMENT_METHODS, type AgreementPrep } from "@/lib/agreement-prep";

export const RENTAL_AMENDMENTS_KEY = "rental_agreement_amendments";
export const AMENDMENT_RATE_MIN = 200;
export const AMENDMENT_RATE_MAX = 1000;
/** How far ahead an effective date may be. */
export const AMENDMENT_MAX_LEAD_DAYS = 90;
/** How old the renter's consent may be when the amendment is sent. */
export const AMENDMENT_CONSENT_MAX_AGE_DAYS = 14;
export const AMENDMENT_CONSENT_CHANNELS = ["sms", "call"] as const;
export const STAFF_CONSENT_CHANNELS = ["sms", "call", "in_person", "email"] as const;
export type ConsentChannel = (typeof STAFF_CONSENT_CHANNELS)[number];

export type RenterConsent = {
  channel: ConsentChannel;
  received_at: string;
  quote: string;
  message_id: string | null;
  call_id: string | null;
};

export type AmendmentInput = {
  new_weekly_rate: number;
  effective_date: string | null;
  reason: string;
  renter_consent: RenterConsent | null;
};

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function parseMoney(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function isValidDateOnly(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function withinRateBounds(rate: number): boolean {
  return rate >= AMENDMENT_RATE_MIN && rate <= AMENDMENT_RATE_MAX;
}

/** Renter consent. `channels` limits what the caller may use (FLEET: sms, call). */
export function parseRenterConsent(
  raw: any,
  now: Date,
  channels: readonly ConsentChannel[],
): { ok: true; value: RenterConsent } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "renter_consent is required." };
  const channel = String(raw.channel ?? "").toLowerCase() as ConsentChannel;
  if (!channels.includes(channel)) return { ok: false, error: `renter_consent.channel must be ${channels.join(" or ")}.` };
  const at = String(raw.received_at ?? "").trim();
  if (!ISO_TS.test(at) || !Number.isFinite(Date.parse(at))) return { ok: false, error: "renter_consent.received_at must be an ISO timestamp with a time zone." };
  const t = Date.parse(at);
  if (t > now.getTime() + 5 * 60_000) return { ok: false, error: "renter_consent.received_at is in the future." };
  if (now.getTime() - t > AMENDMENT_CONSENT_MAX_AGE_DAYS * 86400_000) return { ok: false, error: `The renter's consent is older than ${AMENDMENT_CONSENT_MAX_AGE_DAYS} days. Ask again.` };
  const quote = clean(raw.quote, 1000);
  if (quote.length < 2) return { ok: false, error: "renter_consent.quote is required (the renter's own words)." };
  const messageId = clean(raw.message_id, 120) || null;
  const callId = clean(raw.call_id, 120) || null;
  if (channel === "call" && !callId) return { ok: false, error: "renter_consent.call_id is required for a call." };
  return { ok: true, value: { channel, received_at: new Date(t).toISOString(), quote, message_id: messageId, call_id: callId } };
}

/**
 * The effective date: given, or the next rent week (next_payment_due when it
 * is today or later), else today. Never before today (Eastern), never more
 * than 90 days out.
 */
export function resolveEffectiveDate(
  given: unknown,
  today: string,
  nextPaymentDue: string | null,
): { ok: true; value: string; defaulted: boolean } | { ok: false; error: string } {
  const s = String(given ?? "").trim();
  if (!s) {
    const next = nextPaymentDue && isValidDateOnly(String(nextPaymentDue).slice(0, 10)) ? String(nextPaymentDue).slice(0, 10) : null;
    return { ok: true, value: next && next >= today ? next : today, defaulted: true };
  }
  if (!isValidDateOnly(s)) return { ok: false, error: "effective_date must be YYYY-MM-DD." };
  if (s < today) return { ok: false, error: `effective_date ${s} is in the past. A rate change is never retroactive; use ${today} or later.` };
  if (s > addDaysIso(today, AMENDMENT_MAX_LEAD_DAYS)) return { ok: false, error: `effective_date must be within ${AMENDMENT_MAX_LEAD_DAYS} days.` };
  return { ok: true, value: s, defaulted: false };
}

/**
 * When a signed amendment's rate starts. The effective date if the renter
 * signed on or before it; otherwise the next rent due date on or after the
 * signing day (or the signing day itself). Never before the signature.
 */
export function applyOnDate(effective: string, signedDay: string, nextPaymentDue: string | null): string {
  if (effective >= signedDay) return effective;
  const next = nextPaymentDue ? String(nextPaymentDue).slice(0, 10) : null;
  return next && isValidDateOnly(next) && next >= signedDay ? next : signedDay;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** The amendment paragraph printed at the top of the amended agreement. */
export function amendmentNoticeText(a: { oldRate: number; newRate: number; effectiveDate: string; previousSignedAt: string | null }): string {
  const prior = a.previousSignedAt ? `the Rental Agreement signed ${fmtContractDate(a.previousSignedAt)}` : "your current Rental Agreement";
  return `This agreement replaces ${prior}. Once you sign, all the terms below apply. Starting ${fmtContractDate(a.effectiveDate)}, the weekly rental rate changes from ${usd(a.oldRate)} to ${usd(a.newRate)}. If you sign after that date, the new rate starts with your next rent week after you sign. Rent for weeks before then, including weeks already paid, stays at ${usd(a.oldRate)} and is not billed again. There is no Reservation Fee and no new deposit. Until you sign, your current agreement stays in effect.`;
}

/**
 * Puts the amendment notice at the top of a rendered agreement. Structured
 * (layout) bodies get a "!+ " highlight box right after the layout marker, so
 * the acknowledgment rows and signature blocks are unchanged.
 */
export function insertAmendmentNotice(body: string, notice: string, layoutMarker: string): string {
  const lead = body.match(/^\s*/)?.[0] ?? "";
  const rest = body.slice(lead.length);
  if (rest.startsWith(layoutMarker)) {
    const nl = rest.indexOf("\n");
    const head = nl === -1 ? rest : rest.slice(0, nl);
    const tail = nl === -1 ? "" : rest.slice(nl + 1);
    return `${lead}${head}\n!+ **Amendment.** ${notice}\n\n${tail}`;
  }
  return `${lead}AMENDMENT: ${notice}\n\n${rest}`;
}

export const AMENDMENT_TITLE = "Rental Agreement (Amended)";
/** What an amended agreement prints for the first-rental money lines. */
export const AMENDMENT_NO_FEE_LINE = "Not applicable (rental already active)";
export const AMENDMENT_NO_DEPOSIT_LINE = "$0 (no new deposit; rental already active)";
export const AMENDMENT_NOTHING_DUE_LINE = "$0.00 (rental already active)";
/** Card-on-file line for an updated agreement when no card is saved yet (t327s1775). */
export const AMENDMENT_CARD_NEXT_PAYMENT_LINE = "Saved at next payment";

/**
 * The template an updated agreement is generated from: the agreement new
 * rentals get, v1.16 (library family insurance_included_v116, Nov 21 2026;
 * v1.15 before that). Must equal agreement-library.ts DEFAULT_LIBRARY_KEY
 * (scripts/agreement-v116.test.ts). The Owner's saved/approved version of
 * that family is used (libraryWithDraft).
 */
export const AMENDMENT_TEMPLATE_KEY = "insurance_included_v116";

/** v1.14 staff choices an amendment needs; omitted ones come from the agreement being amended. */
export type AmendmentTerms = {
  damageWaiver?: "accepted" | "declined" | null;
  paymentSchedule?: "weekly" | "every_4_weeks" | null;
  paymentMethod?: (typeof PAYMENT_METHODS)[number] | null;
  vehicleOwner?: string | null;
};

export function parseAmendmentTerms(raw: any): { ok: true; value: AmendmentTerms } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "terms must be an object." };
  const out: AmendmentTerms = {};
  if (raw.damage_waiver != null) {
    if (raw.damage_waiver !== "accepted" && raw.damage_waiver !== "declined") return { ok: false, error: "terms.damage_waiver must be accepted or declined." };
    out.damageWaiver = raw.damage_waiver;
  }
  if (raw.payment_schedule != null) {
    if (raw.payment_schedule !== "weekly" && raw.payment_schedule !== "every_4_weeks") return { ok: false, error: "terms.payment_schedule must be weekly or every_4_weeks." };
    out.paymentSchedule = raw.payment_schedule;
  }
  if (raw.payment_method != null) {
    if (!(PAYMENT_METHODS as readonly string[]).includes(String(raw.payment_method))) return { ok: false, error: `terms.payment_method must be one of: ${PAYMENT_METHODS.join(", ")}.` };
    out.paymentMethod = raw.payment_method;
  }
  if (raw.vehicle_owner != null) {
    const v = clean(raw.vehicle_owner, 160);
    if (v.length < 2) return { ok: false, error: "terms.vehicle_owner is too short." };
    out.vehicleOwner = v;
  }
  return { ok: true, value: out };
}

/**
 * The preparation an updated agreement is rendered with. ALWAYS no
 * Reservation Fee and no deposit (the rental is already active and week 1 is
 * paid). Authorized drivers and the v1.14 choices carry over from the
 * agreement being amended (its merge_data._prep), unless given here; nothing
 * is guessed — a v1.14 value still unknown stays blank and blocks the send.
 */
export function amendmentPrep(previousPrepJson: unknown, terms: AmendmentTerms): AgreementPrep {
  let prev: any = null;
  try { prev = previousPrepJson ? JSON.parse(String(previousPrepJson)) : null; } catch { prev = null; }
  const drivers = prev?.drivers && (prev.drivers.mode === "none" || prev.drivers.mode === "listed") && Array.isArray(prev.drivers.list)
    ? { mode: prev.drivers.mode, list: prev.drivers.list }
    : { mode: "none" as const, list: [] };
  const damageWaiver = terms.damageWaiver ?? (prev?.damageWaiver === "accepted" || prev?.damageWaiver === "declined" ? prev.damageWaiver : null);
  const schedule = terms.paymentSchedule ?? (prev?.payment?.schedule === "weekly" || prev?.payment?.schedule === "every_4_weeks" ? prev.payment.schedule : null);
  const method = terms.paymentMethod ?? ((PAYMENT_METHODS as readonly string[]).includes(String(prev?.payment?.method)) ? prev.payment.method : null);
  const owner = terms.vehicleOwner ?? (typeof prev?.vehicleOwner === "string" && prev.vehicleOwner.trim() ? prev.vehicleOwner.trim() : undefined);
  return forceNoFee({
    drivers,
    reservation: { mode: "not_required", amount: null },
    deposit: { mode: "none", amount: null, reason: "" },
    ...(damageWaiver ? { damageWaiver } : {}),
    payment: { schedule, method },
    ...(owner ? { vehicleOwner: owner } : {}),
  } as AgreementPrep);
}

/** Whatever was passed in, an amendment never carries a Reservation Fee, a deposit or edited details. */
export function forceNoFee(prep: AgreementPrep): AgreementPrep {
  const { details: _drop, ...rest } = prep;
  return { ...rest, reservation: { mode: "not_required", amount: null }, deposit: { mode: "none", amount: null, reason: "" } };
}
