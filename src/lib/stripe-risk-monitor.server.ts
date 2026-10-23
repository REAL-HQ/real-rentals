import { tierAllows, type StaffTier } from "./roles";
import { STRIPE_RISK_MONITOR_OFF } from "./stripe-risk-monitor-flag";
import {
  buildStripeRiskMonitor,
  riskWindow,
  unavailableRiskReport,
  type RiskApplication,
  type RiskPayment,
  type RiskRental,
  type RiskReport,
  type RiskWindow,
} from "./stripe-risk-monitor";
import type { RiskStripeRead } from "./stripe-risk-monitor-read.server";

/**
 * Owners and managers. The flag is checked here again so a direct call still
 * throws before any read. This file only reads the database. Stripe is the
 * caller's list. A Stripe failure is returned before the database is read.
 */

export type RiskResponse = { status: "ready"; report: RiskReport };

export type RiskDirectory = { applications: RiskApplication[]; rentals: RiskRental[]; payments: RiskPayment[] };
export type RiskLoad = { ok: true; directory: RiskDirectory } | { ok: false; capped: boolean };

export async function runStripeRiskMonitor(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  now: Date;
  load: () => Promise<RiskLoad>;
  readStripe: (window: RiskWindow) => Promise<RiskStripeRead>;
}): Promise<RiskResponse> {
  if (!input.enabled) throw new Error(STRIPE_RISK_MONITOR_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const window = riskWindow(input.now);
  if (!window) return { status: "ready", report: { rows: [], stripeCheck: "unavailable", directory: "skipped", gte: 0, lt: 0 } };
  const stripe = await input.readStripe(window);
  if (!stripe.ok) return { status: "ready", report: unavailableRiskReport(window) };
  const loaded = await input.load();
  if (!loaded.ok) {
    return { status: "ready", report: { rows: [], stripeCheck: "ready", directory: "unavailable", gte: window.gte, lt: window.lt } };
  }
  return {
    status: "ready",
    report: buildStripeRiskMonitor({ window, ...stripe, ...loaded.directory }),
  };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type RiskDirectoryClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const APPLICATION_COLUMNS = "id,full_name,stripe_customer_id,deleted_at";
const RENTAL_COLUMNS = "id,application_id,stripe_customer_id,stripe_subscription_id";
const PAYMENT_COLUMNS = "id,driver_id,stripe_payment_intent_id,stripe_subscription_id";

export async function loadRiskDirectory(supabase: RiskDirectoryClient): Promise<RiskLoad> {
  const applications = await readPages(supabase, "applications", APPLICATION_COLUMNS);
  if (!applications.ok) return applications;
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return rentals;
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS);
  if (!payments.ok) return payments;
  const mappedApplications: RiskApplication[] = [];
  for (const row of applications.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    mappedApplications.push({
      id: row.id,
      name: text(row.full_name) ?? "Driver",
      stripeCustomerId: text(row.stripe_customer_id),
      deleted: row.deleted_at != null && row.deleted_at !== "",
    });
  }
  const mappedRentals: RiskRental[] = [];
  for (const row of rentals.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    mappedRentals.push({
      id: row.id,
      applicationId: text(row.application_id),
      stripeCustomerId: text(row.stripe_customer_id),
      stripeSubscriptionId: text(row.stripe_subscription_id),
    });
  }
  const mappedPayments: RiskPayment[] = [];
  for (const row of payments.rows) {
    if (typeof row.id !== "string") return { ok: false, capped: false };
    mappedPayments.push({
      id: row.id,
      driverId: text(row.driver_id),
      stripePaymentIntentId: text(row.stripe_payment_intent_id),
      stripeSubscriptionId: text(row.stripe_subscription_id),
    });
  }
  return { ok: true, directory: { applications: mappedApplications, rentals: mappedRentals, payments: mappedPayments } };
}

async function readPages(supabase: RiskDirectoryClient, table: string, columns: string): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: boolean }> {
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

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
