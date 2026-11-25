/**
 * Pending Reservation I/O. Rules live in pending-reservation.ts.
 *
 * Fee paid → one rentals row in pending_reservation and the assigned car
 * leaves Available. Insurance card issued → that row becomes reserved.
 * Void, decline, close, or a Reservation Fee refund releases the pending
 * hold. Pickup booking (createReservationCore, including PR 517 Book Pickup)
 * reuses the pending or on_hold row.
 *
 * No renter email or text is sent from this module. The optional team alert
 * is one per rental and carries no phone number.
 */
import { isForSaleVehicleStatus } from "@/lib/fleet-summary";
import {
  HELD_RENTAL_STATUSES,
  PENDING_RESERVATION_STATUS,
  isIssuedRenterInsuranceCard,
  isPendingReservationStatus,
  pendingHoldNote,
} from "@/lib/pending-reservation";
import { readReservationDetails, RESERVATION_STATUS } from "@/lib/reservations";

type Admin = any;

const OPEN_FOR_PERSON = [PENDING_RESERVATION_STATUS, RESERVATION_STATUS, "on_hold"] as const;
const NOT_FREE_VEHICLE = ["sold", "retired", "archived", "rented", "unavailable", "reserved", PENDING_RESERVATION_STATUS];

export type ReleaseReason =
  | "agreement_voided"
  | "application_declined"
  | "application_closed"
  | "fee_refunded"
  | "staff_release";

const RELEASE_SUMMARY: Record<ReleaseReason, string> = {
  agreement_voided: "Pending Reservation released because the agreement was voided",
  application_declined: "Pending Reservation released because the application was declined",
  application_closed: "Pending Reservation released because the application was closed",
  fee_refunded: "Pending Reservation released because the Reservation Fee was refunded",
  staff_release: "Pending Reservation released by staff",
};

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

