import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isReservationStatus,
  readReservationDetails,
  reservationPickupDate,
  writeReservationDetails,
  RESERVATION_STATUS,
  vinLast6,
  type ReservationRow,
} from "@/lib/reservations";
import { tierAllows } from "@/lib/roles";
import { chooseVehicleThumbnailPaths, vehicleListThumbnailKey, type VehicleThumbnailMedia } from "@/lib/vehicle-thumbnail";
import {
  DEFAULT_RESERVATION_DEPOSIT_SETTINGS,
  isReservationDepositStatus,
  resolveReservationDeposit,
  type ReservationDepositSettings,
  type ReservationDepositStatus,
} from "@/lib/reservation-deposit-settings";

/**
 * Soft holds: rentals.status = reserved + vehicles.status = reserved.
 * Activate stays activateRental (checked). Cancel flips to cancelled.
 * Never marks insurance, verification, or agreements complete.
 */

async function requireManager(userId: string) {
  const { requireManager: gate } = await import("@/lib/roles.server");
  return gate(userId);
}

async function requireStaff(userId: string) {
  const { requireStaff: gate } = await import("@/lib/roles.server");
  return gate(userId);
}

async function requireOwner(userId: string) {
  const { requireOwner: gate } = await import("@/lib/roles.server");
  return gate(userId);
}

const UUID = z.string().uuid();

/**
 * The old optional "Reservation Deposit" setting is retired (Dolmar, card
 * t315s1710): the $50 Reservation Fee (reservation_fee_auto) replaces it and is
 * never called a deposit. The app_settings row and the reservation_deposit_*
 * columns stay (no DB change); the setting always reads Off and cannot be
 * turned on from the app.
 */
async function loadDepositSettings(_admin: any): Promise<ReservationDepositSettings> {
  return { ...DEFAULT_RESERVATION_DEPOSIT_SETTINGS };
}

function mapRow(r: any, app: any, veh: any, extra?: { thumbnailPath?: string | null; weeklyRate?: number | null }): ReservationRow {
  const label = veh ? [veh.year, veh.make, veh.model].filter(Boolean).join(" ").trim() || null : null;
  const details = readReservationDetails(r.reservation_note);
  const status = isReservationDepositStatus(r.reservation_deposit_status)
    ? (r.reservation_deposit_status as ReservationDepositStatus)
    : "not_required";
  return {
    id: r.id,
    applicationId: r.application_id,
    driverUserId: r.driver_id,
    driverName: app?.full_name ?? app?.email ?? null,
    vehicleId: r.vehicle_id,
    vehicleLabel: label,
    unitNumber: veh?.unit_number ?? null,
    pickupDate: r.start_date,
    pickupTime: details.pickupTime,
    pickupLocation: details.pickupLocation,
    note: details.note,
    bookedBy: details.bookedBy,
    createdAt: r.created_at,
    depositRequired: r.reservation_deposit_required === true,
    depositAmount: Number(r.reservation_deposit_amount ?? 0),
    depositStatus: status,
    depositPaymentId: r.reservation_deposit_payment_id ?? null,
    plate: veh?.license_plate ?? null,
    vinLast6: vinLast6(veh?.vin),
    thumbnailPath: extra?.thumbnailPath ?? null,
    ...(extra && "weeklyRate" in extra ? { weeklyRate: extra.weeklyRate ?? null } : {}),
  };
}

