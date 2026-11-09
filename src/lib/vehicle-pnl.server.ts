import { tierAllows, type StaffTier } from "./roles";
import {
  VEHICLE_PNL_MAX_PAGES,
  VEHICLE_PNL_PAGE,
  buildVehiclePnl,
  vehiclePnlWindow,
  type VehiclePnlExpense,
  type VehiclePnlMaintenance,
  type VehiclePnlPayment,
  type VehiclePnlRental,
  type VehiclePnlResponse,
  type VehiclePnlStripeRead,
  type VehiclePnlToll,
  type VehiclePnlVehicle,
} from "./vehicle-pnl";

/**
 * Managers and owners. The flag is checked again here so a direct call still
 * returns before the role check's caller and before any read. Payments are
 * attributed through the vehicle or its rental. Stripe is only the read
 * passed in by the caller.
 */

const PAGE = VEHICLE_PNL_PAGE;

export type VehiclePnlDirectory = {
  vehicles: VehiclePnlVehicle[];
  rentals: VehiclePnlRental[];
  payments: VehiclePnlPayment[];
  expenses: VehiclePnlExpense[];
  tolls: VehiclePnlToll[];
  maintenance: VehiclePnlMaintenance[];
  stripe: VehiclePnlStripeRead;
  caps: {
    vehicles: boolean;
    rentals: boolean;
    payments: boolean;
    expenses: boolean;
    tolls: boolean;
    maintenance: boolean;
  };
};

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
  gte: (column: string, value: string) => Query;
  lt: (column: string, value: string) => Query;
  or: (filters: string) => Query;
  in: (column: string, values: readonly string[]) => Query;
};
export type VehiclePnlClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

export async function runVehiclePnl(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  month: string;
  load: () => Promise<VehiclePnlDirectory | null>;
}): Promise<VehiclePnlResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const window = vehiclePnlWindow(input.month);
  if (!window) throw new Error("Invalid month");
  const loaded = await input.load();
  if (!loaded) return { status: "unavailable", reason: "Vehicle profit records were incomplete", report: null };
  return { status: "ready", report: buildVehiclePnl({ window, ...loaded }) };
}

export async function loadVehiclePnl(
  supabase: VehiclePnlClient,
  readStripe: (window: { gte: number; lt: number }) => Promise<VehiclePnlStripeRead>,
  month: string,
): Promise<VehiclePnlDirectory | null> {
  const window = vehiclePnlWindow(month);
  if (!window) return null;
  const vehicles = await readPages(supabase, "vehicles", "id,year,make,model,license_plate");
  if (!vehicles) return null;
  const rentals = await readPages(supabase, "rentals", "id,vehicle_id");
  if (!rentals) return null;
  const from = shiftYmd(window.from, -1);
  const to = shiftYmd(window.to, 1);
  const dated = (column: string) => (query: Query) => query.gte(column, from).lt(column, to);
  const expenses = await readPages(
    supabase,
    "vehicle_expenses",
    "id,vehicle_id,category,amount,incurred_on,maintenance_record_id",
    dated("incurred_on"),
  );
  if (!expenses) return null;
  const tolls = await readPages(
    supabase,
    "toll_charges",
    "id,vehicle_id,charge_type,occurred_at,amount",
    dated("occurred_at"),
  );
  if (!tolls) return null;
  const maintenance = await readPages(
    supabase,
    "maintenance_records",
    "id,vehicle_id,company_share,total_cost,performed_on,completed_at,created_at",
    (query) => query.or(["performed_on", "completed_at", "created_at"].map((column) => `and(${column}.gte.${from},${column}.lt.${to})`).join(",")),
  );
  if (!maintenance) return null;
  const stripe = await readStripe({ gte: window.gte, lt: window.lt });
  const paymentColumns = "id,rental_id,vehicle_id,status,type,net_collected,paid_date,stripe_payment_intent_id,stripe_invoice_id";
  const payments = await readPayments(supabase, paymentColumns, dated("paid_date"), stripe);
  if (!payments) return null;

  const directory: VehiclePnlDirectory = {
    vehicles: [],
    rentals: [],
    payments: [],
    expenses: [],
    tolls: [],
    maintenance: [],
    stripe: { ok: false, truncated: false },
    caps: {
      vehicles: vehicles.truncated,
      rentals: rentals.truncated,
      payments: payments.truncated,
      expenses: expenses.truncated,
      tolls: tolls.truncated,
      maintenance: maintenance.truncated,
    },
  };
  for (const row of vehicles.rows) {
    if (typeof row.id !== "string") return null;
    directory.vehicles.push({
      id: row.id,
      year: typeof row.year === "number" ? row.year : null,
      make: text(row.make),
      model: text(row.model),
      licensePlate: text(row.license_plate),
    });
  }
  for (const row of rentals.rows) {
    if (typeof row.id !== "string") return null;
    directory.rentals.push({ id: row.id, vehicleId: text(row.vehicle_id) });
  }
  for (const row of payments.rows) {
    if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.type !== "string") return null;
    directory.payments.push({
      id: row.id,
      rentalId: text(row.rental_id),
      vehicleId: text(row.vehicle_id),
      status: row.status,
      type: row.type,
      netCollected: row.net_collected,
      paidDate: text(row.paid_date),
      stripePaymentIntentId: text(row.stripe_payment_intent_id),
      stripeInvoiceId: text(row.stripe_invoice_id),
    });
  }
  for (const row of expenses.rows) {
    if (typeof row.id !== "string") return null;
    directory.expenses.push({
      id: row.id,
      vehicleId: text(row.vehicle_id),
      category: text(row.category),
      amount: row.amount,
      incurredOn: text(row.incurred_on),
      maintenanceRecordId: text(row.maintenance_record_id),
    });
  }
  for (const row of tolls.rows) {
    if (typeof row.id !== "string" || typeof row.charge_type !== "string") return null;
    directory.tolls.push({
      id: row.id,
      vehicleId: text(row.vehicle_id),
      chargeType: row.charge_type,
      occurredAt: text(row.occurred_at),
      amount: row.amount,
    });
  }
  for (const row of maintenance.rows) {
    if (typeof row.id !== "string") return null;
    directory.maintenance.push({
      id: row.id,
      vehicleId: text(row.vehicle_id),
      companyShare: row.company_share,
      totalCost: row.total_cost,
      performedOn: text(row.performed_on),
      completedAt: text(row.completed_at),
      createdAt: text(row.created_at),
    });
  }
  directory.stripe = stripe;
  return directory;
}

