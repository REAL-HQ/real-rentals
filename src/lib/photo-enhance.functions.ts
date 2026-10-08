import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager, requireTier } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";

// Free on-device photo enhancement. Pixels are processed in the operator's
// browser; the server only gates (switch, daily limit), stores the result as an
// unpublished, review-pending ai_enhanced derivative, and records approval.
// No paid provider is called anywhere in this path, so cost is always 0.

export const ENHANCE_MODES = ["enhanced", "studio"] as const;

function dayStartUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
function monthStartUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function usage(admin: any) {
  const [{ count: today }, { data: month }] = await Promise.all([
    admin.from("photo_enhance_events").select("id", { count: "exact", head: true }).neq("status", "failed").gte("created_at", dayStartUtc()),
    admin.from("photo_enhance_events").select("cost_cents").gte("created_at", monthStartUtc()),
  ]);
  const monthCents = ((month as any[]) ?? []).reduce((s, r) => s + (r.cost_cents ?? 0), 0);
  return { today: today ?? 0, monthCents };
}

async function loadSettings(admin: any) {
  const { data } = await admin.from("photo_enhance_settings").select("*").eq("id", true).maybeSingle();
  return data ?? { enabled: false, daily_limit: 20, monthly_paid_cap_cents: 1000 };
}

/** Manager+: what the Photos screen needs to decide whether Enhance is usable. */
export const getPhotoEnhanceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const s = await loadSettings(supabaseAdmin);
    const u = await usage(supabaseAdmin);
    let recent: any[] = [];
    if (actor.tier === "owner") {
      const { data } = await supabaseAdmin
        .from("photo_enhance_events")
        .select("id,vehicle_id,mode,status,error,processing_ms,cost_cents,created_at")
        .order("created_at", { ascending: false })
        .limit(25);
      recent = data ?? [];
    }
    return {
      isOwner: actor.tier === "owner",
      enabled: !!s.enabled,
      dailyLimit: s.daily_limit as number,
      monthlyPaidCapCents: s.monthly_paid_cap_cents as number,
      usedToday: u.today,
      paidThisMonthCents: u.monthCents,
      recent,
    };
  });

export const savePhotoEnhanceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ enabled: z.boolean(), dailyLimit: z.number().int().min(0).max(1000), monthlyPaidCapCents: z.number().int().min(0).max(100000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireTier(context.userId, "owner");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("photo_enhance_settings")
      .update({ enabled: data.enabled, daily_limit: data.dailyLimit, monthly_paid_cap_cents: data.monthlyPaidCapCents, updated_by: actor.userId, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (error) throw new Error(error.message);
    await logAudit(actor, { action: "settings.photo_enhancement", summary: `Photo Enhancement ${data.enabled ? "On" : "Off"}, ${data.dailyLimit}/day`, entityType: "settings", entityId: null as any, metadata: data });
    return { ok: true };
  });

/** Reserve one slot before the browser starts work. Enforces switch + daily limit. */
export const startPhotoEnhance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mediaId: z.string().uuid(), mode: z.enum(ENHANCE_MODES) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const s = await loadSettings(supabaseAdmin);
    if (!s.enabled) return { ok: false, error: "Photo Enhancement is switched off. An Owner can turn it on in Settings → Photo Enhancement." };
    const u = await usage(supabaseAdmin);
    if (u.today >= s.daily_limit) return { ok: false, error: `Daily limit reached (${s.daily_limit} photos). Try again tomorrow.` };
    const { data: src } = await supabaseAdmin.from("vehicle_media").select("id,vehicle_id,kind").eq("id", data.mediaId).maybeSingle();
    if (!src) return { ok: false, error: "That photo is no longer here." };
    if (src.kind !== "original") return { ok: false, error: "Only an original photograph can be enhanced." };
    const { data: ev, error } = await supabaseAdmin
      .from("photo_enhance_events")
      .insert({ vehicle_id: src.vehicle_id, source_media_id: src.id, mode: data.mode, status: "started", actor_id: actor.userId, cost_cents: 0 })
      .select("id")
      .single();
    if (error || !ev) return { ok: false, error: "Could not start enhancement." };
    return { ok: true, eventId: ev.id };
  });

