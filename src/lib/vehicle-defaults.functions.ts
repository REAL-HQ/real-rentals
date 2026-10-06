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
