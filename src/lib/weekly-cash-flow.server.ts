import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildWeeklyCashFlow, cashFlowWeeks, type CashCharge, type CashExpense, type CashRefund, type WeeklyCashFlowReport } from "./weekly-cash-flow";

/**
 * Owners and managers. Payments and Expenses are both Manager screens, so
 * this report is too. The flag is checked before any expense or Stripe read.
 */

const PAGE = 1000;
type Result<T> = { data: T[] | null; error: { message: string } | null };
export type WeeklyCashFlowResponse =
  | { status: "disabled"; report: null }
  | { status: "unavailable"; reason: string; report: null }
  | { status: "ready"; report: WeeklyCashFlowReport };

export async function runWeeklyCashFlow(input: {
  enabled: boolean;
  userId: string | null;
  roles: string[];
  now?: Date;
  signal?: AbortSignal;
  load: (window: { from: string; through: string }) => Promise<CashExpense[] | null>;
  readStripe: (window: { gte: number; lt: number }) => Promise<{ ok: true; charges: CashCharge[]; refunds: CashRefund[] } | { ok: false; reason: string }>;
}): Promise<WeeklyCashFlowResponse> {
  if (!input.enabled) return { status: "disabled", report: null };
  if (!input.userId) throw new Error("Forbidden");
  const { tierFromRoles, tierAllows } = await import("./roles");
  if (!tierAllows(tierFromRoles(input.roles), "manager")) throw new Error("Forbidden");
  const now = input.now ?? new Date();
  const weeks = cashFlowWeeks(now);
  if (!weeks) return { status: "unavailable", reason: "The weeks could not be dated", report: null };
  const expenses = await input.load({ from: weeks[0]!.from, through: weeks.at(-1)!.through });
  if (!expenses) return { status: "unavailable", reason: "Expense records were incomplete", report: null };
  const stripe = await input.readStripe({ gte: weeks[0]!.gte, lt: weeks.at(-1)!.lt });
  if (!stripe.ok) return { status: "unavailable", reason: stripe.reason, report: null };
  const report = buildWeeklyCashFlow({ now, expenses, charges: stripe.charges, refunds: stripe.refunds });
  return report ? { status: "ready", report } : { status: "unavailable", reason: "The cash flow could not be totaled", report: null };
}

export async function loadCashFlowExpenses(supabase: SupabaseClient<Database>, window: { from: string; through: string }, signal?: AbortSignal) {
  const rows = await readPages(async (cursor) => {
    let query = supabase.from("vehicle_expenses").select("id,amount,category,incurred_on").gte("incurred_on", window.from).lte("incurred_on", window.through).order("id", { ascending: true }).limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  if (!rows) return null;
  return rows.map((row) => ({ id: row.id, amount: row.amount, category: row.category, incurredOn: row.incurred_on }));
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
