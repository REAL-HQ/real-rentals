/**
 * FLEET status reads: one place for FLEET to ask "where is everybody?"
 *
 *   POST /api/public/fleet/status   (Bearer FLEET_API_KEY, JSON)
 *     { "action": "digest" }                         queues across the whole journey
 *     { "action": "lead", "lead_id": "…" }           one renter's journey + next step
 *     { "action": "lookup", "phone"|"email": "…" }   match a driver by any contact
 *     { "action": "balance", "rental_id"|"lead_id" } what a renter owes, row by row
 *
 * Read-only. Writes nothing, sends nothing, mints no links. Every "next step"
 * names who acts: "fleet" (an API exists), "renter" (waiting on them) or
 * "staff" (a person must click or decide). Insurance, inspection, pickup and
 * activation are always staff; FLEET can never mark anyone insured or verified.
 * See docs/fleet-status.md.
 */
import { cleanText, fleetAdmin, fleetJson, fleetRequestBody, tableMissing, UUID_RE, type FleetDeps } from "@/lib/fleet-api.server";
import { paymentOwed, reportedOwes, standingFromPaymentRow } from "@/lib/rental-owes";
import { activeDailyPlan, type DailyRentPlan } from "@/lib/rent-standing";
import { fleetContactsFor, lookupLeadByContact } from "@/lib/driver-contacts.server";
import { missingItems, type MissingItemKey } from "@/lib/missing-items";
import { readReservationDetails } from "@/lib/reservations";
import { loadStaffCoverage, planStaffHandoffSms, publicCoverage } from "@/lib/staff-coverage.server";

type Admin = any;
const SITE = () => String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");
const adminUrl = (id: string) => `${SITE()}/admin?tab=drivers&id=${encodeURIComponent(id)}`;

export const OPEN_STAGES = ["partial", "new", "reviewing", "complete", "approved"] as const;
export const DONE_STAGES = ["declined", "closed", "duplicate"] as const;
/** Payment rows that no longer owe anything. */
export const SETTLED_PAYMENT = ["paid", "void", "voided", "refunded", "cancelled", "canceled", "waived", "entered_in_error"];
const OPEN_AGREEMENT = ["sent", "viewed", "signing"];

export type Owner = "fleet" | "renter" | "staff" | "none";
export type NextStep = { step: string; owner: Owner; detail: string; api: string | null };

const APP_COLS =
  "id,full_name,email,phone,status,created_at,updated_at,contacted_at,reviewed_at,vehicle_id,weekly_rent,deposit_amount,deposit_status,deposit_paid," +
  "contract_start_date,pickup_date,pickup_time,background_check_status,insurance_status,card_on_file_at,card_last4,sms_consent,sms_opt_out_at,sms_consent_phone," +
  "license_photo_url,profile_screenshot_url,income_proof_url,vehicle_size,expected_duration,gig_status,drive_type,deleted_at,primary_application_id,legal_hold";
const AGR_COLS = "id,application_id,rental_id,status,sent_at,viewed_at,signed_at,voided_at,token_expires_at,email_status,sms_status,created_at";
const RENTAL_COLS =
  "id,application_id,vehicle_id,status,start_date,end_date,weekly_rate,autopay_active,payment_status,card_last4,card_on_file_at,next_payment_due," +
  "reservation_deposit_required,reservation_deposit_amount,reservation_deposit_status,balance_due_cents,reservation_note,created_at";
const PAY_COLS = "id,driver_id,rental_id,type,amount,late_fees,balance_due,due_date,paid_date,status,failure_reason,attempt_count,last_attempt_at,stripe_hosted_invoice_url,created_at";

const easternDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (n: number) => Math.round(n * 100) / 100;
const hoursSince = (iso: string | null | undefined, now: Date) => (iso ? Math.round(((now.getTime() - new Date(iso).getTime()) / 3600_000) * 10) / 10 : null);
const arr = <T = any>(r: { data?: unknown } | null | undefined): T[] => (Array.isArray(r?.data) ? (r!.data as T[]) : []);

/** What a payment row still owes: balance_due when set, else amount + late fees. */
export function owed(p: Record<string, any>): number {
  return paymentOwed(p);
}

/**
 * Bookings > Active and this API share reportedOwes (rentStanding plus late
 * fees, non-rent charges and any return balance). A daily plan with no open
 * row still owes the unpaid days.
 */
