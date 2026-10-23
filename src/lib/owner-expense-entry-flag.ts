/**
 * Compile-time gate for Owner Expense Entry.
 *
 * false: the admin tab and its save button are omitted, and createOwnerExpense
 * throws before the role check and before any read or write.
 * true: an owner can insert one vehicle_expenses row through the signed-in
 * client. RLS still applies. There is no edit and no delete.
 *
 * No environment variable can open it. Activation is changing this constant
 * and rebuilding. Leave it false until an owner does that.
 */
export const OWNER_EXPENSE_ENTRY_ENABLED = false;
