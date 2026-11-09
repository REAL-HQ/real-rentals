import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildDriverStatement, type DriverStatementReport, type StatementCharge, type StatementInvoice, type StatementRefund } from "./driver-statement";
import type { DriverMatchApplication, DriverMatchRental } from "./stripe-driver-match";

/**
 * Owners and managers only. The flag is checked before any application,
 * rental, or Stripe read.
 */

const PAGE = 1000;
type Result<T> = { data: T[] | null; error: { message: string } | null };
export type DriverStatementResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: DriverStatementReport };

export async function runDriverStatement(input: {
  enabled: boolean;
  userId: string | null;
  roles: string[];
  driverId: string;
  signal?: AbortSignal;
  load: () => Promise<{ applications: DriverMatchApplication[]; rentals: DriverMatchRental[] } | null>;
  readStripe: () => Promise<{ ok: true; charges: StatementCharge[]; refunds: StatementRefund[]; invoices: StatementInvoice[] } | { ok: false; reason: string }>;
}): Promise<DriverStatementResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId) throw new Error("Forbidden");
  const { tierFromRoles, tierAllows } = await import("./roles");
  if (!tierAllows(tierFromRoles(input.roles), "manager")) throw new Error("Forbidden");
  if (!input.driverId.trim()) return { status: "unavailable", reason: "Driver was not found", report: null };
  const directory = await input.load();
  if (!directory) return { status: "unavailable", reason: "Driver records were incomplete", report: null };
  if (!directory.applications.some((row) => row.id === input.driverId)) return { status: "unavailable", reason: "Driver was not found", report: null };
  const stripe = await input.readStripe();
  if (!stripe.ok) return { status: "unavailable", reason: stripe.reason, report: null };
  const report = buildDriverStatement({ driverId: input.driverId, ...directory, ...stripe });
  return report ? { status: "ready", report } : { status: "unavailable", reason: "The statement could not be totaled", report: null };
}

export async function loadStatementDirectory(supabase: SupabaseClient<Database>, signal?: AbortSignal) {
  const applications = await readPages(async (cursor) => {
    let query = supabase.from("applications").select("id,full_name,email,phone,stripe_customer_id,user_id,deleted_at,status").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  const rentals = await readPages(async (cursor) => {
    let query = supabase.from("rentals").select("id,application_id,driver_id,stripe_customer_id").order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  if (!applications || !rentals) return null;
  return {
    applications: applications.map((row) => ({
      id: row.id, fullName: row.full_name, email: row.email, phone: row.phone, stripeCustomerId: row.stripe_customer_id,
      userId: row.user_id, deletedAt: row.deleted_at, status: row.status,
    })),
    rentals: rentals.map((row) => ({ id: row.id, applicationId: row.application_id, driverId: row.driver_id, stripeCustomerId: row.stripe_customer_id })),
  };
}

async function readPages<T extends { id: string }>(load: (cursor: string | null) => PromiseLike<Result<T>>, signal?: AbortSignal): Promise<T[] | null> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    signal?.throwIfAborted();
    const response = await load(cursor);
    if (response.error || !Array.isArray(response.data) || response.data.length > PAGE) return null;
    for (const row of response.data) {
      if (typeof row.id !== "string" || !row.id || (cursor !== null && row.id <= cursor)) return null;
      cursor = row.id;
      rows.push(row);
    }
    if (response.data.length < PAGE) return rows;
  }
  return null;
}
