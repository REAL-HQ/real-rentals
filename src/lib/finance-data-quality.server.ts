import { tierAllows, type StaffTier } from "./roles";
import { FINANCE_DATA_QUALITY_OFF } from "./finance-data-quality-flag";
import {
  FINANCE_RECORDS_INCOMPLETE,
  buildFinanceDataQuality,
  type QualityPayment,
  type QualityRefund,
  type QualityRental,
  type QualityReport,
} from "./finance-data-quality";

/**
 * Managers and owners. The flag is checked by the server function before this
 * runs, and again here so a direct call still throws before any read.
 * No writes and no Stripe.
 */

export type FinanceDataQualityResponse =
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: QualityReport };

export type FinanceDataQualityLoad =
  | { ok: true; payments: QualityPayment[]; rentals: QualityRental[]; refunds: QualityRefund[] }
  | { ok: false };

export async function runFinanceDataQuality(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  load: () => Promise<FinanceDataQualityLoad>;
}): Promise<FinanceDataQualityResponse> {
  if (!input.enabled) throw new Error(FINANCE_DATA_QUALITY_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) return { status: "unavailable", reason: FINANCE_RECORDS_INCOMPLETE, report: null };
  return { status: "ready", report: buildFinanceDataQuality(loaded) };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
};
export type FinanceDataQualityClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const PAYMENT_COLUMNS = "id,status,payment_method,paid_date,refunded_amount,refunded_at,stripe_payment_intent_id,driver_id,rental_id";
const RENTAL_COLUMNS = "id,status,weekly_rate,vehicle_id,driver_id,application_id,deposit_held,deposit_amount";
const REFUND_COLUMNS = "id,payment_ids";
const APPLICATION_COLUMNS = "id,user_id";
const VEHICLE_COLUMNS = "id,unit_number,year,make,model";

export async function loadFinanceDataQualityDirectory(supabase: FinanceDataQualityClient): Promise<FinanceDataQualityLoad> {
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS);
  if (!payments.ok) return { ok: false };
  const refunds = await readPages(supabase, "payment_refunds", REFUND_COLUMNS);
  if (!refunds.ok) return { ok: false };
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return { ok: false };

  const mappedPayments: QualityPayment[] = [];
  for (const row of payments.rows) {
    const payment = mapPayment(row);
    if (!payment) return { ok: false };
    mappedPayments.push(payment);
  }
  const mappedRefunds: QualityRefund[] = [];
  for (const row of refunds.rows) {
    const refund = mapRefund(row);
    if (!refund) return { ok: false };
    mappedRefunds.push(refund);
  }

  const rentalRows: Array<Record<string, unknown>> = [];
  for (const row of rentals.rows) {
    if (typeof row.id !== "string" || typeof row.status !== "string") return { ok: false };
    rentalRows.push(row);
  }
  const active = rentalRows.filter((row) => typeof row.status === "string" && row.status.trim().toLowerCase() === "active");
  const vehicleIds = unique(active.map((row) => text(row.vehicle_id)));
  const applicationIds = unique(active.map((row) => text(row.application_id)));
  const driverIds = unique(active.map((row) => text(row.driver_id)));
  const vehicles = await readIn(supabase, "vehicles", VEHICLE_COLUMNS, "id", vehicleIds);
  if (!vehicles) return { ok: false };
  const applicationsById = await readIn(supabase, "applications", APPLICATION_COLUMNS, "id", applicationIds);
  if (!applicationsById) return { ok: false };
  const applicationsByUser = await readIn(supabase, "applications", APPLICATION_COLUMNS, "user_id", driverIds);
  if (!applicationsByUser) return { ok: false };

  const vehicleSet = new Set(vehicles.map((row) => text(row.id)).filter((id): id is string => !!id));
  const applicationSet = new Set(applicationsById.map((row) => text(row.id)).filter((id): id is string => !!id));
  const userSet = new Set(applicationsByUser.map((row) => text(row.user_id)).filter((id): id is string => !!id));
  const vehicleById = new Map(vehicles.map((row) => [text(row.id), row]));

  const mappedRentals: QualityRental[] = rentalRows.map((row) => {
    const id = row.id as string;
    const vehicleId = text(row.vehicle_id);
    const applicationId = text(row.application_id);
    const driverId = text(row.driver_id);
    const vehicle = vehicleId ? vehicleById.get(vehicleId) : undefined;
    return {
      id,
      status: row.status as string,
      weeklyRate: money(row.weekly_rate),
      vehicleId,
      vehicleFound: !!vehicleId && vehicleSet.has(vehicleId),
      driverFound: (!!applicationId && applicationSet.has(applicationId)) || (!!driverId && userSet.has(driverId)),
      depositHeld: row.deposit_held === true,
      depositAmount: money(row.deposit_amount),
      label: vehicleLabel(vehicle) ?? `Rental ${id}`,
    };
  });

  return { ok: true, payments: mappedPayments, rentals: mappedRentals, refunds: mappedRefunds };
}

type PageRead = { ok: true; rows: Array<Record<string, unknown>> } | { ok: false };

async function readPages(supabase: FinanceDataQualityClient, table: string, columns: string): Promise<PageRead> {
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
  supabase: FinanceDataQualityClient,
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

function mapPayment(row: Record<string, unknown>): QualityPayment | null {
  if (typeof row.id !== "string" || typeof row.status !== "string") return null;
  return {
    id: row.id,
    status: row.status,
    method: text(row.payment_method),
    paidDate: text(row.paid_date),
    refundedAmount: money(row.refunded_amount),
    refundedAt: text(row.refunded_at),
    stripePaymentIntentId: text(row.stripe_payment_intent_id),
    driverId: text(row.driver_id),
    rentalId: text(row.rental_id),
  };
}

function mapRefund(row: Record<string, unknown>): QualityRefund | null {
  if (typeof row.id !== "string") return null;
  if (row.payment_ids !== null && row.payment_ids !== undefined && !Array.isArray(row.payment_ids)) return null;
  const paymentIds = Array.isArray(row.payment_ids) ? row.payment_ids.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean) : [];
  return { id: row.id, paymentIds };
}

function vehicleLabel(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  const year = typeof row.year === "number" && Number.isSafeInteger(row.year) ? String(row.year) : null;
  const name = [year, text(row.make), text(row.model)].filter(Boolean).join(" ");
  const label = [text(row.unit_number) ? `Unit ${text(row.unit_number)}` : null, name || null].filter(Boolean).join(" · ");
  return label || null;
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}