/** One pickup/login email per new reservation; existing accounts get the portal URL, not a new password link. */
async function maybeSendBookingLoginEmail(
  admin: any,
  applicationId: string,
  reservation: { pickupDate: string; pickupTime: string; pickupLocation: string; vehicle: string | null },
): Promise<"sent" | "skipped" | "off" | "held" | "failed"> {
  const { gateFor, loadAutomationControls } = await import("@/lib/automation-controls.server");
  const gate = gateFor(await loadAutomationControls(admin), "booking_login_email");
  if (gate === "off") return "off";
  if (gate === "held") return "held";

  const { data: app, error } = await admin
    .from("applications")
    .select("id,email,full_name,user_id,status")
    .eq("id", applicationId)
    .maybeSingle();
  if (error || !app?.email) return "failed";
  if (!["approved", "active"].includes(String(app.status ?? "").toLowerCase())) return "skipped";

  try {
    const { provisionDriverAccount } = await import("@/lib/driver-account.server");
    const account = await provisionDriverAccount(admin, {
      applicationId,
      email: String(app.email),
      fullName: (app.full_name as string | null) ?? null,
    });
    if (account.conflict) return "failed";
    // Existing accounts receive the confirmed appointment and portal URL;
    // only a brand-new account receives a set-password link.

    const { sendPortalInviteEmail } = await import("@/lib/email.server");
    await sendPortalInviteEmail({
      to: String(app.email),
      firstName: String(app.full_name ?? "there").trim().split(/\s+/)[0] || "there",
      inviteUrl: account.inviteUrl,
      reservation,
    });
    return "sent";
  } catch (e) {
    console.error("[reservation] booking login email failed", e);
    return "failed";
  }
}

export const getReservationDepositSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReservationDepositSettings> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadDepositSettings(supabaseAdmin);
  });

export const listReservations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: ReservationRow[]; settings: ReservationDepositSettings; reservationFeeOn: boolean }> => {
    const actor = await requireStaff(context.userId);
    const canSeeMoney = tierAllows(actor.tier, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await loadDepositSettings(supabaseAdmin);
    // With the $50 Reservation Fee on, these columns hold the Reservation Fee,
    // so staff screens say "Reservation Fee", never "Deposit" (Dolmar, t309u).
    let reservationFeeOn = false;
    try {
      const { loadReservationFeeSettings } = await import("@/lib/reservation-fee-core.server");
      reservationFeeOn = (await loadReservationFeeSettings(supabaseAdmin)).enabled;
    } catch { /* off */ }
    const { data, error } = await supabaseAdmin
      .from("rentals")
      .select(
        "id,application_id,driver_id,vehicle_id,start_date,reservation_note,created_at,status,weekly_rate,reservation_deposit_required,reservation_deposit_amount,reservation_deposit_status,reservation_deposit_payment_id",
      )
      .eq("status", RESERVATION_STATUS)
      .order("start_date", { ascending: true })
      .limit(500);
    if (error) {
      if (/reservation_/i.test(error.message)) return { rows: [], settings, reservationFeeOn };
      throw new Error(error.message);
    }
    const list = (data ?? []) as any[];
    if (!list.length) return { rows: [], settings, reservationFeeOn };
    const appIds = [...new Set(list.map((r) => r.application_id).filter(Boolean))] as string[];
    const vehicleIds = [...new Set(list.map((r) => r.vehicle_id))];
    const [apps, vehicles, media, thumbSettings] = await Promise.all([
      appIds.length
        ? supabaseAdmin.from("applications").select("id,full_name,email").in("id", appIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      supabaseAdmin.from("vehicles").select("id,unit_number,year,make,model,license_plate,vin").in("id", vehicleIds),
      supabaseAdmin
        .from("vehicle_media")
        .select("id,vehicle_id,storage_path")
        .in("vehicle_id", vehicleIds)
        .eq("kind", "original")
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("app_settings")
        .select("key,value")
        .in("key", vehicleIds.map((id) => vehicleListThumbnailKey(id))),
    ]);
    // Thumbnails are cosmetic: a failed read leaves the placeholder, never the list.
    const thumbnailFor = chooseVehicleThumbnailPaths((media.data ?? []) as VehicleThumbnailMedia[], thumbSettings.data ?? []);
    if (apps.error) throw new Error(apps.error.message);
    if (vehicles.error) throw new Error(vehicles.error.message);
    const appBy = new Map((apps.data ?? []).map((a: any) => [a.id, a]));
    const vehBy = new Map((vehicles.data ?? []).map((v: any) => [v.id, v]));
    return {
      settings,
      reservationFeeOn,
      rows: list.map((r) =>
        mapRow(r, r.application_id ? appBy.get(r.application_id) : null, vehBy.get(r.vehicle_id), {
          thumbnailPath: thumbnailFor.get(r.vehicle_id) ?? null,
          ...(canSeeMoney ? { weeklyRate: r.weekly_rate == null ? null : Number(r.weekly_rate) } : {}),
        }),
      ),
    };
  });

export const CreateReservationInput = z.object({
  applicationId: UUID,
  vehicleId: UUID,
  pickupDate: z.string().max(32),
  pickupTime: z.string().max(5),
  pickupLocation: z.string().trim().min(3).max(180),
  note: z.string().max(140).optional(),
  /** Retired with the Reservation Deposit setting; ignored (card t315s1710). */
  depositRequired: z.boolean().optional(),
  depositAmount: z.number().min(0).max(10000).optional(),
  /** FLEET only: refuse until the Reservation Fee is paid (when that switch is on). */
  requireReservationFee: z.boolean().optional(),
});
export type CreateReservationData = z.infer<typeof CreateReservationInput>;

export const createReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateReservationInput.parse(d))
  .handler(async ({ context, data }): Promise<{ id: string; loginEmail: string }> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return createReservationCore(supabaseAdmin, data);
  });

