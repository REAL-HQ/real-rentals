import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff } from "@/lib/roles.server";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;
async function requireOwnerActor(userId: string) {
  const actor = await requireStaff(userId);
  const { ownerView } = await import("@/lib/experience.server");
  if (!ownerView(actor)) throw new Error("Only the Owner can manage Safe Autofill.");
  return actor;
}

export const getAutofillStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireOwnerActor(context.userId);
    const sb = await admin();
    const m = await import("@/lib/safe-autofill.server");
    const settings = await m.loadAutofillSettings(sb);
    const usedToday = await m.autofillUsedToday(sb);
    const { data: events } = await sb.from("vehicle_autofill_events")
      .select("id,vehicle_id,field,previous_value,new_value,page,batch_id,doc_class,evidence_raw,confidence,created_at,undone_at,undo_result,vehicles(unit_number)")
      .order("created_at", { ascending: false }).limit(50);
    return { settings, usedToday, events: events ?? [] };
  });

export const saveAutofillSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean(), dailyCap: z.number().int().min(1).max(500), clearPause: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireOwnerActor(context.userId);
    const sb = await admin();
    const m = await import("@/lib/safe-autofill.server");
    const cur = await m.loadAutofillSettings(sb);
    const next = { enabled: data.enabled, daily_cap: data.dailyCap, paused_reason: data.clearPause ? null : cur.paused_reason ?? null, paused_at: data.clearPause ? null : cur.paused_at ?? null };
    await m.saveAutofillSettings(sb, next);
    const { logAudit } = await import("@/lib/audit");
    await logAudit(actor, { action: "settings.safe_autofill_updated", summary: `Safe Autofill ${next.enabled ? "On" : "Off"}, cap ${next.daily_cap}/day`, entityType: "app_settings", entityId: "safe_autofill", metadata: { from: cur, to: next } });
    return next;
  });

export const undoAutofillFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid().optional(), batchId: z.string().uuid().optional() }).refine((x) => !!x.vehicleId !== !!x.batchId, "Choose one vehicle or one batch").parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireOwnerActor(context.userId);
    const sb = await admin();
    return (await import("@/lib/safe-autofill.server")).undoAutofill(sb, actor as any, data);
  });
