/**
 * Payment Received page, server half. See payment-received.ts.
 *
 *   lookupPaymentReceived(admin, sessionId)
 *     Stripe is the source for the payment (the webhook can lag a few
 *     seconds behind the redirect). The session must be a paid, payment-mode
 *     Reservation Fee Checkout whose metadata matches OUR rows: the payments
 *     row (paymentIds) belongs to that application and carries
 *     reservation_fee:<agreementId>, and the agreement is signed for the same
 *     application. Anything else is refused, and the page shows the static
 *     thank-you instead.
 *
 *   bookRenterPickup(admin, { sessionId, startAt })
 *     The renter picks a slot. It goes through createReservationCore, the one
 *     Reserved path staff and FLEET use, so every guard applies (Approved or
 *     Active, car free, one reservation per person / car / slot, the unique
 *     indexes) and that save alone sends the booking login email, runs
 *     maybeConfirmReservation (field rep text, staff emails, FLEET
 *     reservation_confirmed) and, by cron, the renter reminders. Nothing here
 *     sends anything itself. The booking is marked booked_by "renter" in the
 *     reservation record and audited as reservation.renter_booked.
 */
import {
  isCheckoutSessionId,
  safeReceiptUrl,
  type BookPickupResult,
  type BookedPickup,
  type PaymentReceivedRental,
  type PaymentReceivedView,
  type PickupBookingState,
} from "@/lib/payment-received";
import { RESERVATION_FEE_REASON, reservationFeeNote } from "@/lib/reservation-fee";
import { isScheduledSlot, parseSlotStart, slotLabel, type PickupScheduleSettings, type PickupSlot } from "@/lib/pickup-schedule";
import { readReservationDetails } from "@/lib/reservations";

