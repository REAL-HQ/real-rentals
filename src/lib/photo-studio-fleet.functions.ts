// Run the fleet through Photo Studio one car at a time, then let the Owner
// approve and publish sets that already passed the identity check.
// Generation still stops at the daily limit and the monthly cap. Publish still
// goes through publishApprovedMarketing, so the marketing trigger stays in force.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager, requireOwner, requireStaff } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import {
  PHOTO_STUDIO_GENERATIONS_PER_SHOT, PHOTO_STUDIO_KEY, effectiveModel, planShots, readStudioSettings, spendRefusal,
  type Original, type PhotoClass, type ShotSlot,
} from "@/lib/photo-studio";
import { isUnlabeledClass } from "@/lib/photo-class-label";
import { carReadyToPublish, fleetProgress, type FleetCarInput, type FleetShot, type StudioLabelCounts } from "@/lib/photo-studio-fleet";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;
const today = () => new Date().toISOString().slice(0, 10);

async function budget(sb: any) {
  const { data } = await sb.from("app_settings").select("value").eq("key", PHOTO_STUDIO_KEY).maybeSingle();
  const settings = readStudioSettings(data?.value ?? null);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const dayStart = `${today()}T00:00:00.000Z`;
  const { data: spend } = await sb.from("photo_studio_spend").select("cost_cents,created_at,outcome").gte("created_at", monthStart);
  let monthCents = 0, todayImages = 0;
  for (const r of (spend ?? []) as any[]) {
    monthCents += Number(r.cost_cents) || 0;
    if (r.created_at >= dayStart && r.outcome !== "provider_error") todayImages++;
  }
  const model = effectiveModel(settings, today());
  const refusal = spendRefusal(settings, { todayImages, monthCents }, PHOTO_STUDIO_GENERATIONS_PER_SHOT, model);
  return { settings, refusal, dailyBlocked: !!refusal && /daily/i.test(refusal) };
}

async function loadCars(sb: any): Promise<FleetCarInput[]> {
  const { data: vehicles } = await sb.from("vehicles")
    .select("id,unit_number,year,make,model,status,archived_at")
    .order("unit_number", { ascending: true });
  const ids = ((vehicles ?? []) as any[]).map((v) => v.id as string);
  if (!ids.length) return [];
  const { data: media } = await (sb.from("vehicle_media") as any)
    .select("vehicle_id,kind,photo_class,shot_slot,studio_review_status,studio_check,published")
    .in("vehicle_id", ids).in("kind", ["original", "marketing"]);
  const byCar = new Map<string, any[]>();
  for (const row of (media ?? []) as any[]) {
    const list = byCar.get(row.vehicle_id) ?? [];
    list.push(row);
    byCar.set(row.vehicle_id, list);
  }
  return ((vehicles ?? []) as any[]).map((v) => {
    const rows = byCar.get(v.id) ?? [];
    const shots: FleetShot[] = rows.filter((r: any) => r.kind === "marketing").map((r: any) => ({
      slot: r.shot_slot ?? null,
      status: r.studio_review_status ?? null,
      published: !!r.published,
      check: r.studio_check ?? null,
    }));
    return {
      id: v.id as string,
      unitNumber: v.unit_number ?? null,
      year: v.year ?? null,
      make: v.make ?? null,
      model: v.model ?? null,
      status: v.status ?? null,
      archivedAt: v.archived_at ?? null,
      originals: rows.filter((r: any) => r.kind === "original").map((r: any) => ({ photoClass: r.photo_class ?? null })),
      shots,
    };
  });
}

export const getStudioFleetProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const { dailyBlocked, settings } = await budget(sb);
    const rows = fleetProgress(await loadCars(sb), dailyBlocked);
    return {
      rows,
      dailyBlocked,
      enabled: settings.enabled,
      canRun: actor.tier === "manager" || actor.tier === "owner",
      canPublish: actor.tier === "owner",
    };
  });

function stopOutcome(reason: string) {
  if (/monthly/i.test(reason)) return "monthly_cap" as const;
  if (/daily/i.test(reason)) return "continues_tomorrow" as const;
  return null;
}

function freshLabels(): StudioLabelCounts {
  return { labeled: 0, lowConfidence: 0, failed: 0 };
}

