/**
 * What expense data exists on this base, cited so the dark line can be
 * checked against the live tables. These are reads of today's code.
 * Nothing here is a new table, and none of these files are modified.
 */
export const EXPENSE_SOURCES = [
  {
    file: "supabase/migrations/20260615002324_32273bb7-22b6-46b9-9b48-775a185053fa.sql",
    line: 276,
    needle: "CREATE TABLE IF NOT EXISTS public.maintenance_records",
    note: "Service events. total_cost and company_share live on this row.",
  },
  {
    file: "supabase/migrations/20260615002324_32273bb7-22b6-46b9-9b48-775a185053fa.sql",
    line: 287,
    needle: "total_cost numeric NOT NULL DEFAULT 0",
    note: "Invoice total on the service event.",
  },
  {
    file: "supabase/migrations/20260615002324_32273bb7-22b6-46b9-9b48-775a185053fa.sql",
    line: 290,
    needle: "company_share numeric NOT NULL DEFAULT 0",
    note: "Company share. A present 0 is a real share, not a blank.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 20,
    needle: "CREATE TABLE IF NOT EXISTS public.vehicle_expenses",
    note: "The live expense ledger, one row per cost, optional receipt.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 26,
    needle: "vendor_id uuid REFERENCES public.vendors(id)",
    note: "Vendor is a vendors row, not free text.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 28,
    needle: "category text NOT NULL CHECK (category IN (",
    note: "Live categories include maintenance, insurance, registration, cleaning, tolls, and other, plus repair, tires, fuel, towing, parking, finance, purchase, and gps.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 45,
    needle: "amount numeric(10,2) NOT NULL CHECK (amount >= 0)",
    note: "Amount in dollars.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 46,
    needle: "incurred_on date NOT NULL DEFAULT CURRENT_DATE",
    note: "The expense date.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 51,
    needle: "receipt_path text",
    note: "Optional receipt object path.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 77,
    needle: "CREATE POLICY \"Managers manage vehicle expenses\"",
    note: "Managers, which includes Owner, can read and write the live ledger.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 83,
    needle: "CREATE POLICY \"Partners read expenses on their vehicles\"",
    note: "Partners can read costs on cars they own. The proposed entry table does not copy that grant.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 107,
    needle: "VALUES ('receipts', 'receipts', false)",
    note: "Receipt files live in the private receipts bucket.",
  },
  {
    file: "supabase/migrations/20260925161000_vehicle_expenses.sql",
    line: 159,
    needle: "COALESCE(sum(COALESCE(m.company_share, m.total_cost, 0)), 0) AS amt",
    note: "vehicle_pl adds this maintenance sum on top of every vehicle_expenses row.",
  },
  {
    file: "supabase/migrations/20261006020456_cf3a2cce-fa6e-4f72-85b9-c95c5d634bb4.sql",
    line: 65,
    needle: "exp AS (SELECT e.vehicle_id, COALESCE(sum(e.amount), 0) AS amt FROM public.vehicle_expenses e",
    note: "The current vehicle_pl still sums every expense.",
  },
  {
    file: "supabase/migrations/20261006020456_cf3a2cce-fa6e-4f72-85b9-c95c5d634bb4.sql",
    line: 66,
    needle: "maint AS (SELECT m.vehicle_id, COALESCE(sum(COALESCE(m.company_share, m.total_cost, 0)), 0) AS amt FROM public.maintenance_records m",
    note: "And still adds company_share, otherwise total_cost, including rows that already have a linked expense.",
  },
  {
    file: "supabase/migrations/20261006110204_b5c6296a-2396-4e8e-9be8-0e6eea261153.sql",
    line: 109,
    needle: "ALTER TABLE public.vehicle_expenses ADD COLUMN IF NOT EXISTS maintenance_record_id",
    note: "An expense may point at the service event it came from.",
  },
  {
    file: "supabase/migrations/20261006110204_b5c6296a-2396-4e8e-9be8-0e6eea261153.sql",
    line: 110,
    needle: "CREATE UNIQUE INDEX IF NOT EXISTS vehicle_expenses_maint_uidx",
    note: "At most one expense row per service event.",
  },
  {
    file: "src/lib/maintenance.server.ts",
    line: 116,
    needle: "await sb.from(\"vehicle_expenses\").insert({",
    note: "Recording a completed service inserts one maintenance expense for the net paid. This write path is unchanged.",
  },
  {
    file: "src/lib/maintenance.functions.ts",
    line: 250,
    needle: "if (exp) await sb.from(\"vehicle_expenses\").update({ amount: net }).eq(\"id\", exp.id);",
    note: "A cost correction updates that same linked expense. This write path is unchanged.",
  },
  {
    file: "src/lib/maintenance-rules.ts",
    line: 149,
    needle: "export function netServiceCost",
    note: "Net paid is total_cost minus warranty and vendor credit. That net is what the linked expense stores.",
  },
  {
    file: "src/lib/expenses.functions.ts",
    line: 14,
    needle: "export const EXPENSE_CATEGORIES",
    note: "The live Expenses screen already enters the wider category list.",
  },
  {
    file: "src/lib/expenses.functions.ts",
    line: 155,
    needle: ".insert({",
    note: "createExpense writes vehicle_expenses through the service role. This write path is unchanged.",
  },
  {
    file: "src/lib/expenses.functions.ts",
    line: 316,
    needle: "supabaseAdmin.rpc(\"vehicle_pl\"",
    note: "The live P&L screen calls vehicle_pl, which still adds expenses and maintenance together.",
  },
  {
    file: "src/components/admin/ExpensesPanel.tsx",
    line: 470,
    needle: ".from(\"receipts\")",
    note: "The live screen uploads an optional receipt into the private receipts bucket.",
  },
  {
    file: "src/lib/unified-finance-vehicles.ts",
    line: 113,
    needle: "for (const expense of input.expenses)",
    note: "Unified Finance adds every vehicle_expenses amount.",
  },
  {
    file: "src/lib/unified-finance-vehicles.ts",
    line: 117,
    needle: "const amount = record.companyShare !== null && record.companyShare !== undefined ? record.companyShare : record.totalCost;",
    note: "And then adds company share, otherwise total cost, with no link check.",
  },
  {
    file: "src/integrations/supabase/types.ts",
    line: 5069,
    needle: "vehicle_expenses: {",
    note: "Generated row: amount, category, incurred_on, vendor_id, receipt_path, maintenance_record_id.",
  },
] as const;
