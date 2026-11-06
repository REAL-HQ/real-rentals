import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  RETURN_CHECKLIST_ENABLED,
  RETURN_DAMAGE_ITEMS,
  RETURN_PHOTO_BUCKET,
  buildReturnChecklist,
  type ReturnChecklistDraft,
} from "@/lib/return-checklist";

// Separate from endRental. This file never calls end_rental_tx, never settles
// a deposit, and never writes a charge or a refund. While the flag is false
// both handlers return before they load the database.

function refuseWhileOff(): void {
  if (!RETURN_CHECKLIST_ENABLED) throw new Error("Return checklist is off");
}

const draftSchema = z.object({
  rentalId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  returnedAtEt: z.string().min(16).max(16),
  odometer: z.string().max(20),
  fuelOrCharge: z.string().max(20),
  items: z.array(z.object({
    key: z.string().max(40),
    area: z.enum(["exterior", "interior"]),
    label: z.string().max(80),
    result: z.enum(["ok", "damage", "na"]),
    notes: z.string().max(500),
  })).max(RETURN_DAMAGE_ITEMS.length),
  keysReturned: z.boolean().nullable(),
  tollsTicketsNote: z.string().max(2000),
  depositDecisionNeeded: z.boolean().nullable(),
  depositDecisionNote: z.string().max(2000),
  photos: z.array(z.object({
    bucket: z.literal(RETURN_PHOTO_BUCKET),
    path: z.string().min(3).max(400),
    angle: z.string().max(40),
  })).max(40),
});

export const saveReturnChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => draftSchema.parse(d))
  .handler(async ({ data, context }) => {
    refuseWhileOff();
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const record = buildReturnChecklist(data.vehicleId, data as ReturnChecklistDraft);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as {
      from: (table: string) => {
        insert: (row: unknown) => {
          select: (cols: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> };
        };
      };
    };
    const inserted = await db.from("return_checklists").insert({
      rental_id: data.rentalId,
      vehicle_id: data.vehicleId,
      recorded_by: context.userId,
      returned_at: record.returnedAt,
      odometer: record.odometer,
      fuel_or_charge: record.fuelOrCharge,
      keys_returned: record.keysReturned,
      tolls_tickets_note: record.tollsTicketsNote,
      deposit_decision_needed: record.depositDecisionNeeded,
      deposit_decision_note: record.depositDecisionNote,
    }).select("id").single();
    if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not save the return checklist");
    const checklistId = inserted.data.id;
    const write = supabaseAdmin as unknown as {
      from: (table: string) => { insert: (row: unknown) => Promise<{ error: { message: string } | null }> };
    };
    if (record.items.length) {
      const items = await write.from("return_checklist_items").insert(record.items.map((item) => ({
        checklist_id: checklistId,
        area: item.area,
        item_key: item.key,
        label: item.label,
        result: item.result,
        notes: item.notes || null,
      })));
      if (items.error) throw new Error(items.error.message);
    }
    if (record.photos.length) {
      const photos = await write.from("return_checklist_photos").insert(record.photos.map((photo) => ({
        checklist_id: checklistId,
        storage_bucket: photo.bucket,
        storage_path: photo.path,
        angle: photo.angle,
      })));
      if (photos.error) throw new Error(photos.error.message);
    }
    return { ok: true as const, id: checklistId };
  });

export const getReturnChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    refuseWhileOff();
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, value: string) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => {
                maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
              };
            };
          };
        };
      };
    };
    const found = await db
      .from("return_checklists")
      .select("id,returned_at,odometer,fuel_or_charge,keys_returned,tolls_tickets_note,deposit_decision_needed,deposit_decision_note")
      .eq("rental_id", data.rentalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (found.error) throw new Error(found.error.message);
    const row = found.data;
    return {
      checklist: row
        ? {
            id: String(row.id),
            returnedAt: String(row.returned_at),
            odometer: Number(row.odometer),
            fuelOrCharge: String(row.fuel_or_charge),
            keysReturned: Boolean(row.keys_returned),
            tollsTicketsNote: row.tolls_tickets_note == null ? null : String(row.tolls_tickets_note),
            depositDecisionNeeded: Boolean(row.deposit_decision_needed),
            depositDecisionNote: row.deposit_decision_note == null ? null : String(row.deposit_decision_note),
          }
        : null,
    };
  });
