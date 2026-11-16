import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Staff side of the staff-text bot pause (staff-text-pause.server.ts): read
 * it on a driver profile, end it now ("Resume Bots"), or extend it. Any staff
 * member may do either. Before public.bot_text_pauses exists the read answers
 * "not paused" and the writes explain why.
 */
export type BotTextPauseView = { paused: boolean; until: string | null; since: string | null; source: string | null };

async function leadPhone(admin: any, applicationId: string): Promise<string | null> {
  const r = await admin.from("applications").select("id,phone").eq("id", applicationId).maybeSingle();
  if (r.error) throw new Error("Could Not Read The Application.");
  return r.data?.phone ? String(r.data.phone) : null;
}

export const getBotTextPause = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<BotTextPauseView> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { activeStaffTextPause } = await import("@/lib/staff-text-pause.server");
    const p = await activeStaffTextPause(supabaseAdmin, await leadPhone(supabaseAdmin, data.applicationId));
    if (p === "unavailable" || !p.paused) return { paused: false, until: null, since: null, source: null };
    return { paused: true, until: p.until, since: p.since, source: p.source };
  });

export const updateBotTextPause = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ applicationId: z.string().uuid(), action: z.enum(["clear", "extend"]), hours: z.number().int().min(1).max(14 * 24).optional() }).strict().parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string; until?: string | null }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const m = await import("@/lib/staff-text-pause.server");
    const phone = await leadPhone(supabaseAdmin, data.applicationId);
    if (!phone || !m.phoneKey(phone)) return { ok: false, error: "This Person Has No Phone Number On File." };
    try {
      if (data.action === "clear") await m.clearStaffTextPause(supabaseAdmin, phone, context.userId);
      else {
        const ok = await m.setStaffTextPause(supabaseAdmin, { phone, hours: data.hours ?? m.STAFF_TEXT_PAUSE_DEFAULT_HOURS, reason: "staff_manual", source: "staff", by: context.userId, applicationId: data.applicationId });
        if (!ok) return { ok: false, error: "Could Not Pause The Bots. The Pause Table May Not Be Installed Yet." };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Could Not Update The Pause." };
    }
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit(actor, {
      action: data.action === "clear" ? "application.bot_text_pause_cleared" : "application.bot_text_pause_extended",
      summary: data.action === "clear" ? "Resumed bot outreach (staff-text pause cleared)" : `Paused bot outreach for ${data.hours ?? m.STAFF_TEXT_PAUSE_DEFAULT_HOURS} hours`,
      entityType: "application",
      entityId: data.applicationId,
      metadata: { hours: data.action === "extend" ? data.hours ?? m.STAFF_TEXT_PAUSE_DEFAULT_HOURS : null },
    });
    const p = await m.activeStaffTextPause(supabaseAdmin, phone);
    return { ok: true, until: p !== "unavailable" && p.paused ? p.until : null };
  });
