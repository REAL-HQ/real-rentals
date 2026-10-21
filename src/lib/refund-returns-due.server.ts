import { tierAllows, type StaffTier } from "./roles";
import { REFUND_RETURNS_DUE_OFF } from "./refund-returns-due-flag";
import {
  REFUND_RETURNS_CAPPED,
  REFUND_RETURNS_INCOMPLETE,
  applyReturnStripe,
  buildRefundReturns,
  dollarsToCents,
  markReturnStripeUnavailable,
  type RefundReturnsReport,
  type ReturnDeduction,
  type ReturnName,
  type ReturnPayment,
  type ReturnRental,
  type ReturnStripeCheck,
  type ReturnVehicle,
} from "./refund-returns-due";

/**
 * Managers and owners. The flag is checked here again so a direct call still
 * throws before any read. Stripe, when the caller supplies it, runs after the
 * database read and cannot change the amount still due.
 */

export type RefundReturnsResponse =
  | { status: "ready"; report: RefundReturnsReport }
  | { status: "unavailable"; reason: string };

export type RefundReturnsLoad =
  | {
      ok: true;
      rentals: ReturnRental[];
      payments: ReturnPayment[];
      deductions: ReturnDeduction[];
      names: ReturnName[];
      vehicles: ReturnVehicle[];
    }
  | { ok: false; capped: boolean };

export type ReturnStripeRead = { ok: true; checks: ReturnStripeCheck[] } | { ok: false };

export async function runRefundReturns(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  today: string;
  load: () => Promise<RefundReturnsLoad>;
  stripe?: (payments: ReturnPayment[]) => Promise<ReturnStripeRead>;
}): Promise<RefundReturnsResponse> {
  if (!input.enabled) throw new Error(REFUND_RETURNS_DUE_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) {
    return {
      status: "unavailable",
      reason: loaded.capped ? REFUND_RETURNS_CAPPED : REFUND_RETURNS_INCOMPLETE,
    };
  }
  const report = buildRefundReturns({ ...loaded, today: input.today });
  if (!report) return { status: "unavailable", reason: REFUND_RETURNS_INCOMPLETE };
  if (!input.stripe) return { status: "ready", report };
  try {
    const checked = await input.stripe(loaded.payments);
    if (!checked.ok) return { status: "ready", report: markReturnStripeUnavailable(report) };
    return { status: "ready", report: applyReturnStripe(report, loaded.payments, checked.checks) };
  } catch {
    return { status: "ready", report: markReturnStripeUnavailable(report) };
  }
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  eq: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
};
export type RefundReturnsClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const RENTAL_COLUMNS = "id,application_id,vehicle_id,status,end_date,deposit_held,deposit_status,deposit_refund_amount";
const PAYMENT_COLUMNS = "id,rental_id,type,status,amount,net_collected,refunded_amount,stripe_payment_intent_id";
const DEDUCTION_COLUMNS = "id,rental_id,amount";
const NAME_COLUMNS = "id,full_name";
const VEHICLE_COLUMNS = "id,unit_number,year,make,model";

