import { tierAllows, type StaffTier } from "./roles";
import { AR_AGING_OFF } from "./ar-aging-flag";
import { REVENUE_TYPES } from "./revenue-report";
import {
  AR_STRIPE_CAP,
  AR_STRIPE_RETRIEVE_CAP,
  AR_STRIPE_UNAVAILABLE,
  buildArAging,
  cappedArAging,
  dollarsToCents,
  type AgingDriver,
  type AgingPayment,
  type AgingReport,
  type AgingStripeNet,
} from "./ar-aging";

/**
 * Managers and owners. The flag is checked here again so a direct call still
 * throws before any read. This file only reads the database.
 */

export type ArAgingResponse =
  | { status: "ready"; report: AgingReport }
  | { status: "unavailable"; reason: string };

export type ArAgingLoad =
  | { ok: true; drivers: AgingDriver[]; payments: AgingPayment[] }
  | { ok: false; capped: boolean };

export async function runArAging(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  today: string;
  load: () => Promise<ArAgingLoad>;
  stripe?: (paymentIntentIds: string[]) => Promise<{ ok: true; nets: AgingStripeNet[] } | { ok: false }>;
}): Promise<ArAgingResponse> {
  if (!input.enabled) throw new Error(AR_AGING_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) {
    if (!loaded.capped) return { status: "unavailable", reason: "Receivables could not be read" };
    const report = cappedArAging(input.today);
    if (!report) return { status: "unavailable", reason: "The aging date could not be read" };
    return { status: "ready", report };
  }
  const intents = stripeIntentIds(loaded.drivers, loaded.payments);
  if (!input.stripe || intents.length > AR_STRIPE_RETRIEVE_CAP) {
    const warning = intents.length > AR_STRIPE_RETRIEVE_CAP ? AR_STRIPE_CAP : intents.length > 0 ? AR_STRIPE_UNAVAILABLE : undefined;
    return ready(input.today, loaded, [], intents.length > 0, warning);
  }
  try {
    const checked = await input.stripe(intents);
    return ready(input.today, loaded, checked.ok ? checked.nets : [], !checked.ok && intents.length > 0, !checked.ok && intents.length > 0 ? AR_STRIPE_UNAVAILABLE : undefined);
  } catch {
    return ready(input.today, loaded, [], intents.length > 0, intents.length > 0 ? AR_STRIPE_UNAVAILABLE : undefined);
  }
}

function ready(
  today: string,
  loaded: { drivers: AgingDriver[]; payments: AgingPayment[] },
  stripeNets: AgingStripeNet[],
  stripeUnavailable: boolean,
  warning?: string,
): ArAgingResponse {
  const report = buildArAging({
    today,
    drivers: loaded.drivers,
    payments: loaded.payments,
    stripeNets,
    stripeUnavailable,
    warnings: warning ? [warning] : [],
  });
  if (!report) return { status: "unavailable", reason: "The aging date could not be read" };
  return { status: "ready", report };
}

export function stripeIntentIds(drivers: AgingDriver[], payments: AgingPayment[]): string[] {
  const active = new Set(drivers.filter((driver) => driver.status.trim().toLowerCase() === "active").map((driver) => driver.id));
  const ids = new Set<string>();
  for (const payment of payments) {
    if (!payment.driverId || !active.has(payment.driverId) || !payment.stripePaymentIntentId) continue;
    const status = payment.status.trim().toLowerCase();
    if (status !== "paid" && status !== "refunded") continue;
    if (!(REVENUE_TYPES as readonly string[]).includes(payment.type)) continue;
    ids.add(payment.stripePaymentIntentId);
  }
  return [...ids].sort();
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  eq: (column: string, value: string) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type ArAgingClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

export async function loadArAging(supabase: ArAgingClient): Promise<ArAgingLoad> {
  const drivers = await readPages(supabase, "applications", "id,full_name,status");
  if (!drivers.ok) return drivers;
  const payments = await readPages(supabase, "payments", "id,driver_id,type,status,amount,net_collected,stripe_payment_intent_id,due_date");
  if (!payments.ok) return payments;
  const mappedDrivers: AgingDriver[] = [];
  for (const row of drivers.rows) {
    if (typeof row.id !== "string" || typeof row.status !== "string") return { ok: false, capped: false };
    mappedDrivers.push({ id: row.id, name: text(row.full_name) || "Driver", status: row.status });
  }
  const mappedPayments: AgingPayment[] = [];
  for (const row of payments.rows) {
    const payment = mapPayment(row);
    if (!payment) return { ok: false, capped: false };
    mappedPayments.push(payment);
  }
  return { ok: true, drivers: mappedDrivers, payments: mappedPayments };
}

async function readPages(
  supabase: ArAgingClient,
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

function mapPayment(row: Record<string, unknown>): AgingPayment | null {
  if (typeof row.id !== "string" || typeof row.type !== "string" || typeof row.status !== "string") return null;
  return {
    id: row.id,
    driverId: text(row.driver_id),
    type: row.type,
    status: row.status,
    amountCents: dollarsToCents(row.amount),
    netCollectedCents: dollarsToCents(row.net_collected),
    stripePaymentIntentId: text(row.stripe_payment_intent_id),
    dueDate: text(row.due_date),
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
