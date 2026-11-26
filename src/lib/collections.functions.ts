/* eslint-disable @typescript-eslint/no-explicit-any -- the service-role client is used untyped here, as in rentals.functions.ts */
// Collections server functions (Payments > Collections, renter profile card). Every edit needs
// Manager or Owner (requireManager) and goes through the SECURITY DEFINER functions in
// migration 20261122143000_collections.sql, which log each change with the date and the user.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COLLECTION_REASONS, COLLECTION_STATUSES, type StoredProration } from "@/lib/collections";

const UUID = z.string().uuid();
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function manager(userId: string) {
  const { requireManager } = await import("@/lib/roles.server");
  const actor = await requireManager(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { logAudit } = await import("@/lib/audit.server");
  return { actor, admin: supabaseAdmin as any, audit: (e: Parameters<typeof logAudit>[1]) => logAudit(actor, e) };
}

/** Database refusals in plain words for staff. */
function friendly(message: string | undefined): string {
  const m = String(message ?? "");
  const map: Record<string, string> = {
    rental_still_active: "End the rental with Return first, then record the repo.",
    repo_date_before_start: "The repo date can't be before the rental started.",
    repo_date_in_future: "The repo date can't be in the future.",
    status_changed_elsewhere: "Someone else changed this line. Reload and try again.",
    amount_must_be_positive: "Enter an amount above $0.",
    attachment_path_mismatch: "That file wasn't uploaded for this line.",
    rental_belongs_to_another_renter: "That rental belongs to another renter.",
  };
  for (const [k, v] of Object.entries(map)) if (m.includes(k)) return v;
  return "Could not save. Nothing was changed.";
}

export type CollectionItemRow = {
  id: string;
  application_id: string;
  rental_id: string | null;
  vehicle_id: string | null;
  source_payment_id: string | null;
  source_kind: string;
  reason: string;
  description: string | null;
  amount: number;
  amount_paid: number;
  week_start: string | null;
  original_amount: number | null;
  proration: StoredProration | null;
  status: string;
  incurred_on: string | null;
  notes: string | null;
  stripe_invoice_id: string | null;
  created_at: string;
  closed_at: string | null;
};
export type CollectionEventRow = {
  id: string;
  item_id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  amount: number | null;
  actor_label: string | null;
  note: string | null;
  created_at: string;
};
export type CollectionAttachmentRow = { id: string; item_id: string; storage_path: string; file_name: string | null; mime_type: string | null; created_at: string };
export type CollectionRentalRow = { id: string; application_id: string | null; status: string; start_date: string | null; end_date: string | null; weekly_rate: number | null; close_reason: string | null; repossessed_on: string | null; days_late_at_repo: number | null };

/** Items, history, attachments and the rentals they belong to. Manager+. */
export const listCollections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: UUID.nullish() }).parse(d ?? {}))
  .handler(async ({ context, data }): Promise<{ items: CollectionItemRow[]; events: CollectionEventRow[]; attachments: CollectionAttachmentRow[]; rentals: CollectionRentalRow[]; names: Record<string, string | null> }> => {
    const { admin } = await manager(context.userId);
    let q = admin.from("collection_items").select("*").order("created_at", { ascending: true }).limit(2000);
    if (data.applicationId) q = q.eq("application_id", data.applicationId);
    const { data: items, error } = await q;
    if (error) throw new Error("Could not load Collections.");
    const ids = (items ?? []).map((i: any) => i.id);
    const rentalIds = [...new Set((items ?? []).map((i: any) => i.rental_id).filter(Boolean))];
    const appIds = [...new Set((items ?? []).map((i: any) => i.application_id))];
    const [ev, at, rs, apps] = await Promise.all([
      ids.length ? admin.from("collection_item_events").select("id,item_id,kind,from_status,to_status,amount,actor_label,note,created_at").in("item_id", ids).order("created_at", { ascending: true }) : { data: [] },
      ids.length ? admin.from("collection_item_attachments").select("id,item_id,storage_path,file_name,mime_type,created_at").in("item_id", ids) : { data: [] },
      rentalIds.length ? admin.from("rentals").select("id,application_id,status,start_date,end_date,weekly_rate,close_reason,repossessed_on,days_late_at_repo").in("id", rentalIds) : { data: [] },
      appIds.length ? admin.from("applications").select("id,full_name").in("id", appIds) : { data: [] },
    ]);
    const names: Record<string, string | null> = {};
    for (const a of apps.data ?? []) names[a.id] = a.full_name ?? null;
    const n = (v: unknown) => (v == null ? null : Number(v));
    return {
      items: (items ?? []).map((i: any) => ({ ...i, amount: Number(i.amount), amount_paid: Number(i.amount_paid), original_amount: n(i.original_amount) })),
      events: (ev.data ?? []).map((e: any) => ({ ...e, amount: n(e.amount) })),
      attachments: at.data ?? [],
      rentals: (rs.data ?? []).map((r: any) => ({ ...r, weekly_rate: n(r.weekly_rate) })),
      names,
    };
  });