const LINK_CHUNK = 50;

async function readPayments(
  supabase: VehiclePnlClient,
  columns: string,
  dated: (query: Query) => Query,
  stripe: VehiclePnlStripeRead,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean } | null> {
  const payments = await readPages(supabase, "payments", columns, dated);
  if (!payments) return null;
  if (!stripe.ok) return payments;
  const intents = unique(stripe.charges.flatMap((charge) => [charge.paymentIntentId, charge.id]));
  const invoices = unique(stripe.charges.map((charge) => charge.invoiceId));
  const linked = await readLinked(supabase, columns, intents, invoices);
  if (!linked) return null;
  const byId = new Map(payments.rows.map((row) => [String(row.id), row]));
  for (const row of linked.rows) {
    if (typeof row.id === "string" && !byId.has(row.id)) byId.set(row.id, row);
  }
  return { rows: [...byId.values()], truncated: payments.truncated || linked.truncated };
}

async function readLinked(
  supabase: VehiclePnlClient,
  columns: string,
  intents: string[],
  invoices: string[],
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean } | null> {
  const rows: Array<Record<string, unknown>> = [];
  let truncated = false;
  for (const [column, ids] of [["stripe_payment_intent_id", intents], ["stripe_invoice_id", invoices]] as const) {
    for (let index = 0; index < ids.length; index += LINK_CHUNK) {
      const chunk = ids.slice(index, index + LINK_CHUNK);
      const page = await readPages(supabase, "payments", columns, (query) => query.in(column, chunk));
      if (!page) return null;
      if (page.truncated) truncated = true;
      rows.push(...page.rows);
    }
  }
  return { rows, truncated };
}

export async function readPages(
  supabase: VehiclePnlClient,
  table: string,
  columns: string,
  narrow?: (query: Query) => Query,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean } | null> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < VEHICLE_PNL_MAX_PAGES; page++) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true });
    if (narrow) query = narrow(query);
    if (cursor) query = query.gt("id", cursor);
    const response = await query.limit(PAGE + 1);
    if (response.error || !Array.isArray(response.data) || response.data.length > PAGE + 1) return null;
    const extra = response.data.length > PAGE;
    const slice = extra ? response.data.slice(0, PAGE) : response.data;
    for (const row of slice) {
      if (typeof row.id !== "string" || !row.id || (cursor !== null && row.id <= cursor)) return null;
      cursor = row.id;
      rows.push(row);
    }
    if (!extra) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}
