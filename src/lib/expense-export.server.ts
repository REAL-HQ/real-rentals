import { runVehiclePnl, type VehiclePnlDirectory } from "./vehicle-pnl.server";
import { expenseExportCsv, type ExpenseExportResponse } from "./expense-export";
import { VEHICLE_PNL_ENABLED } from "./vehicle-pnl-flag";
import type { StaffTier } from "./roles";

/**
 * The flag is checked again here so a direct call still returns before
 * runVehiclePnl checks the role and before that function reads. The report
 * is the Vehicle Profit report. This module does not calculate revenue.
 */

const DISABLED: ExpenseExportResponse = { status: "disabled", csv: null, truncated: false, month: null };

export async function runExpenseExport(input: {
  enabled: boolean;
  userId: string | null;
  tier: StaffTier | null;
  month: string;
  load: () => Promise<VehiclePnlDirectory | null>;
}): Promise<ExpenseExportResponse> {
  if (!input.enabled || !VEHICLE_PNL_ENABLED) return DISABLED;
  const result = await runVehiclePnl({
    enabled: VEHICLE_PNL_ENABLED,
    userId: input.userId,
    tier: input.tier,
    month: input.month,
    load: input.load,
  });
  if (result.status === "disabled") return DISABLED;
  if (result.status === "unavailable") {
    return { status: "unavailable", reason: result.reason, csv: null, truncated: false, month: null };
  }
  return {
    status: "ready",
    csv: expenseExportCsv(result.report),
    truncated: result.report.truncated,
    month: result.report.month,
  };
}
