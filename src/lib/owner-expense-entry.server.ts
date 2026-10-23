import { tierAllows, tierFromRoles } from "./roles";
import { ownerExpenseInsert, type OwnerExpenseDraft, type OwnerExpenseInsert } from "./owner-expense-entry";

/**
 * Owners only, and only while the flag is on. The flag throws before the role
 * check and before the vehicle read or the insert. The insert is whatever
 * client the caller passes — the server function passes the signed-in client,
 * so RLS applies. No update, no delete, and no audit_log write: authenticated
 * has no INSERT grant on audit_log.
 */

export async function runCreateOwnerExpense(input: {
  enabled: boolean;
  userId: string | null;
  roles: string[];
  draft: OwnerExpenseDraft;
  vehicleExists: (vehicleId: string) => Promise<boolean>;
  vendorExists?: (vendorId: string) => Promise<boolean>;
  insert: (row: OwnerExpenseInsert) => Promise<{ id: string }>;
}): Promise<{ id: string }> {
  if (!input.enabled) throw new Error("Owner expense entry is off");
  if (!input.userId || !tierAllows(tierFromRoles(input.roles), "owner")) throw new Error("Forbidden");
  const row = ownerExpenseInsert(input.draft, input.userId);
  if (!(await input.vehicleExists(row.vehicle_id))) throw new Error("Vehicle was not found");
  if (row.vendor_id && input.vendorExists && !(await input.vendorExists(row.vendor_id))) throw new Error("Vendor was not found");
  return input.insert(row);
}
