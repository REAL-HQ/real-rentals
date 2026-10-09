import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAudit } from "@/lib/audit";
import { DEFAULT_FIELDS, type VehicleDefault } from "@/lib/vehicle-defaults";

// Owner edits company defaults; every staff tier may read them (Managers and
// Coordinators use them while adding vehicles). Writes go only through these
// functions — the table grants the browser SELECT and nothing else.

const money = z.number().min(0).max(400000).nullable();
const bodyType = z.string().trim().toLowerCase().regex(/^[a-z_]{2,30}$/);

export const listVehicleDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ defaults: VehicleDefault[]; canEdit: boolean }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("vehicle_defaults" as any).select("body_type,weekly_rate,monthly_rate,deposit").order("body_type");
    return {
      defaults: ((data ?? []) as any[]).map((r) => ({
        body_type: r.body_type,
        weekly_rate: r.weekly_rate == null ? null : Number(r.weekly_rate),
        monthly_rate: r.monthly_rate == null ? null : Number(r.monthly_rate),
        deposit: r.deposit == null ? null : Number(r.deposit),
      })),
      canEdit: actor.tier === "owner",
    };
  });

export const saveVehicleDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ body_type: bodyType, weekly_rate: money, monthly_rate: money, deposit: money }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("vehicle_defaults" as any).select("*").eq("body_type", data.body_type).maybeSingle();
    const { error } = await supabaseAdmin.from("vehicle_defaults" as any).upsert({ ...data, updated_by: actor.userId } as any, { onConflict: "body_type" });
    if (error) throw new Error("Could not save the vehicle default.");
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of DEFAULT_FIELDS) {
      const prev = (before as any)?.[f] == null ? null : Number((before as any)[f]);
      if (prev !== data[f]) changed[f] = { from: prev, to: data[f] };
    }
    await logAudit(actor, {
      action: before ? "vehicle_default.updated" : "vehicle_default.created",
      summary: `${before ? "Changed" : "Created"} ${data.body_type} vehicle default`,
      entityType: "vehicle_default", entityId: null,
      metadata: { body_type: data.body_type, changed },
    });
    return { ok: true as const };
  });

export const deleteVehicleDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ body_type: bodyType }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("vehicle_defaults" as any).delete().eq("body_type", data.body_type).select("*").maybeSingle();
    if (before) await logAudit(actor, {
      action: "vehicle_default.deleted", summary: `Deleted ${data.body_type} vehicle default`,
      entityType: "vehicle_default", entityId: null, metadata: { body_type: data.body_type, previous: before },
    });
    return { ok: true as const };
  });

// ---- Apply Template to an existing vehicle (Manager+) ----
const fieldEnum = z.enum(DEFAULT_FIELDS);

async function loadPlan(vehicleId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: v } = await supabaseAdmin.from("vehicles").select("id,unit_number,body_type,weekly_rate,monthly_rate,deposit").eq("id", vehicleId).maybeSingle();
  if (!v) throw new Error("Vehicle not found.");
  const { loadDefaultFor } = await import("@/lib/vehicle-defaults.server");
  const def = await loadDefaultFor((v as any).body_type);
  const { planApplyTemplate } = await import("@/lib/vehicle-defaults");
  return { v: v as any, def, plan: planApplyTemplate(v as any, def) };
}

export const previewApplyTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { v, def, plan } = await loadPlan(data.vehicleId);
    return { bodyType: (v.body_type as string | null) ?? null, hasTemplate: !!def, plan };
  });

export const applyVehicleTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    vehicleId: z.string().uuid(),
    fields: z.array(fieldEnum).min(1),
    // The plan the user confirmed; refused if the car or template changed since.
    expected: z.array(z.object({ field: fieldEnum, current: z.number().nullable(), proposed: z.number().nullable() })),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { v, def, plan } = await loadPlan(data.vehicleId);
    if (!def) return { ok: false as const, error: "No pricing template matches this vehicle's body type." };
    for (const e of data.expected) {
      const r = plan.find((p) => p.field === e.field)!;
      if (r.current !== e.current || r.proposed !== e.proposed) return { ok: false as const, error: "Rates changed since you opened this. Review again." };
    }
    const { fieldsToApply } = await import("@/lib/vehicle-defaults");
    const rows = fieldsToApply(plan, data.fields);
    if (!rows.length) return { ok: false as const, error: "Nothing to change." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q: any = supabaseAdmin.from("vehicles").update(Object.fromEntries(rows.map((r) => [r.field, r.proposed])) as any).eq("id", v.id);
    // Conditional write: only if each touched field still holds the value the user saw.
    for (const r of rows) q = r.current == null ? q.is(r.field, null) : q.eq(r.field, r.current);
    const { data: upd, error } = await q.select("id");
    if (error) throw new Error("Could not apply the template.");
    if (!upd?.length) return { ok: false as const, error: "Rates changed since you opened this. Review again." };
    await logAudit(actor, {
      action: "vehicle.pricing_template_applied",
      summary: `Applied ${v.body_type} pricing template to ${v.unit_number ?? "vehicle"}`,
      entityType: "vehicle", entityId: v.id,
      metadata: { body_type: v.body_type, changes: rows.map((r) => ({ field: r.field, from: r.current, to: r.proposed })) },
    });
    return { ok: true as const, applied: rows.length };
  });
