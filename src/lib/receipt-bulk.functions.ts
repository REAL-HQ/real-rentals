import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BULK_RECEIPT_KINDS } from "@/lib/receipt-bulk-match";

const input = z.object({
  storagePath: z.string().trim().min(3).max(400).regex(/^[A-Za-z0-9-]+\/[0-9]+-[a-z0-9]+\.[a-z0-9]{1,5}$/),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().max(120).nullish(),
  sizeBytes: z.number().int().nonnegative().max(20 * 1024 * 1024),
  kind: z.enum(BULK_RECEIPT_KINDS),
  vehicleIds: z.array(z.string().uuid()).min(1).max(25),
  matchBasis: z.enum(["vin", "vin_suffix", "plate", "unit", "manual"]),
});

/**
 * File one uploaded receipt/invoice against one or more cars. Manager+, the
 * same tier the receipts bucket and expenses require. The row is team-only
 * (visibility {admin}, no driver_id), so renters never see it; renter
 * receipts in the portal stay the paid payments of their own rental, shown
 * until 1 year after return. One documents row on the first car plus a
 * document_vehicle_links row per car.
 */
export const fileBulkReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => input.parse(v))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const { logAudit } = await import("@/lib/audit.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = Array.from(new Set(data.vehicleIds));

    const { data: cars, error: carErr } = await supabaseAdmin.from("vehicles").select("id").in("id", ids);
    if (carErr) throw new Error(carErr.message);
    if ((cars ?? []).length !== ids.length) throw new Error("One of those cars was not found.");

    // The object must exist in the receipts bucket under the path we were given.
    const folder = data.storagePath.split("/")[0];
    const name = data.storagePath.slice(folder.length + 1);
    const { data: listed } = await supabaseAdmin.storage.from("receipts").list(folder, { search: name, limit: 1 });
    if (!listed?.some((o: { name: string }) => o.name === name)) throw new Error("Upload not found. Try again.");

    const { data: row, error } = await supabaseAdmin
      .from("documents")
      .insert({
        vehicle_id: ids[0],
        driver_id: null,
        kind: `vehicle_${data.kind}`,
        category: `vehicle_${data.kind}`,
        label: data.fileName,
        file_name: data.fileName,
        mime_type: data.mimeType ?? null,
        size_bytes: data.sizeBytes,
        storage_bucket: "receipts",
        storage_path: data.storagePath,
        visibility: ["admin"],
        is_current: true,
        uploaded_by: context.userId,
        uploaded_by_role: "admin",
        source: "bulk_receipt_upload",
        evidence_class: "financial",
        notes: `Assigned by ${data.matchBasis}`,
      } as any)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Could not file the receipt");

    const { error: linkErr } = await supabaseAdmin
      .from("document_vehicle_links")
      .insert(ids.map((vehicle_id) => ({ document_id: row.id, vehicle_id, created_by: context.userId })) as any);
    if (linkErr) throw new Error(linkErr.message);

    await logAudit(actor, {
      action: "document.bulk_receipt_filed",
      summary: `Filed ${data.kind} ${data.fileName} to ${ids.length} car(s)`,
      entityType: "vehicle",
      entityId: ids[0],
      metadata: { documentId: row.id, vehicleIds: ids, matchBasis: data.matchBasis },
    });
    return { id: row.id as string };
  });
