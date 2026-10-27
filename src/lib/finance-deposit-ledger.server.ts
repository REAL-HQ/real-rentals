import { tierAllows, type StaffTier } from "./roles";
import { DEPOSIT_LEDGER_OFF } from "./finance-deposit-ledger-flag";
import {
  DEPOSIT_LEDGER_INCOMPLETE,
  buildDepositLedger,
  type DepositLedgerReport,
  type LedgerDeduction,
  type LedgerName,
  type LedgerPayment,
  type LedgerRefund,
  type LedgerRental,
} from "./finance-deposit-ledger";

/**
 * Managers and owners. The flag is checked by the server function before this
 * runs, and again here so a direct call still throws before any read.
 * No writes and no Stripe.
 */

export type DepositLedgerResponse =
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: DepositLedgerReport };

export type DepositLedgerLoad =
  | {
      ok: true;
      rentals: LedgerRental[];
      payments: LedgerPayment[];
      deductions: LedgerDeduction[];
      refunds: LedgerRefund[];
      names: Map<string, LedgerName>;
    }
  | { ok: false };

export async function runDepositLedger(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  load: () => Promise<DepositLedgerLoad>;
}): Promise<DepositLedgerResponse> {
  if (!input.enabled) throw new Error(DEPOSIT_LEDGER_OFF);
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const loaded = await input.load();
  if (!loaded.ok) return { status: "unavailable", reason: DEPOSIT_LEDGER_INCOMPLETE, report: null };
  const built = buildDepositLedger(loaded);
  if (!built.ok) return { status: "unavailable", reason: DEPOSIT_LEDGER_INCOMPLETE, report: null };
  return { status: "ready", report: built.report };
}

type QueryResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  gt: (column: string, value: string) => Query;
  in: (column: string, values: string[]) => Query;
};
export type DepositLedgerClient = {
  from: (table: string) => { select: (columns: string) => Query };
};

const RENTAL_COLUMNS = "id,application_id,driver_id,deposit_amount,deposit_held,deposit_status,deposit_refund_amount,deposit_settled_at";
const PAYMENT_COLUMNS = "id,status,type,amount,net_collected,paid_date,payment_method,refunded_amount,refunded_at,rental_id,driver_id";
const DEDUCTION_COLUMNS = "id,rental_id,amount,reason";
const REFUND_COLUMNS = "id,amount,payment_ids,status";
const APPLICATION_COLUMNS = "id,full_name,user_id";

export async function loadDepositLedgerDirectory(supabase: DepositLedgerClient): Promise<DepositLedgerLoad> {
  const rentals = await readPages(supabase, "rentals", RENTAL_COLUMNS);
  if (!rentals.ok) return { ok: false };
  const payments = await readPages(supabase, "payments", PAYMENT_COLUMNS);
  if (!payments.ok) return { ok: false };
  const deductions = await readPages(supabase, "deposit_deductions", DEDUCTION_COLUMNS);
  if (!deductions.ok) return { ok: false };
  const refunds = await readPages(supabase, "payment_refunds", REFUND_COLUMNS);
  if (!refunds.ok) return { ok: false };

  const rentalRows: LedgerRental[] = [];
  for (const row of rentals.rows) {
    const rental = mapRental(row);
    if (!rental) return { ok: false };
    rentalRows.push(rental);
  }
  const paymentRows: LedgerPayment[] = [];
  for (const row of payments.rows) {
    const payment = mapPayment(row);
    if (!payment) return { ok: false };
    paymentRows.push(payment);
  }
  const deductionRows: LedgerDeduction[] = [];
  for (const row of deductions.rows) {
    const deduction = mapDeduction(row);
    if (!deduction) return { ok: false };
    deductionRows.push(deduction);
  }
  const refundRows: LedgerRefund[] = [];
  for (const row of refunds.rows) {
    const refund = mapRefund(row);
    if (!refund) return { ok: false };
    refundRows.push(refund);
  }

  const applicationIds = unique([
    ...rentalRows.map((rental) => rental.applicationId),
    ...paymentRows.map((payment) => payment.driverId),
  ]);
  const userIds = unique(rentalRows.map((rental) => rental.driverId));
  const byId = await readIn(supabase, "applications", APPLICATION_COLUMNS, "id", applicationIds);
  if (!byId) return { ok: false };
  const byUser = await readIn(supabase, "applications", APPLICATION_COLUMNS, "user_id", userIds);
  if (!byUser) return { ok: false };
  const names = new Map<string, LedgerName>();
  for (const row of [...byId, ...byUser]) {
    const id = text(row.id);
    if (!id) return { ok: false };
    const name = { applicationId: id, renterName: text(row.full_name) || "Renter" };
    names.set(id, name);
    const userId = text(row.user_id);
    if (userId) names.set(userId, name);
  }
  return { ok: true, rentals: rentalRows, payments: paymentRows, deductions: deductionRows, refunds: refundRows, names };
}

type PageRead = { ok: true; rows: Array<Record<string, unknown>> } | { ok: false };

async function readPages(supabase: DepositLedgerClient, table: string, columns: string): Promise<PageRead> {
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
  supabase: DepositLedgerClient,
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

function mapRental(row: Record<string, unknown>): LedgerRental | null {
  if (typeof row.id !== "string") return null;
  const depositAmount = money(row.deposit_amount);
  const depositRefundAmount = money(row.deposit_refund_amount);
  if (!depositAmount.ok || !depositRefundAmount.ok) return null;
  if (row.deposit_held !== null && row.deposit_held !== undefined && typeof row.deposit_held !== "boolean") return null;
  return {
    id: row.id,
    applicationId: text(row.application_id),
    driverId: text(row.driver_id),
    depositAmount: depositAmount.value,
    depositHeld: row.deposit_held === true ? true : row.deposit_held === false ? false : null,
    depositStatus: text(row.deposit_status) ?? "none",
    depositRefundAmount: depositRefundAmount.value,
    depositSettledAt: text(row.deposit_settled_at),
  };
}

function mapPayment(row: Record<string, unknown>): LedgerPayment | null {
  if (typeof row.id !== "string" || typeof row.status !== "string") return null;
  const amount = money(row.amount);
  const netCollected = money(row.net_collected);
  const refundedAmount = money(row.refunded_amount);
  if (!amount.ok || !netCollected.ok || !refundedAmount.ok) return null;
  if (amount.value === null || refundedAmount.value === null) return null;
  return {
    id: row.id,
    rentalId: text(row.rental_id),
    driverId: text(row.driver_id),
    type: text(row.type) ?? "",
    status: row.status,
    amount: amount.value,
    netCollected: netCollected.value,
    paidDate: text(row.paid_date),
    method: text(row.payment_method),
    refundedAmount: refundedAmount.value,
    refundedAt: text(row.refunded_at),
  };
}

function mapDeduction(row: Record<string, unknown>): LedgerDeduction | null {
  if (typeof row.id !== "string") return null;
  const rentalId = text(row.rental_id);
  const amount = money(row.amount);
  if (!rentalId || !amount.ok || amount.value === null) return null;
  return { id: row.id, rentalId, amount: amount.value, reason: text(row.reason) ?? "" };
}

function mapRefund(row: Record<string, unknown>): LedgerRefund | null {
  if (typeof row.id !== "string") return null;
  const amount = money(row.amount);
  if (!amount.ok || amount.value === null) return null;
  if (!Array.isArray(row.payment_ids) || row.payment_ids.some((id) => typeof id !== "string")) return null;
  return {
    id: row.id,
    amount: amount.value,
    paymentIds: row.payment_ids,
    status: text(row.status),
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