/**
 * The one Reserved code path, shared by staff (createReservation, manager
 * only), FLEET (/api/public/fleet/pickup-slots) and the renter on the Payment
 * Received page (payment-received.server.ts, scoped to a paid Reservation Fee
 * Checkout). Callers authorize first.
 */
export async function createReservationCore(
  admin: any,
  data: CreateReservationData & {
    /** Server-only (never in CreateReservationInput): the renter picked this slot on the Payment Received page. */
    bookedBy?: "renter";
  },
): Promise<{ id: string; loginEmail: string }> {
  const pickup = reservationPickupDate(data.pickupDate);
  if (!pickup) throw new Error("Pick A Real Pickup Date.");
  const reservationNote = writeReservationDetails({
    pickupTime: data.pickupTime,
    pickupLocation: data.pickupLocation,
    note: data.note,
    bookedBy: data.bookedBy === "renter" ? "renter" : null,
  });
  const settings = await loadDepositSettings(admin);
  // No per-booking deposit any more: only the Reservation Fee below sets these columns.
  let deposit = resolveReservationDeposit({ settings });
  // $50 Reservation Fee (Dolmar, t299s1618): with reservation_fee_auto ON the
  // car is held only once the fee is paid. A paid fee is recorded on the
  // reservation as applied (credited to week 1, never a security deposit);
  // an unpaid one shows as pending, so the reservation is not confirmed yet.
  let feePaymentId: string | null = null;
  let feeOn = false;
  {
    const { loadReservationFeeSettings, paidReservationFee } = await import("@/lib/reservation-fee.server");
    const fee = await loadReservationFeeSettings(admin);
    if (fee.enabled) {
      feeOn = true;
      const paid = await paidReservationFee(admin, data.applicationId);
      if (data.requireReservationFee && !paid) throw new Error("The Reservation Fee Is Not Paid Yet. The Car Is Held Once It Is Paid.");
      deposit = { required: true, amount: paid ? paid.amount : fee.amount, status: paid ? "applied" : "pending" } as typeof deposit;
      feePaymentId = paid?.id ?? null;
    }
  }

  const { data: app, error: appErr } = await admin
    .from("applications")
    .select("id,status,user_id,full_name,email")
    .eq("id", data.applicationId)
    .maybeSingle();
  if (appErr) throw new Error(appErr.message);
  if (!app) throw new Error("Applicant Not Found.");
  // Safer: block until approved (no held emails for unapproved drivers).
  const appStatus = String(app.status ?? "").toLowerCase();
  if (!["approved", "active"].includes(appStatus)) {
    throw new Error("Only An Approved Applicant Or Active Renter Can Hold A Reservation.");
  }
  if (!app.user_id) {
    // Provision so driver_id NOT NULL can be satisfied; invite may follow.
    try {
      const { provisionDriverAccount } = await import("@/lib/driver-account.server");
      const account = await provisionDriverAccount(admin, {
        applicationId: data.applicationId,
        email: String(app.email ?? ""),
        fullName: (app.full_name as string | null) ?? null,
      });
      if (account.conflict) throw new Error("This Application’s Login Identity Conflicts With The Email On File. Resolve It Before Reserving.");
      if (!account.userId) throw new Error("Could Not Create A Portal Login For This Person.");
      app.user_id = account.userId;
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "This Person Needs A Portal Login Before A Car Can Be Reserved.");
    }
  }

  const { data: vehicle, error: vehErr } = await admin
    .from("vehicles")
    .select("id,status,archived_at,weekly_rate,year,make,model")
    .eq("id", data.vehicleId)
    .maybeSingle();
  if (vehErr) throw new Error(vehErr.message);
  if (!vehicle) throw new Error("Vehicle Not Found.");
  if (vehicle.archived_at) throw new Error("That Vehicle Is Archived.");
  const vStatus = String(vehicle.status ?? "").toLowerCase();
  if (["sold", "retired", "archived", "rented"].includes(vStatus)) {
    throw new Error("That Vehicle Is Not Free To Reserve.");
  }

  const { data: busyActive } = await admin.from("rentals").select("id").eq("vehicle_id", data.vehicleId).eq("status", "active").limit(1);
  if (busyActive?.length) throw new Error("That Vehicle Already Has An Active Rental.");
  const { data: busyReserved } = await admin.from("rentals").select("id").eq("vehicle_id", data.vehicleId).eq("status", RESERVATION_STATUS).limit(1);
  if (busyReserved?.length) throw new Error("That Vehicle Is Already Reserved.");
  const { data: driverReserved } = await admin.from("rentals").select("id").eq("driver_id", app.user_id).eq("status", RESERVATION_STATUS).limit(1);
  if (driverReserved?.length) throw new Error("This Person Already Has A Reserved Car. Cancel It First.");

  // One booking per pickup slot (date + time), for staff and FLEET alike.
  const { data: sameDay } = await admin.from("rentals").select("id,reservation_note").eq("status", RESERVATION_STATUS).eq("start_date", pickup).limit(50);
  if ((sameDay ?? []).some((r: any) => readReservationDetails(r.reservation_note).pickupTime === data.pickupTime)) {
    throw new Error("That Pickup Slot Is Already Booked.");
  }

  const weekly = typeof vehicle.weekly_rate === "number" ? vehicle.weekly_rate : 0;
  const insertRow: Record<string, unknown> = {
    driver_id: app.user_id,
    vehicle_id: data.vehicleId,
    application_id: data.applicationId,
    start_date: pickup,
    status: RESERVATION_STATUS,
    weekly_rate: weekly,
    // The Reservation Fee is not a security deposit.
    deposit_amount: deposit.required && !feeOn ? deposit.amount : 0,
    deposit_held: false,
    deposit_status: deposit.required ? "none" : "none",
    reservation_note: reservationNote,
    reservation_deposit_required: deposit.required,
    reservation_deposit_amount: deposit.amount,
    reservation_deposit_status: deposit.status,
    ...(feePaymentId ? { reservation_deposit_payment_id: feePaymentId } : {}),
  };

  const { data: inserted, error: insErr } = await admin.from("rentals").insert(insertRow as never).select("id").single();
  if (insErr) {
    if (/rentals_one_reserved_per_vehicle/i.test(insErr.message)) throw new Error("That Vehicle Is Already Reserved.");
    if (/rentals_one_reserved_per_driver/i.test(insErr.message)) throw new Error("This Person Already Has A Reserved Car.");
    if (/rentals_one_reserved_per_pickup_slot/i.test(insErr.message)) throw new Error("That Pickup Slot Is Already Booked.");
    if (/reservation_/i.test(insErr.message)) throw new Error("Reservations Need The Rental Reservations Migration Applied First.");
    throw new Error(insErr.message);
  }

  await admin.from("vehicles").update({ status: "reserved" }).eq("id", data.vehicleId).neq("status", "rented");

  const loginEmail = await maybeSendBookingLoginEmail(admin, data.applicationId, {
    pickupDate: pickup,
    pickupTime: data.pickupTime,
    pickupLocation: data.pickupLocation.trim(),
    vehicle: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() || null,
  });
  // Fully confirmed? (reservation-confirmation.server.ts) Never fails the booking.
  try {
    const { maybeConfirmReservation } = await import("@/lib/reservation-confirmation.server");
    await maybeConfirmReservation(admin, { rentalId: inserted.id });
  } catch (e) {
    console.error("[reservation] confirmation check failed", String((e as Error)?.message ?? e));
  }
  return { id: inserted.id, loginEmail };
}

