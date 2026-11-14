import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isReservationStatus,
  readReservationDetails,
  reservationPickupDate,
  writeReservationDetails,
  RESERVATION_STATUS,
  type ReservationRow,
} from "@/lib/reservations";
import {
  isReservationDepositStatus,
  readReservationDepositSettings,
  RESERVATION_DEPOSIT_SETTINGS_KEY,
  resolveReservationDeposit,
  writeReservationDepositSettings,
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

async function loadDepositSettings(admin: any): Promise<ReservationDepositSettings> {
  const { data } = await admin.from("app_settings").select("value").eq("key", RESERVATION_DEPOSIT_SETTINGS_KEY).maybeSingle();
  return readReservationDepositSettings(data?.value);
}

function mapRow(r: any, app: any, veh: any): ReservationRow {
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
    createdAt: r.created_at,
    depositRequired: r.reservation_deposit_required === true,
    depositAmount: Number(r.reservation_deposit_amount ?? 0),
    depositStatus: status,
    depositPaymentId: r.reservation_deposit_payment_id ?? null,
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

export const saveReservationDepositSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        defaultAmount: z.number().min(0).max(10000),
        blockStartWhenPending: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<ReservationDepositSettings> => {
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const next: ReservationDepositSettings = {
      enabled: data.enabled,
      defaultAmount: data.defaultAmount,
      blockStartWhenPending: data.blockStartWhenPending,
    };
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(
        { key: RESERVATION_DEPOSIT_SETTINGS_KEY, value: writeReservationDepositSettings(next) as never },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    return next;
  });

export const listReservations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: ReservationRow[]; settings: ReservationDepositSettings }> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await loadDepositSettings(supabaseAdmin);
    const { data, error } = await supabaseAdmin
      .from("rentals")
      .select(
        "id,application_id,driver_id,vehicle_id,start_date,reservation_note,created_at,status,reservation_deposit_required,reservation_deposit_amount,reservation_deposit_status,reservation_deposit_payment_id",
      )
      .eq("status", RESERVATION_STATUS)
      .order("start_date", { ascending: true })
      .limit(500);
    if (error) {
      if (/reservation_/i.test(error.message)) return { rows: [], settings };
      throw new Error(error.message);
    }
    const list = (data ?? []) as any[];
    if (!list.length) return { rows: [], settings };
    const appIds = [...new Set(list.map((r) => r.application_id).filter(Boolean))] as string[];
    const vehicleIds = [...new Set(list.map((r) => r.vehicle_id))];
    const [apps, vehicles] = await Promise.all([
      appIds.length
        ? supabaseAdmin.from("applications").select("id,full_name,email").in("id", appIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      supabaseAdmin.from("vehicles").select("id,unit_number,year,make,model").in("id", vehicleIds),
    ]);
    if (apps.error) throw new Error(apps.error.message);
    if (vehicles.error) throw new Error(vehicles.error.message);
    const appBy = new Map((apps.data ?? []).map((a: any) => [a.id, a]));
    const vehBy = new Map((vehicles.data ?? []).map((v: any) => [v.id, v]));
    return {
      settings,
      rows: list.map((r) => mapRow(r, r.application_id ? appBy.get(r.application_id) : null, vehBy.get(r.vehicle_id))),
    };
  });

