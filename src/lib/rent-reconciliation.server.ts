import { tierAllows, type StaffTier } from "./roles";
import { RENT_RECONCILIATION_OFF } from "./rent-reconciliation-flag";
import {
  buildRentReconciliation,
  cappedRentReconciliation,
  dollarsToCents,
  lastFullWeek,
  rentPaymentsInWeek,
  weekBounds,
  type RentApplication,
  type RentPayment,
  type RentReconciliationReport,
  type RentRental,
  type RentStripeRead,
  type RentVehicle,
  type RentWeek,
} from "./rent-reconciliation";

/**
 * Owners and managers. The flag is checked here again so a direct call still
 * throws before any read. This file only reads the database. Stripe, when the
 * caller supplies it, runs after that read and cannot change a payment.
 */

export type RentReconciliationResponse =
  | { status: "ready"; report: RentReconciliationReport }
  | { status: "unavailable"; reason: string };

export type RentDirectory = {
  payments: RentPayment[];
  applications: RentApplication[];
  rentals: RentRental[];
  vehicles: RentVehicle[];
};

export type RentLoad = { ok: true; directory: RentDirectory } | { ok: false; capped: boolean };

export async function runRentReconciliation(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  now: Date;
  weekStart: string | null;
  load: () => Promise<RentLoad>;
  stripe?: (request: { gte: number; lt: number; paymentIntentIds: string[]; invoiceIds: string[] }) => Promise<RentStripeRead>;
}): Promise<RentReconciliationResponse> {
  if (!input.enabled) throw new Error(RENT_RECONCILIATION_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const week = input.weekStart ? weekBounds(input.weekStart) : lastFullWeek(input.now);
  if (!week) return { status: "unavailable", reason: "The week could not be read" };
  const loaded = await input.load();
  if (!loaded.ok) {
    if (!loaded.capped) return { status: "unavailable", reason: "Rent payment records were incomplete" };
    return { status: "ready", report: cappedRentReconciliation(week) };
  }
  const base = buildRentReconciliation({ week, ...loaded.directory, stripe: { ok: false } });
  if (!input.stripe) return { status: "ready", report: base };
  try {
    const checked = await input.stripe(stripeRequest(loaded.directory.payments, week));
    if (!checked.ok) return { status: "ready", report: base };
    return { status: "ready", report: buildRentReconciliation({ week, ...loaded.directory, stripe: checked }) };
  } catch {
    return { status: "ready", report: base };
  }
}

function stripeRequest(payments: RentPayment[], week: RentWeek) {
  const rent = rentPaymentsInWeek(payments, week);
  return {
    gte: week.gte,
    lt: week.lt,
    paymentIntentIds: rent.map((payment) => payment.stripePaymentIntentId).filter((id): id is string => !!id),
    invoiceIds: rent.map((payment) => payment.stripeInvoiceId).filter((id): id is string => !!id),
  };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
};
export type RentDirectoryClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const PAYMENT_COLUMNS = "id,rental_id,driver_id,vehicle_id,type,status,amount,net_collected,paid_date,due_date,stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id";
const APPLICATION_COLUMNS = "id,full_name,stripe_customer_id";
const RENTAL_COLUMNS = "id,application_id,vehicle_id,stripe_customer_id";
const VEHICLE_COLUMNS = "id,unit_number,year,make,model,license_plate";

export async function loadRentReconciliation(supabase: RentDirectoryClient): Promise<RentLoad> {
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS);
  if (!payments.ok) return payments;
  const applications = await readPages(supabase, "applications", APPLICATION_COLUMNS);
  if (!applications.ok) return applications;
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return rentals;

  const mappedPayments: RentPayment[] = [];
  for (const row of payments.rows) {
    const payment = mapPayment(row);
    if (!payment) return { ok: false, capped: false };
    mappedPayments.push(payment);
  }
  const mappedApplications: RentApplication[] = [];
  for (const row of applications.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    mappedApplications.push({ id: row.id, name: text(row.full_name) || "Renter", stripeCustomerId: text(row.stripe_customer_id) });
  }
  const mappedRentals: RentRental[] = [];
  for (const row of rentals.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    mappedRentals.push({
      id: row.id,
      applicationId: text(row.application_id),
      vehicleId: text(row.vehicle_id),
      stripeCustomerId: text(row.stripe_customer_id),
    });
  }
  const vehicleIds = [
    ...mappedPayments.map((payment) => payment.vehicleId),
    ...mappedRentals.map((rental) => rental.vehicleId),
  ].filter((id): id is string => !!id);
  const vehicles = await readByIds(supabase, "vehicles", VEHICLE_COLUMNS, vehicleIds);
  if (!vehicles.ok) return { ok: false, capped: false };

  return {
    ok: true,
    directory: {
      payments: mappedPayments,
      applications: mappedApplications,
      rentals: mappedRentals,
      vehicles: vehicles.rows.map((row) => ({ id: String(row.id), label: vehicleLabel(row) })),
    },
  };
}

async function readPages(
  supabase: RentDirectoryClient,
  table: string,
  columns: string,
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = supabase.from(table).select(columns).order("id", { ascending: true }).limit(1000);
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
  supabase: RentDirectoryClient,
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

function mapPayment(row: Record<string, unknown>): RentPayment | null {
  if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.type !== "string") return null;
  const amount = dollarsToCents(row.amount);
  const net = dollarsToCents(row.net_collected);
  if (amount.unreadable || net.unreadable) {
    return {
      id: row.id,
      rentalId: text(row.rental_id),
      applicationId: text(row.driver_id),
      vehicleId: text(row.vehicle_id),
      type: row.type,
      status: row.status,
      amountCents: null,
      netCollectedCents: null,
      unreadable: true,
      paidDate: text(row.paid_date),
      dueDate: text(row.due_date),
      stripePaymentIntentId: text(row.stripe_payment_intent_id),
      stripeInvoiceId: text(row.stripe_invoice_id),
      stripeSubscriptionId: text(row.stripe_subscription_id),
    };
  }
  return {
    id: row.id,
    rentalId: text(row.rental_id),
    applicationId: text(row.driver_id),
    vehicleId: text(row.vehicle_id),
    type: row.type,
    status: row.status,
    amountCents: amount.cents,
    netCollectedCents: net.cents,
    unreadable: false,
    paidDate: text(row.paid_date),
    dueDate: text(row.due_date),
    stripePaymentIntentId: text(row.stripe_payment_intent_id),
    stripeInvoiceId: text(row.stripe_invoice_id),
    stripeSubscriptionId: text(row.stripe_subscription_id),
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