export const setCollectionItemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ itemId: UUID, to: z.enum(COLLECTION_STATUSES), expected: z.enum(COLLECTION_STATUSES), note: z.string().trim().max(500).nullish() }).strict().parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true } | { error: string }> => {
    const { admin, actor, audit } = await manager(context.userId);
    const { error } = await admin.rpc("set_collection_item_status", { _item_id: data.itemId, _to: data.to, _actor: actor.userId, _note: data.note ?? null, _expected: data.expected });
    if (error) return { error: friendly(error.message) };
    await audit({ action: "collections.status_changed", entityType: "collection_item", entityId: data.itemId, summary: `Collections line ${data.expected} -> ${data.to}`, metadata: { note: data.note ?? null } });
    return { ok: true };
  });

export const addCollectionItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      applicationId: UUID,
      rentalId: UUID.nullish(),
      reason: z.enum(COLLECTION_REASONS),
      amount: z.number().positive().max(100000),
      description: z.string().trim().max(300).nullish(),
      incurredOn: DAY.nullish(),
      notes: z.string().trim().max(4000).nullish(),
    }).strict().parse(d),
  )
  .handler(async ({ context, data }): Promise<{ ok: true; id: string } | { error: string }> => {
    const { admin, actor, audit } = await manager(context.userId);
    const { data: id, error } = await admin.rpc("add_collection_item", {
      _application_id: data.applicationId, _rental_id: data.rentalId ?? null, _reason: data.reason, _amount: data.amount,
      _description: data.description ?? null, _incurred_on: data.incurredOn ?? null, _notes: data.notes ?? null, _actor: actor.userId,
    });
    if (error) return { error: friendly(error.message) };
    await audit({ action: "collections.charge_added", entityType: "collection_item", entityId: String(id), summary: `Added $${data.amount.toFixed(2)} ${data.reason} to Collections`, metadata: { applicationId: data.applicationId } });
    return { ok: true, id: String(id) };
  });

export const updateCollectionItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      itemId: UUID,
      amount: z.number().min(0).max(100000).nullish(),
      reason: z.enum(COLLECTION_REASONS).nullish(),
      description: z.string().trim().max(300).nullish(),
      notes: z.string().trim().max(4000).nullish(),
    }).strict().parse(d),
  )
  .handler(async ({ context, data }): Promise<{ ok: true } | { error: string }> => {
    const { admin, actor } = await manager(context.userId);
    const { error } = await admin.rpc("update_collection_item", {
      _item_id: data.itemId, _amount: data.amount ?? null, _reason: data.reason ?? null, _description: data.description ?? null, _notes: data.notes ?? null, _actor: actor.userId,
    });
    if (error) return { error: friendly(error.message) };
    return { ok: true };
  });

/** Record (or change) a repo date. Moves anything still open and recalculates the missed week. */
export const recordRepossession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: UUID, repoDate: DAY, note: z.string().trim().max(500).nullish() }).strict().parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true; daysLate: number } | { error: string }> => {
    const { admin, actor } = await manager(context.userId);
    const { data: res, error } = await admin.rpc("record_rental_repossession", { _rental_id: data.rentalId, _repo_date: data.repoDate, _actor: actor.userId, _note: data.note ?? null });
    if (error) return { error: friendly(error.message) };
    return { ok: true, daysLate: Number(res?.days_late ?? 0) };
  });

/** Move a closed rental's open, due rows to Collections by hand (the automatic move covers rentals ended after release). */
export const moveRentalToCollections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rentalId: UUID, note: z.string().trim().max(500).nullish() }).strict().parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true; moved: number } | { error: string }> => {
    const { admin, actor } = await manager(context.userId);
    const { data: moved, error } = await admin.rpc("move_rental_to_collections", { _rental_id: data.rentalId, _actor: actor.userId, _note: data.note ?? "Moved by staff" });
    if (error) return { error: friendly(error.message) };
    return { ok: true, moved: Number(moved ?? 0) };
  });

/** Record a file the browser already uploaded to receipts/collections/<itemId>/... (Managers' storage policy). */
export const addCollectionAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ itemId: UUID, path: z.string().max(300), fileName: z.string().max(200), mimeType: z.string().max(100).nullish() }).strict().parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true } | { error: string }> => {
    const { admin, actor } = await manager(context.userId);
    const { error } = await admin.rpc("add_collection_attachment", { _item_id: data.itemId, _path: data.path, _file_name: data.fileName, _mime: data.mimeType ?? null, _actor: actor.userId });
    if (error) return { error: friendly(error.message) };
    return { ok: true };
  });

/** Short-lived link to view an attachment. */
export const collectionAttachmentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ attachmentId: UUID }).strict().parse(d))
  .handler(async ({ context, data }): Promise<{ url: string } | { error: string }> => {
    const { admin } = await manager(context.userId);
    const { data: row } = await admin.from("collection_item_attachments").select("storage_path").eq("id", data.attachmentId).maybeSingle();
    if (!row) return { error: "Attachment not found." };
    const { data: signed, error } = await admin.storage.from("receipts").createSignedUrl(row.storage_path, 300);
    if (error || !signed?.signedUrl) return { error: "Could not open the file." };
    return { url: signed.signedUrl };
  });