export const cancelReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: UUID }).parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("rentals").select("id,status,vehicle_id").eq("id", data.rentalId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Reservation Not Found.");
    if (!isReservationStatus(row.status)) throw new Error("That Rental Is Not An Open Reservation.");

    const { error: upd } = await supabaseAdmin
      .from("rentals")
      .update({ status: "cancelled" } as never)
      .eq("id", data.rentalId)
      .eq("status", RESERVATION_STATUS);
    if (upd) throw new Error(upd.message);

    if (row.vehicle_id) {
      const { data: still } = await supabaseAdmin
        .from("rentals")
        .select("id")
        .eq("vehicle_id", row.vehicle_id)
        .in("status", [RESERVATION_STATUS, "active"])
        .limit(1);
      if (!still?.length) {
        await supabaseAdmin.from("vehicles").update({ status: "available" }).eq("id", row.vehicle_id).eq("status", "reserved");
      }
    }
    return { ok: true };
  });

export const clearReservationAfterActivate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: UUID, vehicleId: UUID.optional() }).parse(d))
  .handler(async ({ context, data }): Promise<{ cleared: number }> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("rentals")
      .select("id,vehicle_id,reservation_deposit_status,reservation_deposit_amount,reservation_deposit_payment_id,reservation_deposit_required")
      .eq("application_id", data.applicationId)
      .eq("status", RESERVATION_STATUS);
    if (data.vehicleId) q = q.eq("vehicle_id", data.vehicleId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let cleared = 0;
    for (const row of (rows ?? []) as any[]) {
      const patch: Record<string, unknown> = { status: "cancelled" };
      // Nothing is carried into the security deposit: the old reservation
      // deposit is retired, and a Reservation Fee is credited to week 1
      // (applyReservationFeeCredit), never held as a deposit (card t315s1710).
      const { error: upd } = await supabaseAdmin.from("rentals").update(patch as never).eq("id", row.id).eq("status", RESERVATION_STATUS);
      if (!upd) {
        cleared += 1;
        // Free the reserved vehicle if nothing else holds it.
        const still = await supabaseAdmin
          .from("rentals")
          .select("id")
          .eq("vehicle_id", row.vehicle_id)
          .in("status", [RESERVATION_STATUS, "active"])
          .limit(1);
        if (!still.data?.length) {
          await supabaseAdmin.from("vehicles").update({ status: "available" }).eq("id", row.vehicle_id).eq("status", "reserved");
        }
      }
    }
    return { cleared };
  });