function withReportedOwes(summary: ReturnType<typeof summarizeBalance>, payments: readonly Record<string, any>[], rental: Record<string, any> | null, now: Date, plan: DailyRentPlan | null) {
  const reported = reportedOwes({
    today: easternDate(now),
    payments: payments.map(standingFromPaymentRow),
    rental,
    dailyPlan: plan,
  });
  return {
    ...summary,
    total_owed: reported.total_owed,
    overdue_owed: reported.overdue_owed,
    late_fees_owed: reported.late_fees_owed,
    return_balance: reported.return_balance,
    rent_owed: reported.rent_owed,
    overdue_days: reported.overdue_days,
    next_due: reported.next_due,
    cadence: reported.cadence,
  };
}

async function planFor(admin: Admin, rentalId: string | null | undefined, now: Date): Promise<DailyRentPlan | null> {
  if (!rentalId) return null;
  try {
    const { loadDailyRentPlans } = await import("@/lib/daily-rent-plans.server");
    const plans = await loadDailyRentPlans(admin);
    return activeDailyPlan(plans.get(rentalId) ?? null, easternDate(now));
  } catch {
    return null;
  }
}

export function summarizeBalance(payments: readonly Record<string, any>[], rental: Record<string, any> | null, now: Date) {
  const today = easternDate(now);
  const open = payments.filter((p) => owed(p) > 0).sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")));
  const overdue = open.filter((p) => p.due_date && String(p.due_date) < today);
  const returnBalance = rental ? Math.max(0, num(rental.balance_due_cents) / 100) : 0;
  return {
    total_owed: money(open.reduce((s, p) => s + owed(p), 0) + returnBalance),
    overdue_owed: money(overdue.reduce((s, p) => s + owed(p), 0)),
    late_fees_owed: money(open.reduce((s, p) => s + num(p.late_fees), 0)),
    return_balance: money(returnBalance),
    oldest_overdue_due_date: overdue[0]?.due_date ?? null,
    failed_attempts: open.filter((p) => String(p.status).toLowerCase() === "failed").length,
    open_rows: open.map((p) => ({
      payment_id: p.id,
      type: p.type ?? null,
      due_date: p.due_date ?? null,
      status: p.status ?? null,
      amount: money(num(p.amount)),
      late_fees: money(num(p.late_fees)),
      owed: money(owed(p)),
      failure_reason: p.failure_reason ?? null,
      attempts: p.attempt_count ?? null,
      invoice_url: p.stripe_hosted_invoice_url ?? null,
    })),
  };
}

export type JourneyInput = {
  app: Record<string, any>;
  docs: readonly Record<string, any>[];
  agreements: readonly Record<string, any>[];
  rentals: readonly Record<string, any>[];
  payments: readonly Record<string, any>[];
  needsStaff: { reason: string; created_at: string | null } | null;
  botPause: { reason: string; since: string | null } | null;
  now: Date;
};

export function reservationFeeState(app: Record<string, any>, rental: Record<string, any> | null, payments: readonly Record<string, any>[]): "paid" | "waived" | "not_required" | "due" | "unknown" {
  const rs = String(rental?.reservation_deposit_status ?? "").toLowerCase();
  if (["paid", "applied", "succeeded"].includes(rs)) return "paid";
  if (rs === "waived") return "waived";
  if (payments.some((p) => String(p.type) === "deposit" && String(p.status).toLowerCase() === "paid")) return "paid";
  if (String(app.deposit_status ?? "").toLowerCase() === "paid" || app.deposit_paid === true) return "paid";
  if (rental && rental.reservation_deposit_required === false) return "not_required";
  if (rental?.reservation_deposit_required === true || rs === "pending" || rs === "due") return "due";
  return "unknown";
}