export const createReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: UUID,
        vehicleId: UUID,
        pickupDate: z.string().max(32),
        pickupTime: z.string().max(5),
        pickupLocation: z.string().trim().min(3).max(180),
        note: z.string().max(140).optional(),
        depositRequired: z.boolean().optional(),
        depositAmount: z.number().min(0).max(10000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }): Promise<{ id: string; loginEmail: string }> => {
    await requireManager(context.userId);
    const pickup = reservationPickupDate(data.pickupDate);
    if (!pickup) throw new Error("Pick A Real Pickup Date.");
    const reservationNote = writeReservationDetails({
      pickupTime: data.pickupTime,
      pickupLocation: data.pickupLocation,
      note: data.note,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await loadDepositSettings(supabaseAdmin);
    const deposit = resolveReservationDeposit({
      settings,
      overrideRequired: data.depositRequired,
      overrideAmount: data.depositAmount,
    });

    const { data: app, error: appErr } = await supabaseAdmin
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
        const account = await provisionDriverAccount(supabaseAdmin, {
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

    const { data: vehicle, error: vehErr } = await supabaseAdmin
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

    const { data: busyActive } = await supabaseAdmin.from("rentals").select("id").eq("vehicle_id", data.vehicleId).eq("status", "active").limit(1);
    if (busyActive?.length) throw new Error("That Vehicle Already Has An Active Rental.");
    const { data: busyReserved } = await supabaseAdmin.from("rentals").select("id").eq("vehicle_id", data.vehicleId).eq("status", RESERVATION_STATUS).limit(1);
    if (busyReserved?.length) throw new Error("That Vehicle Is Already Reserved.");
    const { data: driverReserved } = await supabaseAdmin.from("rentals").select("id").eq("driver_id", app.user_id).eq("status", RESERVATION_STATUS).limit(1);
    if (driverReserved?.length) throw new Error("This Person Already Has A Reserved Car. Cancel It First.");

    const weekly = typeof vehicle.weekly_rate === "number" ? vehicle.weekly_rate : 0;
    const insertRow: Record<string, unknown> = {
      driver_id: app.user_id,
      vehicle_id: data.vehicleId,
      application_id: data.applicationId,
      start_date: pickup,
      status: RESERVATION_STATUS,
      weekly_rate: weekly,
      deposit_amount: deposit.required ? deposit.amount : 0,
      deposit_held: false,
      deposit_status: deposit.required ? "none" : "none",
      reservation_note: reservationNote,
      reservation_deposit_required: deposit.required,
      reservation_deposit_amount: deposit.amount,
      reservation_deposit_status: deposit.status,
    };

    const { data: inserted, error: insErr } = await supabaseAdmin.from("rentals").insert(insertRow as never).select("id").single();
    if (insErr) {
      if (/rentals_one_reserved_per_vehicle/i.test(insErr.message)) throw new Error("That Vehicle Is Already Reserved.");
      if (/rentals_one_reserved_per_driver/i.test(insErr.message)) throw new Error("This Person Already Has A Reserved Car.");
      if (/reservation_/i.test(insErr.message)) throw new Error("Reservations Need The Rental Reservations Migration Applied First.");
      throw new Error(insErr.message);
    }

    await supabaseAdmin.from("vehicles").update({ status: "reserved" }).eq("id", data.vehicleId).neq("status", "rented");

    const loginEmail = await maybeSendBookingLoginEmail(supabaseAdmin, data.applicationId, {
      pickupDate: pickup,
      pickupTime: data.pickupTime,
      pickupLocation: data.pickupLocation.trim(),
      vehicle: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() || null,
    });
    return { id: inserted.id, loginEmail };
  });

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
      // Carry a paid reservation deposit onto the active rental without double-counting rent.
      if (row.reservation_deposit_status === "paid" && Number(row.reservation_deposit_amount) > 0) {
        let activeQ = supabaseAdmin
          .from("rentals")
          .select("id")
          .eq("application_id", data.applicationId)
          .eq("status", "active");
        if (data.vehicleId) activeQ = activeQ.eq("vehicle_id", data.vehicleId);
        const active = await activeQ.maybeSingle();
        if (active.data?.id) {
          await supabaseAdmin
            .from("rentals")
            .update({
              deposit_amount: Number(row.reservation_deposit_amount),
              deposit_held: true,
              deposit_status: "held",
              deposit_notes: "Applied From Reservation Deposit",
            } as never)
            .eq("id", active.data.id);
          patch.reservation_deposit_status = "applied";
        }
      }
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

export const recordReservationDeposit = createServerFn({ method: "POST" })
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
    const { data: row, error } = await supabaseAdmin
      .from("rentals")
      .select("id,status,application_id,vehicle_id,reservation_deposit_required,reservation_deposit_status,reservation_deposit_amount")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const resRow = row as any;
    if (!resRow || !isReservationStatus(resRow.status)) throw new Error("Reservation Not Found.");
    if (resRow.reservation_deposit_status === "paid" || resRow.reservation_deposit_status === "applied") {
      throw new Error("Deposit Already Recorded.");
    }
    if (resRow.reservation_deposit_status === "waived") throw new Error("Deposit Was Waived.");

    const ins = await supabaseAdmin
      .from("payments")
      .insert({
        type: "deposit",
        status: "paid",
        amount: Math.round(data.amount * 100) / 100,
        paid_date: paidOn,
        due_date: paidOn,
        payment_method: data.method,
        notes: data.reference?.slice(0, 200) || "Reservation Deposit",
        rental_id: resRow.id,
        driver_id: resRow.application_id,
        vehicle_id: resRow.vehicle_id,
        balance_due: 0,
        notified_status: "paid",
      })
      .select("id")
      .single();
    if (ins.error || !ins.data) throw new Error("Could Not Record The Deposit.");

    const { error: upd } = await supabaseAdmin
      .from("rentals")
      .update({
        reservation_deposit_required: true,
        reservation_deposit_amount: Math.round(data.amount * 100) / 100,
        reservation_deposit_status: "paid",
        reservation_deposit_payment_id: ins.data.id,
      } as never)
      .eq("id", resRow.id);
    if (upd) throw new Error("Deposit Payment Saved, But The Reservation Could Not Be Updated.");
    return { paymentId: ins.data.id };
  });

/** Future Stripe deposit invoice/link hook — not implemented; never use a generic Stripe payment page. */
export function stripeReservationDepositHook(_args: { rentalId: string; amount: number }): { ok: false; reason: string } {
  return { ok: false, reason: "Stripe Reservation Deposits Are Not Built Yet. Record The Deposit Manually." };
}

export const getOpenReservationForApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: UUID }).parse(d))
  .handler(async ({ context, data }): Promise<{ reservation: ReservationRow | null; settings: ReservationDepositSettings }> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await loadDepositSettings(supabaseAdmin);
    const { data: row, error } = await supabaseAdmin
      .from("rentals")
      .select(
        "id,application_id,driver_id,vehicle_id,start_date,reservation_note,created_at,status,reservation_deposit_required,reservation_deposit_amount,reservation_deposit_status,reservation_deposit_payment_id",
      )
      .eq("application_id", data.applicationId)
      .eq("status", RESERVATION_STATUS)
      .maybeSingle();
    if (error) {
      if (/reservation_/i.test(error.message)) return { reservation: null, settings };
      throw new Error(error.message);
    }
    if (!row) return { reservation: null, settings };
    const resRow = row as any;
    const [app, veh] = await Promise.all([
      supabaseAdmin.from("applications").select("id,full_name,email").eq("id", data.applicationId).maybeSingle(),
      supabaseAdmin.from("vehicles").select("id,unit_number,year,make,model").eq("id", resRow.vehicle_id).maybeSingle(),
    ]);
    return { reservation: mapRow(resRow, app.data, veh.data), settings };
  });


export const listVehiclesForReservation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Array<{ id: string; unit_number: string | null; year: number | null; make: string | null; model: string | null; status: string | null; weekly_rate: number | null }>> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .select("id,unit_number,year,make,model,status,weekly_rate,archived_at")
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
