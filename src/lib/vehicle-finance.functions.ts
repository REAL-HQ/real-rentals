import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager } from "@/lib/roles.server";
import { logAudit, diffFields } from "@/lib/audit.server";

// What a vehicle cost and what is still owed on it.
//
// This lives in its own table for one reason: every signed-in user — Owner,
// Manager, Coordinator, renter, partner — authenticates as the single
// `authenticated` Postgres role, and RLS gates rows, not columns. There is no
// combination of policies or column grants that hides a column on `vehicles`
// from a Coordinator while showing it to a Manager. Separate table, separate
// policy, real denial.
//
// So the boundary is the database's, not this file's. These functions exist to
// give the UI a typed path and to write the audit trail, not to be the thing
// standing between a Coordinator and a payoff figure.

export type VehicleFinance = {
  vehicle_id: string;
  ownership_type: string | null;
  legal_owner: string | null;
  seller_dealer: string | null;
  lienholder: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  loan_reference: string | null;
  payoff_amount: number | null;
  monthly_payment: number | null;
  loan_maturity_date: string | null;
  updated_at: string | null;
};

/** Every field this record holds, in the order the drawer shows them. */
const FIELDS = [
  "ownership_type",
  "legal_owner",
  "seller_dealer",
  "lienholder",
  "purchase_date",
  "purchase_price",
  "loan_reference",
  "payoff_amount",
  "monthly_payment",
  "loan_maturity_date",
] as const;

/**
 * Field names, humanised, for the one-line audit summary.
 *
 * The summary says which figures moved, never what they moved to: the
 * Activity list is skimmed on a shared screen, and a payoff balance does not
 * need to be legible from across the room to make the entry useful.
 */
const LABELS: Record<string, string> = {
  ownership_type: "ownership type",
  legal_owner: "legal owner",
  seller_dealer: "seller/dealer",
  lienholder: "lienholder",
  purchase_date: "purchase date",
  purchase_price: "purchase price",
  loan_reference: "loan reference",
  payoff_amount: "payoff",
  monthly_payment: "monthly payment",
  loan_maturity_date: "loan maturity",
};

const saveInput = z.object({
  vehicle_id: z.string().uuid(),
  ownership_type: z.enum(["owned", "financed", "leased", "partner"]).nullish(),
  legal_owner: z.string().trim().max(120).nullish(),
  seller_dealer: z.string().trim().max(120).nullish(),
  lienholder: z.string().trim().max(120).nullish(),
  purchase_date: z.string().trim().max(10).nullish(),
  purchase_price: z.number().min(0).max(10_000_000).nullish(),
  loan_reference: z.string().trim().max(80).nullish(),
  payoff_amount: z.number().min(0).max(10_000_000).nullish(),
  monthly_payment: z.number().min(0).max(1_000_000).nullish(),
  loan_maturity_date: z.string().trim().max(10).nullish(),
});

/** Empty strings from a form mean "not recorded", not "recorded as blank". */
function blankToNull<T>(v: T | null | undefined): T | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}

export const getVehicleFinance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicle_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<VehicleFinance | null> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("vehicle_finance")
      .select("*")
      .eq("vehicle_id", data.vehicle_id)
      .maybeSingle();

    // No row is the normal state for a car nobody has recorded financing for.
    // The drawer opens empty rather than erroring.
    return (row as VehicleFinance | null) ?? null;
  });

export const saveVehicleFinance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveInput.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("id,unit_number,year,make,model")
      .eq("id", data.vehicle_id)
      .maybeSingle();
    if (!vehicle) return { ok: false, error: "That vehicle no longer exists." };

    const { data: before } = await supabaseAdmin
      .from("vehicle_finance")
      .select("*")
      .eq("vehicle_id", data.vehicle_id)
      .maybeSingle();

    const payload: Record<string, unknown> = { vehicle_id: data.vehicle_id, updated_by: actor.userId };
    for (const k of FIELDS) payload[k] = blankToNull((data as any)[k]);

    const { error } = await supabaseAdmin
      .from("vehicle_finance")
      .upsert(payload as any, { onConflict: "vehicle_id" });

    if (error) {
      console.error("[vehicle-finance] save failed", error.message);
      return { ok: false, error: error.message };
    }

    const changed = diffFields(before as any, payload, [...FIELDS]);
    const changedKeys = Object.keys(changed);
    if (changedKeys.length) {
      const label = vehicle.unit_number || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
      // A loan reference is an account identifier. Knowing it changed is the
      // useful part; copying it into a second, longer-lived table is not.
      const metadata: Record<string, unknown> = { ...changed };
      if ("loan_reference" in metadata) metadata.loan_reference = { changed: true };

      await logAudit(actor, {
        action: before ? "vehicle.finance.updated" : "vehicle.finance.created",
        summary: `${before ? "Updated" : "Recorded"} financing for ${label} — ${changedKeys
          .map((k) => LABELS[k] ?? k)
          .join(", ")}`,
        entityType: "vehicle",
        entityId: data.vehicle_id,
        metadata,
      });
    }

    return { ok: true };
  });

export const deleteVehicleFinance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicle_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: vehicle } = await supabaseAdmin
      .from("vehicles")
      .select("unit_number,year,make,model")
      .eq("id", data.vehicle_id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("vehicle_finance")
      .delete()
      .eq("vehicle_id", data.vehicle_id);
    if (error) return { ok: false, error: error.message };

    await logAudit(actor, {
      action: "vehicle.finance.deleted",
      summary: `Cleared the financing record for ${
        vehicle?.unit_number || `${vehicle?.year ?? ""} ${vehicle?.make ?? ""} ${vehicle?.model ?? ""}`.trim() || "a vehicle"
      }`,
      entityType: "vehicle",
      entityId: data.vehicle_id,
    });

    return { ok: true };
  });