export const failPhotoEnhance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid(), error: z.string().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("photo_enhance_events").update({ status: "failed", error: data.error }).eq("id", data.eventId).eq("status", "started");
    return { ok: true };
  });

/** Browser has uploaded the result to the private bucket; register it as a pending derivative. */
export const completePhotoEnhance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      eventId: z.string().uuid(),
      path: z.string().min(1).max(400),
      sizeBytes: z.number().int().min(1).max(50_000_000),
      processingMs: z.number().int().min(0).max(3_600_000),
      flags: z.array(z.string().max(80)).max(20),
    }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; id?: string; error?: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ev } = await supabaseAdmin.from("photo_enhance_events").select("*").eq("id", data.eventId).maybeSingle();
    if (!ev || ev.status !== "started" || ev.actor_id !== actor.userId) return { ok: false, error: "This enhancement is no longer active." };
    if (!data.path.startsWith(`${ev.vehicle_id}/enhanced-`)) return { ok: false, error: "Unexpected file location." };
    const { data: src } = await supabaseAdmin.from("vehicle_media").select("*").eq("id", ev.source_media_id ?? "").maybeSingle();
    if (!src) return { ok: false, error: "The original photo was deleted." };
    const { data: row, error } = await supabaseAdmin
      .from("vehicle_media")
      .insert({
        vehicle_id: ev.vehicle_id,
        kind: "ai_enhanced",
        provenance: "ai_enhanced",
        storage_bucket: "vehicle-photos",
        storage_path: data.path,
        mime_type: "image/jpeg",
        size_bytes: data.sizeBytes,
        derived_from_id: src.id,
        enhancement_mode: ev.mode === "studio" ? "studio" : "enhanced",
        enhancement_provider: "on-device (BiRefNet Lite, MIT)",
        published: false,
        is_primary: false,
        sort_order: src.sort_order ?? 0,
        uploaded_by: actor.userId,
        review_status: "pending",
        quality_flags: data.flags,
        processing_ms: data.processingMs,
      } as any)
      .select("id")
      .single();
    if (error || !row) {
      await supabaseAdmin.storage.from("vehicle-photos").remove([data.path]);
      await supabaseAdmin.from("photo_enhance_events").update({ status: "failed", error: error?.message ?? "save failed" }).eq("id", ev.id);
      return { ok: false, error: "Could not save the enhanced photo." };
    }
    await supabaseAdmin.from("photo_enhance_events").update({ status: "succeeded", result_media_id: row.id, processing_ms: data.processingMs }).eq("id", ev.id);
    await logAudit(actor, {
      action: "vehicle.photo.enhanced",
      summary: `Created a ${ev.mode} version of a photo — pending review, not published`,
      entityType: "vehicle",
      entityId: ev.vehicle_id,
      metadata: { media_id: row.id, derived_from: src.id, mode: ev.mode, flags: data.flags, cost_cents: 0 },
    });
    return { ok: true, id: row.id };
  });

/** Approve keeps it unpublished (publishing stays a separate step). Reject removes the derivative. */
export const reviewPhotoEnhance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mediaId: z.string().uuid(), decision: z.enum(["approve", "reject"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("vehicle_media").select("*").eq("id", data.mediaId).maybeSingle();
    if (!row || row.kind !== "ai_enhanced") return { ok: false, error: "Only a retouched photo can be reviewed." };
    if (data.decision === "approve") {
      const { error } = await supabaseAdmin
        .from("vehicle_media")
        .update({ review_status: "approved", reviewed_by: actor.userId, reviewed_at: new Date().toISOString() } as any)
        .eq("id", row.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabaseAdmin.from("vehicle_media").delete().eq("id", row.id);
      if (error) return { ok: false, error: error.message };
      await supabaseAdmin.storage.from("vehicle-photos").remove([row.storage_path]);
    }
    await logAudit(actor, {
      action: `vehicle.photo.enhanced_${data.decision === "approve" ? "approved" : "rejected"}`,
      summary: `${data.decision === "approve" ? "Approved" : "Rejected"} a retouched photo`,
      entityType: "vehicle",
      entityId: row.vehicle_id,
      metadata: { media_id: row.id, flags: (row as any).quality_flags },
    });
    return { ok: true };
  });