/** The renter's journey as FLEET sees it, and the one next step with its owner. */
export function computeJourney(i: JourneyInput) {
  const { app, now } = i;
  const status = String(app.status ?? "").toLowerCase();
  const missing: MissingItemKey[] = missingItems(app as any, i.docs as any);
  const liveAgreements = i.agreements.filter((a) => !a.voided_at && a.status !== "voided").sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const agreement = liveAgreements[0] ?? null;
  const signed = liveAgreements.find((a) => a.signed_at && a.status === "signed") ?? null;
  const rentals = [...i.rentals].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const active = rentals.find((r) => r.status === "active") ?? null;
  const reserved = rentals.find((r) => ["reserved", "pending", "upcoming"].includes(String(r.status))) ?? null;
  const rental = active ?? reserved ?? rentals[0] ?? null;
  const fee = reservationFeeState(app, reserved ?? active, i.payments);
  const cardOnFile = !!(app.card_on_file_at || rental?.card_on_file_at);
  // A booked pickup is a Reserved rental: its start_date is the pickup day and the
  // time lives in reservation_note (reservations.ts). applications.pickup_date is
  // only the day the applicant asked for on the form.
  const pickupBooked = !!reserved;
  const pickupDate: string | null = reserved?.start_date ?? null;
  const pickupTime: string | null = reserved ? readReservationDetails(reserved.reservation_note).pickupTime : null;

  const steps = {
    applied: { done: true, at: app.created_at ?? null },
    contacted: { done: !!app.contacted_at, at: app.contacted_at ?? null },
    documents: { done: missing.length === 0, missing },
    approved: { done: ["approved", "active"].includes(status) || !!active, at: app.reviewed_at ?? null },
    vehicle_assigned: { done: !!app.vehicle_id, vehicle_id: app.vehicle_id ?? null, weekly_rate: app.weekly_rent ?? null },
    agreement_sent: { done: !!agreement?.sent_at, at: agreement?.sent_at ?? null },
    agreement_signed: { done: !!signed, at: signed?.signed_at ?? null },
    reservation_fee: { done: fee === "paid" || fee === "waived" || fee === "not_required", state: fee },
    pickup_booked: { done: pickupBooked, date: pickupDate, time: pickupTime, requested_date: app.pickup_date ?? null },
    card_on_file: { done: cardOnFile, last4: app.card_last4 ?? rental?.card_last4 ?? null },
    insurance: { done: String(app.insurance_status ?? "").toLowerCase() === "verified", status: app.insurance_status ?? null, owner: "staff" as const },
    active: { done: !!active, rental_id: active?.id ?? null, since: active?.start_date ?? null },
  };

  const next = ((): NextStep => {
    if (app.deleted_at || (DONE_STAGES as readonly string[]).includes(status)) return { step: "none", owner: "none", detail: `Application is ${status || "deleted"}.`, api: null };
    if (i.botPause) return { step: "staff_handling", owner: "staff", detail: `Bots paused: ${i.botPause.reason}.`, api: null };
    if (i.needsStaff) return { step: "needs_staff", owner: "staff", detail: i.needsStaff.reason, api: null };
    if (active) return { step: "rent", owner: "renter", detail: "Rental is active. Watch the balance.", api: "POST /api/public/fleet/status {action:balance}" };
    if (!steps.approved.done) {
      if (missing.length) return { step: "documents", owner: "renter", detail: `Missing: ${missing.join(", ")}.`, api: "POST /api/public/fleet/resend-link {kind:upload}" };
      return { step: "review", owner: "fleet", detail: "Ready for FLEET review.", api: "POST /api/public/fleet/applicants {action:get} then /api/public/fleet/applicant-decision" };
    }
    if (!steps.vehicle_assigned.done) return { step: "assign_vehicle", owner: "fleet", detail: "Approved with no car.", api: "POST /api/public/fleet/assign-vehicle" };
    if (!agreement) return { step: "send_agreement", owner: "fleet", detail: "Confirm terms with the renter (call or YES text), then send.", api: "POST /api/public/fleet/send-agreement" };
    if (!signed) {
      const h = hoursSince(agreement.sent_at, now);
      return { step: "sign_agreement", owner: "renter", detail: `Agreement sent ${h ?? "?"}h ago (email ${agreement.email_status ?? "?"}, text ${agreement.sms_status ?? "?"}).`, api: "POST /api/public/fleet/resend-link {kind:signing}" };
    }
    if (!pickupBooked) return { step: "book_pickup", owner: "fleet", detail: "Signed; no pickup booked.", api: "POST /api/public/fleet/pickup-slots" };
    if (fee === "due") return { step: "reservation_fee", owner: "renter", detail: "Reservation fee not paid yet.", api: null };
    if (!cardOnFile) return { step: "card_on_file", owner: "renter", detail: "No card on file.", api: null };
    return { step: "pickup", owner: "staff", detail: `Field rep hands over the car ${pickupDate ?? "?"} ${pickupTime ?? ""} (pickup checklist, then activation).`, api: null };
  })();

  return { steps, next, agreement, rental, reservation_fee: fee };
}

