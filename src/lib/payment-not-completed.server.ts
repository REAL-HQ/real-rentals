/**
 * Payment Not Completed page, server half. See payment-not-completed.ts.
 *
 *   lookupPaymentNotCompleted(admin, sessionId)
 *     The cancel return URL's Checkout Session id is the bearer token. The
 *     session must be a payment-mode Reservation Fee Checkout whose metadata
 *     matches OUR rows (same checks as payment-received.server.ts, except
 *     unpaid / expired / canceled sessions are accepted). A paid session (or
 *     a fee row already marked paid) is returned as alreadyPaid so the page
 *     can send the renter to Payment Received. Live figures — available cars
 *     in the applicant's city, and open Mon–Fri pickup slots this week — come
 *     from the database and listOpenSlots (the PR435 slot logic). If either
 *     cannot be resolved, it is omitted rather than invented. Published
 *     listing photos for the signed car are included when they exist.
 *
 *   restartReservationFeeCheckout(admin, sessionId)
 *     Reuses the still-open Checkout, or mints a new session for the SAME
 *     unpaid fee row (reservation-fee.server.ts). A paid fee never starts a
 *     second charge.
 */
import { isCheckoutSessionId, vehicleLabel } from "@/lib/payment-received";
import {
  countOpenSlotsThisWeek,
  publicPhotoUrls,
  type PaymentNotCompletedView,
  type RestartCheckoutResult,
} from "@/lib/payment-not-completed";
import { RESERVATION_FEE_REASON, reservationFeeNote, safeCheckoutUrl } from "@/lib/reservation-fee";
import { type PickupScheduleSettings, type PickupSlot } from "@/lib/pickup-schedule";

