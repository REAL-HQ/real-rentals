/**
 * Read-only oil change facts. Selects only. A reminder is a draft for staff
 * to copy. This file does not send a text and does not store a draft.
 */
import { businessToday } from "@/lib/vehicle-maintenance";
import type { VehicleMaintenanceView } from "@/lib/vehicle-maintenance";
import {
  companyOilChangeIntervalMiles,
  effectiveOilNextDue,
  isOilChangeItem,
  lastCompletedOilServiceMiles,
  latestReadingDate,
  oilChangeReminderEligibility,
  parseOilMiles,
  type OilServiceRecord,
  type SettingsIntervalRow,
} from "@/lib/oil-next-due";

export type OilDueSources = {
  oilRecords: OilServiceRecord[];
  settingsIntervals: SettingsIntervalRow[];
};

export type OilChangePhotoDraft = {
  vehicleId: string;
  vehicleLabel: string;
  renterName: string | null;
  reason: "within_window" | "overdue" | "stale_reading";
  reasonLabel: string;
  cycleKey: string;
  milesRemaining: number | null;
  draft: string;
};

export async function loadOilDueSources(sb: any, vehicleId: string): Promise<OilDueSources> {
  const [records, settings] = await Promise.all([
    sb
      .from("maintenance_records")
      .select("id,item,category,status,performed_on,odometer")
      .eq("vehicle_id", vehicleId)
      .order("performed_on", { ascending: false })
      .limit(200),
    sb.from("maintenance_defaults").select("item,category,interval_miles,is_active").eq("is_active", true).limit(200),
  ]);
  if (records.error || settings.error) throw new Error("Could not load maintenance.");
  return {
    oilRecords: ((records.data ?? []) as any[]).map((row) => ({
      status: row.status,
      item: row.item,
      category: row.category,
      performed_on: row.performed_on,
      odometer: row.odometer,
      items: row.maintenance_record_items ?? row.items ?? [],
    })),
    settingsIntervals: (settings.data ?? []) as SettingsIntervalRow[],
  };
}

function vehicleWords(year: number | null, make: string | null, model: string | null): string {
  return [year, make, model].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ");
}

function readingOnFromView(view: VehicleMaintenanceView): string | null {
  return latestReadingDate(view.mileage_log, view.vehicle.odometer_updated_at);
}

/** Staff vehicle page. One draft or nothing. Does not look up a stored pending row. */
export async function oilChangeReminderForVehicle(sb: any, view: VehicleMaintenanceView): Promise<OilChangePhotoDraft | null> {
  const { data, error } = await sb
    .from("rentals")
    .select("id,application_id")
    .eq("vehicle_id", view.vehicle.id)
    .eq("status", "active")
    .limit(1);
  if (error) return null;
  const rental = Array.isArray(data) ? data[0] : null;
  let fullName: string | null = null;
  if (rental?.application_id) {
    const app = await sb.from("applications").select("id,full_name").eq("id", rental.application_id).limit(1);
    if (!app.error) {
      const row = Array.isArray(app.data) ? app.data[0] : null;
      fullName = row?.full_name ?? null;
    }
  }
  const decision = oilChangeReminderEligibility({
    vehicleId: view.vehicle.id,
    hasCurrentRenter: Boolean(rental),
    effectiveDueMiles: view.next_service_due.effective_next_due_miles,
    latestOdometerMiles: view.vehicle.current_odometer,
    latestReadingOn: readingOnFromView(view),
    today: businessToday(),
    pendingCycleKey: null,
    fullName,
    year: view.vehicle.year,
    make: view.vehicle.make,
    model: view.vehicle.model,
  });
  if (!decision.eligible) return null;
  return {
    vehicleId: view.vehicle.id,
    vehicleLabel: vehicleWords(view.vehicle.year, view.vehicle.make, view.vehicle.model) || "Vehicle",
    renterName: fullName,
    reason: decision.reason,
    reasonLabel: decision.reasonLabel,
    cycleKey: decision.cycleKey,
    milesRemaining: decision.milesRemaining,
    draft: decision.draft,
  };
}

type RentalRow = { id: string; vehicle_id: string | null; application_id: string | null };
type VehicleRow = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  current_odometer: unknown;
  odometer_updated_at: unknown;
};