export async function loadRefundReturns(supabase: RefundReturnsClient): Promise<RefundReturnsLoad> {
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return rentals;
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS, { column: "type", value: "deposit" });
  if (!payments.ok) return payments;
  const deductions = await readPages(supabase, "deposit_deductions", DEDUCTION_COLUMNS);
  if (!deductions.ok) return deductions;

  const mappedRentals: ReturnRental[] = [];
  for (const row of rentals.rows) {
    const rental = mapRental(row);
    if (!rental) return { ok: false, capped: false };
    mappedRentals.push(rental);
  }
  const mappedPayments: ReturnPayment[] = [];
  for (const row of payments.rows) {
    const payment = mapPayment(row);
    if (!payment) return { ok: false, capped: false };
    mappedPayments.push(payment);
  }
  const mappedDeductions: ReturnDeduction[] = [];
  for (const row of deductions.rows) {
    const deduction = mapDeduction(row);
    if (!deduction) return { ok: false, capped: false };
    mappedDeductions.push(deduction);
  }

  const names = await readByIds(
    supabase,
    "applications",
    NAME_COLUMNS,
    mappedRentals.map((rental) => rental.applicationId).filter((id): id is string => !!id),
  );
  if (!names.ok) return { ok: false, capped: false };
  const vehicleIds = mappedRentals.map((rental) => rental.vehicleId).filter((id): id is string => !!id);
  const vehicles = await readByIds(supabase, "vehicles", VEHICLE_COLUMNS, vehicleIds);
  if (!vehicles.ok) return { ok: false, capped: false };
  const onFile = new Set(vehicles.rows.map((row) => text(row.id)).filter((id): id is string => !!id));

  return {
    ok: true,
    rentals: mappedRentals.map((rental) => ({
      ...rental,
      vehicleOnFile: !!rental.vehicleId && onFile.has(rental.vehicleId),
    })),
    payments: mappedPayments,
    deductions: mappedDeductions,
    names: names.rows.map((row) => ({ id: String(row.id), name: text(row.full_name) || "Renter" })),
    vehicles: vehicles.rows.map((row) => ({ id: String(row.id), label: vehicleLabel(row) })),
  };
}

async function readPages(
  supabase: RefundReturnsClient,
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
  supabase: RefundReturnsClient,
  table: string,
  columns: string,
  ids: string[],
): Promise<{ ok: true; rows: Array<Record<string, unknown>> } | { ok: false }> {
  const rows: Array<Record<string, unknown>> = [];
  const unique = [...new Set(ids)];
  for (let index = 0; index < unique.length; index += 100) {
    const response = await supabase.from(table).select(columns).in("id", unique.slice(index, index + 100)).limit(1000);
    if (response.error || !response.data) return { ok: false };
    rows.push(...response.data);
  }
  return { ok: true, rows };
}

function mapRental(row: Record<string, unknown>): ReturnRental | null {
  if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.deposit_status !== "string") return null;
  const refund = dollarsToCents(row.deposit_refund_amount);
  const held = heldFlag(row.deposit_held);
  const vehicleId = text(row.vehicle_id);
  return {
    id: row.id,
    applicationId: text(row.application_id),
    vehicleId,
    vehicleOnFile: false,
    status: row.status,
    endDate: text(row.end_date),
    depositHeld: held.held,
    depositHeldUnreadable: held.unreadable,
    depositStatus: row.deposit_status,
    refundCents: refund.cents,
    refundUnreadable: refund.unreadable,
  };
}

function mapPayment(row: Record<string, unknown>): ReturnPayment | null {
  if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.type !== "string") return null;
  const amount = dollarsToCents(row.amount);
  const net = dollarsToCents(row.net_collected);
  const refunded = dollarsToCents(row.refunded_amount);
  return {
    id: row.id,
    rentalId: text(row.rental_id),
    type: row.type,
    status: row.status,
    amountCents: amount.cents,
    netCollectedCents: net.cents,
    refundedCents: refunded.cents,
    unreadable: amount.unreadable || net.unreadable || refunded.unreadable,
    stripePaymentIntentId: text(row.stripe_payment_intent_id),
  };
}

function mapDeduction(row: Record<string, unknown>): ReturnDeduction | null {
  if (typeof row.id !== "string" || typeof row.rental_id !== "string") return null;
  const amount = dollarsToCents(row.amount);
  return {
    id: row.id,
    rentalId: row.rental_id,
    amountCents: amount.cents,
    unreadable: amount.unreadable || amount.cents == null,
  };
}

function heldFlag(value: unknown): { held: boolean | null; unreadable: boolean } {
  if (value == null) return { held: null, unreadable: false };
  if (typeof value === "boolean") return { held: value, unreadable: false };
  return { held: null, unreadable: true };
}

function vehicleLabel(row: Record<string, unknown>): string {
  const year = typeof row.year === "number" && Number.isSafeInteger(row.year) ? String(row.year) : null;
  const name = [year, text(row.make), text(row.model)].filter(Boolean).join(" ");
  const unit = text(row.unit_number);
  return [unit ? `Unit ${unit}` : null, name || null].filter(Boolean).join(" · ") || "Vehicle";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
