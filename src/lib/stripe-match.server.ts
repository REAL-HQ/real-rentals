import { stripeMatchReportEnabled } from "./stripe-match-flag";
import { matchStripeCustomers, type MatchApplication, type MatchRental, type MatchVehicle, type StripeMatchCustomer, type StripeMatchReport } from "./stripe-match";

/**
 * Owners and managers only. The flag is checked before any application read
 * or Stripe call. A coordinator is refused even when the flag is on.
 */

type Result = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Limited = PromiseLike<Result> & { gt: (column: string, value: string) => PromiseLike<Result> };
export type MatchDirectoryClient = {
  from: (table: string) => { select: (columns: string) => { order: (column: string, options: { ascending: boolean }) => { limit: (count: number) => Limited } } };
};

export type MatchDirectory = { applications: MatchApplication[]; rentals: MatchRental[]; vehicles: MatchVehicle[] };
export type StripeMatchResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: StripeMatchReport };

export async function runStripeMatch(input: {
  userId: string | null;
  roles: string[];
  env: { STRIPE_MATCH_REPORT_ENABLED?: string };
  loadDirectory: () => Promise<MatchDirectory | null>;
  readStripe: () => Promise<{ ok: true; customers: StripeMatchCustomer[] } | { ok: false; reason: string }>;
}): Promise<StripeMatchResponse> {
  if (!input.userId) throw new Error("Forbidden");
  const { tierFromRoles, tierAllows } = await import("./roles");
  if (!tierAllows(tierFromRoles(input.roles), "manager")) throw new Error("Forbidden");
  if (!stripeMatchReportEnabled(input.env)) return { status: "disabled", report: null };
  const directory = await input.loadDirectory();
  if (!directory) return { status: "unavailable", reason: "Driver records were incomplete", report: null };
  const stripe = await input.readStripe();
  if (!stripe.ok) return { status: "unavailable", reason: stripe.reason, report: null };
  return { status: "ready", report: matchStripeCustomers({ ...directory, customers: stripe.customers }) };
}

export async function loadMatchDirectory(supabase: MatchDirectoryClient): Promise<MatchDirectory | null> {
  const applications = await readTable(supabase, "applications", "id,full_name,email,phone,stripe_customer_id,vehicle_id,user_id,deleted_at,status", mapApplication);
  const rentals = await readTable(supabase, "rentals", "id,application_id,driver_id,vehicle_id,stripe_customer_id", mapRental);
  const vehicles = await readTable(supabase, "vehicles", "id,year,make,model,license_plate", mapVehicle);
  if (!applications || !rentals || !vehicles) return null;
  return { applications, rentals, vehicles };
}

async function readTable<T>(supabase: MatchDirectoryClient, table: string, columns: string, map: (row: Record<string, unknown>) => T | null): Promise<T[] | null> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const query = supabase.from(table).select(columns).order("id", { ascending: true }).limit(1000);
    const response: Result = await (cursor ? query.gt("id", cursor) : query);
    if (response.error || !response.data) return null;
    for (const row of response.data) {
      if (typeof row.id !== "string" || (cursor !== null && row.id <= cursor)) return null;
      const mapped = map(row);
      if (!mapped) return null;
      cursor = row.id;
      rows.push(mapped);
    }
    if (response.data.length < 1000) return rows;
  }
  return null;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function mapApplication(row: Record<string, unknown>): MatchApplication | null {
  if (typeof row.id !== "string" || typeof row.full_name !== "string" || typeof row.email !== "string" || typeof row.status !== "string") return null;
  return {
    id: row.id, fullName: row.full_name, email: row.email, phone: optionalText(row.phone),
    stripeCustomerId: optionalText(row.stripe_customer_id), vehicleId: optionalText(row.vehicle_id),
    userId: optionalText(row.user_id), deletedAt: optionalText(row.deleted_at), status: row.status,
  };
}
function mapRental(row: Record<string, unknown>): MatchRental | null {
  if (typeof row.id !== "string") return null;
  return {
    id: row.id, applicationId: optionalText(row.application_id), driverId: optionalText(row.driver_id),
    vehicleId: optionalText(row.vehicle_id), stripeCustomerId: optionalText(row.stripe_customer_id),
  };
}
function mapVehicle(row: Record<string, unknown>): MatchVehicle | null {
  if (typeof row.id !== "string") return null;
  const year = typeof row.year === "number" && Number.isSafeInteger(row.year) ? row.year : null;
  return { id: row.id, year, make: optionalText(row.make), model: optionalText(row.model), licensePlate: optionalText(row.license_plate) };
}