/**
 * Record a Reservation Fee paid outside Stripe (Cash App, Venmo, Zelle, cash).
 * The fee row is type fee / reason reservation_fee, like the Stripe one, so
 * it is credited to week 1 at activation and never treated as a deposit. An
 * open Stripe fee row for this renter is settled instead of adding a second.
 */
export const recordReservationFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rentalId: UUID,
        amount: z.number().positive().max(10000),
        method: z.string().min(1).max(40),
        reference: z.string().max(200).nullable().optional(),
        paidOn: z.string().max(32),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<{ paymentId: string }> => {
    await requireManager(context.userId);
    const { MANUAL_METHODS } = await import("@/lib/rent-reminders");
    if (!MANUAL_METHODS.some((m) => m.value === data.method)) throw new Error("Choose A Payment Method.");
    const paidOn = reservationPickupDate(data.paidOn);
    if (!paidOn) throw new Error("Pick A Real Paid Date.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { RESERVATION_FEE_REASON } = await import("@/lib/reservation-fee");
    const { data: row, error } = await supabaseAdmin
      .from("rentals")
      .select("id,status,application_id,vehicle_id,reservation_deposit_status")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const resRow = row as any;
    if (!resRow || !isReservationStatus(resRow.status)) throw new Error("Reservation Not Found.");
    if (resRow.reservation_deposit_status === "paid" || resRow.reservation_deposit_status === "applied") {
      throw new Error("Reservation Fee Already Recorded.");
    }
    if (resRow.reservation_deposit_status === "waived") throw new Error("Reservation Fee Was Waived.");

    const amount = Math.round(data.amount * 100) / 100;
    const note = `Reservation Fee (manual${data.reference ? `: ${data.reference.slice(0, 160)}` : ""})`;
    const { data: open } = await supabaseAdmin
      .from("payments")
      .select("id,status,notes")
      .eq("driver_id", resRow.application_id)
      .eq("reason", RESERVATION_FEE_REASON)
      .in("status", ["current", "unpaid", "failed", "pending", "paid"])
      .limit(5);
    const openRows = (open ?? []) as any[];
    if (openRows.some((p) => p.status === "paid" && !/\bkept:/.test(String(p.notes ?? "")))) throw new Error("Reservation Fee Already Paid.");
    if (openRows.some((p) => p.status === "pending")) throw new Error("A Card Payment For The Reservation Fee Is Still Processing.");
    const existing = openRows.find((p) => p.status !== "paid") ?? null;
    let paymentId: string;
    if (existing) {
      // Close the renter's Stripe link first so the fee can never be paid twice.
      // If Stripe cannot confirm the link is closed, nothing is recorded.
      const { data: ags } = await supabaseAdmin.from("agreements").select("id,metadata").eq("application_id", resRow.application_id).limit(20);
      const sessionIds = ((ags ?? []) as any[])
        .map((g) => g?.metadata?.reservation_fee_checkout)
        .filter((c) => c && c.payment_id === existing.id)
        .map((c) => (c.session_id ? String(c.session_id) : ""));
      if (sessionIds.length) {
        if (sessionIds.some((id) => !id)) throw new Error("This Renter Has An Open Stripe Link For The Reservation Fee. Wait For It To Expire (24 Hours) Before Recording A Manual Payment.");
        const { stripeClient } = await import("@/lib/reservation-fee-core.server");
        const stripe = await stripeClient({});
        if (!stripe) throw new Error("Card Payments Are Not Configured, So The Open Stripe Link Could Not Be Closed.");
        for (const id of sessionIds) {
          const sess = await stripe.checkout.sessions.retrieve(id);
          if (sess?.status === "complete") throw new Error("The Renter Already Paid The Reservation Fee By Card.");
          if (sess?.status === "open") await stripe.checkout.sessions.expire(id);
        }
      }
      // Settle the open Stripe fee row; the renter's link then shows it as paid.
      const { error: upErr } = await supabaseAdmin
        .from("payments")
        .update({ status: "paid", amount, paid_date: paidOn, payment_method: data.method, rental_id: resRow.id, balance_due: 0, notified_status: "paid", failure_reason: null, notes: `${String(existing.notes ?? "")} · ${note}`.slice(0, 400) } as never)
        .eq("id", existing.id)
        .in("status", ["current", "unpaid", "failed"]);
      if (upErr) throw new Error("Could Not Record The Reservation Fee.");
      paymentId = existing.id;
    } else {
      const ins = await supabaseAdmin
        .from("payments")
        .insert({
          type: "fee",
          reason: RESERVATION_FEE_REASON,
          status: "paid",
          amount,
          paid_date: paidOn,
          due_date: paidOn,
          payment_method: data.method,
          notes: note,
          rental_id: resRow.id,
          driver_id: resRow.application_id,
          vehicle_id: resRow.vehicle_id,
          balance_due: 0,
          notified_status: "paid",
        } as never)
        .select("id")
        .single();
      if (ins.error || !ins.data) throw new Error("Could Not Record The Reservation Fee.");
      paymentId = (ins.data as any).id;
    }

    const { error: upd } = await supabaseAdmin
      .from("rentals")
      .update({
        reservation_deposit_required: true,
        reservation_deposit_amount: amount,
        // "applied": credited to week 1, never carried as a security deposit.
        reservation_deposit_status: "applied",
        reservation_deposit_payment_id: paymentId,
      } as never)
      .eq("id", resRow.id);
    if (upd) throw new Error("Reservation Fee Saved, But The Reservation Could Not Be Updated.");
    try {
      const { maybeConfirmReservation } = await import("@/lib/reservation-confirmation.server");
      await maybeConfirmReservation(supabaseAdmin, { rentalId: resRow.id });
    } catch (e) {
      console.error("[reservation] confirmation check failed", String((e as Error)?.message ?? e));
    }
    return { paymentId };
  });