async function needsStaffFor(admin: Admin, leadId: string) {
  const r = await admin.from("fleet_review_decisions").select("id,reason,created_at").eq("application_id", leadId).eq("decision", "needs_staff").is("resolved_at", null).order("created_at", { ascending: false }).limit(1);
  if (r.error) return null;
  const row = arr(r)[0];
  return row ? { reason: String(row.reason ?? "needs staff"), created_at: row.created_at ?? null } : null;
}

/** An open handoff (fleet-handoff.server.ts) pauses the bots. Unreadable counts as paused. */
export async function botPauseFor(admin: Admin, leadId: string): Promise<{ reason: string; since: string | null } | null> {
  const { activeHandoff } = await import("@/lib/fleet-handoff.server");
  const h = await activeHandoff(admin, leadId);
  if (h === "unavailable") return { reason: "handoff status unreadable", since: null };
  return h ? { reason: h.reason, since: h.since } : null;
}

export async function leadStatus(admin: Admin, leadId: string, now: Date) {
  const a = await admin.from("applications").select(APP_COLS).eq("id", leadId).maybeSingle();
  if (a.error) throw new Error("Could not read the application.");
  const app = a.data;
  if (!app) return null;
  const [docs, agreements, rentals, payments, quoIn, outMsg, needsStaff, botPause] = await Promise.all([
    admin.from("documents").select("category,review_status,is_current,created_at").eq("driver_id", leadId),
    admin.from("agreements").select(AGR_COLS).eq("application_id", leadId),
    admin.from("rentals").select(RENTAL_COLS).eq("application_id", leadId),
    admin.from("payments").select(PAY_COLS).eq("driver_id", leadId),
    admin.from("quo_events").select("event_type,direction,occurred_at,body").eq("application_id", leadId).order("occurred_at", { ascending: false }).limit(1),
    admin.from("outbound_messages").select("channel,kind,status,sent_at,created_at").eq("application_id", leadId).order("created_at", { ascending: false }).limit(1),
    needsStaffFor(admin, leadId),
    botPauseFor(admin, leadId),
  ]);
  const j = computeJourney({ app, docs: arr(docs), agreements: arr(agreements), rentals: arr(rentals), payments: arr(payments), needsStaff, botPause, now });
  const rentalPayments = j.rental ? arr(payments).filter((p) => !p.rental_id || p.rental_id === j.rental!.id) : arr(payments);
  const lastIn = arr(quoIn)[0] ?? null;
  const lastOut = arr(outMsg)[0] ?? null;
  const contacts = await fleetContactsFor(admin, leadId, app);
  return {
    lead_id: app.id,
    name: app.full_name ?? null,
    email: app.email ?? null,
    phone: app.phone ?? null,
    contacts,
    stage: app.status,
    applied_at: app.created_at ?? null,
    sms_ok: app.sms_consent === true && !app.sms_opt_out_at,
    background_check_status: app.background_check_status ?? null,
    steps: j.steps,
    next: j.next,
    needs_staff: needsStaff,
    bot_pause: botPause,
    agreement: j.agreement
      ? { agreement_id: j.agreement.id, status: j.agreement.status, sent_at: j.agreement.sent_at ?? null, viewed_at: j.agreement.viewed_at ?? null, signed_at: j.agreement.signed_at ?? null, link_expires_at: j.agreement.token_expires_at ?? null, email_status: j.agreement.email_status ?? null, sms_status: j.agreement.sms_status ?? null }
      : null,
    rental: j.rental
      ? { rental_id: j.rental.id, status: j.rental.status, vehicle_id: j.rental.vehicle_id ?? null, start_date: j.rental.start_date ?? null, end_date: j.rental.end_date ?? null, weekly_rate: j.rental.weekly_rate ?? null, autopay: j.rental.autopay_active === true, payment_status: j.rental.payment_status ?? null, next_payment_due: j.rental.next_payment_due ?? null }
      : null,
    balance: j.rental || rentalPayments.length ? withReportedOwes(summarizeBalance(rentalPayments, j.rental, now), rentalPayments, j.rental, now, await planFor(admin, j.rental?.id, now)) : null,
    last_inbound: lastIn ? { type: lastIn.event_type, at: lastIn.occurred_at ?? null, body: lastIn.body ? cleanText(lastIn.body, 300) : null } : null,
    last_outbound: lastOut ? { channel: lastOut.channel, kind: lastOut.kind ?? null, status: lastOut.status, at: lastOut.sent_at ?? lastOut.created_at ?? null } : null,
    admin_url: adminUrl(app.id),
  };
}