/** Fleet list for Overview and Service. Reads only. One row per rented vehicle. */
export async function listOilChangePhotoDrafts(sb: any): Promise<OilChangePhotoDraft[]> {
  const today = businessToday();
  const [settingsQ, rentalsQ] = await Promise.all([
    sb.from("maintenance_defaults").select("item,category,interval_miles,is_active").eq("is_active", true).limit(200),
    sb.from("rentals").select("id,vehicle_id,application_id").eq("status", "active").limit(500),
  ]);
  if (settingsQ.error || rentalsQ.error) throw new Error("Could not load oil change reminders.");
  const rentals = ((rentalsQ.data ?? []) as RentalRow[]).filter((row) => row.vehicle_id);
  const vehicleIds = [...new Set(rentals.map((row) => row.vehicle_id as string))];
  if (!vehicleIds.length) return [];
  const appIds = [...new Set(rentals.map((row) => row.application_id).filter((id): id is string => Boolean(id)))];
  const [vehiclesQ, schedulesQ, recordsQ, readingsQ, appsQ] = await Promise.all([
    sb.from("vehicles").select("id,year,make,model,current_odometer,odometer_updated_at").in("id", vehicleIds),
    sb.from("maintenance_schedules").select("vehicle_id,item,next_due_miles,is_active").in("vehicle_id", vehicleIds).eq("is_active", true).limit(2000),
    sb.from("maintenance_records").select("vehicle_id,item,category,status,performed_on,odometer").in("vehicle_id", vehicleIds).limit(2000),
    sb
      .from("odometer_readings")
      .select("vehicle_id,mileage,observed_on,status")
      .in("vehicle_id", vehicleIds)
      .order("observed_on", { ascending: false })
      .limit(2000),
    appIds.length
      ? sb.from("applications").select("id,full_name").in("id", appIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (vehiclesQ.error || schedulesQ.error || recordsQ.error || readingsQ.error || appsQ.error) {
    throw new Error("Could not load oil change reminders.");
  }
  const settingsInterval = companyOilChangeIntervalMiles((settingsQ.data ?? []) as SettingsIntervalRow[]);
  const names = new Map<string, string>(((appsQ.data ?? []) as any[]).map((row) => [row.id, row.full_name as string]));
  const vehicles = new Map<string, VehicleRow>(((vehiclesQ.data ?? []) as VehicleRow[]).map((row) => [row.id, row]));
  const schedules = (schedulesQ.data ?? []) as any[];
  const records = (recordsQ.data ?? []) as any[];
  const readings = (readingsQ.data ?? []) as any[];
  const rentalByVehicle = new Map<string, RentalRow>();
  for (const rental of rentals) {
    if (rental.vehicle_id && !rentalByVehicle.has(rental.vehicle_id)) rentalByVehicle.set(rental.vehicle_id, rental);
  }
  const drafts: OilChangePhotoDraft[] = [];
  for (const vehicleId of vehicleIds) {
    const vehicle = vehicles.get(vehicleId);
    const rental = rentalByVehicle.get(vehicleId);
    if (!vehicle || !rental) continue;
    const oilSchedule = schedules.find((row) => row.vehicle_id === vehicleId && row.is_active !== false && isOilChangeItem(row.item));
    const vehicleReadings = readings.filter((row) => row.vehicle_id === vehicleId);
    const odometer = parseOilMiles(vehicle.current_odometer) ?? parseOilMiles(vehicleReadings.find((row) => (row.status ?? "valid") === "valid")?.mileage);
    const due = effectiveOilNextDue({
      explicitNextDueMiles: oilSchedule?.next_due_miles ?? null,
      lastOilServiceMiles: lastCompletedOilServiceMiles(records.filter((row) => row.vehicle_id === vehicleId)),
      latestOdometerMiles: odometer,
      settingsIntervalMiles: settingsInterval,
    });
    const fullName = rental.application_id ? names.get(rental.application_id) ?? null : null;
    const decision = oilChangeReminderEligibility({
      vehicleId,
      hasCurrentRenter: true,
      effectiveDueMiles: due.miles,
      latestOdometerMiles: odometer,
      latestReadingOn: latestReadingDate(vehicleReadings, vehicle.odometer_updated_at),
      today,
      pendingCycleKey: null,
      fullName,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
    });
    if (!decision.eligible) continue;
    drafts.push({
      vehicleId,
      vehicleLabel: vehicleWords(vehicle.year, vehicle.make, vehicle.model) || "Vehicle",
      renterName: fullName,
      reason: decision.reason,
      reasonLabel: decision.reasonLabel,
      cycleKey: decision.cycleKey,
      milesRemaining: decision.milesRemaining,
      draft: decision.draft,
    });
  }
  const rank: Record<OilChangePhotoDraft["reason"], number> = { overdue: 0, within_window: 1, stale_reading: 2 };
  drafts.sort((a, b) => rank[a.reason] - rank[b.reason] || a.vehicleLabel.localeCompare(b.vehicleLabel));
  return drafts.slice(0, 100);
}
