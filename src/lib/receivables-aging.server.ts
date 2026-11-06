import { tierAllows, type StaffTier } from "./roles";
import { RECEIVABLES_AGING_OFF } from "./receivables-aging-flag";
import {
  buildReceivablesAging,
  cappedReceivablesAging,
  dollarsToCents,
  type AgingPayment,
  type AgingPerson,
  type AgingRental,
  type AgingReport,
  type AgingVehicle,
} from "./receivables-aging";

/**
 * Owners and managers. The flag is checked here again so a direct call still
 * throws before any read. Database reads only. No writes and no Stripe list.
 */

export type AgingResponse =
  | { status: "ready"; report: AgingReport }
  | { status: "unavailable"; reason: string };

export type AgingLoad =
  | { ok: true; rentals: AgingRental[]; payments: AgingPayment[]; people: AgingPerson[]; vehicles: AgingVehicle[] }
  | { ok: false; capped: boolean };

export async function runReceivablesAging(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  today: string;
  load: () => Promise<AgingLoad>;
}): Promise<AgingResponse> {
  if (!input.enabled) throw new Error(RECEIVABLES_AGING_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) {
    if (!loaded.capped) return { status: "unavailable", reason: "Receivable records were incomplete" };
    const report = cappedReceivablesAging(input.today);
    if (!report) return { status: "unavailable", reason: "The aging date could not be read" };
    return { status: "ready", report };
  }
  const report = buildReceivablesAging({ ...loaded, today: input.today });
  if (!report) return { status: "unavailable", reason: "The aging date could not be read" };
  return { status: "ready", report };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  eq: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type AgingDirectoryClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const RENTAL_COLUMNS = "id,application_id,vehicle_id,status,end_date";
const PAYMENT_COLUMNS = "id,rental_id,driver_id,type,status,amount,net_collected,refunded_amount,balance_due,due_date";
const PERSON_COLUMNS = "id,full_name";
const VEHICLE_COLUMNS = "id,unit_number,year,make,model,license_plate";

export async function loadReceivablesAging(supabase: AgingDirectoryClient): Promise<AgingLoad> {
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return rentals;
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS, { column: "type", value: "rent" });
  if (!payments.ok) return payments;

  const mappedRentals: AgingRental[] = [];
  for (const row of rentals.rows) {
    const rental = mapRental(row);
    if (!rental) return { ok: false, capped: false };
    mappedRentals.push(rental);
  }
  const mappedPayments: AgingPayment[] = [];
  for (const row of payments.rows) {
    const payment = mapPayment(row);
    if (!payment) return { ok: false, capped: false };
    mappedPayments.push(payment);
  }

  const personIds = [
    ...mappedRentals.map((rental) => rental.applicationId),
    ...mappedPayments.map((payment) => payment.applicationId),
  ].filter((id): id is string => !!id);
  const people = await readByIds(supabase, "applications", PERSON_COLUMNS, personIds);
  if (!people.ok) return { ok: false, capped: false };
  const vehicles = await readByIds(supabase, "vehicles", VEHICLE_COLUMNS, mappedRentals.map((rental) => rental.vehicleId));
  if (!vehicles.ok) return { ok: false, capped: false };

  return {
    ok: true,
    rentals: mappedRentals,
    payments: mappedPayments,
    people: people.rows.map((row) => ({ id: String(row.id), name: text(row.full_name) || "Driver" })),
    vehicles: vehicles.rows.map((row) => ({ id: String(row.id), label: vehicleLabel(row) })),
  };
}

async function readPages(
  supabase: AgingDirectoryClient,
  table: string,
  columns: string,
  match?: { column: string; value: string },
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = supabase.from(table).select(columns);
    if (match) query = query.eq(match.column, match.value);
    query = query.order("id", { ascending: true }).limit(1000);
    if (cursor) query = query.gt("id", cursor);
    const response = await query;
    if (response.error || !response.data) return { ok: false, capped: false };
    for (const row of response.data) {
      if (typeof row.id !== "string" || (cursor !== null && row.id <= cursor)) return { ok: false, capped: false };
      cursor = row.id;
      rows.push(row);
    }
    if (response.data.length < 1000) return { ok: true, rows };
  }
  return { ok: false, capped: true };
}

async function readByIds(
  supabase: AgingDirectoryClient,
  table: string,
  columns: string,
  ids: string[],
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: false }> {
  const rows: Array<Record<string, unknown>> = [];
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += 100) {
    const response = await supabase.from(table).select(columns).in("id", unique.slice(index, index + 100)).limit(1000);
    if (response.error || !response.data) return { ok: false, capped: false };
    rows.push(...response.data);
  }
  return { ok: true, rows };
}

function mapRental(row: Record<string, unknown>): AgingRental | null {
  if (typeof row.id !== "string" || typeof row.vehicle_id !== "string" || typeof row.status !== "string") return null;
  return {
    id: row.id,
    applicationId: text(row.application_id),
    vehicleId: row.vehicle_id,
    status: row.status,
    endDate: text(row.end_date),
  };
}

function mapPayment(row: Record<string, unknown>): AgingPayment | null {
  if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.type !== "string") return null;
  const amount = dollarsToCents(row.amount);
  const net = dollarsToCents(row.net_collected);
  const refunded = dollarsToCents(row.refunded_amount);
  const balance = dollarsToCents(row.balance_due);
  return {
    id: row.id,
    rentalId: text(row.rental_id),
    applicationId: text(row.driver_id),
    type: row.type,
    status: row.status,
    dueDate: text(row.due_date),
    amountCents: amount.cents,
    netCollectedCents: net.cents,
    refundedCents: refunded.cents,
    balanceDueCents: balance.cents,
    unreadable: amount.unreadable || net.unreadable || refunded.unreadable || balance.unreadable,
  };
}

function vehicleLabel(row: Record<string, unknown>): string {
  const year = typeof row.year === "number" && Number.isSafeInteger(row.year) ? String(row.year) : null;
  const name = [year, text(row.make), text(row.model)].filter(Boolean).join(" ");
  const label = [text(row.unit_number) ? `Unit ${text(row.unit_number)}` : null, name || null, text(row.license_plate)].filter(Boolean).join(" · ");
  return label || "Vehicle";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
