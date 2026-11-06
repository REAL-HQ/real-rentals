// Available cars board (PR C). Team-only. Shows each car's approved marketing
// shots (AI-generated, labelled) with specs; Assign goes through the server and
// only accepts approved drivers.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager, requireStaff } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import { BOARD_VEHICLE_STATUSES, canAssign, ASSIGNABLE_DRIVER_STATUSES } from "@/lib/available-cars";
import { EXTERIOR_SLOTS, SHOT_SLOTS, carSetStatus, vinLast6, type ShotSlot } from "@/lib/photo-studio";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

export const listAvailableCars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ includeOnboarding: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const sb = await admin();
    const statuses = data.includeOnboarding ? [...BOARD_VEHICLE_STATUSES] : ["available"];
    const { data: cars } = await sb.from("vehicles")
      .select("id,unit_number,year,make,model,trim,color,license_plate,plate_state,vin,status,weekly_rate,mileage,archived_at")
      .in("status", statuses).is("archived_at", null).order("unit_number");
    const ids = ((cars ?? []) as any[]).map((c) => c.id);
    const { data: shots } = ids.length
      ? await (sb.from("vehicle_media") as any).select("id,vehicle_id,shot_slot,studio_review_status,published,storage_bucket,storage_path")
          .in("vehicle_id", ids).eq("kind", "marketing").neq("studio_review_status", "rejected")
      : { data: [] };
    const { data: assigned } = ids.length
      ? await sb.from("applications").select("vehicle_id").in("vehicle_id", ids)
      : { data: [] };
    const taken = new Set(((assigned ?? []) as any[]).map((a) => a.vehicle_id));
    const out = [];
    for (const c of (cars ?? []) as any[]) {
      const mine = ((shots ?? []) as any[]).filter((s) => s.vehicle_id === c.id);
      const approved = mine.filter((s) => s.studio_review_status === "approved")
        .sort((a, b) => SHOT_SLOTS.indexOf(a.shot_slot) - SHOT_SLOTS.indexOf(b.shot_slot));
      const photos: { slot: ShotSlot; url: string | null }[] = [];
      for (const s of approved) {
        const { data: u } = await sb.storage.from(s.storage_bucket).createSignedUrl(s.storage_path, 600);
        photos.push({ slot: s.shot_slot, url: u?.signedUrl ?? null });
      }
      out.push({
        id: c.id, unit: c.unit_number, year: c.year, make: c.make, model: c.model, trim: c.trim, color: c.color,
        plate: c.license_plate, plateState: c.plate_state, vinLast6: vinLast6(c.vin), status: c.status,
        weeklyRate: c.weekly_rate == null ? null : Number(c.weekly_rate), mileage: c.mileage ?? null,
        assigned: taken.has(c.id), photos, aiGenerated: photos.length > 0,
        setStatus: carSetStatus(mine.map((s) => ({ id: s.id, slot: s.shot_slot, status: s.studio_review_status }))),
        missingExterior: EXTERIOR_SLOTS.filter((x) => !approved.some((s) => s.shot_slot === x)),
      });
    }
    return { cars: out };
  });

export const listAssignableDrivers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireManager(context.userId);
    const sb = await admin();
    const { data } = await sb.from("applications").select("id,full_name,status,vehicle_id")
      .in("status", [...ASSIGNABLE_DRIVER_STATUSES]).is("vehicle_id", null).order("full_name");
    return { drivers: ((data ?? []) as any[]).map((d) => ({ id: d.id, name: d.full_name, status: d.status })) };
  });

export const assignCarFromBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid(), driverId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const sb = await admin();
    const [{ data: driver }, { data: vehicle }, { data: holder }] = await Promise.all([
      sb.from("applications").select("id,status,vehicle_id,full_name").eq("id", data.driverId).maybeSingle(),
      sb.from("vehicles").select("id,status,archived_at").eq("id", data.vehicleId).maybeSingle(),
      sb.from("applications").select("id").eq("vehicle_id", data.vehicleId).limit(1).maybeSingle(),
    ]);
    const chk = canAssign(driver as any, vehicle ? { ...(vehicle as any), assignedTo: (holder as any)?.id ?? null } : null, data.driverId);
    if (!chk.ok) return chk;
    // Same column the driver drawer's VehiclePicker writes; no money flows change.
    const { error } = await sb.from("applications").update({ vehicle_id: data.vehicleId }).eq("id", data.driverId).is("vehicle_id", null)
      .in("status", [...ASSIGNABLE_DRIVER_STATUSES]);
    if (error) return { ok: false as const, error: "Could not assign." };
    await logAudit(actor, { action: "vehicle.assigned", summary: `Car assigned to ${(driver as any).full_name ?? "driver"} from Available cars`, entityType: "vehicle", entityId: data.vehicleId, metadata: { driverId: data.driverId } });
    return { ok: true as const };
  });
