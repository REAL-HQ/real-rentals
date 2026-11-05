// Photo Studio — server functions (PR B).
// Off by default. Owner sets the switch and caps; Managers run and review;
// only the Owner can put an approved car's shots on the public website.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager, requireOwner, requireStaff } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import {
  MARKETING_BUCKET, ORIGINALS_BUCKET, PHOTO_STUDIO_KEY, SHOT_SLOTS, carSetStatus, effectiveModel, readStudioSettings,
  type Original, type PhotoClass, type ShotSlot,
} from "@/lib/photo-studio";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;
const today = () => new Date().toISOString().slice(0, 10);

async function loadSettings(sb: any) {
  const { data } = await sb.from("app_settings").select("value").eq("key", PHOTO_STUDIO_KEY).maybeSingle();
  return readStudioSettings(data?.value ?? null);
}

async function usage(sb: any) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const dayStart = `${today()}T00:00:00.000Z`;
  const { data } = await sb.from("photo_studio_spend").select("cost_cents,created_at,outcome").gte("created_at", monthStart);
  let monthCents = 0, todayImages = 0;
  for (const r of (data ?? []) as any[]) {
    monthCents += Number(r.cost_cents) || 0;
    if (r.created_at >= dayStart && r.outcome !== "provider_error") todayImages++;
  }
  return { monthCents, todayImages };
}

export const getPhotoStudioStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const s = await loadSettings(sb);
    const u = await usage(sb);
    return {
      enabled: s.enabled, dailyImageLimit: s.dailyImageLimit, monthlyCapCents: s.monthlyCapCents,
      model: effectiveModel(s, today()), provider: s.provider, usage: u,
      configured: s.provider === "mock" || !!process.env.GEMINI_API_KEY,
      canConfigure: actor.tier === "owner", canPublish: actor.tier === "owner",
    };
  });

export const savePhotoStudioSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    enabled: z.boolean(), dailyImageLimit: z.number().int().min(0).max(500), monthlyCapCents: z.number().int().min(0).max(100000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireOwner(context.userId);
    const sb = await admin();
    const cur = await loadSettings(sb);
    const next = { ...cur, ...data, version: cur.version + 1 };
    const { error } = await sb.from("app_settings").upsert({ key: PHOTO_STUDIO_KEY, value: next as any, updated_at: new Date().toISOString() });
    if (error) return { ok: false as const, error: "Could not save." };
    await logAudit(actor, { action: "settings.photo_studio", summary: `Photo Studio ${data.enabled ? "On" : "Off"}, ${data.dailyImageLimit}/day, $${(data.monthlyCapCents / 100).toFixed(2)}/month`, entityType: "settings", entityId: null as any, metadata: data });
    return { ok: true as const };
  });