type Admin = any;
type StripeLike = any;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PaymentNotCompletedDeps = {
  stripe?: StripeLike | null;
  settings?: PickupScheduleSettings;
  now?: () => Date;
  listSlots?: (admin: Admin, s: PickupScheduleSettings, now: Date) => Promise<PickupSlot[]>;
  audit?: (e: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) => Promise<void>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

async function stripeFor(deps: PaymentNotCompletedDeps): Promise<StripeLike | null> {
  if (deps.stripe !== undefined) return deps.stripe;
  const { stripeClient } = await import("@/lib/reservation-fee-core.server");
  return stripeClient({});
}

async function scheduleFor(admin: Admin, deps: PaymentNotCompletedDeps): Promise<PickupScheduleSettings> {
  if (deps.settings) return deps.settings;
  const { loadPickupSchedule } = await import("@/lib/reservation-confirmation.server");
  return loadPickupSchedule(admin);
}

async function openSlots(admin: Admin, s: PickupScheduleSettings, now: Date, deps: PaymentNotCompletedDeps): Promise<PickupSlot[]> {
  if (deps.listSlots) return deps.listSlots(admin, s, now);
  const { listOpenSlots } = await import("@/lib/fleet-pickup.server");
  return listOpenSlots(admin, s, now, { days: 8, limit: 50 });
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

type Verified = {
  view: Extract<PaymentNotCompletedView, { ok: true }>;
  agreementId: string;
};

async function verify(admin: Admin, sessionId: unknown, deps: PaymentNotCompletedDeps): Promise<Verified | Extract<PaymentNotCompletedView, { ok: false }>> {
  if (!isCheckoutSessionId(sessionId)) return { ok: false, reason: "invalid" };
  const stripe = await stripeFor(deps);
  if (!stripe) return { ok: false, reason: "unavailable" };

  let session: any;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { ok: false, reason: "not_found" };
  }
  if (!session || session.id !== sessionId) return { ok: false, reason: "not_found" };
  const meta = (session.metadata ?? {}) as Record<string, unknown>;
  if (session.mode !== "payment" || meta.reason !== RESERVATION_FEE_REASON) return { ok: false, reason: "not_reservation_fee" };
  const applicationId = str(meta.applicationId);
  const agreementId = str(meta.agreementId);
  const paymentId = str(meta.paymentIds);
  if (!applicationId || !agreementId || !paymentId || ![applicationId, agreementId, paymentId].every((x) => UUID.test(x))) {
    return { ok: false, reason: "not_reservation_fee" };
  }

  const [payRes, agRes, appRes] = await Promise.all([
    admin.from("payments").select("id,driver_id,reason,notes,status,amount").eq("id", paymentId).maybeSingle(),
    admin.from("agreements").select("id,application_id,status,vehicle_id,metadata").eq("id", agreementId).maybeSingle(),
    admin.from("applications").select("id,status,vehicle_id,market_id,deleted_at").eq("id", applicationId).maybeSingle(),
  ]);
  const pay = payRes?.data;
  const ag = agRes?.data;
  const app = appRes?.data;
  if (!pay || pay.driver_id !== applicationId || pay.reason !== RESERVATION_FEE_REASON || pay.notes == null || !String(pay.notes).startsWith(reservationFeeNote(agreementId))) {
    return { ok: false, reason: "not_reservation_fee" };
  }
  if (pay.status === "void" || pay.status === "refunded") return { ok: false, reason: "not_reservation_fee" };
  if (!ag || ag.application_id !== applicationId || ag.status !== "signed") return { ok: false, reason: "not_reservation_fee" };
  if (!app || app.deleted_at) return { ok: false, reason: "not_found" };

  const now = (deps.now ?? (() => new Date()))();
  const stripePaid = session.payment_status === "paid";
  if (stripePaid || pay.status === "paid") {
    return { view: { ok: true, alreadyPaid: true, sessionId: stripePaid ? sessionId : null }, agreementId };
  }

  const terms = await latestStaffTerms(admin, applicationId);
  const vehicleId = [ag.vehicle_id, terms?.vehicle_id, app.vehicle_id].map(str).find((x) => x && UUID.test(x)) ?? null;
  let vehicleRow: any = null;
  if (vehicleId) {
    const v = await admin.from("vehicles").select("id,year,make,model,color,body_type,photos,status,archived_at,market_id").eq("id", vehicleId).maybeSingle();
    vehicleRow = v?.data ?? null;
  }
  const label = vehicleLabel(vehicleRow ? { year: num(vehicleRow.year), make: str(vehicleRow.make), model: str(vehicleRow.model), color: str(vehicleRow.color) } : null);
  const vehicle = label
    ? { label, photos: publicPhotoUrls(vehicleRow?.photos), bodyType: str(vehicleRow?.body_type) }
    : null;

  const marketId = str(app.market_id) ?? str(vehicleRow?.market_id);
  let city: string | null = null;
  let availableCars: number | null = null;
  if (marketId && UUID.test(marketId)) {
    try {
      const m = await admin.from("markets").select("id,name").eq("id", marketId).maybeSingle();
      const name = str(m?.data?.name);
      city = name;
      if (name) {
        const inv = await admin.from("vehicles").select("id,status,archived_at,market_id").eq("market_id", marketId).eq("status", "available");
        if (inv?.error) {
          availableCars = null;
        } else {
          availableCars = ((inv?.data ?? []) as any[]).filter((row) => !row.archived_at).length;
        }
      }
    } catch {
      city = city ?? null;
      availableCars = null;
    }
  }

  let openSlotsThisWeek: number | null = null;
  try {
    const settings = await scheduleFor(admin, deps);
    const slots = await openSlots(admin, settings, now, deps);
    openSlotsThisWeek = countOpenSlotsThisWeek(slots, now, settings.timezone);
  } catch {
    openSlotsThisWeek = null;
  }

  const expiresAtSec = num(session.expires_at);
  const linkExpiresAt = expiresAtSec && expiresAtSec > 0 ? new Date(expiresAtSec * 1000).toISOString() : null;
  const stillOpen = session.status === "open" && (!expiresAtSec || expiresAtSec * 1000 > now.getTime());
  const checkoutUrl = stillOpen ? safeCheckoutUrl(session.url) : null;

  return {
    view: {
      ok: true,
      alreadyPaid: false,
      processing: pay.status === "pending",
      amount: num(pay.amount) ?? 50,
      vehicle,
      city,
      availableCars,
      openSlotsThisWeek,
      linkExpiresAt,
      checkoutUrl: pay.status === "pending" ? null : checkoutUrl,
    },
    agreementId,
  };
}

export async function lookupPaymentNotCompleted(admin: Admin, sessionId: unknown, deps: PaymentNotCompletedDeps = {}): Promise<PaymentNotCompletedView> {
  try {
    const v = await verify(admin, sessionId, deps);
    return "view" in v ? v.view : v;
  } catch (e) {
    console.error("[payment-not-completed] lookup failed", String((e as Error)?.message ?? e));
    return { ok: false, reason: "unavailable" };
  }
}

const RESTART_FAILED = "We couldn't open checkout. Please use the Pay Reservation Fee button in your Agreement Signed email, or call us.";

export async function restartReservationFeeCheckout(admin: Admin, sessionId: unknown, deps: PaymentNotCompletedDeps = {}): Promise<RestartCheckoutResult> {
  let v: Awaited<ReturnType<typeof verify>>;
  try {
    v = await verify(admin, sessionId, deps);
  } catch {
    return { ok: false, message: RESTART_FAILED };
  }
  if (!("view" in v)) return { ok: false, message: RESTART_FAILED };
  if (v.view.alreadyPaid) return { ok: true, alreadyPaid: true, sessionId: v.view.sessionId };
  if (v.view.processing) return { ok: false, message: "Your Reservation Fee is still processing. Please wait a moment, then refresh this page." };
  if (v.view.checkoutUrl) return { ok: true, alreadyPaid: false, url: v.view.checkoutUrl };

  try {
    const { chargeReservationFeeAfterSigning } = await import("@/lib/reservation-fee.server");
    const outcome = await chargeReservationFeeAfterSigning(admin, v.agreementId, {
      stripe: await stripeFor(deps),
      reuseCheckout: false,
      now: () => (deps.now ?? (() => new Date()))().getTime(),
      audit: deps.audit ?? (async () => {}),
    });
    if (outcome.status === "already_paid" || outcome.status === "paid") return { ok: true, alreadyPaid: true, sessionId: typeof sessionId === "string" ? sessionId : null };
    if (outcome.status === "pending") return { ok: false, message: "Your Reservation Fee is still processing. Please wait a moment, then refresh this page." };
    if (outcome.status === "checkout") {
      const url = safeCheckoutUrl(outcome.url);
      if (url) return { ok: true, alreadyPaid: false, url };
    }
    return { ok: false, message: RESTART_FAILED };
  } catch (e) {
    console.error("[payment-not-completed] restart failed", String((e as Error)?.message ?? e));
    return { ok: false, message: RESTART_FAILED };
  }
}

