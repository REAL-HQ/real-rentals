/**
 * On Hold and Reservation Fee credit I/O. Pure rules live in rental-hold.ts.
 * No Stripe, no texts, no emails here: a hold stops automated texts (the crons
 * only work on Reserved rentals) and a credit is a ledger row plus a payment note.
 */
import { readReservationDetails, reservationPickupDate, writeReservationDetails } from "@/lib/reservations";
import { appliedNoteFor, canApplyCreditTo, checkHoldReason, creditableAmount, creditNoteFor, ON_HOLD_STATUS } from "@/lib/rental-hold";
import { creditExpired, creditExpiresAt, FORFEITED_FEE_CREDIT_DEFAULT_DAYS } from "@/lib/forfeited-fee-credit";

type Admin = any;
type Audit = (e: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void> | void;
export type HoldDeps = {
  audit?: Audit;
  actorId?: string | null;
  today?: () => string;
  now?: () => Date;
  /** Days the new credit lasts. Omitted reads app_settings, then 90. */
  creditDays?: number;
};

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
  const createdAt = deps.now ? deps.now() : new Date();
  let days = deps.creditDays;
  if (days == null) {
    try {
      const { loadForfeitedFeeCreditSettings } = await import("@/lib/forfeited-fee-credit.server");
      days = (await loadForfeitedFeeCreditSettings(admin)).days;
    } catch {
      days = FORFEITED_FEE_CREDIT_DEFAULT_DAYS;
    }
  }
  const row = {
    application_id: p.driver_id,
    source_payment_id: p.id,
    source_rental_id: p.rental_id ?? null,
    amount: ok.amount,
    reason: (input.reason ?? "").trim() || "Reservation Fee Credit Toward Next Rental",
    status: "available",
    created_by: deps.actorId ?? null,
    expires_at: creditExpiresAt(createdAt, days),
  };
  let ins = await admin.from("renter_credits").insert(row).select("id").single();
  // The expiry column arrives with the migration. Until then the credit is saved without one.
  if (ins.error && /expires_at/i.test(String(ins.error.message ?? ins.error))) {
    const { expires_at: _drop, ...withoutExpiry } = row;
    ins = await admin.from("renter_credits").insert(withoutExpiry).select("id").single();
  }
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
  let creditRead = await admin.from("renter_credits").select("id,application_id,source_payment_id,amount,status,expires_at").eq("id", input.creditId).maybeSingle();
  if (creditRead.error && /expires_at/i.test(String(creditRead.error.message ?? creditRead.error))) {
    creditRead = await admin.from("renter_credits").select("id,application_id,source_payment_id,amount,status").eq("id", input.creditId).maybeSingle();
  }
  const c = creditRead.data;
  if (!c) return { ok: false, error: "Credit Not Found." };
  if (creditExpired(c.expires_at, deps.now ? deps.now() : new Date())) return { ok: false, error: "That Credit Has Expired." };
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

/** Called when a fee is counted toward week 1 outside this flow, so an Available credit is never used twice. */
export async function markCreditUsedByWeek1(admin: Admin, paymentId: string, rentalId: string): Promise<void> {
  try {
    await admin.from("renter_credits").update({ status: "applied", applied_to_rental_id: rentalId, applied_at: new Date().toISOString() }).eq("source_payment_id", paymentId).eq("status", "available");
  } catch { /* table may not exist before the migration */ }
}