export const getOpenReservationForApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: UUID }).parse(d))
  .handler(async ({ context, data }): Promise<{ reservation: ReservationRow | null; settings: ReservationDepositSettings; feeDisplayStatus: string | null }> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await loadDepositSettings(supabaseAdmin);
    const { reservationFeeStatusForApplication } = await import("@/lib/reservation-fee-refund.server");
    const fee = await reservationFeeStatusForApplication(supabaseAdmin as any, data.applicationId).catch(() => ({ status: null as string | null }));
    const { data: row, error } = await supabaseAdmin
      .from("rentals")
      .select(
        "id,application_id,driver_id,vehicle_id,start_date,reservation_note,created_at,status,weekly_rate,reservation_deposit_required,reservation_deposit_amount,reservation_deposit_status,reservation_deposit_payment_id",
      )
      .eq("application_id", data.applicationId)
      .eq("status", RESERVATION_STATUS)
      .maybeSingle();
    if (error) {
      if (/reservation_/i.test(error.message)) return { reservation: null, settings, feeDisplayStatus: fee.status };
      throw new Error(error.message);
    }
    if (!row) return { reservation: null, settings, feeDisplayStatus: fee.status };
    const resRow = row as any;
    const [app, veh] = await Promise.all([
      supabaseAdmin.from("applications").select("id,full_name,email").eq("id", data.applicationId).maybeSingle(),
      supabaseAdmin.from("vehicles").select("id,unit_number,year,make,model").eq("id", resRow.vehicle_id).maybeSingle(),
    ]);
    return { reservation: mapRow(resRow, app.data, veh.data), settings, feeDisplayStatus: fee.status ?? resRow.reservation_deposit_status ?? null };
  });


