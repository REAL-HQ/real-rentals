import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";
import {
  assertFleetAvailabilityEnabled,
  buildFleetAvailability,
  countApprovedNotRenting,
  etCalendarDate,
  type FleetAvailabilityBoard,
  type FleetIncidentInput,
  type FleetRentalInput,
  type FleetVehicleInput,
} from "@/lib/fleet-availability";

/**
 * Read-only Fleet Availability.
 *
 * Coordinator, Manager, or Owner. supabaseAdmin bypasses RLS, so the tier is
 * checked here before any read. Incidents are manager-only under RLS;
 * coordinators still see this board because the request includes them.
 *
 * The flag is checked before the client is imported. A disabled call reads
 * nothing. This file has no insert, update, delete, or upsert.
 *
 * Archived cars (archived_at) are not loaded. Sold, retired, and status
 * archived stay in the result and the grouper files them under Not Rentable.
 * Next payment due is rentals.next_payment_due. Driver is
 * applications.full_name on the rental's application_id. A missing value is
 * Unknown. The waiting count is #79's population without the audit-log sort.
 */

const VEHICLE_COLUMNS =
  "id, unit_number, year, make, model, license_plate, status, archived_at, registration_expires_on, insurance_expires_on";

const PAGE = 1000;
const CAP = 5000;

type VehicleRow = {
  id: string;
  unit_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate: string | null;
  status: string | null;
  archived_at: string | null;
  registration_expires_on: string | null;
  insurance_expires_on: string | null;
};

type RentalRow = {
  id: string;
  vehicle_id: string | null;
  application_id: string | null;
  next_payment_due: string | null;
  status: string | null;
};

type IncidentRow = {
  vehicle_id: string | null;
  status: string | null;
};

type ApplicantRow = {
  id: string;
  status: string | null;
  deleted_at: string | null;
};

export type FleetAvailabilityResult = FleetAvailabilityBoard & { waitingCount: number };

export const listFleetAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FleetAvailabilityResult> => {
    await requireStaff(context.userId);
    assertFleetAvailabilityEnabled();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const vehicles = await readPages<VehicleRow>((from, to) =>
      supabaseAdmin
        .from("vehicles")
        .select(VEHICLE_COLUMNS)
        .is("archived_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    const rentals = await readPages<RentalRow>((from, to) =>
      supabaseAdmin
        .from("rentals")
        .select("id, vehicle_id, application_id, next_payment_due, status")
        .eq("status", "active")
        .order("id", { ascending: true })
        .range(from, to),
    );
    const incidents = await readPages<IncidentRow>((from, to) =>
      supabaseAdmin
        .from("incidents")
        .select("vehicle_id, status")
        .in("status", ["open", "in_claim", "repairing"])
        .order("id", { ascending: true })
        .range(from, to),
    );
    const applicants = await readPages<ApplicantRow>((from, to) =>
      supabaseAdmin
        .from("applications")
        .select("id, status, deleted_at")
        .eq("status", "approved")
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    );

    const applicationIds = [
      ...new Set(
        rentals
          .map((rental) => rental.application_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    const names = new Map<string, string | null>();
    for (let index = 0; index < applicationIds.length; index += 100) {
      const slice = applicationIds.slice(index, index + 100);
      const named = await supabaseAdmin.from("applications").select("id, full_name").in("id", slice);
      if (named.error) throw new Error(named.error.message);
      for (const row of named.data ?? []) names.set(row.id, row.full_name);
    }

    const board = buildFleetAvailability({
      vehicles: vehicles.map(toVehicle),
      rentals: rentals.map((rental) => toRental(rental, names)),
      incidents: incidents.map(toIncident),
      todayEt: etCalendarDate(new Date()),
    });
    const waitingCount = countApprovedNotRenting(
      applicants.map((row) => ({ id: row.id, status: row.status, deletedAt: row.deleted_at })),
      rentals.map((rental) => rental.application_id).filter((id): id is string => typeof id === "string"),
    );
    return { ...board, waitingCount };
  });

function toVehicle(row: VehicleRow): FleetVehicleInput {
  return {
    id: row.id,
    unitNumber: row.unit_number,
    year: row.year,
    make: row.make,
    model: row.model,
    plate: row.license_plate,
    status: row.status,
    archivedAt: row.archived_at,
    registrationExpiresOn: row.registration_expires_on,
    insuranceExpiresOn: row.insurance_expires_on,
  };
}

function toRental(row: RentalRow, names: Map<string, string | null>): FleetRentalInput {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    applicationId: row.application_id,
    driverName: row.application_id ? (names.get(row.application_id) ?? null) : null,
    nextPaymentDue: row.next_payment_due,
    status: row.status,
  };
}

function toIncident(row: IncidentRow): FleetIncidentInput {
  return { vehicleId: row.vehicle_id, status: row.status };
}

async function readPages<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < CAP; from += PAGE) {
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error("Fleet Availability could not load every row.");
}