export async function rentalBalance(admin: Admin, by: { rental_id?: unknown; lead_id?: unknown }, now: Date) {
  let rental: any = null;
  if (by.rental_id) {
    if (!UUID_RE.test(String(by.rental_id))) return { status: 400, error: "rental_id must be a UUID." } as const;
    const r = await admin.from("rentals").select(RENTAL_COLS).eq("id", String(by.rental_id)).maybeSingle();
    if (r.error) throw new Error("Could not read rentals.");
    rental = r.data;
  } else if (by.lead_id) {
    if (!UUID_RE.test(String(by.lead_id))) return { status: 400, error: "lead_id must be a UUID." } as const;
    const r = await admin.from("rentals").select(RENTAL_COLS).eq("application_id", String(by.lead_id)).order("created_at", { ascending: false }).limit(5);
    if (r.error) throw new Error("Could not read rentals.");
    const list = arr(r);
    rental = list.find((x) => x.status === "active") ?? list[0] ?? null;
  } else return { status: 400, error: "Give rental_id or lead_id." } as const;
  if (!rental) return { status: 404, error: "No rental found." } as const;
  const p = await admin.from("payments").select(PAY_COLS).eq("rental_id", rental.id);
  if (p.error) throw new Error("Could not read payments.");
  return {
    status: 200,
    body: {
      rental_id: rental.id,
      lead_id: rental.application_id ?? null,
      rental_status: rental.status,
      weekly_rate: rental.weekly_rate ?? null,
      autopay: rental.autopay_active === true,
      card_last4: rental.card_last4 ?? null,
      payment_status: rental.payment_status ?? null,
      next_payment_due: rental.next_payment_due ?? null,
      ...withReportedOwes(summarizeBalance(arr(p), rental, now), arr(p), rental, now, await planFor(admin, rental.id, now)),
      note: "Read-only. Charging, waiving and payment deals stay with staff; a deal pause is /api/public/fleet/payment-text-pause.",
    },
  } as const;
}

const LIST_CAP = 25;