async function audit(admin: Admin, entry: { action: string; summary: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }) {
  try {
    await admin.from("audit_log").insert({
      action: entry.action,
      summary: entry.summary,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch {
    /* audit never fails the hold */
  }
}

export async function hasIssuedInsuranceCard(admin: Admin, applicationId: string): Promise<boolean> {
  const res = await admin
    .from("documents")
    .select("id,category,label,is_current,review_status")
    .eq("driver_id", applicationId)
    .eq("category", "insurance")
    .limit(20);
  return ((res?.data ?? []) as any[]).some((row) => isIssuedRenterInsuranceCard(row));
}

async function setVehicleStatus(admin: Admin, vehicleId: string, status: "pending_reservation" | "reserved" | "available", from: string[]) {
  await admin.from("vehicles").update({ status }).eq("id", vehicleId).in("status", from);
}

async function linkFee(admin: Admin, rentalId: string, paymentId: string | null) {
  if (paymentId) {
    await admin.from("payments").update({ rental_id: rentalId }).eq("id", paymentId).is("rental_id", null);
  }
  try {
    await (await import("@/lib/booking-links.server")).linkOrphansToRental(admin, rentalId);
  } catch {
    /* linking never fails the hold */
  }
}

async function stampFee(
  admin: Admin,
  rentalId: string,
  fee: { id: string; amount: number },
  onlyStatus: string,
) {
  await admin
    .from("rentals")
    .update({
      reservation_deposit_required: true,
      reservation_deposit_amount: fee.amount,
      reservation_deposit_status: "applied",
      reservation_deposit_payment_id: fee.id,
    })
    .eq("id", rentalId)
    .eq("status", onlyStatus);
  await linkFee(admin, rentalId, fee.id);
}

/** Optional team alert, once per rental. No phone number. */
async function alertPendingOnce(admin: Admin, rentalId: string, who: string | null, applicationId: string) {
  const prior = await admin
    .from("audit_log")
    .select("id")
    .eq("action", "rental.pending_reservation")
    .eq("entity_id", rentalId)
    .limit(1);
  if (!prior?.error && ((prior?.data ?? []) as any[]).length) return;
  const name = String(who ?? "").trim() || "A lead";
  try {
    // Read the inbox from this client. A missing or unreadable row sends
    // nothing: the alert is optional, and a guessed address is not used.
    const settings = await admin.from("app_settings").select("value").eq("key", "notifications").maybeSingle();
    const raw = (settings?.data?.value ?? {}) as { admin_email?: unknown; alert_on_new?: unknown };
    const list = Array.isArray(raw.admin_email) ? raw.admin_email : typeof raw.admin_email === "string" ? raw.admin_email.split(",") : [];
    const to = list.map((v) => String(v).trim()).filter((v) => v.includes("@"));
    if (raw.alert_on_new !== false && to.length) {
      const { sendEmail } = await import("@/lib/email.server");
      const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const link = `https://drivereal.com/admin?tab=drivers&id=${encodeURIComponent(applicationId)}`;
      await sendEmail({
        to,
        subject: `Pending Reservation — ${name}`,
        html: `<p><strong>${esc(name)}</strong> paid the Reservation Fee. The assigned car is now a Pending Reservation, waiting on the insurance card.</p><p><a href="${link}">Open Their Profile</a></p>`,
        track: { workflow: "pending_reservation" },
      });
    }
  } catch (err) {
    console.error("[pending-reservation] team alert failed", err);
  }
  await audit(admin, {
    action: "rental.pending_reservation",
    summary: `Pending Reservation opened for ${name} after the Reservation Fee was paid`,
    entityType: "rental",
    entityId: rentalId,
    metadata: { application_id: applicationId },
  });
}

/**
 * Mark an existing reserved row fee-applied, or open a Pending Reservation
 * when the fee is paid and no pickup row exists yet.
 */
export async function holdVehicleForPaidReservationFee(
  admin: Admin,
  applicationId: string,
  fee: { id: string; amount: number },
): Promise<string | null> {
  const open = await admin
    .from("rentals")
    .select("id,status,vehicle_id")
    .eq("application_id", applicationId)
    .in("status", [...OPEN_FOR_PERSON])
    .limit(5);
  const rows = (open?.data ?? []) as any[];
  const firm = rows.find((r) => r.status === RESERVATION_STATUS || r.status === "on_hold");
  if (firm) {
    await stampFee(admin, firm.id, fee, firm.status);
    if (firm.status === RESERVATION_STATUS) {
      try {
        const { maybeConfirmReservation } = await import("@/lib/reservation-confirmation.server");
        await maybeConfirmReservation(admin, { rentalId: firm.id });
      } catch {
        /* never fails the charge */
      }
    }
    return firm.id as string;
  }
  const pending = rows.find((r) => isPendingReservationStatus(r.status));
  if (pending) {
    await stampFee(admin, pending.id, fee, PENDING_RESERVATION_STATUS);
    if (await hasIssuedInsuranceCard(admin, applicationId)) {
      return (await promotePendingReservationOnInsuranceCard(admin, applicationId)) ?? (pending.id as string);
    }
    return pending.id as string;
  }

  const { data: app, error: appErr } = await admin
    .from("applications")
    .select("id,status,user_id,full_name,email,vehicle_id,deleted_at")
    .eq("id", applicationId)
    .maybeSingle();
  if (appErr || !app || app.deleted_at) return null;
  const appStatus = String(app.status ?? "").toLowerCase();
  if (!["approved", "active"].includes(appStatus)) return null;
  const vehicleId = app.vehicle_id as string | null;
  if (!vehicleId) return null;
  try {
    await (await import("@/lib/blacklist.server")).assertNotBlacklisted(admin, applicationId);
  } catch {
    return null;
  }

  const { data: vehicle } = await admin
    .from("vehicles")
    .select("id,status,archived_at,weekly_rate")
    .eq("id", vehicleId)
    .maybeSingle();
  if (!vehicle || vehicle.archived_at) return null;
  const vStatus = String(vehicle.status ?? "").toLowerCase();
  if (NOT_FREE_VEHICLE.includes(vStatus) || isForSaleVehicleStatus(vStatus)) return null;
  const busy = await admin
    .from("rentals")
    .select("id")
    .eq("vehicle_id", vehicleId)
    .in("status", [...HELD_RENTAL_STATUSES])
    .limit(1);
  if ((busy?.data ?? []).length) return null;

  let driverId = (app.user_id as string | null) ?? null;
  if (!driverId) {
    try {
      const { provisionDriverAccount } = await import("@/lib/driver-account.server");
      const account = await provisionDriverAccount(admin, {
        applicationId,
        email: String(app.email ?? ""),
        fullName: (app.full_name as string | null) ?? null,
      });
      if (account.conflict || !account.userId) return null;
      driverId = account.userId;
    } catch {
      return null;
    }
  }

  const cardOnFile = await hasIssuedInsuranceCard(admin, applicationId);
  const status = cardOnFile ? RESERVATION_STATUS : PENDING_RESERVATION_STATUS;
  const weekly = typeof vehicle.weekly_rate === "number" ? vehicle.weekly_rate : 0;
  const inserted = await admin
    .from("rentals")
    .insert({
      driver_id: driverId,
      vehicle_id: vehicleId,
      application_id: applicationId,
      start_date: etToday(),
      status,
      weekly_rate: weekly,
      deposit_amount: 0,
      deposit_held: false,
      reservation_note: pendingHoldNote(),
      reservation_deposit_required: true,
      reservation_deposit_amount: fee.amount,
      reservation_deposit_status: "applied",
      reservation_deposit_payment_id: fee.id,
    })
    .select("id")
    .single();
  if (inserted?.error || !inserted?.data?.id) {
    console.error("[pending-reservation] could not open the hold", inserted?.error?.message ?? "");
    return null;
  }
  const rentalId = inserted.data.id as string;
  await setVehicleStatus(
    admin,
    vehicleId,
    cardOnFile ? "reserved" : "pending_reservation",
    ["available", "onboarding", "ready"],
  );
  await linkFee(admin, rentalId, fee.id);
  if (cardOnFile) {
    try {
      const { maybeConfirmReservation } = await import("@/lib/reservation-confirmation.server");
      await maybeConfirmReservation(admin, { rentalId });
    } catch {
      /* no pickup yet, so this does not confirm */
    }
    await audit(admin, {
      action: "rental.pending_reservation_promoted",
      summary: "Reservation opened as Reserved because the insurance card was already on file",
      entityType: "rental",
      entityId: rentalId,
      metadata: { application_id: applicationId, vehicle_id: vehicleId },
    });
  } else {
    await alertPendingOnce(admin, rentalId, app.full_name ?? null, applicationId);
  }
  return rentalId;
}

/** Insurance card on file: pending_reservation becomes reserved. Idempotent. */
export async function promotePendingReservationOnInsuranceCard(admin: Admin, applicationId: string): Promise<string | null> {
  if (!applicationId) return null;
  if (!(await hasIssuedInsuranceCard(admin, applicationId))) return null;
  const found = await admin
    .from("rentals")
    .select("id,status,vehicle_id")
    .eq("application_id", applicationId)
    .eq("status", PENDING_RESERVATION_STATUS)
    .limit(1);
  const row = ((found?.data ?? []) as any[])[0];
  if (!row) return null;
  const upd = await admin
    .from("rentals")
    .update({ status: RESERVATION_STATUS })
    .eq("id", row.id)
    .eq("status", PENDING_RESERVATION_STATUS)
    .select("id");
  if (upd?.error) {
    console.error("[pending-reservation] promote failed", upd.error.message);
    return null;
  }
  if (!((upd?.data ?? []) as any[]).length) return null;
  if (row.vehicle_id) {
    await setVehicleStatus(admin, row.vehicle_id, "reserved", ["pending_reservation", "available", "onboarding", "ready"]);
  }
  try {
    const { maybeConfirmReservation } = await import("@/lib/reservation-confirmation.server");
    await maybeConfirmReservation(admin, { rentalId: row.id });
  } catch {
    /* confirmation stays quiet until a pickup exists */
  }
  await audit(admin, {
    action: "rental.pending_reservation_promoted",
    summary: "Pending Reservation became Reserved because the insurance card is on file",
    entityType: "rental",
    entityId: row.id,
    metadata: { application_id: applicationId, vehicle_id: row.vehicle_id },
  });
  return row.id as string;
}

/** Cancel a pending hold and return the car to Available when nothing else holds it. */
export async function releasePendingReservation(
  admin: Admin,
  input: { applicationId?: string | null; rentalId?: string | null; reason: ReleaseReason },
): Promise<{ released: number }> {
  let q = admin
    .from("rentals")
    .select("id,vehicle_id,status,application_id")
    .eq("status", PENDING_RESERVATION_STATUS)
    .limit(5);
  if (input.rentalId) q = q.eq("id", input.rentalId);
  else if (input.applicationId) q = q.eq("application_id", input.applicationId);
  else return { released: 0 };
  const found = await q;
  const rows = (found?.data ?? []) as any[];
  let released = 0;
  for (const row of rows) {
    const upd = await admin
      .from("rentals")
      .update({ status: "cancelled" })
      .eq("id", row.id)
      .eq("status", PENDING_RESERVATION_STATUS)
      .select("id");
    if (upd?.error || !((upd?.data ?? []) as any[]).length) continue;
    released += 1;
    if (row.vehicle_id) {
      const still = await admin
        .from("rentals")
        .select("id")
        .eq("vehicle_id", row.vehicle_id)
        .in("status", [...HELD_RENTAL_STATUSES])
        .limit(1);
      if (!((still?.data ?? []) as any[]).length) {
        await setVehicleStatus(admin, row.vehicle_id, "available", [PENDING_RESERVATION_STATUS]);
      }
    }
    await audit(admin, {
      action: "rental.pending_reservation_released",
      summary: RELEASE_SUMMARY[input.reason],
      entityType: "rental",
      entityId: row.id,
      metadata: { application_id: row.application_id ?? input.applicationId ?? null, vehicle_id: row.vehicle_id ?? null, reason: input.reason },
    });
  }
  return { released };
}

export type PickupReuse =
  | { reused: false }
  | { reused: true; id: string; status: string; pickupWasNew: boolean };

/**
 * Book a pickup onto the lead's pending or on-hold row instead of inserting
 * another rental. A reserved row that already has a pickup time is refused
 * with the existing message so a double tap still looks like "already booked".
 * A pending row stays pending until the insurance card is on file.
 */
export async function reuseOpenHoldForPickup(
  admin: Admin,
  input: {
    applicationId: string;
    vehicleId: string;
    pickupDate: string;
    pickupTime: string;
    reservationNote: string;
    deposit: { required: boolean; amount: number; status: string };
    feeOn: boolean;
    feePaymentId: string | null;
  },
): Promise<PickupReuse> {
  const mineRes = await admin
    .from("rentals")
    .select("id,status,vehicle_id,application_id,reservation_note,start_date")
    .eq("application_id", input.applicationId)
    .in("status", [...OPEN_FOR_PERSON])
    .limit(5);
  const mine = (mineRes?.data ?? []) as any[];
  const onThisCar = mine.find((r) => r.vehicle_id === input.vehicleId);
  const elsewhere = mine.find((r) => r.vehicle_id !== input.vehicleId);
  if (!onThisCar && elsewhere) {
    throw new Error(
      isPendingReservationStatus(elsewhere.status)
        ? "This Person Already Has A Pending Reservation."
        : "This Person Already Has A Reserved Car. Cancel It First.",
    );
  }

  const carRes = await admin
    .from("rentals")
    .select("id,status,application_id,reservation_note")
    .eq("vehicle_id", input.vehicleId)
    .in("status", [...HELD_RENTAL_STATUSES])
    .limit(5);
  const holders = (carRes?.data ?? []) as any[];
  if (holders.some((r) => r.application_id !== input.applicationId)) {
    throw new Error("That Vehicle Is Already Reserved.");
  }
  if (!onThisCar) return { reused: false };

  const previousTime = readReservationDetails(onThisCar.reservation_note).pickupTime;
  if ((onThisCar.status === RESERVATION_STATUS || onThisCar.status === "on_hold") && previousTime) {
    throw new Error("This Person Already Has A Reserved Car. Cancel It First.");
  }

  const sameDay = await admin
    .from("rentals")
    .select("id,reservation_note,status")
    .in("status", [RESERVATION_STATUS, PENDING_RESERVATION_STATUS])
    .eq("start_date", input.pickupDate)
    .limit(50);
  if (
    ((sameDay?.data ?? []) as any[]).some(
      (r) => r.id !== onThisCar.id && readReservationDetails(r.reservation_note).pickupTime === input.pickupTime,
    )
  ) {
    throw new Error("That Pickup Slot Is Already Booked.");
  }

  let nextStatus = String(onThisCar.status);
  if (isPendingReservationStatus(onThisCar.status) && (await hasIssuedInsuranceCard(admin, input.applicationId))) {
    nextStatus = RESERVATION_STATUS;
  }
  const patch: Record<string, unknown> = {
    start_date: input.pickupDate,
    reservation_note: input.reservationNote,
    status: nextStatus,
    reservation_deposit_required: input.deposit.required,
    reservation_deposit_amount: input.deposit.amount,
    reservation_deposit_status: input.deposit.status,
    ...(input.feePaymentId ? { reservation_deposit_payment_id: input.feePaymentId } : {}),
    ...(input.feeOn ? { deposit_amount: 0, deposit_held: false } : {}),
  };
  const upd = await admin.from("rentals").update(patch).eq("id", onThisCar.id).in("status", [...OPEN_FOR_PERSON]).select("id");
  if (upd?.error) {
    if (/rentals_one_reserved_per_vehicle/i.test(upd.error.message)) throw new Error("That Vehicle Is Already Reserved.");
    if (/rentals_one_reserved_per_driver/i.test(upd.error.message)) throw new Error("This Person Already Has A Reserved Car.");
    if (/rentals_one_reserved_per_pickup_slot/i.test(upd.error.message)) throw new Error("That Pickup Slot Is Already Booked.");
    throw new Error(upd.error.message);
  }
  if (!((upd?.data ?? []) as any[]).length) throw new Error("That Reservation Changed. Try Again.");

  if (nextStatus === RESERVATION_STATUS) {
    await setVehicleStatus(admin, input.vehicleId, "reserved", ["pending_reservation", "available", "onboarding", "ready"]);
  } else if (isPendingReservationStatus(nextStatus)) {
    await setVehicleStatus(admin, input.vehicleId, "pending_reservation", ["available", "onboarding", "ready", "pending_reservation"]);
  }
  await linkFee(admin, onThisCar.id, input.feePaymentId);
  return { reused: true, id: onThisCar.id as string, status: nextStatus, pickupWasNew: !previousTime };
}
