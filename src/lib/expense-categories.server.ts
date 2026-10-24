import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { tierAllows, type StaffTier } from "./roles";
import {
  buildExpenseCategorySummary,
  type ExpenseCategoriesResponse,
  type ExpenseCategoryRow,
  type ExpensePeriod,
} from "./expense-categories";

export type { ExpenseCategoriesResponse };

/**
 * Managers and owners. The flag is checked before the role and before any
 * table read. The loader only selects vehicle_expenses. It does not read
 * maintenance company share and it does not write.
 */

const PAGE = 1000;
const DISABLED = { status: "disabled" as const, summary: null };

type Result<T> = { data: T[] | null; error: { message: string } | null };
type ExpenseRecord = {
  id: string;
  vehicle_id: string;
  category: string;
  amount: number;
  incurred_on: string;
};

export async function runExpenseCategories(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  period: ExpensePeriod;
  now?: Date;
  load: () => Promise<ExpenseCategoryRow[] | null>;
}): Promise<ExpenseCategoriesResponse> {
  if (!input.enabled) return DISABLED;
  if (!input.userId || !tierAllows(input.tier, "manager")) throw new Error("Forbidden");
  const rows = await input.load();
  if (!rows) {
    return {
      status: "unavailable",
      reason: "Expense records were incomplete",
      summary: null,
    };
  }
  const summary = buildExpenseCategorySummary({
    expenses: rows,
    period: input.period,
    now: input.now ?? new Date(),
  });
  return summary
    ? { status: "ready", summary }
    : { status: "unavailable", reason: "The period could not be dated", summary: null };
}

export async function loadExpenseCategories(
  supabase: SupabaseClient<Database>,
  signal?: AbortSignal,
): Promise<ExpenseCategoryRow[] | null> {
  const rows = await readStable(async (cursor) => {
    let query = supabase
      .from("vehicle_expenses")
      .select("id,vehicle_id,category,amount,incurred_on")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) query = query.gt("id", cursor);
    if (signal) query = query.abortSignal(signal);
    return query;
  }, signal);
  if (!rows) return null;
  return rows.map((row) => ({
    id: row.id,
    vehicleId: row.vehicle_id,
    category: row.category,
    amount: row.amount,
    incurredOn: row.incurred_on,
  }));
}

async function readStable(
  load: (cursor: string | null) => PromiseLike<Result<ExpenseRecord>>,
  signal?: AbortSignal,
): Promise<ExpenseRecord[] | null> {
  async function scan(): Promise<ExpenseRecord[] | null> {
    const rows: ExpenseRecord[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      signal?.throwIfAborted();
      const response = await load(cursor);
      if (response.error || !Array.isArray(response.data) || response.data.length > PAGE)
        return null;
      for (const row of response.data) {
        if (typeof row.id !== "string" || !row.id || (cursor !== null && row.id <= cursor))
          return null;
        cursor = row.id;
        rows.push(row);
      }
      if (response.data.length < PAGE) return rows;
    }
    return null;
  }
  const first = await scan();
  const second = await scan();
  if (!first || !second || JSON.stringify(first) !== JSON.stringify(second)) return null;
  return first;
}