export const listVehiclesForReservation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{ id: string; unit_number: string | null; year: number | null; make: string | null; model: string | null; license_plate: string | null; vin: string | null; status: string | null; weekly_rate: number | null }>> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .select("id,unit_number,year,make,model,license_plate,vin,status,weekly_rate,archived_at")
      .is("archived_at", null)
      .in("status", ["available", "ready", "onboarding"])
      .order("unit_number", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    // Exclude cars that already have an active or reserved rental.
    const ids = (data ?? []).map((v) => v.id);
    if (!ids.length) return [];
    const busy = await supabaseAdmin
      .from("rentals")
      .select("vehicle_id")
      .in("vehicle_id", ids)
      .in("status", ["active", "reserved"]);
    if (busy.error) throw new Error(busy.error.message);
    const taken = new Set((busy.data ?? []).map((r) => r.vehicle_id));
    return (data ?? [])
      .filter((v) => !taken.has(v.id))
      .map((v) => ({
        id: v.id,
        unit_number: v.unit_number ?? null,
        year: v.year ?? null,
        make: v.make ?? null,
        model: v.model ?? null,
        license_plate: v.license_plate ?? null,
        vin: v.vin ?? null,
        status: v.status ?? null,
        weekly_rate: typeof v.weekly_rate === "number" ? v.weekly_rate : null,
      }));
  });


export const listApprovedForReservation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{ id: string; full_name: string | null; email: string | null }>> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("applications")
      .select("id,full_name,email,status,user_id")
      .in("status", ["approved", "active"])
      .order("full_name", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    // Drop anyone who already has a reserved car.
    const reserved = await supabaseAdmin.from("rentals").select("application_id").eq("status", "reserved");
    if (reserved.error) throw new Error(reserved.error.message);
    const taken = new Set((reserved.data ?? []).map((r) => r.application_id).filter(Boolean));
    return (data ?? [])
      .filter((a) => !taken.has(a.id))
      .map((a) => ({ id: a.id, full_name: a.full_name ?? null, email: a.email ?? null }));
  });
