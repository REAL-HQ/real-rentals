// File a signed rental agreement that arrived through Fleet Inbox onto the
// renter's application without copying the stored bytes. Manager and above;
// the audit row is written first (fail closed). Verification — what counts
// for activation — stays the separate Owner/Manager step in setDocumentReview.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { AGREEMENT_ROLES, FILEABLE_INBOX_CLASSES, looksLikeRentalAgreement, planAgreementFiling, roleFromLabel } from "@/lib/inbox-agreement-filing";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

/** Fleet Inbox files that look like rental agreements and are not filed yet (incl. older ones misfiled as purchase_agreement). */
export const listUnfiledInboxAgreements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const sb: any = await admin();
    const { data: docs, error } = await sb.from("documents").select("id,file_name,category,created_at")
      .eq("source", "fleet_inbox").is("driver_id", null).in("category", [...FILEABLE_INBOX_CLASSES])
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error("Could not list Fleet Inbox agreements.");
    const ids = (docs ?? []).map((d: any) => d.id);
    const { data: items } = ids.length
      ? await sb.from("fleet_import_items").select("document_id,batch_id,doc_class,warnings,status").in("document_id", ids).neq("status", "duplicate")
      : { data: [] as any[] };
    const byDoc = new Map<string, any>();
    for (const it of items ?? []) if (!byDoc.has(it.document_id)) byDoc.set(it.document_id, it);
    return (docs ?? [])
      .filter((d: any) => { const it = byDoc.get(d.id); return looksLikeRentalAgreement(it?.doc_class ?? d.category, it?.warnings); })
      .map((d: any) => ({ documentId: d.id as string, fileName: d.file_name as string | null, category: d.category as string, createdAt: d.created_at as string, batchId: (byDoc.get(d.id)?.batch_id ?? null) as string | null }));
  });

/** Current agreements already filed on an application (for picking the original a swap follows). */
export const listFiledAgreements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const sb: any = await admin();
    const { data: rows } = await sb.from("documents").select("id,label,file_name,review_status").eq("driver_id", data.applicationId).eq("category", "agreement").eq("is_current", true);
    return (rows ?? []).map((r: any) => ({ id: r.id as string, label: r.label as string | null, fileName: r.file_name as string | null, role: roleFromLabel(r.label), reviewStatus: r.review_status as string }));
  });

export const fileInboxAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ documentId: z.string().uuid(), applicationId: z.string().uuid(), role: z.enum(AGREEMENT_ROLES), relatedDocumentId: z.string().uuid().nullish() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const sb: any = await admin();
    const { data: doc } = await sb.from("documents")
      .select("id,driver_id,vehicle_id,category,source,storage_bucket,storage_path,content_sha256,is_current,file_name")
      .eq("id", data.documentId).maybeSingle();
    const { data: app } = await sb.from("applications").select("id,deleted_at,purged_at,full_name").eq("id", data.applicationId).maybeSingle();
    const { data: filedRows } = await sb.from("documents").select("id,label").eq("driver_id", data.applicationId).eq("category", "agreement").eq("is_current", true);
    const plan = planAgreementFiling({
      doc: doc ?? null, app: app ?? null, role: data.role, relatedDocumentId: data.relatedDocumentId ?? null,
      filed: (filedRows ?? []).map((r: any) => ({ id: r.id, agreement_role: roleFromLabel(r.label) })),
    });
    if (!plan.ok) return { ok: false as const, error: plan.error };
    const { error: auditErr } = await sb.from("audit_log").insert({
      actor_user_id: actor.userId, actor_email: actor.email ?? null, actor_role: actor.role,
      action: "document.filed_from_fleet_inbox", entity_type: "application", entity_id: data.applicationId,
      summary: `Filed Fleet Inbox file ${doc?.file_name ?? data.documentId} as ${data.role} rental agreement`,
      metadata: { ...plan.audit, actor_tier: actor.tier },
    });
    if (auditErr) return { ok: false as const, error: "Could not record the filing. Nothing was changed." };
    // Guarded re-point: only while still unfiled. Bytes and storage path untouched.
    const { data: updated, error: upErr } = await sb.from("documents").update(plan.patch)
      .eq("id", data.documentId).is("driver_id", null).eq("source", "fleet_inbox").select("id").maybeSingle();
    if (upErr || !updated) return { ok: false as const, error: "The file changed while filing. Nothing was filed; reload and retry." };
    const { data: itemRows } = await sb.from("fleet_import_items").select("id,batch_id,status").eq("document_id", data.documentId);
    const itemIds = (itemRows ?? []).map((r: any) => r.id);
    if (itemIds.length) {
      await sb.from("fleet_import_proposals").update({ status: "superseded" }).in("item_id", itemIds).in("status", ["pending", "failed"]);
      await sb.from("fleet_import_items").update({ doc_class: "rental_agreement", classified_manually: true, status: "applied" }).in("id", itemIds).neq("status", "duplicate");
    }
    const { refreshBatchStatus } = await import("@/lib/fleet-inbox-core.server");
    for (const b of new Set<string>((itemRows ?? []).map((r: any) => String(r.batch_id)))) await refreshBatchStatus(b);
    return { ok: true as const, documentId: data.documentId, nextStep: "Review and Verify it on the renter's Documents tab (Owner or Manager)." };
  });

/** Renters an agreement may be filed to: approved or active, not deleted. */
export const listFileableRenters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const sb: any = await admin();
    const { data } = await sb.from("applications").select("id,full_name,email,status").in("status", ["approved", "active"]).is("deleted_at", null).order("full_name").limit(500);
    return (data ?? []).map((a: any) => ({ id: a.id as string, name: (a.full_name ?? "") as string, email: (a.email ?? "") as string }));
  });
