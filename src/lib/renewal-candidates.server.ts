/**
 * Reads renewal candidates. The caller has already refused on the flag.
 * This file does not insert, update, or send.
 */
import { RENEWAL_CANDIDATES_ENABLED } from "@/lib/renewal-candidates-flag";
import {
  buildRenewalCandidates,
  easternCalendarDate,
  renewalCandidateHorizon,
  type CandidateApplication,
  type CandidatePayment,
  type CandidateRental,
  type CandidateVehicle,
  type RenewalCandidateList,
} from "@/lib/renewal-candidates";

const PAGE = 200;
const PAGE_CAP = 20;
const PAYMENT_CHUNK = 50;
/** PostgREST returns at most this many rows and drops the rest with no error. */
const POSTGREST_MAX_ROWS = 1000;
const READ_CAP = POSTGREST_MAX_ROWS - 1;

const RENTAL_COLUMNS = "id,status,application_id,vehicle_id,end_date";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function refuseIfTruncated(count: number): void {
  if (count > READ_CAP) throw new Error("Renewal candidates could not be listed.");
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function endingRentals(admin: Admin, today: string, through: string): Promise<CandidateRental[]> {
  const kept: CandidateRental[] = [];
  for (let pageIndex = 0; kept.length <= READ_CAP; pageIndex += 1) {
    if (pageIndex >= PAGE_CAP) throw new Error("Renewal candidates could not be listed.");
    const from = pageIndex * PAGE;
    const page = await admin
      .from("rentals")
      .select(RENTAL_COLUMNS)
      .eq("status", "active")
      .gte("end_date", today)
      .lte("end_date", through)
      .order("end_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE);
    if (page.error) throw new Error(page.error.message);
    const rows = page.data ?? [];
    const more = rows.length > PAGE;
    for (const row of rows.slice(0, PAGE)) {
      kept.push({
        id: row.id,
        status: row.status,
        applicationId: text(row.application_id),
        vehicleId: text(row.vehicle_id),
        endDate: text(row.end_date),
      });
      if (kept.length > READ_CAP) throw new Error("Renewal candidates could not be listed.");
    }
    if (!more) break;
  }
  return kept;
}

async function rowsIn<T>(
  load: (ids: string[]) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  ids: string[],
): Promise<T[]> {
  const out: T[] = [];
  for (let index = 0; index < ids.length; index += PAYMENT_CHUNK) {
    const chunk = ids.slice(index, index + PAYMENT_CHUNK);
    const query = await load(chunk);
    if (query.error) throw new Error(query.error.message);
    const rows = query.data ?? [];
    refuseIfTruncated(rows.length);
    out.push(...rows);
  }
  return out;
}

export async function loadRenewalCandidates(now = new Date()): Promise<RenewalCandidateList> {
  if (RENEWAL_CANDIDATES_ENABLED !== true) throw new Error("Renewal candidates are not enabled.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = easternCalendarDate(now);
  const through = renewalCandidateHorizon(today);
  const rentals = await endingRentals(supabaseAdmin, today, through);
  if (rentals.length === 0) return buildRenewalCandidates({ today, rentals, applications: [], vehicles: [], payments: [] });

  const applicationIds = [...new Set(rentals.map((rental) => rental.applicationId).filter((id): id is string => !!id))];
  const vehicleIds = [...new Set(rentals.map((rental) => rental.vehicleId).filter((id): id is string => !!id))];
  const rentalIds = rentals.map((rental) => rental.id);

  const applications = await rowsIn(async (ids) => {
    const query = await supabaseAdmin.from("applications").select("id,full_name").in("id", ids).limit(READ_CAP + 1);
    return query;
  }, applicationIds);
  const vehicles = await rowsIn(async (ids) => {
    const query = await supabaseAdmin
      .from("vehicles")
      .select("id,year,make,model,unit_number")
      .in("id", ids)
      .limit(READ_CAP + 1);
    return query;
  }, vehicleIds);
  const payments = await rowsIn(async (ids) => {
    const query = await supabaseAdmin
      .from("payments")
      .select("rental_id,status")
      .in("rental_id", ids)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(READ_CAP + 1);
    return query;
  }, rentalIds);

  return buildRenewalCandidates({
    today,
    rentals,
    applications: applications.map(
      (row): CandidateApplication => ({ id: row.id, fullName: text(row.full_name) }),
    ),
    vehicles: vehicles.map(
      (row): CandidateVehicle => ({
        id: row.id,
        year: typeof row.year === "number" ? row.year : null,
        make: text(row.make),
        model: text(row.model),
        unitNumber: text(row.unit_number),
      }),
    ),
    payments: payments.map(
      (row): CandidatePayment => ({ rentalId: text(row.rental_id), status: text(row.status) }),
    ),
  });
}
