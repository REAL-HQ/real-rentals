import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OWNER_EXPENSE_ENTRY_ENABLED } from "./owner-expense-entry-flag";
import { tierAllows, tierFromRoles } from "./roles";
import type { OwnerExpenseDraft } from "./owner-expense-entry";

/**
 * Owner expense entry. While OWNER_EXPENSE_ENTRY_ENABLED is false every
 * handler throws before the role lookup and before any table read or insert.
 * The signed-in client is the only database client. No service role.
 */

export const listOwnerExpenseChoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(async ({ context }): Promise<{ vehicles: { id: string; label: string }[]; vendors: { id: string; name: string }[] }> => {
    if (!OWNER_EXPENSE_ENTRY_ENABLED) throw new Error("Owner expense entry is off");
    const { data: roleRows, error: roleError } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (roleError || !tierAllows(tierFromRoles((roleRows ?? []).map((row) => String(row.role))), "owner")) throw new Error("Forbidden");
    const [vehicles, vendors] = await Promise.all([
      context.supabase.from("vehicles").select("id,year,make,model,license_plate").order("make", { ascending: true }).limit(1000),
      context.supabase.from("vendors").select("id,name").order("name", { ascending: true }).limit(1000),
    ]);
    if (vehicles.error || vendors.error) throw new Error(vehicles.error?.message ?? vendors.error?.message ?? "Could not load expenses");
    return {
      vehicles: (vehicles.data ?? []).map((vehicle) => ({
        id: vehicle.id,
        label: [vehicle.year, vehicle.make, vehicle.model, vehicle.license_plate].filter((part) => part !== null && String(part).trim() !== "").join(" "),
      })),
      vendors: (vendors.data ?? []).map((vendor) => ({ id: vendor.id, name: vendor.name })),
    };
  });

export const createOwnerExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    if (!OWNER_EXPENSE_ENTRY_ENABLED) throw new Error("Owner expense entry is off");
    const { data: roleRows, error: roleError } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (roleError) throw new Error("Forbidden");
    const { runCreateOwnerExpense } = await import("./owner-expense-entry.server");
    return runCreateOwnerExpense({
      enabled: true,
      userId: context.userId,
      roles: (roleRows ?? []).map((row) => String(row.role)),
      draft: (data ?? {}) as OwnerExpenseDraft,
      vehicleExists: async (vehicleId) => {
        const found = await context.supabase.from("vehicles").select("id").eq("id", vehicleId).maybeSingle();
        if (found.error) throw new Error(found.error.message);
        return !!found.data;
      },
      vendorExists: async (vendorId) => {
        const found = await context.supabase.from("vendors").select("id").eq("id", vendorId).maybeSingle();
        if (found.error) throw new Error(found.error.message);
        return !!found.data;
      },
      insert: async (row) => {
        const inserted = await context.supabase.from("vehicle_expenses").insert(row).select("id").single();
        if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "Could not save the expense.");
        return { id: inserted.data.id };
      },
    });
  });
