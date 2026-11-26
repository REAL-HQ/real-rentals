import { RESERVATION_STATUS } from "@/lib/reservations";
import {
  SWITCH_TARGET_STATUSES,
  classifyAgreementsForSwitch,
  oldVehicleReleaseStatus,
  type SwitchReservationVehicleData,
  type SwitchResult,
} from "@/lib/reservation-switch";

export type SwitchAudit = (entry: {
  action: string;
  summary: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
}) => Promise<void>;

const label = (v: any) => [v?.year, v?.make, v?.model].filter(Boolean).join(" ").trim() || "Vehicle";

/**
 * Move a Reserved rental onto another available car.
 *
 * Atomicity without a new database function: the move is ONE conditional
 * UPDATE on the rental (id + status reserved + the vehicle we read), so two
 * staff cannot both move it, and the existing partial unique index
 * rentals_one_reserved_per_vehicle_idx refuses a second reservation on the new
 * car. Only the vehicle (and, if asked, the rate) is written on the rental:
 * start date, pickup time/location (reservation_note), the Reservation Fee
 * columns and the driver are not touched. If the new car's status cannot be
 * set, the rental move is reversed before returning the error.
 *
 * Never sends anything to the renter, never edits or voids an agreement.
 */
export async function switchReservationVehicleCore(
  admin: any,
  data: SwitchReservationVehicleData,
  audit: SwitchAudit,
): Promise<SwitchResult> {
  const { data: rental, error: rErr } = await admin
    .from("rentals")
    .select("id,status,vehicle_id,application_id,weekly_rate")
    .eq("id", data.rentalId)
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (!rental) throw new Error("Reservation Not Found.");
  if (rental.status !== RESERVATION_STATUS) throw new Error("Only A Reserved Car Can Be Switched. Use The Active Rental Tools For A Started Rental.");
  const oldVehicleId = rental.vehicle_id as string | null;
  if (!oldVehicleId) throw new Error("This Reservation Has No Vehicle To Switch From.");
  if (oldVehicleId === data.newVehicleId) throw new Error("Pick A Different Vehicle.");

  const { data: next, error: nErr } = await admin
    .from("vehicles")
    .select("id,status,archived_at,year,make,model,unit_number")
    .eq("id", data.newVehicleId)
    .maybeSingle();
  if (nErr) throw new Error(nErr.message);
  if (!next) throw new Error("Vehicle Not Found.");
  if (next.archived_at) throw new Error("That Vehicle Is Archived.");
  const nextStatus = String(next.status ?? "").toLowerCase();
  if (!(SWITCH_TARGET_STATUSES as readonly string[]).includes(nextStatus)) {
    throw new Error("That Vehicle Is Not Available.");
  }
  const { data: busy, error: bErr } = await admin
    .from("rentals")
    .select("id")
    .eq("vehicle_id", data.newVehicleId)
    .in("status", ["active", RESERVATION_STATUS, "on_hold", "pending_reservation"])
    .limit(1);
  if (bErr) throw new Error(bErr.message);
  if (busy?.length) throw new Error("That Vehicle Already Has A Rental Or Reservation.");

  const { data: prev } = await admin
    .from("vehicles")
    .select("id,status,year,make,model,unit_number")
    .eq("id", oldVehicleId)
    .maybeSingle();

  const oldRate = rental.weekly_rate == null ? null : Number(rental.weekly_rate);
  const rateChanged = data.weeklyRate != null && data.weeklyRate !== oldRate;
  const patch: Record<string, unknown> = { vehicle_id: data.newVehicleId };
  if (rateChanged) patch.weekly_rate = data.weeklyRate;

  // The one atomic step.
  const { data: moved, error: mErr } = await admin
    .from("rentals")
    .update(patch as never)
    .eq("id", data.rentalId)
    .eq("status", RESERVATION_STATUS)
    .eq("vehicle_id", oldVehicleId)
    .select("id");
  if (mErr) {
    if (/rentals_one_reserved_per_vehicle/i.test(mErr.message)) throw new Error("That Vehicle Is Already Reserved.");
    throw new Error(mErr.message);
  }
  if (!moved?.length) throw new Error("This Reservation Changed While You Were Switching. Refresh And Try Again.");

  // Hold the new car. Conditional on its status so a car that went out of
  // service in the meantime is refused, not silently held.
  const { data: held, error: hErr } = await admin
    .from("vehicles")
    .update({ status: "reserved" })
    .eq("id", data.newVehicleId)
    .in("status", [...SWITCH_TARGET_STATUSES])
    .select("id");
  if (hErr || !held?.length) {
    await admin
      .from("rentals")
      .update({ vehicle_id: oldVehicleId, ...(rateChanged ? { weekly_rate: oldRate } : {}) } as never)
      .eq("id", data.rentalId)
      .eq("status", RESERVATION_STATUS)
      .eq("vehicle_id", data.newVehicleId);
    throw new Error(hErr?.message ?? "That Vehicle Is No Longer Available.");
  }

  // Release the old car unless something else still holds it.
  let oldVehicleStatus: SwitchResult["oldVehicleStatus"] = "unchanged";
  let oldVehicleReleased = true;
  const { data: still } = await admin
    .from("rentals")
    .select("id")
    .eq("vehicle_id", oldVehicleId)
    .in("status", ["active", RESERVATION_STATUS, "on_hold", "pending_reservation"])
    .limit(1);
  if (!still?.length) {
    const target = oldVehicleReleaseStatus(data.oldCarHasIssue);
    const { data: rel, error: relErr } = await admin
      .from("vehicles")
      .update({ status: target })
      .eq("id", oldVehicleId)
      .eq("status", "reserved")
      .select("id");
    if (relErr) {
      oldVehicleReleased = false;
      console.error("[reservation-switch] could not release the old vehicle", relErr.message);
    } else if (rel?.length) {
      oldVehicleStatus = target;
    }
  }

  // A lead's chosen car follows the switch only if it was the old one, so a
  // later agreement is prepared for the right car. Best effort.
  if (rental.application_id) {
    try {
      await admin
        .from("applications")
        .update({ vehicle_id: data.newVehicleId } as never)
        .eq("id", rental.application_id)
        .eq("vehicle_id", oldVehicleId);
    } catch (e) {
      console.error("[reservation-switch] application vehicle not updated", String((e as Error)?.message ?? e));
    }
  }

  // Agreements are only read: anything that names the old car is flagged.
  let agreementRows: Array<{ status: string | null }> = [];
  if (rental.application_id) {
    const { data: ag } = await admin
      .from("agreements")
      .select("id,status")
      .eq("application_id", rental.application_id)
      .eq("vehicle_id", oldVehicleId)
      .limit(50);
    agreementRows = (ag ?? []) as any[];
  }
  const agreement = classifyAgreementsForSwitch(agreementRows);

  const reason = data.reason?.trim() || null;
  const result: SwitchResult = {
    rentalId: data.rentalId,
    fromVehicleId: oldVehicleId,
    toVehicleId: data.newVehicleId,
    weeklyRate: rateChanged ? (data.weeklyRate as number) : oldRate,
    rateChanged,
    oldVehicleStatus,
    oldVehicleReleased,
    agreement,
  };
  await audit({
    action: "reservation.vehicle_switched",
    entityType: "rental",
    entityId: data.rentalId,
    summary: `Reserved car switched from ${label(prev)}${prev?.unit_number ? ` (Unit ${prev.unit_number})` : ""} to ${label(next)}${next.unit_number ? ` (Unit ${next.unit_number})` : ""}${reason ? `: ${reason}` : ""}`,
    metadata: {
      from_vehicle_id: oldVehicleId,
      to_vehicle_id: data.newVehicleId,
      reason,
      old_car_has_issue: data.oldCarHasIssue === true,
      old_vehicle_status: oldVehicleStatus,
      old_vehicle_released: oldVehicleReleased,
      old_weekly_rate: oldRate,
      new_weekly_rate: result.weeklyRate,
      agreement_needs_attention: agreement.needsAttention,
      agreement_signed: agreement.signed,
      agreement_outstanding: agreement.outstanding,
      agreement_draft: agreement.draft,
      renter_notified: false,
    },
  });
  return result;
}
