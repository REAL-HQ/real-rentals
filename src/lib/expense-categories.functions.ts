import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { FINANCE_EXPENSE_CATEGORIES_ENABLED } from "./expense-categories-flag";
import type { ExpenseCategoriesResponse } from "./expense-categories";

const inputSchema = z.object({
  period: z.enum(["this_month", "last_month", "last_90"]).optional(),
});

const DISABLED: ExpenseCategoriesResponse = { status: "disabled", summary: null };

/** Read-only. The flag returns before the role check and before any table read. */
export const getExpenseCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const parsed = inputSchema.safeParse(data ?? {});
    if (!parsed.success) throw new Error("Invalid period");
    return { period: parsed.data.period ?? "this_month" };
  })
  .handler(async ({ data, context }): Promise<ExpenseCategoriesResponse> => {
    if (!FINANCE_EXPENSE_CATEGORIES_ENABLED) return DISABLED;
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadExpenseCategories, runExpenseCategories } = await import(
      "./expense-categories.server"
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runExpenseCategories({
      enabled: FINANCE_EXPENSE_CATEGORIES_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      period: data.period,
      load: () => loadExpenseCategories(supabaseAdmin),
    });
  });
