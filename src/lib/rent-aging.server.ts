import { tierAllows, type StaffTier } from "./roles";
import { RENT_AGING_OFF } from "./rent-aging-flag";
import {
  RENT_AGING_INCOMPLETE,
  buildRentAging,
  type AgingCharge,
  type AgingName,
  type AgingReport,
} from "./rent-aging";

/**
 * Managers and owners. The flag is checked by the server function before this
 * runs, and again here so a direct call still throws before any read.
 * No writes and no Stripe.
 */

export type RentAgingResponse =
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: AgingReport };

export type RentAgingLoad =
  | { ok: true; charges: AgingCharge[]; names: Map<string, AgingName> }
  | { ok: false };

export async function runRentAging(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  asOf: Date;
  load: () => Promise<RentAgingLoad>;
}): Promise<RentAgingResponse> {
  if (!input.enabled) throw new Error(RENT_AGING_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) return { status: "unavailable", reason: RENT_AGING_INCOMPLETE, report: null };
  const built = buildRentAging({ asOf: input.asOf, charges: loaded.charges, names: loaded.names });
  if (!built.ok) return { status: "unavailable", reason: RENT_AGING_INCOMPLETE, report: null };
  return { status: "ready", report: built.report };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
};
export type RentAgingClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const PAYMENT_COLUMNS = "id,status,type,amount,balance_due,due_date,paid_date,driver_id,rental_id,stripe_invoice_id";
const RENTAL_COLUMNS = "id,application_id,driver_id";
const APPLICATION_COLUMNS = "id,full_name,user_id";

export async function loadRentAgingDirectory(supabase: RentAgingClient): Promise<RentAgingLoad> {
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS);
  if (!payments.ok) return { ok: false };
  const charges: AgingCharge[] = [];
  for (const row of payments.rows) {
    const charge = mapCharge(row);
    if (!charge) return { ok: false };
    charges.push(charge);
  }
  const rentalIds = unique(charges.map((charge) => charge.rentalId));
  const rentals = await readIn(supabase, "rentals", RENTAL_COLUMNS, "id", rentalIds);
  if (!rentals) return { ok: false };
  const rentalById = new Map<string, { applicationId: string | null; driverId: string | null }>();
  for (const row of rentals) {
    if (typeof row.id !== "string") return { ok: false };
    rentalById.set(row.id, { applicationId: text(row.application_id), driverId: text(row.driver_id) });
  }
  const applicationIds = unique([
    ...charges.map((charge) => charge.driverId),
    ...[...rentalById.values()].map((rental) => rental.applicationId),
  ]);
  const userIds = unique([...rentalById.values()].map((rental) => rental.driverId));
  const byId = await readIn(supabase, "applications", APPLICATION_COLUMNS, "id", applicationIds);
  if (!byId) return { ok: false };
  const byUser = await readIn(supabase, "applications", APPLICATION_COLUMNS, "user_id", userIds);
  if (!byUser) return { ok: false };

  const names = new Map<string, AgingName>();
  for (const row of [...byId, ...byUser]) {
    const id = text(row.id);
    if (!id) return { ok: false };
    const name = { applicationId: id, renterName: text(row.full_name) || "Renter" };
    names.set(id, name);
    const userId = text(row.user_id);
    if (userId && !names.has(userId)) names.set(userId, name);
  }
  for (const [rentalId, rental] of rentalById) {
    const named = (rental.applicationId && names.get(rental.applicationId)) || (rental.driverId && names.get(rental.driverId)) || null;
    if (named) names.set(`rental:${rentalId}`, named);
  }
  for (const charge of charges) {
    if (charge.driverId) continue;
    const named = charge.rentalId ? names.get(`rental:${charge.rentalId}`) : undefined;
    if (named) charge.driverId = named.applicationId;
  }
  return { ok: true, charges, names };
}

type PageRead = { ok: true; rows: Array<Record<string, unknown>> } | { ok: false };

async function readPages(supabase: RentAgingClient, table: string, columns: string): Promise<PageRead> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true }).limit(1000);
    if (cursor) query = query.gt("id", cursor);
    const response = await query;
    if (response.error || !response.data) return { ok: false };
    for (const row of response.data) {
      if (typeof row.id !== "string" || (cursor !== null && row.id <= cursor)) return { ok: false };
      cursor = row.id;
      rows.push(row);
    }
    if (response.data.length < 1000) return { ok: true, rows };
  }
  return { ok: false };
}

async function readIn(
  supabase: RentAgingClient,
  table: string,
  columns: string,
  column: string,
  ids: string[],
): Promise<Array<Record<string, unknown>> | null> {
  if (!ids.length) return [];
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < ids.length; index += 200) {
    const response = await supabase.from(table).select(columns).in(column, ids.slice(index, index + 200));
    if (response.error || !response.data) return null;
    rows.push(...response.data);
  }
  return rows;
}

function mapCharge(row: Record<string, unknown>): AgingCharge | null {
  if (typeof row.id !== "string" || typeof row.status !== "string") return null;
  const balance = money(row.balance_due);
  const amount = money(row.amount);
  if (!balance.ok || !amount.ok) return null;
  return {
    id: row.id,
    rentalId: text(row.rental_id),
    driverId: text(row.driver_id),
    type: text(row.type),
    status: row.status,
    balanceDue: balance.value,
    amount: amount.value,
    dueDate: text(row.due_date),
    paidDate: text(row.paid_date),
  };
}

function money(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
  }
  return { ok: false };
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}
