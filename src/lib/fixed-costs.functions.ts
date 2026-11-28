import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { FIXED_COSTS_ENABLED } from "./fixed-costs-flag";
import {
  buildFixedCosts,
  FIXED_COST_FREQUENCIES,
  FIXED_COST_KINDS,
  fixedCostInputError,
  type FixedCostItem,
  type FixedCostRental,
  type FixedCostsReport,
  type FixedCostVehicle,
} from "./fixed-costs";

/**
 * Fixed Costs (Accounting, Owner only). Every call checks the owner tier on
 * the server; RLS on fixed_cost_items is owner-only as well. Reads vehicles,
 * active rentals and renter names live, so new cars and renters show up at
 * once. Writes touch only fixed_cost_items and are audit logged.
 */

export type FixedCostsResponse =
  | { status: "disabled"; report: null }
  | { status: "setup_needed"; report: FixedCostsReport }
  | { status: "ok"; report: FixedCostsReport };

const FETCH_LIMIT = 2000;

/** PostgREST / Postgres "relation does not exist" (migration not applied yet). */
export function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /fixed_cost_items/.test(String(error.message ?? "")) && /(does not exist|could not find)/i.test(String(error.message ?? ""));
}

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const getFixedCosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FixedCostsResponse> => {
    if (!FIXED_COSTS_ENABLED) return { status: "disabled", report: null };
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // fixed_cost_items is new (migration 20261128170000); typed loosely until generated types include it.
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };

    const [vehiclesQ, rentalsQ, itemsQ] = await Promise.all([
      supabaseAdmin.from("vehicles").select("id,year,make,model,license_plate,vin,status,archived_at").limit(FETCH_LIMIT),
      supabaseAdmin.from("rentals").select("id,vehicle_id,status,application_id").eq("status", "active").limit(FETCH_LIMIT),
      admin.from("fixed_cost_items").select("id,kind,scope,vehicle_id,rental_id,label,provider,amount,frequency,next_due_on,active,notes").eq("active", true).limit(FETCH_LIMIT),
    ]);
    if (vehiclesQ.error) throw new Error(vehiclesQ.error.message);
    if (rentalsQ.error) throw new Error(rentalsQ.error.message);
    const setupNeeded = isMissingTable(itemsQ.error);
    if (itemsQ.error && !setupNeeded) throw new Error(itemsQ.error.message);
    const items = (setupNeeded ? [] : (itemsQ.data ?? [])) as FixedCostItem[];

    // Rentals referenced by cost lines (an ended rental whose policy still bills).
    const extraRentalIds = [...new Set(items.map((i) => i.rental_id).filter((id): id is string => !!id))]
      .filter((id) => !(rentalsQ.data ?? []).some((r) => r.id === id));
    const extraQ = extraRentalIds.length
      ? await supabaseAdmin.from("rentals").select("id,vehicle_id,status,application_id").in("id", extraRentalIds.slice(0, 500))
      : { data: [], error: null };
    if (extraQ.error) throw new Error(extraQ.error.message);
    const allRentals = [...(rentalsQ.data ?? []), ...(extraQ.data ?? [])];

    const appIds = [...new Set(allRentals.map((r) => r.application_id).filter((id): id is string => !!id))];
    const names = new Map<string, string | null>();
    for (let i = 0; i < appIds.length; i += 200) {
      const q = await supabaseAdmin.from("applications").select("id,full_name").in("id", appIds.slice(i, i + 200));
      if (q.error) throw new Error(q.error.message);
      for (const a of q.data ?? []) names.set(a.id, a.full_name);
    }
    const rentals: FixedCostRental[] = allRentals.map((r) => ({
      id: r.id,
      vehicle_id: r.vehicle_id,
      status: r.status,
      renter: r.application_id ? names.get(r.application_id) ?? null : null,
    }));
    const report = buildFixedCosts({
      today: easternToday(),
      vehicles: (vehiclesQ.data ?? []) as FixedCostVehicle[],
      rentals,
      items: items.map((i) => ({ ...i, amount: Number(i.amount) })),
    });
    return setupNeeded ? { status: "setup_needed", report } : { status: "ok", report };
  });

const saveSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  kind: z.enum(FIXED_COST_KINDS as unknown as ["insurance", "gps"]),
  scope: z.enum(["vehicle", "rental", "fleet", "default"]),
  vehicleId: z.string().uuid().nullable().optional(),
  rentalId: z.string().uuid().nullable().optional(),
  label: z.string().trim().max(80).nullable().optional(),
  provider: z.string().trim().max(120).nullable().optional(),
  amount: z.number().min(0).max(100000),
  frequency: z.enum(FIXED_COST_FREQUENCIES as unknown as ["weekly", "monthly", "quarterly", "semiannual", "annual"]),
  nextDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const saveFixedCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    if (!FIXED_COSTS_ENABLED) throw new Error("Fixed Costs is off");
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const problem = fixedCostInputError({
      kind: data.kind,
      scope: data.scope,
      vehicleId: data.vehicleId ?? null,
      rentalId: data.rentalId ?? null,
      amount: data.amount,
      frequency: data.frequency,
    });
    if (problem) throw new Error(problem);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
    const row = {
      kind: data.kind,
      scope: data.scope,
      vehicle_id: data.scope === "fleet" || data.scope === "default" ? null : data.vehicleId ?? null,
      rental_id: data.scope === "rental" ? data.rentalId ?? null : null,
      label: blank(data.label),
      provider: blank(data.provider),
      amount: Math.round(data.amount * 100) / 100,
      frequency: data.frequency,
      next_due_on: data.nextDueOn ?? null,
      notes: blank(data.notes),
      updated_by: context.userId,
    };
    let id = data.id ?? null;
    if (id) {
      const q = await admin.from("fixed_cost_items").update(row).eq("id", id).eq("active", true).select("id").maybeSingle();
      if (q.error) throw new Error(isMissingTable(q.error) ? "Setup Needed" : q.error.message);
      if (!q.data) throw new Error("Cost Not Found");
    } else {
      const q = await admin.from("fixed_cost_items").insert({ ...row, created_by: context.userId }).select("id").single();
      if (q.error) {
        if (isMissingTable(q.error)) throw new Error("Setup Needed");
        if (q.error.code === "23505") throw new Error("A Cost Is Already Set Here");
        throw new Error(q.error.message);
      }
      id = q.data.id as string;
    }
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: data.id ? "fixed_cost.updated" : "fixed_cost.created",
      summary: `${data.id ? "Updated" : "Added"} ${data.kind} fixed cost (${data.scope}) ${row.amount} ${data.frequency}`,
      entityType: "fixed_cost_item",
      entityId: id,
      metadata: { kind: data.kind, scope: data.scope, vehicle_id: row.vehicle_id, rental_id: row.rental_id, amount: row.amount, frequency: data.frequency },
    });
    return { id: id as string };
  });

export const endFixedCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    if (!FIXED_COSTS_ENABLED) throw new Error("Fixed Costs is off");
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };
    const today = easternToday();
    const q = await admin.from("fixed_cost_items").update({ active: false, ended_on: today, updated_by: context.userId }).eq("id", data.id).eq("active", true).select("id,kind,scope").maybeSingle();
    if (q.error) throw new Error(isMissingTable(q.error) ? "Setup Needed" : q.error.message);
    if (!q.data) throw new Error("Cost Not Found");
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: "fixed_cost.ended",
      summary: `Ended ${q.data.kind} fixed cost (${q.data.scope})`,
      entityType: "fixed_cost_item",
      entityId: data.id,
      metadata: { ended_on: today },
    });
    return { ok: true };
  });
