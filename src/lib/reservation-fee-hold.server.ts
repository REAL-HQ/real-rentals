/**
 * Release an unpaid Reservation Fee hold: turn off the payment link, mark the
 * fee expired (not deleted), clear the assigned car, and cancel any open
 * reservation rental so the car can be booked immediately.
 *
 * Staff may release at any time inside the window. The cron releases only
 * after the window (app_settings reservation_fee_hold_hours, default 24).
 * The application is not declined. Nothing here refunds a payment.
 */
import { RESERVATION_FEE_REASON } from "@/lib/reservation-fee";
import {
  EXPIRED_FEE_STATUS,
  NO_HOLD_NOTE,
  assignmentStillBlocks,
  holdWindowOpen,
  reservationFeeHoldHours,
  unpaidFeeBlockMessage,
  RESERVATION_FEE_HOLD_HOURS_KEY,
  DEFAULT_RESERVATION_FEE_HOLD_HOURS,
} from "@/lib/reservation-fee-hold";
import { isUnpaidReservationFee } from "@/lib/payments-summary";

type Admin = any;

const UNPAID_STATUSES = ["current", "unpaid", "pending", "failed"];
const OPEN_RENTAL = ["reserved", "on_hold", "pending_reservation"];

type StripeLike = {
  checkout: { sessions: { retrieve: (id: string) => Promise<{ status?: string | null }>; expire: (id: string) => Promise<unknown> } };
};

export type ReleaseResult = {
  released: boolean;
  reason?: "not_found" | "not_unpaid" | "still_open" | "already_paid";
  vehicleId?: string | null;
  paymentLinkExpired?: boolean;
};

type Notify = (admin: Admin, notice: { title: string; body: string; applicationId: string }) => Promise<void>;

async function defaultNotify(admin: Admin, notice: { title: string; body: string; applicationId: string }) {
  try {
    await admin.from("notifications").insert({
      driver_id: null,
      title: notice.title,
      body: notice.body,
      kind: "payment",
      read: false,
    });
  } catch { /* the audit row still records the release */ }
  try {
    const { sendEmail, TEAM_ALERT_INBOX } = await import("@/lib/email.server");
    await sendEmail({
      to: TEAM_ALERT_INBOX,
      subject: notice.title,
      html: `<p>${notice.body}</p><p><a href="https://drivereal.com/admin?tab=drivers&id=${encodeURIComponent(notice.applicationId)}">Open In Admin</a></p>`,
      track: { workflow: "payment_team_alert" },
    });
  } catch { /* in-app notice already written */ }
}