type Admin = any;
type StripeLike = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PaymentReceivedDeps = {
  stripe?: StripeLike | null;
  settings?: PickupScheduleSettings;
  now?: () => Date;
  listSlots?: (admin: Admin, s: PickupScheduleSettings, now: Date) => Promise<PickupSlot[]>;
  reserve?: (admin: Admin, data: { applicationId: string; vehicleId: string; pickupDate: string; pickupTime: string; pickupLocation: string; bookedBy: "renter" }) => Promise<{ id: string; loginEmail: string }>;
  audit?: (e: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void>;
};

/** Internal: everything the lookup verified. Only `view` ever leaves the server. */
type Verified = {
  view: Extract<PaymentReceivedView, { ok: true }>;
  applicationId: string;
  vehicleId: string | null;
  location: string | null;
  settings: PickupScheduleSettings;
};

async function stripeFor(deps: PaymentReceivedDeps): Promise<StripeLike | null> {
  if (deps.stripe !== undefined) return deps.stripe;
  const { stripeClient } = await import("@/lib/reservation-fee-core.server");
  return stripeClient({});
}

async function scheduleFor(admin: Admin, deps: PaymentReceivedDeps): Promise<PickupScheduleSettings> {
  if (deps.settings) return deps.settings;
  const { loadPickupSchedule } = await import("@/lib/reservation-confirmation.server");
  return loadPickupSchedule(admin);
}

async function openSlots(admin: Admin, s: PickupScheduleSettings, now: Date, deps: PaymentReceivedDeps): Promise<PickupSlot[]> {
  if (deps.listSlots) return deps.listSlots(admin, s, now);
  const { listOpenSlots } = await import("@/lib/fleet-pickup.server");
  // Same window staff see (horizonDays, minimum notice, holidays), earliest first.
  return listOpenSlots(admin, s, now, { limit: 30 });
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const day = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

function bookedFrom(rental: any): BookedPickup | null {
  const d = readReservationDetails(rental?.reservation_note ?? null);
  if (!rental?.start_date || !d.pickupTime) return null;
  return { date: String(rental.start_date), time: d.pickupTime, label: slotLabel(String(rental.start_date), d.pickupTime), location: d.pickupLocation };
}

/** The staff terms (Applicant Ready For Agreement) for this applicant, newest first. Optional table. */
async function latestStaffTerms(admin: Admin, applicationId: string): Promise<any | null> {
  try {
    const r = await admin.from("staff_terms_confirmations").select("vehicle_id,weekly_rate,start_date,clicked_at").eq("application_id", applicationId).order("clicked_at", { ascending: false }).limit(1);
    if (r?.error) return null;
    return ((r?.data ?? []) as any[])[0] ?? null;
  } catch {
    return null;
  }
}

async function verify(admin: Admin, sessionId: unknown, deps: PaymentReceivedDeps): Promise<Verified | Extract<PaymentReceivedView, { ok: false }>> {
  if (!isCheckoutSessionId(sessionId)) return { ok: false, reason: "invalid" };
  const stripe = await stripeFor(deps);
  if (!stripe) return { ok: false, reason: "unavailable" };

  let session: any;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
  } catch {
    return { ok: false, reason: "not_found" };
  }
  if (!session || session.id !== sessionId) return { ok: false, reason: "not_found" };
  const meta = (session.metadata ?? {}) as Record<string, unknown>;
  if (session.mode !== "payment" || meta.reason !== RESERVATION_FEE_REASON) return { ok: false, reason: "not_reservation_fee" };
  if (session.payment_status !== "paid") return { ok: false, reason: "unpaid" };
  const applicationId = str(meta.applicationId);
  const agreementId = str(meta.agreementId);
  const paymentId = str(meta.paymentIds);
  if (!applicationId || !agreementId || !paymentId || ![applicationId, agreementId, paymentId].every((x) => UUID.test(x))) return { ok: false, reason: "not_reservation_fee" };

  // The session must point at OUR Reservation Fee row for this agreement and applicant.
  const [payRes, agRes, appRes] = await Promise.all([
    admin.from("payments").select("id,driver_id,reason,notes,status,amount,stripe_receipt_url,stripe_paid_at").eq("id", paymentId).maybeSingle(),
    admin.from("agreements").select("id,application_id,status,vehicle_id,metadata").eq("id", agreementId).maybeSingle(),
    admin.from("applications").select("id,status,vehicle_id,weekly_rent,contract_start_date,market_id,deleted_at").eq("id", applicationId).maybeSingle(),
  ]);
  const pay = payRes?.data;
  const ag = agRes?.data;
  const app = appRes?.data;
  if (!pay || pay.driver_id !== applicationId || pay.reason !== RESERVATION_FEE_REASON || pay.notes == null || !String(pay.notes).startsWith(reservationFeeNote(agreementId))) return { ok: false, reason: "not_reservation_fee" };
  if (pay.status === "void" || pay.status === "refunded") return { ok: false, reason: "not_reservation_fee" };
  if (!ag || ag.application_id !== applicationId || ag.status !== "signed") return { ok: false, reason: "not_reservation_fee" };
  const storedSession = (ag.metadata as any)?.reservation_fee_checkout?.session_id;
  if (storedSession && storedSession !== sessionId) return { ok: false, reason: "not_reservation_fee" };
  if (!app || app.deleted_at) return { ok: false, reason: "not_found" };

  // Payment fields from Stripe; the stored row only fills gaps.
  const pi = typeof session.payment_intent === "object" && session.payment_intent ? session.payment_intent : null;
  const charge = pi && typeof pi.latest_charge === "object" && pi.latest_charge ? pi.latest_charge : null;
  const card = charge?.payment_method_details?.card ?? null;
  const paidAtSec = num(charge?.created) ?? num(pi?.created);
  const receipt = {
    amount: (num(session.amount_total) ?? Math.round(Number(pay.amount ?? 0) * 100)) / 100,
    paidAt: paidAtSec ? new Date(paidAtSec * 1000).toISOString() : str(pay.stripe_paid_at),
    cardBrand: str(card?.brand),
    cardLast4: str(card?.last4) && /^\d{4}$/.test(String(card.last4)) ? String(card.last4) : null,
    receiptUrl: safeReceiptUrl(charge?.receipt_url) ?? safeReceiptUrl(pay.stripe_receipt_url),
  };

  // The car: the signed agreement's, then the staff terms', then the applicant's.
  const terms = await latestStaffTerms(admin, applicationId);
  const vehicleId = [ag.vehicle_id, terms?.vehicle_id, app.vehicle_id].map(str).find((x) => x && UUID.test(x)) ?? null;
  let vehicle: any = null;
  if (vehicleId) {
    const v = await admin.from("vehicles").select("id,year,make,model,color,weekly_rate,status,archived_at").eq("id", vehicleId).maybeSingle();
    vehicle = v?.data ?? null;
  }
  let market: string | null = null;
  if (app.market_id) {
    const m = await admin.from("markets").select("name,state").eq("id", app.market_id).maybeSingle();
    market = m?.data ? [m.data.name, m.data.state].filter(Boolean).join(", ") || null : null;
  }
  const rental: PaymentReceivedRental = {
    vehicle: vehicle ? { year: num(vehicle.year), make: str(vehicle.make), model: str(vehicle.model), color: str(vehicle.color) } : null,
    weeklyRate: num(terms?.weekly_rate) ?? num(app.weekly_rent) ?? num(vehicle?.weekly_rate),
    startDate: day(terms?.start_date) ?? day(app.contract_start_date),
    market,
  };

  const settings = await scheduleFor(admin, deps);
  const location = settings.defaultLocation ?? null;
  const booking = await bookingState(admin, { applicationId, appStatus: app.status, vehicleId, vehicle, settings, location }, deps);
  return { view: { ok: true, receipt, rental, booking }, applicationId, vehicleId: vehicle ? vehicleId : null, location, settings };
}

async function bookingState(
  admin: Admin,
  x: { applicationId: string; appStatus: unknown; vehicleId: string | null; vehicle: any; settings: PickupScheduleSettings; location: string | null },
  deps: PaymentReceivedDeps,
): Promise<PickupBookingState> {
  const { data: mine } = await admin.from("rentals").select("id,start_date,reservation_note,vehicle_id").eq("application_id", x.applicationId).eq("status", "reserved").limit(1);
  const existing = ((mine ?? []) as any[])[0];
  if (existing) {
    const b = bookedFrom(existing);
    // A reservation without a pickup time (an old staff record) still means "we'll call".
    return b ? { state: "reserved", pickup: b } : { state: "unavailable" };
  }
  if (!x.vehicleId || !x.vehicle) return { state: "no_vehicle" };
  if (!["approved", "active"].includes(String(x.appStatus ?? "").toLowerCase())) return { state: "unavailable" };
  const vs = String(x.vehicle.status ?? "").toLowerCase();
  if (x.vehicle.archived_at || ["sold", "retired", "archived", "rented"].includes(vs)) return { state: "unavailable" };
  const { data: busy } = await admin.from("rentals").select("id,application_id").eq("vehicle_id", x.vehicleId).in("status", ["active", "reserved"]).limit(5);
  if (((busy ?? []) as any[]).some((r) => r.application_id !== x.applicationId)) return { state: "unavailable" };
  if (!x.location || x.location.trim().length < 3) return { state: "no_slots" };
  const now = (deps.now ?? (() => new Date()))();
  let slots: PickupSlot[];
  try {
    slots = await openSlots(admin, x.settings, now, deps);
  } catch {
    return { state: "no_slots" };
  }
  return slots.length ? { state: "pick", slots, location: x.location } : { state: "no_slots" };
}

/** The page's data, or why it falls back to the static thank-you. */
export async function lookupPaymentReceived(admin: Admin, sessionId: unknown, deps: PaymentReceivedDeps = {}): Promise<PaymentReceivedView> {
  try {
    const v = await verify(admin, sessionId, deps);
    return "view" in v ? v.view : v;
  } catch (e) {
    console.error("[payment-received] lookup failed", String((e as Error)?.message ?? e));
    return { ok: false, reason: "unavailable" };
  }
}

const SLOT_TAKEN = "That time was just taken. Please pick another.";
const CALL_US = "We couldn't book that online. We'll call you to schedule your pickup.";

/** The renter picks a pickup slot. One Reserved booking, through createReservationCore only. */
export async function bookRenterPickup(admin: Admin, input: { sessionId: unknown; startAt: unknown }, deps: PaymentReceivedDeps = {}): Promise<BookPickupResult> {
  let v: Awaited<ReturnType<typeof verify>>;
  try {
    v = await verify(admin, input.sessionId, deps);
  } catch {
    return { ok: false, code: "failed", message: "Something went wrong. Please try again or call us." };
  }
  if (!("view" in v)) return { ok: false, code: "invalid_session", message: "We couldn't find this payment. Please call us to schedule your pickup." };
  const b = v.view.booking;
  // Already booked (a double tap, a second tab, a refresh): show it, never book twice.
  if (b.state === "reserved") return { ok: true, already: true, pickup: b.pickup };
  if (b.state === "no_vehicle") return { ok: false, code: "no_vehicle", message: "Your car isn't assigned yet. We'll call you to schedule your pickup." };
  if (b.state === "no_slots") return { ok: false, code: "no_slots", message: "No pickup times are open right now. We'll call you to schedule." };
  if (b.state !== "pick" || !v.vehicleId || !v.location) return { ok: false, code: "unavailable", message: CALL_US };

  const s = v.settings;
  const slot = parseSlotStart(input.startAt, s.timezone);
  if (!slot || !isScheduledSlot(s, slot.date, slot.time)) return { ok: false, code: "bad_slot", message: "Please pick one of the times shown.", slots: b.slots };
  if (!b.slots.some((o) => o.date === slot.date && o.time === slot.time)) return { ok: false, code: "slot_taken", message: SLOT_TAKEN, slots: b.slots };

  const reserve = deps.reserve ?? (async (a: Admin, d: any) => (await import("@/lib/reservations.functions")).createReservationCore(a, d));
  let res: { id: string; loginEmail: string };
  try {
    // Not requireReservationFee: Stripe just confirmed this exact fee is paid,
    // and the payments webhook may not have landed yet. If it lags, the
    // reservation shows the fee as pending until the webhook's
    // holdReservationForFee marks it applied and re-runs the (idempotent)
    // confirmation check.
    res = await reserve(admin, { applicationId: v.applicationId, vehicleId: v.vehicleId, pickupDate: slot.date, pickupTime: slot.time, pickupLocation: v.location, bookedBy: "renter" });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // Whatever the guard said, first check whether this renter now holds a
    // booking (a second tap or tab won the race): show it, never book twice.
    const fresh = await lookupPaymentReceived(admin, input.sessionId, deps);
    if (fresh.ok && fresh.booking.state === "reserved") return { ok: true, already: true, pickup: fresh.booking.pickup };
    if (/Pickup Slot Is Already Booked/i.test(msg)) {
      const slots = fresh.ok && fresh.booking.state === "pick" ? fresh.booking.slots : [];
      return { ok: false, code: slots.length ? "slot_taken" : "no_slots", message: slots.length ? SLOT_TAKEN : "No pickup times are open right now. We'll call you to schedule.", slots };
    }
    console.error("[payment-received] booking refused", msg.slice(0, 200));
    return { ok: false, code: "unavailable", message: CALL_US };
  }

  const pickup: BookedPickup = { date: slot.date, time: slot.time, label: slotLabel(slot.date, slot.time), location: v.location };
  const audit = deps.audit ?? (async (e: any) => (await import("@/lib/audit.server")).logAudit(null, e));
  await audit({
    action: "reservation.renter_booked",
    summary: `Pickup booked ${pickup.label} (Renter-Booked on the Payment Received page)`,
    entityType: "rental",
    entityId: res.id,
    metadata: { booked_by: "renter", source: "renter", application_id: v.applicationId, vehicle_id: v.vehicleId, pickup_date: slot.date, pickup_time: slot.time, login_email: res.loginEmail },
  }).catch(() => {});
  return { ok: true, already: false, pickup };
}