export async function fleetDigest(admin: Admin, now: Date) {
  const today = easternDate(now);
  const in2 = easternDate(new Date(now.getTime() + 2 * 86400_000));
  const since24 = new Date(now.getTime() - 86400_000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const [appsRes, agrRes, rentRes, payRes, nsRes, whRes] = await Promise.all([
    admin.from("applications").select("id,full_name,status,vehicle_id,created_at,insurance_status,primary_application_id").in("status", [...OPEN_STAGES, "active"]).is("deleted_at", null).limit(2000),
    admin.from("agreements").select(AGR_COLS).in("status", [...OPEN_AGREEMENT, "signed"]).is("voided_at", null).limit(2000),
    admin.from("rentals").select(RENTAL_COLS).in("status", ["active", "reserved", "pending", "upcoming", "closed"]).limit(2000),
    admin.from("payments").select(PAY_COLS).not("status", "in", `(${SETTLED_PAYMENT.join(",")})`).limit(2000),
    admin.from("fleet_review_decisions").select("application_id,reason,escalation_codes,created_at").eq("decision", "needs_staff").is("resolved_at", null).order("created_at", { ascending: true }).limit(500),
    admin.from("fleet_webhook_deliveries").select("event_type,status,created_at").gte("created_at", since24).limit(5000),
  ]);
  if (appsRes.error) throw new Error("Could not read applications.");
  const apps = arr(appsRes).filter((a) => !a.primary_application_id);
  const byId = new Map(apps.map((a) => [a.id, a]));
  const name = (id: string | null | undefined) => (id ? byId.get(id)?.full_name ?? null : null);
  const stages: Record<string, number> = {};
  for (const a of apps) stages[a.status] = (stages[a.status] ?? 0) + 1;

  const agreements = arr(agrRes);
  const agrBy = new Map<string, any[]>();
  for (const g of agreements) if (g.application_id) (agrBy.get(g.application_id) ?? agrBy.set(g.application_id, []).get(g.application_id)!).push(g);
  const rentals = arr(rentRes);
  const reservedBy = new Map<string, any>();
  for (const r of rentals) if (["reserved", "pending", "upcoming"].includes(r.status) && r.application_id) reservedBy.set(r.application_id, r);

  const approved = apps.filter((a) => a.status === "approved");
  const approvedNoVehicle = approved.filter((a) => !a.vehicle_id);
  const approvedNoAgreement = approved.filter((a) => a.vehicle_id && !(agrBy.get(a.id) ?? []).length);
  const unsigned = agreements.filter((g) => OPEN_AGREEMENT.includes(g.status) && byId.has(g.application_id));
  const signedIds = new Set(agreements.filter((g) => g.status === "signed").map((g) => g.application_id));
  const signedNoPickup = approved.filter((a) => signedIds.has(a.id) && !reservedBy.has(a.id));
  const pickups = rentals
    .filter((r) => ["reserved", "pending", "upcoming"].includes(r.status) && r.start_date && r.start_date >= today && r.start_date <= in2)
    .map((r) => ({ r, time: readReservationDetails(r.reservation_note).pickupTime }))
    .sort((x, y) => `${x.r.start_date} ${x.time ?? ""}`.localeCompare(`${y.r.start_date} ${y.time ?? ""}`));

  const payments = arr(payRes);
  const active = rentals.filter((r) => r.status === "active");
  const payByRental = new Map<string, any[]>();
  for (const p of payments) if (p.rental_id) (payByRental.get(p.rental_id) ?? payByRental.set(p.rental_id, []).get(p.rental_id)!).push(p);
  let dailyPlans = new Map<string, DailyRentPlan>();
  try {
    const { loadDailyRentPlans } = await import("@/lib/daily-rent-plans.server");
    dailyPlans = await loadDailyRentPlans(admin);
  } catch { /* a missing setting reads as weekly */ }
  const pastDue = active
    .map((r) => ({ r, b: withReportedOwes(summarizeBalance(payByRental.get(r.id) ?? [], r, now), payByRental.get(r.id) ?? [], r, now, activeDailyPlan(dailyPlans.get(r.id) ?? null, today)) }))
    .filter((x) => x.b.overdue_owed > 0 || String(x.r.payment_status) === "past_due")
    .map((x) => ({ rental_id: x.r.id, lead_id: x.r.application_id, name: name(x.r.application_id), overdue_owed: x.b.overdue_owed, late_fees_owed: x.b.late_fees_owed, oldest_due: x.b.oldest_overdue_due_date, autopay: x.r.autopay_active === true }));
  const failedRecent = payments.filter((p) => String(p.status).toLowerCase() === "failed" && String(p.last_attempt_at ?? p.created_at ?? "") >= since7d);
  const returnedWithBalance = rentals.filter((r) => r.status === "closed" && num(r.balance_due_cents) > 0);

  const needsStaff = nsRes.error ? [] : arr(nsRes);
  const wh = whRes.error ? [] : arr(whRes);
  const whCount = (s: string) => wh.filter((w) => w.status === s).length;

  let readyForReview: number | null = null;
  try {
    const { listAwaitingReview } = await import("@/lib/fleet-review.server");
    readyForReview = (await listAwaitingReview(admin, { readyOnly: true, limit: 1, now })).total;
  } catch {
    readyForReview = null;
  }

  const cap = <T>(xs: T[]) => xs.slice(0, LIST_CAP);
  const staffActions: { kind: string; count: number; detail: string }[] = [];
  const handoffs = needsStaff.filter((n) => (Array.isArray(n.escalation_codes) ? n.escalation_codes : []).some((c: unknown) => String(c).startsWith("handoff:")));
  if (handoffs.length) staffActions.push({ kind: "handoff", count: handoffs.length, detail: "People handed to staff (complaint, injury, payment dispute...). Bots are paused for them." });
  if (needsStaff.length) staffActions.push({ kind: "needs_staff", count: needsStaff.length, detail: "Applicants FLEET escalated (Drivers → Needs Staff)." });
  if (pickups.length) staffActions.push({ kind: "pickup_handover", count: pickups.length, detail: "Pickups in the next 2 days: field rep checklist, then activation." });
  const insurancePending = approved.filter((a) => String(a.insurance_status ?? "").toLowerCase() !== "verified").length;
  if (insurancePending) staffActions.push({ kind: "insurance_verification", count: insurancePending, detail: "Approved renters without verified insurance (staff only)." });
  if (returnedWithBalance.length) staffActions.push({ kind: "return_balance", count: returnedWithBalance.length, detail: "Returned rentals with a balance or deposit decision." });

  return {
    as_of: now.toISOString(),
    eastern_date: today,
    stages,
    queues: {
      ready_for_review: readyForReview,
      needs_staff: { count: needsStaff.length, oldest: cap(needsStaff.map((n) => ({ lead_id: n.application_id, name: name(n.application_id), reason: n.reason, since: n.created_at }))) },
      approved_no_vehicle: { count: approvedNoVehicle.length, leads: cap(approvedNoVehicle.map((a) => ({ lead_id: a.id, name: a.full_name }))) },
      approved_no_agreement: { count: approvedNoAgreement.length, leads: cap(approvedNoAgreement.map((a) => ({ lead_id: a.id, name: a.full_name }))) },
      agreements_unsigned: {
        count: unsigned.length,
        agreements: cap(unsigned.map((g) => ({ agreement_id: g.id, lead_id: g.application_id, name: name(g.application_id), status: g.status, hours_since_sent: hoursSince(g.sent_at, now), email_status: g.email_status ?? null, sms_status: g.sms_status ?? null }))),
      },
      signed_no_pickup: { count: signedNoPickup.length, leads: cap(signedNoPickup.map((a) => ({ lead_id: a.id, name: a.full_name }))) },
      pickups_next_2_days: { count: pickups.length, pickups: cap(pickups.map((p) => ({ lead_id: p.r.application_id ?? null, name: name(p.r.application_id), date: p.r.start_date, time: p.time, rental_id: p.r.id }))) },
    },
    rentals: {
      active: active.length,
      autopay: active.filter((r) => r.autopay_active === true).length,
      past_due: { count: pastDue.length, rentals: cap(pastDue) },
      failed_payments_7d: failedRecent.length,
      open_balance_total: money(payments.reduce((s, p) => s + owed(p), 0)),
      returned_with_balance: returnedWithBalance.length,
    },
    webhooks_24h: { delivered: whCount("delivered"), pending: whCount("pending"), failed: whCount("failed"), skipped: whCount("skipped") },
    staff_actions: staffActions,
    staff_coverage: await (async () => {
      try {
        const loaded = await loadStaffCoverage(admin);
        const plan = await planStaffHandoffSms({ admin, now, coverage: loaded, ignoreQuietHours: true });
        return publicCoverage(plan.coverage, plan);
      } catch {
        return null;
      }
    })(),
  };
}

export async function handleFleetStatus(request: Request, deps: FleetDeps = {}): Promise<Response> {
  const parsed = await fleetRequestBody(request, deps);
  if ("response" in parsed) return parsed.response;
  const { body } = parsed;
  const admin = await fleetAdmin(deps);
  const now = (deps.now ?? (() => new Date()))();
  const action = String(body.action ?? "digest");
  try {
    if (action === "digest") return fleetJson(200, { ok: true, digest: await fleetDigest(admin, now) });
    if (action === "lead") {
      if (!UUID_RE.test(String(body.lead_id ?? ""))) return fleetJson(400, { ok: false, error: "lead_id must be a UUID." });
      const lead = await leadStatus(admin, String(body.lead_id), now);
      if (!lead) return fleetJson(404, { ok: false, error: "Lead not found." });
      return fleetJson(200, { ok: true, lead });
    }
    if (action === "lookup") {
      const found = await lookupLeadByContact(admin, body);
      if (found.status !== 200) return fleetJson(found.status, { ok: false, error: found.error });
      return fleetJson(200, { ok: true, ...found.body });
    }
    if (action === "balance") {
      const r = await rentalBalance(admin, { rental_id: body.rental_id, lead_id: body.lead_id }, now);
      if (r.status !== 200) return fleetJson(r.status, { ok: false, error: r.error });
      return fleetJson(200, { ok: true, balance: r.body });
    }
  } catch (e) {
    if (tableMissing(e, "")) return fleetJson(503, { ok: false, error: "A table this read needs is not installed." });
    console.error("[fleet-status] read failed", String((e as Error)?.message ?? e));
    return fleetJson(503, { ok: false, error: "Could not read status." });
  }
  return fleetJson(400, { ok: false, error: "action must be digest, lead, lookup or balance." });
}