async function audit(admin: Admin, entry: { action: string; summary: string; entityId?: string; metadata?: Record<string, unknown> }) {
  try {
    await admin.from("audit_log").insert({
      action: entry.action,
      summary: entry.summary,
      entity_type: "application",
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch { /* audit never fails the release */ }
}

export async function loadReservationFeeHoldHours(admin: Admin): Promise<number> {
  try {
    const row = await admin.from("app_settings").select("value").eq("key", RESERVATION_FEE_HOLD_HOURS_KEY).maybeSingle();
    if (row?.error || !row?.data) return DEFAULT_RESERVATION_FEE_HOLD_HOURS;
    return reservationFeeHoldHours(row.data.value);
  } catch {
    return DEFAULT_RESERVATION_FEE_HOLD_HOURS;
  }
}

function latestSignedAt(agreements: any[], payment: { created_at?: string | null }): string | null {
  const signed = (agreements ?? [])
    .filter((g) => String(g?.status ?? "").toLowerCase() === "signed" && g?.signed_at)
    .map((g) => String(g.signed_at))
    .sort();
  if (signed.length) return signed[signed.length - 1];
  return payment?.created_at ? String(payment.created_at) : null;
}

async function sessionIds(admin: Admin, applicationId: string): Promise<string[]> {
  const ag = await admin.from("agreements").select("id,metadata").eq("application_id", applicationId).limit(20);
  const ids: string[] = [];
  for (const g of (ag?.data ?? []) as any[]) {
    const id = g?.metadata?.reservation_fee_checkout?.session_id;
    if (id) ids.push(String(id));
  }
  return ids;
}

async function stripeClientOrNull(): Promise<StripeLike | null> {
  try {
    const { stripeClient } = await import("@/lib/reservation-fee-core.server");
    return (await stripeClient({})) as StripeLike | null;
  } catch {
    return null;
  }
}

/** Expire open Checkout sessions. A completed session means the fee was paid. */
async function expireLinks(stripe: StripeLike | null, ids: string[]): Promise<{ expired: boolean; alreadyPaid: boolean }> {
  if (!stripe || !ids.length) return { expired: false, alreadyPaid: false };
  let expired = false;
  for (const id of ids) {
    const sess = await stripe.checkout.sessions.retrieve(id);
    if (sess?.status === "complete") return { expired: false, alreadyPaid: true };
    if (sess?.status === "open") {
      await stripe.checkout.sessions.expire(id);
      expired = true;
    }
  }
  return { expired, alreadyPaid: false };
}

async function cancelOpenRentals(admin: Admin, applicationId: string, vehicleId: string | null) {
  const open = await admin.from("rentals").select("id,status,vehicle_id").eq("application_id", applicationId).limit(10);
  const rows = ((open?.data ?? []) as any[]).filter((r) => OPEN_RENTAL.includes(String(r.status)));
  const vehicles = new Set<string>();
  if (vehicleId) vehicles.add(vehicleId);
  for (const rental of rows) {
    await admin.from("rentals").update({ status: "cancelled" }).eq("id", rental.id).in("status", OPEN_RENTAL);
    if (rental.vehicle_id) vehicles.add(String(rental.vehicle_id));
  }
  for (const id of vehicles) {
    const still = await admin.from("rentals").select("id").eq("vehicle_id", id).in("status", [...OPEN_RENTAL, "active"]).limit(1);
    if (!(still?.data ?? []).length) {
      await admin.from("vehicles").update({ status: "available" }).eq("id", id).in("status", ["reserved", "pending_reservation"]);
    }
  }
}

export async function releaseUnpaidReservationHold(
  admin: Admin,
  input: { applicationId: string; by: "staff" | "cron"; now?: Date; stripe?: StripeLike | null; notify?: Notify },
): Promise<ReleaseResult> {
  const now = input.now ?? new Date();
  const notify = input.notify ?? defaultNotify;
  const appRes = await admin.from("applications").select("id,full_name,email,status,vehicle_id,deleted_at").eq("id", input.applicationId).maybeSingle();
  const app = appRes?.data;
  if (appRes?.error || !app || app.deleted_at) return { released: false, reason: "not_found" };

  const pay = await admin.from("payments").select("id,status,type,reason,notes,amount,created_at").eq("driver_id", input.applicationId).limit(20);
  const unpaid = ((pay?.data ?? []) as any[]).filter((row) => isUnpaidReservationFee(row));
  if (!unpaid.length) return { released: false, reason: "not_unpaid" };
  const fee = unpaid[0];

  const agreements = await admin.from("agreements").select("id,status,signed_at,metadata").eq("application_id", input.applicationId).limit(20);
  const signedAt = latestSignedAt((agreements?.data ?? []) as any[], fee);
  const hours = await loadReservationFeeHoldHours(admin);
  if (input.by === "cron" && (!signedAt || holdWindowOpen(signedAt, now, hours))) {
    return { released: false, reason: "still_open" };
  }

  const ids = await sessionIds(admin, input.applicationId);
  const stripe = input.stripe === undefined ? await stripeClientOrNull() : input.stripe;
  let link = { expired: false, alreadyPaid: false };
  try {
    link = await expireLinks(stripe, ids);
  } catch {
    link = { expired: false, alreadyPaid: false };
  }
  if (link.alreadyPaid) return { released: false, reason: "already_paid" };

  const note = `${String(fee.notes ?? "")} Released: payment link turned off.`.trim().slice(0, 400);
  const upd = await admin.from("payments").update({ status: EXPIRED_FEE_STATUS, notes: note }).eq("id", fee.id).in("status", UNPAID_STATUSES).select("id");
  if (upd?.error) throw new Error(upd.error.message ?? "Could not release the Reservation Fee.");
  if (!(upd?.data ?? []).length) return { released: false, reason: "not_unpaid" };

  const vehicleId = app.vehicle_id ? String(app.vehicle_id) : null;
  if (vehicleId) {
    await admin.from("applications").update({ vehicle_id: null }).eq("id", input.applicationId).eq("vehicle_id", vehicleId);
  }
  await cancelOpenRentals(admin, input.applicationId, vehicleId);

  const name = String(app.full_name ?? app.email ?? "This signer");
  const who = input.by === "staff" ? "staff" : `${hours} hours`;
  await audit(admin, {
    action: "reservation_fee.hold_released",
    summary: `Reservation Fee hold released by ${who}. Payment link turned off.`.slice(0, 300),
    entityId: input.applicationId,
    metadata: {
      application_id: input.applicationId,
      vehicle_id: vehicleId,
      payment_id: fee.id,
      by: input.by,
      hours,
      payment_link_expired: link.expired,
    },
  });
  await notify(admin, {
    title: "Reservation Fee Hold Released",
    body: `${name}'s payment link was turned off. The car can be assigned to someone else.`,
    applicationId: input.applicationId,
  });
  return { released: true, vehicleId, paymentLinkExpired: link.expired };
}

export async function releaseExpiredReservationHolds(
  admin: Admin,
  opts: { now?: Date; stripe?: StripeLike | null; notify?: Notify } = {},
): Promise<{ checked: number; released: number }> {
  const [byReason, byType] = await Promise.all([
    admin.from("payments").select("id,driver_id,status,type,reason,notes").eq("reason", RESERVATION_FEE_REASON).limit(200),
    admin.from("payments").select("id,driver_id,status,type,reason,notes").eq("type", "reservation").limit(200),
  ]);
  const rows = [...((byReason?.data ?? []) as any[]), ...((byType?.data ?? []) as any[])].filter((row) => isUnpaidReservationFee(row));
  const apps = [...new Set(rows.map((row) => row.driver_id).filter(Boolean).map(String))];
  let released = 0;
  for (const applicationId of apps) {
    try {
      const result = await releaseUnpaidReservationHold(admin, { applicationId, by: "cron", now: opts.now, stripe: opts.stripe, notify: opts.notify });
      if (result.released) released += 1;
    } catch (err) {
      console.error("[reservation-fee-hold] release failed", applicationId, err);
    }
  }
  return { checked: apps.length, released };
}

/** Another approved applicant still holds this car on an unpaid Reservation Fee. */
export async function reservationFeeHoldConflict(
  admin: Admin,
  input: { vehicleId: string; requesterApplicationId: string },
): Promise<string | null> {
  const holders = await admin.from("applications").select("id,full_name,email,status,deleted_at,vehicle_id").eq("vehicle_id", input.vehicleId).eq("status", "approved").limit(20);
  const others = ((holders?.data ?? []) as any[]).filter((row) => row.id !== input.requesterApplicationId && !row.deleted_at);
  for (const holder of others) {
    const fees = await admin.from("payments").select("id,status,type,reason,notes").eq("driver_id", holder.id).limit(20);
    const rows = (fees?.data ?? []) as any[];
    if (rows.some((row) => isUnpaidReservationFee(row)) && assignmentStillBlocks(rows)) {
      return unpaidFeeBlockMessage(holder.full_name ?? holder.email);
    }
  }
  return null;
}

/**
 * The fee was collected but no car was held (released already, or the car
 * was not free). The payment stays paid. Staff get a notice. No refund.
 */
export async function flagReservationFeePaidWithoutHold(
  admin: Admin,
  applicationId: string,
  fee: { id: string; amount: number },
  notify: Notify = defaultNotify,
): Promise<{ flagged: boolean }> {
  const row = await admin.from("payments").select("id,status,notes").eq("id", fee.id).maybeSingle();
  if (!row?.data || String(row.data.status) !== "paid") return { flagged: false };
  if (String(row.data.notes ?? "").includes(NO_HOLD_NOTE)) return { flagged: false };
  const notes = `${String(row.data.notes ?? "")} ${NO_HOLD_NOTE}`.trim().slice(0, 400);
  await admin.from("payments").update({ notes }).eq("id", fee.id).eq("status", "paid");
  const app = await admin.from("applications").select("id,full_name,email").eq("id", applicationId).maybeSingle();
  const name = String(app?.data?.full_name ?? app?.data?.email ?? "A renter");
  await audit(admin, {
    action: "reservation_fee.paid_without_hold",
    summary: `${name} paid the Reservation Fee with no car held. No refund was issued.`.slice(0, 300),
    entityId: applicationId,
    metadata: { application_id: applicationId, payment_id: fee.id, amount: fee.amount },
  });
  await notify(admin, {
    title: "Reservation Fee Paid With No Car",
    body: `${name} paid $${Number(fee.amount).toFixed(2)} after the car was released or was not available. No hold was created. Refund or reassign.`,
    applicationId,
  });
  return { flagged: true };
}

export async function clearReservationFeeNoHoldFlag(admin: Admin, paymentId: string): Promise<void> {
  const row = await admin.from("payments").select("id,notes").eq("id", paymentId).maybeSingle();
  const notes = String(row?.data?.notes ?? "");
  if (!notes.includes(NO_HOLD_NOTE)) return;
  await admin.from("payments").update({ notes: notes.replace(NO_HOLD_NOTE, "").replace(/\s+/g, " ").trim() }).eq("id", paymentId);
}