/** One car: label unlabeled originals, then generate the shots that are still missing. */
export const runStudioNextCar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ skipIds: z.array(z.string().uuid()).max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const sb = await admin();
    const { settings, refusal } = await budget(sb);
    if (!settings.enabled) return { ok: false as const, outcome: "studio_off" as const, error: "Photo Studio is off.", labels: freshLabels() };
    const skip = new Set(data.skipIds ?? []);
    const cars = await loadCars(sb);
    const next = fleetProgress(cars, false).find((r) => !skip.has(r.vehicleId) && r.needsWork);
    if (!next) return { ok: true as const, outcome: "done" as const, labels: freshLabels() };
    const car = cars.find((c) => c.id === next.vehicleId)!;
    const { data: origs } = await (sb.from("vehicle_media") as any)
      .select("id,photo_class,created_at").eq("vehicle_id", car.id).eq("kind", "original");
    const openIds = ((origs ?? []) as any[]).filter((o) => isUnlabeledClass(o.photo_class)).map((o) => o.id as string);
    let labels: StudioLabelCounts = freshLabels();
    if (openIds.length) {
      const { runPhotoLabelBatch } = await import("@/lib/photo-class-label.server");
      const summary = await runPhotoLabelBatch(openIds, actor);
      labels = { labeled: summary.labeled, lowConfidence: summary.lowConfidence, failed: summary.failed };
    }
    const again = await (sb.from("vehicle_media") as any)
      .select("id,photo_class,created_at").eq("vehicle_id", car.id).eq("kind", "original");
    const originals: Original[] = ((again.data ?? []) as any[]).map((o) => ({
      id: o.id as string, photoClass: (o.photo_class ?? "unknown") as PhotoClass, createdAt: o.created_at as string,
    }));
    const live = new Set(car.shots.filter((s) => s.status !== "rejected" && s.slot).map((s) => s.slot as ShotSlot));
    const missing = planShots(originals).map((p) => p.slot).filter((slot) => !live.has(slot));
    const held = missing.length ? (refusal ? stopOutcome(refusal) : null) : null;
    if (held) return { ok: true as const, outcome: held, vehicleId: car.id, label: next.label, reason: refusal, labels };
    if (missing.length) {
      const { generateVehicleShots } = await import("@/lib/photo-studio.functions");
      const result = await generateVehicleShots(actor, car.id, missing);
      if (!result.ok) {
        const why = stopOutcome(result.error);
        if (why) return { ok: true as const, outcome: why, vehicleId: car.id, label: next.label, reason: result.error, labels };
        return { ok: false as const, outcome: "failed" as const, error: result.error, vehicleId: car.id, labels };
      }
      const hit = result.outcomes.find((o) => o.reason && stopOutcome(o.reason));
      if (hit?.reason) {
        return { ok: true as const, outcome: stopOutcome(hit.reason)!, vehicleId: car.id, label: next.label, reason: hit.reason, labels };
      }
    }
    const unlabeled = labels.failed;
    await logAudit(actor, {
      action: "photo_studio.fleet_car",
      summary: unlabeled
        ? `Photo Studio ran for ${next.label}. ${unlabeled} ${unlabeled === 1 ? "photo" : "photos"} could not be labeled.`
        : `Photo Studio ran for ${next.label}`,
      entityType: "vehicle",
      entityId: car.id,
      metadata: { missing, labels },
    });
    return { ok: true as const, outcome: "worked" as const, vehicleId: car.id, label: next.label, labels };
  });

async function approveAndPublishOne(actor: Awaited<ReturnType<typeof requireOwner>>, vehicleId: string) {
  const sb = await admin();
  const { data: shots } = await (sb.from("vehicle_media") as any)
    .select("id,shot_slot,studio_review_status,studio_check,published")
    .eq("vehicle_id", vehicleId).eq("kind", "marketing");
  const mapped: FleetShot[] = ((shots ?? []) as any[]).map((s) => ({
    slot: s.shot_slot ?? null, status: s.studio_review_status ?? null, published: !!s.published, check: s.studio_check ?? null,
  }));
  if (!carReadyToPublish(mapped)) return { ok: false as const, error: "This set is not complete, or a shot did not pass the identity check." };
  for (const s of (shots ?? []) as any[]) {
    if (s.studio_review_status === "rejected" || s.studio_review_status === "approved") continue;
    const { error } = await (sb.from("vehicle_media") as any).update({
      studio_review_status: "approved", approved_by: actor.userId, approved_at: new Date().toISOString(), published: false,
    }).eq("id", s.id).eq("kind", "marketing");
    if (error) return { ok: false as const, error: "Could not approve the set." };
  }
  const { publishApprovedMarketing } = await import("@/lib/photo-studio.functions");
  const published = await publishApprovedMarketing(actor, vehicleId, true);
  if (!published.ok) return published;
  await logAudit(actor, { action: "photo_studio.approve_publish", summary: "Approved and published a Photo Studio set", entityType: "vehicle", entityId: vehicleId, metadata: {} });
  return { ok: true as const };
}

export const approveAndPublishStudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireOwner(context.userId);
    return approveAndPublishOne(actor, data.vehicleId);
  });

export const approveAndPublishStudioReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await requireOwner(context.userId);
    const sb = await admin();
    const { dailyBlocked } = await budget(sb);
    const ready = fleetProgress(await loadCars(sb), dailyBlocked).filter((r) => r.ready && r.state !== "Published");
    let published = 0;
    for (const row of ready) {
      const result = await approveAndPublishOne(actor, row.vehicleId);
      if (result.ok) published++;
    }
    return { ok: true as const, published, ready: ready.length };
  });
