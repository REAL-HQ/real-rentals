import { netServiceCost } from "./maintenance-rules";
import { MAINTENANCE_COMPANY_SHARE_ENABLED } from "./maintenance-company-share-flag";

/**
 * company_share is the company's portion of a service. partner_share is the
 * JV partner's portion. There is no driver share on maintenance_records.
 * vehicle_pl excludes partner-funded maintenance by summing company_share.
 *
 * The columns are NOT NULL DEFAULT 0 and cost_split defaults to '50_50',
 * but no writer sets either share, so an untouched row is indistinguishable
 * from "the company pays nothing."
 *
 * Proposed rule, used only when MAINTENANCE_COMPANY_SHARE_ENABLED is true
 * for new inserts, and by the unapplied vehicle_pl proposal for rows already
 * stored. Live vehicleProfitability and the live vehicle_pl function do not
 * call this.
 *
 * - A linked expense is the one count, so this amount is 0.
 * - A positive company_share is that share.
 * - company_share 0 with a positive partner_share stays 0 (partner-funded).
 * - company_share 0, partner_share 0, total_cost > 0, and no linked expense:
 *   the net the company paid (total_cost minus warranty and vendor credit,
 *   not below 0). That is the owner decision. It is not applied here.
 */

export type CompanyMaintenanceRow = {
  companyShare: number;
  partnerShare: number;
  totalCost: number;
  warrantyCovered?: number | null;
  vendorCredit?: number | null;
  linkedExpense: boolean;
};

export function proposedCompanyMaintenanceDollars(row: CompanyMaintenanceRow): number {
  if (row.linkedExpense) return 0;
  if (row.companyShare > 0) return row.companyShare;
  if (row.partnerShare > 0) return row.companyShare;
  if (row.companyShare === 0 && row.partnerShare === 0 && row.totalCost > 0) {
    return netServiceCost(row.totalCost, row.warrantyCovered, row.vendorCredit) ?? 0;
  }
  return row.companyShare;
}

/** Columns to add to a maintenance_records insert. Empty while the flag is false, so the stored default is unchanged. */
export function companyShareInsert(
  input: {
    linkedExpense: boolean;
    totalCost: number | null;
    warrantyCovered?: number | null;
    vendorCredit?: number | null;
  },
  enabled: boolean = MAINTENANCE_COMPANY_SHARE_ENABLED,
): { company_share?: number } {
  if (!enabled) return {};
  if (input.linkedExpense) return {};
  const net = netServiceCost(input.totalCost, input.warrantyCovered, input.vendorCredit);
  if (net == null || net <= 0) return {};
  return { company_share: net };
}