/** Generate (or regenerate specific slots of) one car's template set. */
export const generateMarketingShots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid(), slots: z.array(z.enum(SHOT_SLOTS)).max(7).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const sb = await admin();
    const settings = await loadSettings(sb);
    if (!settings.enabled) return { ok: false as const, error: "Photo Studio is off." };
    const { resolveProvider } = await import("@/lib/photo-studio-provider.server");
    const provider = resolveProvider(settings.provider);
    if ("error" in provider) return { ok: false as const, error: provider.error };
    const { runCar } = await import("@/lib/photo-studio-run");

    const { data: car } = await sb.from("vehicles").select("id,year,make,model,color,license_plate,vin").eq("id", data.vehicleId).maybeSingle();
    if (!car) return { ok: false as const, error: "Car not found." };
    const { data: origs } = await (sb.from("vehicle_media") as any).select("id,photo_class,storage_bucket,storage_path,created_at")
      .eq("vehicle_id", data.vehicleId).eq("kind", "original");
    const originals: Original[] = ((origs ?? []) as any[]).map((o) => ({ id: o.id, photoClass: (o.photo_class ?? "unknown") as PhotoClass, createdAt: o.created_at }));
    const byId = new Map(((origs ?? []) as any[]).map((o) => [o.id, o]));
    const model = effectiveModel(settings, today());

    // A regenerated slot replaces its old shot only once the new one passes (saveShot).
    const result = await runCar(
      { id: car.id, year: car.year, make: car.make, model: car.model, color: (car as any).color, plate: car.license_plate, vin: car.vin },
      originals, data.slots ?? null,
      {
        provider, settings, model,
        usage: () => usage(sb),
        loadOriginal: async (id) => {
          const o = byId.get(id); if (!o) return null;
          const { data: f } = await sb.storage.from(o.storage_bucket).download(o.storage_path);
          return f ? { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type || "image/jpeg" } : null;
        },
        saveShot: async (s) => {
          const ext = s.mime.includes("png") ? "png" : s.mime.includes("webp") ? "webp" : "jpg";
          const path = `${data.vehicleId}/studio/${s.slot}-${crypto.randomUUID()}.${ext}`;
          const up = await sb.storage.from(MARKETING_BUCKET).upload(path, s.bytes, { contentType: s.mime });
          if (up.error) throw new Error("upload failed");
          await (sb.from("vehicle_media") as any).update({ studio_review_status: "rejected" })
            .eq("vehicle_id", data.vehicleId).eq("kind", "marketing").eq("shot_slot", s.slot).neq("studio_review_status", "rejected");
          const { error } = await (sb.from("vehicle_media") as any).insert({
            vehicle_id: data.vehicleId, kind: "marketing", storage_bucket: MARKETING_BUCKET, storage_path: path, mime_type: s.mime,
            shot_slot: s.slot, source_media_ids: s.sources, generation_model: `${provider.name}:${model}`,
            enhancement_provider: provider.name, studio_check: s.check, published: false, uploaded_by: actor.userId,
            caption: "AI-generated", sort_order: 100 + SHOT_SLOTS.indexOf(s.slot),
          });
          if (error) { await sb.storage.from(MARKETING_BUCKET).remove([path]); throw new Error("record failed"); }
        },
        logSpend: async (e) => {
          await (sb.from as any)("photo_studio_spend").insert({ vehicle_id: data.vehicleId, shot_slot: e.slot, provider: provider.name, model, cost_cents: e.costCents, outcome: e.outcome, created_by: actor.userId });
        },
      },
    );
    await logAudit(actor, { action: "photo_studio.generate", summary: `Generated marketing shots (${result.outcomes.filter((o) => o.status === "saved").length} saved)`, entityType: "vehicle", entityId: data.vehicleId, metadata: { outcomes: result.outcomes, model } });
    return result;
  });

/** Approve or reject one shot. Approval is per shot; the car is "approved"
 * only when all four exterior slots are approved (carSetStatus). */
export const reviewMarketingShot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mediaId: z.string().uuid(), decision: z.enum(["approved", "rejected"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const sb = await admin();
    const patch = data.decision === "approved"
      ? { studio_review_status: "approved", approved_by: actor.userId, approved_at: new Date().toISOString() }
      : { studio_review_status: "rejected", published: false, approved_by: null, approved_at: null };
    const { data: row, error } = await (sb.from("vehicle_media") as any).update(patch).eq("id", data.mediaId).eq("kind", "marketing").select("vehicle_id").single();
    if (error || !row) return { ok: false as const, error: "Could not update." };
    await sb.rpc("sync_vehicle_photos" as any, { _vehicle_id: row.vehicle_id });
    await logAudit(actor, { action: `photo_studio.${data.decision}`, summary: `Marketing shot ${data.decision}`, entityType: "vehicle", entityId: row.vehicle_id, metadata: { mediaId: data.mediaId } });
    return { ok: true as const };
  });

/** Owner-only: put (or take down) a car's approved shots on the public site. */
export const setCarMarketingPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid(), published: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireOwner(context.userId);
    const sb = await admin();
    const { data: shots } = await (sb.from("vehicle_media") as any).select("id,shot_slot,studio_review_status").eq("vehicle_id", data.vehicleId).eq("kind", "marketing");
    const set = carSetStatus(((shots ?? []) as any[]).map((s) => ({ id: s.id, slot: s.shot_slot as ShotSlot, status: s.studio_review_status })));
    if (data.published && set !== "approved") return { ok: false as const, error: "Approve all four exterior shots (and nothing pending) first." };
    const q = (sb.from("vehicle_media") as any).update({ published: data.published }).eq("vehicle_id", data.vehicleId).eq("kind", "marketing");
    const { error } = data.published ? await q.eq("studio_review_status", "approved") : await q;
    if (error) return { ok: false as const, error: "Could not update." };
    await sb.rpc("sync_vehicle_photos" as any, { _vehicle_id: data.vehicleId });
    await logAudit(actor, { action: "photo_studio.publish", summary: data.published ? "Marketing shots published to website" : "Marketing shots taken off website", entityType: "vehicle", entityId: data.vehicleId, metadata: {} });
    return { ok: true as const };
  });

export { ORIGINALS_BUCKET };
