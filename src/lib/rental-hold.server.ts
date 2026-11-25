/**
 * On Hold and Reservation Fee credit I/O. Pure rules live in rental-hold.ts.
 * No Stripe, no texts, no emails here: a hold stops automated texts (the crons
 * only work on Reserved rentals) and a credit is a ledger row plus a payment note.
 */
import { readReservationDetails, reservationPickupDate, writeReservationDetails } from "@/lib/reservations";
import {
  appliedNoteFor, canApplyCreditTo, checkCreditNote, checkHoldReason, creditableAmount, creditExpiresAt, creditNoteFor, creditStillOpen,
  DEFAULT_RESERVATION_FEE_CREDIT_DAYS, isOfferedCreditNote, OFFERED_CREDIT_NOTE, ON_HOLD_STATUS, OPEN_RENTAL_STATUSES,
  RESERVATION_FEE_CREDIT_DAYS_KEY, reservationFeeCreditDays,
} from "@/lib/rental-hold";

type Admin = any;
type Audit = (e: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void> | void;
export type HoldDeps = { audit?: Audit; actorId?: string | null; today?: () => string; now?: () => Date };

const noAudit: Audit = async () => {};
const etToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

export async function putRentalOnHold(admin: Admin, input: { rentalId: string; reason: string }, deps: HoldDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const why = checkHoldReason(input.reason);
  if (!why.ok) return why;
  const { data: r, error } = await admin.from("rentals").select("id,status,vehicle_id").eq("id", input.rentalId).maybeSingle();
  if (error || !r) return { ok: false, error: "Reservation Not Found." };
  if (r.status !== "reserved") return { ok: false, error: "Only A Reserved Rental Can Be Put On Hold." };
  const upd = await admin
    .from("rentals")
    .update({ status: ON_HOLD_STATUS, hold_reason: why.reason, hold_started_at: new Date().toISOString(), hold_by: deps.actorId ?? null })
    .eq("id", r.id)
    .eq("status", "reserved")
    .select("id");
  if (upd.error) return { ok: false, error: "Could Not Put The Rental On Hold." };
  if (!(upd.data ?? []).length) return { ok: false, error: "The Rental Changed While Saving. Reload And Try Again." };
  // The vehicle stays held for the renter: nothing is released here.
  await (deps.audit ?? noAudit)({ action: "rental.put_on_hold", summary: `Reservation put On Hold: ${why.reason}`.slice(0, 300), entityType: "rental", entityId: r.id, metadata: { vehicle_id: r.vehicle_id } });
  return { ok: true };
}

export async function resumeRentalFromHold(admin: Admin, input: { rentalId: string; pickupDate: string; pickupTime?: string | null }, deps: HoldDeps = {}): Promise<{ ok: true; pickupDate: string } | { ok: false; error: string }> {
  const date = reservationPickupDate(input.pickupDate);
  if (!date) return { ok: false, error: "Pick A Real Pickup Date." };
  if (date < (deps.today ?? etToday)()) return { ok: false, error: "The Pickup Date Cannot Be In The Past." };
  const { data: r, error } = await admin.from("rentals").select("id,status,vehicle_id,reservation_note").eq("id", input.rentalId).maybeSingle();
  if (error || !r) return { ok: false, error: "Reservation Not Found." };
  if (r.status !== ON_HOLD_STATUS) return { ok: false, error: "That Rental Is Not On Hold." };
  const d = readReservationDetails(r.reservation_note);
  const time = input.pickupTime || d.pickupTime;
  let note = r.reservation_note as string | null;
  if (time && d.pickupLocation) note = writeReservationDetails({ pickupTime: time, pickupLocation: d.pickupLocation, note: d.note, bookedBy: d.bookedBy });
  const upd = await admin
    .from("rentals")
    .update({ status: "reserved", start_date: date, reservation_note: note, hold_reason: null, hold_started_at: null, hold_by: null })
    .eq("id", r.id)
    .eq("status", ON_HOLD_STATUS)
    .select("id");
  if (upd.error) {
    if (/rentals_one_reserved/i.test(String(upd.error.message))) return { ok: false, error: "That Vehicle Or Renter Already Has Another Reservation." };
    return { ok: false, error: "Could Not Resume The Reservation." };
  }
  if (!(upd.data ?? []).length) return { ok: false, error: "The Rental Changed While Saving. Reload And Try Again." };
  await admin.from("vehicles").update({ status: "reserved" }).eq("id", r.vehicle_id).eq("status", "available");
  await (deps.audit ?? noAudit)({ action: "rental.resumed_from_hold", summary: `Reservation resumed for ${date}`, entityType: "rental", entityId: r.id });
  return { ok: true, pickupDate: date };
}

/** Turn a paid, kept Reservation Fee into an available renter credit. Never touches Stripe. */
export async function convertFeeToCredit(admin: Admin, input: { paymentId: string; reason?: string | null }, deps: HoldDeps = {}): Promise<{ ok: true; creditId: string; amount: number } | { ok: false; error: string }> {
  const { data: p, error } = await admin.from("payments").select("id,driver_id,status,reason,amount,refunded_amount,notes,rental_id").eq("id", input.paymentId).maybeSingle();
  if (error || !p) return { ok: false, error: "Payment Not Found." };
  const ok = creditableAmount(p);
  if (!ok.ok) return ok;
  if (!p.driver_id) return { ok: false, error: "That Payment Has No Renter On It." };
  const existing = await admin.from("renter_credits").select("id,status").eq("source_payment_id", p.id).neq("status", "void").limit(1);
  if ((existing.data ?? []).length) return { ok: false, error: "That Reservation Fee Already Has A Credit." };
  const ins = await admin
    .from("renter_credits")
    .insert({ application_id: p.driver_id, source_payment_id: p.id, source_rental_id: p.rental_id ?? null, amount: ok.amount, reason: (input.reason ?? "").trim() || "Reservation Fee Credit Toward Next Rental", status: "available", created_by: deps.actorId ?? null })
    .select("id")
    .single();
  if (ins.error || !ins.data) return { ok: false, error: "Could Not Save The Credit." };
  await admin.from("payments").update({ notes: creditNoteFor(p.notes, p.rental_id ?? null) }).eq("id", p.id);
  await (deps.audit ?? noAudit)({ action: "payment.reservation_fee_to_credit", summary: `Reservation Fee $${ok.amount.toFixed(2)} kept as a credit toward the next rental`, entityType: "payment", entityId: p.id, metadata: { credit_id: ins.data.id } });
  return { ok: true, creditId: ins.data.id as string, amount: ok.amount };
}

/**
 * Apply an available credit to a Reserved or On Hold rental of the same renter.
 * It attaches the fee the same way an attached Reservation Fee is attached, so
 * applyReservationFeeCredit counts it toward week 1 at activation.
 */
export async function applyCreditToRental(admin: Admin, input: { creditId: string; rentalId: string }, deps: HoldDeps = {}): Promise<{ ok: true; amount: number } | { ok: false; error: string }> {
  const { data: c } = await admin.from("renter_credits").select("id,application_id,source_payment_id,amount,status").eq("id", input.creditId).maybeSingle();
  if (!c) return { ok: false, error: "Credit Not Found." };
  const { data: r } = await admin.from("rentals").select("id,status,application_id").eq("id", input.rentalId).maybeSingle();
  if (!r) return { ok: false, error: "Rental Not Found." };
  const can = canApplyCreditTo(r, c);
  if (!can.ok) return can;
  const claim = await admin.from("renter_credits").update({ status: "applied", applied_to_rental_id: r.id, applied_at: new Date().toISOString() }).eq("id", c.id).eq("status", "available").select("id");
  if (claim.error || !(claim.data ?? []).length) return { ok: false, error: "That Credit Was Just Used. Reload And Try Again." };
  const { data: p } = await admin.from("payments").select("id,notes").eq("id", c.source_payment_id).maybeSingle();
  if (p) await admin.from("payments").update({ notes: appliedNoteFor(p.notes, r.id), rental_id: r.id }).eq("id", p.id);
  await admin
    .from("rentals")
    .update({ reservation_deposit_required: true, reservation_deposit_amount: Number(c.amount), reservation_deposit_status: "applied", reservation_deposit_payment_id: c.source_payment_id })
    .eq("id", r.id);
  await (deps.audit ?? noAudit)({ action: "renter_credit.applied", summary: `Credit $${Number(c.amount).toFixed(2)} applied to a rental (counts toward week 1)`, entityType: "rental", entityId: r.id, metadata: { credit_id: c.id, payment_id: c.source_payment_id } });
  return { ok: true, amount: Number(c.amount) };
}

export async function voidCredit(admin: Admin, input: { creditId: string; reason: string }, deps: HoldDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const why = checkHoldReason(input.reason);
  if (!why.ok) return why;
  const upd = await admin.from("renter_credits").update({ status: "void", void_reason: why.reason }).eq("id", input.creditId).eq("status", "available").select("id");
  if (upd.error || !(upd.data ?? []).length) return { ok: false, error: "Only An Available Credit Can Be Voided." };
  await (deps.audit ?? noAudit)({ action: "renter_credit.voided", summary: `Credit voided: ${why.reason}`.slice(0, 300), entityType: "renter_credit", entityId: input.creditId });
  return { ok: true };
}

const OPEN_RENTAL_BLOCK = "This Renter Has An Open Rental. The Reservation Fee Stays With That Rental.";

async function creditDays(admin: Admin): Promise<number> {
  try {
    const r = await admin.from("app_settings").select("value").eq("key", RESERVATION_FEE_CREDIT_DAYS_KEY).maybeSingle();
    if (r?.error || !r?.data) return DEFAULT_RESERVATION_FEE_CREDIT_DAYS;
    return reservationFeeCreditDays(r.data.value);
  } catch {
    return DEFAULT_RESERVATION_FEE_CREDIT_DAYS;
  }
}

function isFeeRow(p: { reason?: string | null; notes?: string | null; type?: string | null }): boolean {
  return String(p.reason ?? "") === "reservation_fee" || String(p.type ?? "") === "reservation" || /^reservation_fee:/.test(String(p.notes ?? ""));
}

/** The paid Reservation Fee staff may offer, or why not. Does not write. */
export async function reservationFeeOfferPreview(admin: Admin, applicationId: string, now = new Date()): Promise<{ ok: true; paymentId: string; amount: number; expiresAt: string; days: number } | { ok: false; error: string }> {
  const { data: payments, error } = await admin.from("payments").select("id,driver_id,status,reason,type,amount,refunded_amount,notes,paid_date,created_at").eq("driver_id", applicationId).eq("status", "paid").limit(20);
  if (error) return { ok: false, error: "Could Not Read Payments." };
  const fees = ((payments ?? []) as any[]).filter(isFeeRow);
  const fee = fees.find((p) => creditableAmount({ ...p, reason: "reservation_fee" }).ok);
  if (!fee) return { ok: false, error: "No Paid Reservation Fee To Offer." };
  const open = await admin.from("rentals").select("id").eq("application_id", applicationId).in("status", [...OPEN_RENTAL_STATUSES]).limit(1);
  if (open.error) return { ok: false, error: "Could Not Check Open Rentals." };
  if ((open.data ?? []).length) return { ok: false, error: OPEN_RENTAL_BLOCK };
  const taken = await admin.from("renter_credits").select("id").eq("source_payment_id", fee.id).neq("status", "void").limit(1);
  if ((taken.data ?? []).length) return { ok: false, error: "That Reservation Fee Already Has A Credit." };
  const amount = creditableAmount({ ...fee, reason: "reservation_fee" });
  if (!amount.ok) return amount;
  const days = await creditDays(admin);
  return { ok: true, paymentId: fee.id, amount: amount.amount, days, expiresAt: creditExpiresAt(fee.paid_date ?? fee.created_at, days, now) };
}

/**
 * Staff offer a paid Reservation Fee as a credit. The fee stays paid.
 * Nothing is refunded and nothing is emailed. expires_at is the payment
 * date plus the day count (app_settings, else 90).
 */
export async function offerReservationFeeCredit(admin: Admin, input: { paymentId?: string | null; applicationId?: string | null; note: string }, deps: HoldDeps = {}): Promise<{ ok: true; creditId: string; amount: number; expiresAt: string; days: number } | { ok: false; error: string }> {
  const note = checkCreditNote(input.note);
  if (!note.ok) return note;
  const paymentId = input.paymentId ?? null;
  const applicationId = input.applicationId ?? null;
  let fee: any = null;
  if (paymentId) {
    const { data, error } = await admin.from("payments").select("id,driver_id,status,reason,type,amount,refunded_amount,notes,paid_date,created_at,rental_id").eq("id", paymentId).maybeSingle();
    if (error || !data) return { ok: false, error: "Payment Not Found." };
    fee = data;
  } else if (applicationId) {
    const preview = await reservationFeeOfferPreview(admin, applicationId, deps.now?.() ?? new Date());
    if (!preview.ok) return preview;
    const { data } = await admin.from("payments").select("id,driver_id,status,reason,type,amount,refunded_amount,notes,paid_date,created_at,rental_id").eq("id", preview.paymentId).maybeSingle();
    fee = data;
  }
  if (!fee || !isFeeRow(fee)) return { ok: false, error: "Only A Reservation Fee Can Become A Credit." };
  if (applicationId && fee.driver_id !== applicationId) return { ok: false, error: "That Reservation Fee Belongs To A Different Renter." };
  const amount = creditableAmount({ ...fee, reason: "reservation_fee" });
  if (!amount.ok) return amount;
  if (!fee.driver_id) return { ok: false, error: "That Payment Has No Renter On It." };
  const open = await admin.from("rentals").select("id").eq("application_id", fee.driver_id).in("status", [...OPEN_RENTAL_STATUSES]).limit(1);
  if (open.error) return { ok: false, error: "Could Not Check Open Rentals." };
  if ((open.data ?? []).length) return { ok: false, error: OPEN_RENTAL_BLOCK };
  const existing = await admin.from("renter_credits").select("id,status").eq("source_payment_id", fee.id).neq("status", "void").limit(1);
  if ((existing.data ?? []).length) return { ok: false, error: "That Reservation Fee Already Has A Credit." };
  const days = await creditDays(admin);
  const now = deps.now?.() ?? new Date();
  const expiresAt = creditExpiresAt(fee.paid_date ?? fee.created_at, days, now);
  const ins = await admin
    .from("renter_credits")
    .insert({ application_id: fee.driver_id, source_payment_id: fee.id, source_rental_id: fee.rental_id ?? null, amount: amount.amount, reason: note.reason, status: "available", expires_at: expiresAt, created_by: deps.actorId ?? null })
    .select("id")
    .single();
  if (ins.error || !ins.data) return { ok: false, error: "Could Not Save The Credit." };
  const notes = `${creditNoteFor(fee.notes, fee.rental_id ?? null)}${isOfferedCreditNote(fee.notes) ? "" : ` ${OFFERED_CREDIT_NOTE}`}`.trim();
  await admin.from("payments").update({ notes }).eq("id", fee.id);
  await (deps.audit ?? noAudit)({ action: "payment.reservation_fee_offered_as_credit", summary: `Reservation Fee $${amount.amount.toFixed(2)} offered as a credit, valid ${days} days`, entityType: "payment", entityId: fee.id, metadata: { credit_id: ins.data.id, expires_at: expiresAt } });
  return { ok: true, creditId: ins.data.id as string, amount: amount.amount, expiresAt, days };
}

/**
 * Use one offered credit to cover a new Reservation Fee in full.
 * The new row is paid with net_collected 0, so the original $50 is not
 * collected again. The source fee is marked credited_week1 so activation
 * does not also add a Stripe balance for that same $50. No Stripe call here.
 */
export async function coverReservationFeeWithCredit(admin: Admin, input: { applicationId: string; paymentId: string; amount: number }, deps: HoldDeps = {}): Promise<{ ok: true; creditId: string } | { ok: false }> {
  const now = deps.now?.() ?? new Date();
  const { data, error } = await admin.from("renter_credits").select("id,application_id,source_payment_id,amount,status,expires_at").eq("application_id", input.applicationId).eq("status", "available").limit(20);
  if (error || !data) return { ok: false };
  const open = ((data ?? []) as any[])
    .filter((c) => c.expires_at && creditStillOpen(c, now) && Number(c.amount) >= Number(input.amount))
    .sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at)));
  const credit = open[0];
  if (!credit) return { ok: false };
  const claim = await admin.from("renter_credits").update({ status: "applied", applied_to_payment_id: input.paymentId, applied_at: now.toISOString() }).eq("id", credit.id).eq("status", "available").select("id");
  if (claim.error || !(claim.data ?? []).length) return { ok: false };
  const paidDate = now.toISOString().slice(0, 10);
  const { data: row } = await admin.from("payments").select("id,notes").eq("id", input.paymentId).maybeSingle();
  const pay = await admin.from("payments").update({
    status: "paid", balance_due: 0, net_collected: 0, payment_method: "credit", paid_date: paidDate,
    notes: `${String(row?.notes ?? "")} covered_by_credit:${credit.id}`.trim(),
  }).eq("id", input.paymentId).select("id");
  if (pay.error || !(pay.data ?? []).length) {
    await admin.from("renter_credits").update({ status: "available", applied_to_payment_id: null, applied_at: null }).eq("id", credit.id).eq("status", "applied");
    return { ok: false };
  }
  if (credit.source_payment_id) {
    const { data: source } = await admin.from("payments").select("id,notes").eq("id", credit.source_payment_id).maybeSingle();
    if (source && !/credited_week1/.test(String(source.notes ?? ""))) {
      await admin.from("payments").update({ notes: `${String(source.notes ?? "")} credited_week1:credit:${credit.id}`.trim() }).eq("id", source.id);
    }
  }
  await (deps.audit ?? noAudit)({ action: "renter_credit.applied_to_fee", summary: `Credit $${Number(credit.amount).toFixed(2)} covered a Reservation Fee`, entityType: "payment", entityId: input.paymentId, metadata: { credit_id: credit.id } });
  return { ok: true, creditId: credit.id as string };
}

/** Mark offered credits past expires_at. Null expiry is left alone. Nothing is deleted. */
export async function expireDueReservationFeeCredits(admin: Admin, now = new Date()): Promise<{ expired: number }> {
  try {
    const { data, error } = await admin.from("renter_credits").select("id,status,expires_at").eq("status", "available").limit(200);
    if (error) return { expired: 0 };
    const due = ((data ?? []) as any[]).filter((c) => c.expires_at && !creditStillOpen(c, now));
    let expired = 0;
    for (const c of due) {
      const upd = await admin.from("renter_credits").update({ status: "expired" }).eq("id", c.id).eq("status", "available").select("id");
      if ((upd.data ?? []).length) expired += 1;
    }
    return { expired };
  } catch {
    return { expired: 0 };
  }
}

/** Called when a fee is counted toward week 1 outside this flow, so an Available credit is never used twice. */
export async function markCreditUsedByWeek1(admin: Admin, paymentId: string, rentalId: string): Promise<void> {
  try {
    await admin.from("renter_credits").update({ status: "applied", applied_to_rental_id: rentalId, applied_at: new Date().toISOString() }).eq("source_payment_id", paymentId).eq("status", "available");
  } catch { /* table may not exist before the migration */ }
}
