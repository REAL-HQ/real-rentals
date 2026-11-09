import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { EXPENSE_RECEIPT_GAPS_ENABLED, EXPENSE_RECEIPT_GAPS_OFF } from "./expense-receipt-gaps-flag";
import {
  EXPENSE_RECEIPT_GAP_CAP,
  EXPENSE_RECEIPT_GAP_LIMIT,
  MISSING_RECEIPT_PATH_OR,
  MISSING_RECEIPTS_UNREAD,
  formatExpenseAmount,
  receiptOnFile,
  summarizeReceiptGaps,
} from "./expense-receipt-gaps";

export type ExpenseReceiptGapRow = {
  id: string;
  vehicleLabel: string;
  category: string;
  description: string;
  amountText: string;
  incurredOn: string;
};

export type ExpenseReceiptGapsResult =
  | { status: "capped"; reason: string }
  | {
      status: "ready";
      total: number;
      counts: { month: string; category: string; count: number }[];
      rows: ExpenseReceiptGapRow[];
    };

export const listExpenseReceiptGaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        category: z.string().trim().max(40).optional(),
        vehicleId: z.string().uuid().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<ExpenseReceiptGapsResult> => {
    if (!EXPENSE_RECEIPT_GAPS_ENABLED) throw new Error(EXPENSE_RECEIPT_GAPS_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("vehicle_expenses")
      .select("id,vehicle_id,category,description,amount,incurred_on,receipt_path")
      .or(MISSING_RECEIPT_PATH_OR)
      .order("incurred_on", { ascending: false })
      .order("id", { ascending: true })
      .limit(EXPENSE_RECEIPT_GAP_LIMIT + 1);
    if (data.category && data.category !== "all") query = query.eq("category", data.category);
    if (data.vehicleId) query = query.eq("vehicle_id", data.vehicleId);
    if (data.from) query = query.gte("incurred_on", data.from);
    if (data.to) query = query.lt("incurred_on", data.to);
    const { data: loaded, error } = await query;
    if (error) throw new Error(MISSING_RECEIPTS_UNREAD);
    const raw = loaded ?? [];
    const summary = summarizeReceiptGaps(
      raw.map((row) => ({
        category: row.category == null ? null : String(row.category),
        incurredOn: row.incurred_on == null ? null : String(row.incurred_on),
        receiptPath: row.receipt_path == null ? null : String(row.receipt_path),
      })),
    );
    if (summary.capped) return { status: "capped", reason: EXPENSE_RECEIPT_GAP_CAP };
    const gaps = raw.filter((row) => !receiptOnFile(row.receipt_path == null ? null : String(row.receipt_path)));
    const vehicleIds = [...new Set(gaps.map((row) => (row.vehicle_id ? String(row.vehicle_id) : "")).filter(Boolean))];
    const labels = new Map<string, string>();
    for (let index = 0; index < vehicleIds.length; index += 100) {
      const slice = vehicleIds.slice(index, index + 100);
      const vehicles = await supabaseAdmin.from("vehicles").select("id,year,make,model,license_plate").in("id", slice);
      if (vehicles.error) throw new Error(MISSING_RECEIPTS_UNREAD);
      for (const vehicle of vehicles.data ?? []) labels.set(String(vehicle.id), vehicleName(vehicle));
    }
    return {
      status: "ready",
      total: summary.total,
      counts: summary.counts,
      rows: gaps.map((row) => ({
        id: String(row.id),
        vehicleLabel: labels.get(String(row.vehicle_id ?? "")) ?? "Unknown Vehicle",
        category: row.category == null ? "" : String(row.category),
        description: String(row.description ?? "").trim() || "No Description",
        amountText: formatExpenseAmount(row.amount),
        incurredOn: row.incurred_on == null ? "" : String(row.incurred_on),
      })),
    };
  });

function vehicleName(vehicle: {
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  license_plate?: string | null;
}): string {
  const name = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ").trim();
  const plate = vehicle.license_plate ? ` · ${vehicle.license_plate}` : "";
  return (name || "Unknown Vehicle") + plate;
}
