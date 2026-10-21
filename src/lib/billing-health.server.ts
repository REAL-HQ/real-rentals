import { tierAllows, type StaffTier } from "./roles";
import {
  BILLING_RENTAL_CAP,
  buildBillingHealth,
  type BillingDriverLink,
  type BillingHealthReport,
  type BillingRental,
} from "./billing-health";
import type { BillingStripeRead } from "./billing-health-read.server";

export type BillingDirectory = { rentals: BillingRental[]; driverLinks: BillingDriverLink[] };

/**
 * Owners only. The flag is checked by the server function before this runs,
 * and again here so a direct call still returns disabled before any read.
 * No writes.
 */

export type BillingHealthResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: BillingHealthReport };

export type BillingLoad =
  | { ok: true; directory: BillingDirectory }
  | { ok: false; capped: boolean };

export async function runBillingHealth(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  load: () => Promise<BillingLoad>;
  readStripe: () => Promise<BillingStripeRead>;
}): Promise<BillingHealthResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId || !tierAllows(input.tier, "owner")) throw new Error("Forbidden");
  const stripe = await input.readStripe();
  if (!stripe.ok) {
    if (stripe.capped) {
      return { status: "ready", report: { mismatches: [], warnings: [stripe.reason], activeRentals: null, subscriptions: null } };
    }
    return { status: "unavailable", reason: stripe.reason, report: null };
  }
  const loaded = await input.load();
  if (!loaded.ok) {
    if (loaded.capped) {
      return { status: "ready", report: { mismatches: [], warnings: [BILLING_RENTAL_CAP], activeRentals: null, subscriptions: null } };
    }
    return { status: "unavailable", reason: "Rental records were incomplete", report: null };
  }
  return {
    status: "ready",
    report: buildBillingHealth({
      rentals: loaded.directory.rentals,
      subscriptions: stripe.subscriptions,
      driverLinks: loaded.directory.driverLinks,
    }),
  };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  eq: (column: string, value: string) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
};
export type BillingDirectoryClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const RENTAL_COLUMNS = "id,status,weekly_rate,next_payment_due,stripe_customer_id,stripe_subscription_id,driver_id,application_id,vehicle_id";

export async function loadBillingDirectory(supabase: BillingDirectoryClient): Promise<BillingLoad> {
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS, "active");
  if (!rentals.ok) return rentals;
  const applications = await readPages(supabase, "applications", "id,full_name,stripe_customer_id,deleted_at");
  if (!applications.ok) return applications;
  const vehicleIds = [...new Set(rentals.rows.map((row) => text(row.vehicle_id)).filter((id): id is string => !!id))];
  const vehicles = await readByIds(supabase, "vehicles", "id,unit_number,year,make,model,license_plate", vehicleIds);
  if (!vehicles) return { ok: false, capped: false };
  const apps: AppRow[] = [];
  for (const row of applications.rows) {
    const app = mapApplication(row);
    if (!app) return { ok: false, capped: false };
    apps.push(app);
  }
  const appById = new Map(apps.map((row) => [row.id, row]));
  const vehicleById = new Map(vehicles.map((row) => [text(row.id), row]));
  const driverLinks: BillingDriverLink[] = [];
  const seen = new Map<string, number>();
  for (const app of apps) {
    if (app.deletedAt || !app.stripeCustomerId) continue;
    seen.set(app.stripeCustomerId, (seen.get(app.stripeCustomerId) ?? 0) + 1);
  }
  for (const app of apps) {
    if (app.deletedAt || !app.stripeCustomerId || seen.get(app.stripeCustomerId) !== 1) continue;
    driverLinks.push({ customerId: app.stripeCustomerId, applicationId: app.id, driverName: app.fullName });
  }
  const mapped: BillingRental[] = [];
  for (const row of rentals.rows) {
    const rental = mapRental(row, appById, vehicleById);
    if (!rental) return { ok: false, capped: false };
    mapped.push(rental);
  }
  return { ok: true, directory: { rentals: mapped, driverLinks } };
}

type PageRead = { ok: true; rows: Array<Record<string, unknown>> } | { ok: false; capped: boolean };

async function readPages(supabase: BillingDirectoryClient, table: string, columns: string, status?: string): Promise<PageRead> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = supabase.from(table).select(columns);
    if (status) query = query.eq("status", status);
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

async function readByIds(supabase: BillingDirectoryClient, table: string, columns: string, ids: string[]): Promise<Array<Record<string, unknown>> | null> {
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < ids.length; index += 200) {
    const response = await supabase.from(table).select(columns).in("id", ids.slice(index, index + 200));
    if (response.error || !response.data) return null;
    rows.push(...response.data);
  }
  return rows;
}

type AppRow = { id: string; fullName: string; stripeCustomerId: string | null; deletedAt: string | null };

function mapApplication(row: Record<string, unknown>): AppRow | null {
  if (typeof row.id !== "string") return null;
  return {
    id: row.id,
    fullName: text(row.full_name) ?? "Driver",
    stripeCustomerId: text(row.stripe_customer_id),
    deletedAt: text(row.deleted_at),
  };
}

function mapRental(
  row: Record<string, unknown>,
  apps: Map<string, AppRow>,
  vehicles: Map<string | null, Record<string, unknown>>,
): BillingRental | null {
  if (typeof row.id !== "string" || typeof row.status !== "string") return null;
  const applicationId = text(row.application_id);
  const app = applicationId ? apps.get(applicationId) : undefined;
  const vehicle = vehicles.get(text(row.vehicle_id));
  return {
    id: row.id,
    status: row.status,
    weeklyRate: money(row.weekly_rate),
    nextPaymentDue: text(row.next_payment_due),
    stripeCustomerId: text(row.stripe_customer_id),
    stripeSubscriptionId: text(row.stripe_subscription_id),
    applicationId,
    driverName: app?.fullName ?? "Driver",
    vehicleLabel: vehicleLabel(vehicle),
  };
}

function vehicleLabel(row: Record<string, unknown> | undefined): string {
  if (!row) return "Vehicle";
  const year = typeof row.year === "number" && Number.isSafeInteger(row.year) ? String(row.year) : null;
  const name = [year, text(row.make), text(row.model)].filter(Boolean).join(" ");
  const label = [text(row.unit_number) ? `Unit ${text(row.unit_number)}` : null, name || null, text(row.license_plate)].filter(Boolean).join(" · ");
  return label || "Vehicle";
}

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
