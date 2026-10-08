// Fleet Inbox: upload → classify → extract → identify → match → review → apply.
// AI proposes, the server validates, a person approves. Originals are stored
// once in the private vehicle-docs bucket and recorded in the existing
// `documents` vault; document_vehicle_links relates one document to many cars.
import { isFinanceKind } from "@/lib/vehicle-doc-presence";
import { normalizeDisplayField, normalizeDisplayText } from "@/lib/display-normalize";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff } from "@/lib/roles.server";
import { normalizeBodyType } from "@/lib/safe-autofill";
import { tierAllows } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import {
  DOC_CLASSES, FINANCE_FIELDS, HIGH_RISK, VEHICLE_FIELDS, buildProposal, authorityOf, defaultWeeklyRate,
  isFinanceField, docGroupOf, type ExistingVehicle, type ExtractedEntry, type ExtractedField, type ProvenanceIndex, type Change,
} from "@/lib/fleet-inbox";

const BUCKET = "vehicle-docs";
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- batches
export const createImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ label: z.string().trim().max(120).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const label = data.label || `Fleet Import — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}`;
    const { data: row, error } = await sb.from("fleet_import_batches").insert({ label, created_by: actor.userId }).select("id").single();
    if (error) throw new Error("Could not start an import.");
    return { id: row.id as string };
  });

export const listImportBatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context.userId);
    const sb = await admin();
    const { data: batches } = await sb.from("fleet_import_batches").select("*").order("created_at", { ascending: false }).limit(50);
    const ids = (batches ?? []).map((b: any) => b.id);
    const { data: items } = ids.length ? await sb.from("fleet_import_items").select("batch_id,status").in("batch_id", ids) : { data: [] as any[] };
    const { data: props } = ids.length ? await sb.from("fleet_import_proposals").select("batch_id,kind,status").in("batch_id", ids) : { data: [] as any[] };
    return (batches ?? []).map((b: any) => {
      const its = (items ?? []).filter((i: any) => i.batch_id === b.id);
      const ps = (props ?? []).filter((p: any) => p.batch_id === b.id);
      return {
        id: b.id, label: b.label, status: b.status, created_at: b.created_at, source: b.source_channel ?? "fleet_inbox",
        files: its.length, vehicles: ps.length,
        newVehicles: ps.filter((p: any) => p.kind === "new").length,
        conflicts: ps.filter((p: any) => p.kind === "conflict").length,
      };
    });
  });

// ---------------------------------------------------------------- register
export const registerInboxFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      batchId: z.string().uuid(),
      path: z.string().trim().min(1).max(400).regex(/^inbox\//),
      fileName: z.string().trim().min(1).max(200),
      mimeType: z.string().trim().max(120).nullish(),
      sizeBytes: z.number().int().nonnegative().nullish(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const { data: file, error: dlErr } = await sb.storage.from(BUCKET).download(data.path);
    if (dlErr || !file) throw new Error("Upload not found.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha = await sha256Hex(bytes);
    const mime = data.mimeType || file.type || null;

    // Duplicate by content, not filename.
    const { data: dup } = await sb.from("documents").select("id,file_name").eq("content_sha256", sha).is("driver_id", null).maybeSingle();
    if (dup) {
      await sb.storage.from(BUCKET).remove([data.path]);
      const { data: item } = await sb.from("fleet_import_items").insert({
        batch_id: data.batchId, file_name: data.fileName, mime_type: mime, size_bytes: bytes.byteLength,
        content_sha256: sha, status: "duplicate", duplicate_of_document_id: dup.id, document_id: dup.id,
      }).select("id").single();
      await refreshBatchStatus(data.batchId);
      return { itemId: item?.id as string, duplicate: true, existingFileName: dup.file_name as string | null };
    }

    const { data: doc, error: docErr } = await sb.from("documents").insert({
      kind: "unknown", category: "unknown", label: data.fileName, storage_bucket: BUCKET, storage_path: data.path,
      file_name: data.fileName, mime_type: mime, size_bytes: bytes.byteLength, content_sha256: sha,
      is_current: true, visibility: ["admin"], uploaded_by: actor.userId, uploaded_by_role: actor.role,
      source: "fleet_inbox", review_status: "uploaded",
    }).select("id").single();
    if (docErr) {
      // Lost a race with an identical concurrent upload: treat as duplicate.
      const { data: d2 } = await sb.from("documents").select("id").eq("content_sha256", sha).is("driver_id", null).maybeSingle();
      if (!d2) throw new Error("Could not store that file.");
      await sb.storage.from(BUCKET).remove([data.path]);
      const { data: item } = await sb.from("fleet_import_items").insert({
        batch_id: data.batchId, file_name: data.fileName, mime_type: mime, size_bytes: bytes.byteLength,
        content_sha256: sha, status: "duplicate", duplicate_of_document_id: d2.id, document_id: d2.id,
      }).select("id").single();
      return { itemId: item?.id as string, duplicate: true, existingFileName: null };
    }
    const { data: item } = await sb.from("fleet_import_items").insert({
      batch_id: data.batchId, document_id: doc.id, file_name: data.fileName, mime_type: mime,
      size_bytes: bytes.byteLength, content_sha256: sha, status: "uploaded",
    }).select("id").single();
    await sb.from("fleet_import_batches").update({ status: "processing" }).eq("id", data.batchId);
    // Background analysis starts now, whether or not anyone keeps the import open.
    if (item?.id) await enqueueAnalysis(sb, item.id as string, data.batchId, "upload");
    return { itemId: item?.id as string, duplicate: false, existingFileName: null };
  });

// ---------------------------------------------------------------- analyze
// The analysis core lives server-only in fleet-inbox-core.server.ts (also used by the job worker).
const core = () => import("@/lib/fleet-inbox-core.server");
async function loadVehicles(sb: any): Promise<ExistingVehicle[]> { return (await core()).loadVehicles(sb); }
async function loadProvenance(sb: any, ids: string[]): Promise<ProvenanceIndex> { return (await core()).loadProvenance(sb, ids); }
async function buildItemProposals(sb: any, itemId: string) { return (await core()).buildItemProposals(sb, itemId); }
async function refreshBatchStatus(batchId: string) { return (await core()).refreshBatchStatus(batchId); }
/** Queue background analysis for an item (idempotent: one open job per item). */
async function enqueueAnalysis(sb: any, itemId: string, batchId: string, source: string) {
  await sb.from("fleet_inbox_jobs").insert({ item_id: itemId, batch_id: batchId, source });
}

export const analyzeInboxItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ itemId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    return (await core()).analyzeItemCore(data.itemId);
  });

export const classifyInboxItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ itemId: z.string().uuid(), docClass: z.enum(DOC_CLASSES as [string, ...string[]]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const sb = await admin();
    const { data: item } = await sb.from("fleet_import_items").update({ doc_class: data.docClass, class_confidence: "high", classified_manually: true })
      .eq("id", data.itemId).neq("status", "analyzing").select("batch_id,document_id,extraction,status").maybeSingle();
    if (!item) return { ok: false as const, error: "File is busy." };
    if (item.document_id) await sb.from("documents").update({ kind: data.docClass, category: data.docClass }).eq("id", item.document_id);
    const { isServiceClass, readServiceItem, rebuildServiceTransactions } = await import("@/lib/service-ingest.server");
    const { isFinancialClass } = await import("@/lib/financial-docs");
    if (isFinancialClass(data.docClass)) {
      // Payments / receipts: review only, never an expense or vehicle change.
      const { readFinancialItem, buildFinancialReview } = await import("@/lib/financial-ingest.server");
      if (!(item.extraction as any)?.financial) await readFinancialItem(sb, data.itemId);
      await buildFinancialReview(sb, data.itemId);
      await sb.from("fleet_import_proposals").update({ status: "superseded" }).eq("item_id", data.itemId).in("status", ["pending", "failed"]);
      if (item.status !== "duplicate") await sb.from("fleet_import_items").update({ status: "needs_attention" }).eq("id", data.itemId);
      await refreshBatchStatus(item.batch_id);
      return { ok: true as const };
    }
    if (isServiceClass(data.docClass)) {
      if (!(item.extraction as any)?.service) await readServiceItem(sb, data.itemId);
      await rebuildServiceTransactions(sb, item.batch_id);
    } else if (item.extraction) await buildItemProposals(sb, data.itemId); // authority depends on class
    if (item.status !== "duplicate") await sb.from("fleet_import_items").update({ status: item.extraction ? "ready" : item.status === "failed" ? "failed" : "needs_attention" }).eq("id", data.itemId);
    await refreshBatchStatus(item.batch_id);
    return { ok: true as const };
  });

/** Manual attach: link the original to a vehicle without any field changes. */
export const attachInboxItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ itemId: z.string().uuid(), vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const { data: item } = await sb.from("fleet_import_items").select("document_id,batch_id").eq("id", data.itemId).single();
    const { data: v } = await sb.from("vehicles").select("id").eq("id", data.vehicleId).maybeSingle();
    if (!item?.document_id || !v) return { ok: false as const, error: "File or vehicle not found." };
    await sb.from("document_vehicle_links").upsert({ document_id: item.document_id, vehicle_id: data.vehicleId, created_by: actor.userId }, { onConflict: "document_id,vehicle_id", ignoreDuplicates: true });
    await logAudit(actor, { action: "fleet_inbox.attached", summary: "Attached a fleet document to a vehicle", entityType: "vehicle", entityId: data.vehicleId, metadata: { document_id: item.document_id } });
    return { ok: true as const };
  });

// ---------------------------------------------------------------- read batch
const SERVICE_COST_FIELDS = new Set(["parts_total", "labor_total", "tax_total", "total", "payment_method"]);
const isOwnerOnlyField = (k: string) => isFinanceField(k) || k === "title_number" || k === "title_status";
function stripOwnershipFinance(p: any) {
  const fields = Object.fromEntries(Object.entries(p.fields ?? {}).filter(([k]) => !isOwnerOnlyField(k)));
  const changes = Array.isArray(p.changes) ? p.changes.filter((c: any) => !isOwnerOnlyField(c?.field)) : p.changes;
  return { ...p, fields, changes };
}
function stripServiceCosts(p: any) {
  const fields = Object.fromEntries(Object.entries(p.fields ?? {}).filter(([k]) => !SERVICE_COST_FIELDS.has(k)).map(([k, v]: [string, any]) => {
    if (k !== "service_items" || !v) return [k, v];
    let items: any[] = []; try { items = JSON.parse(v.value ?? "[]"); } catch { items = []; }
    return [k, { ...v, value: JSON.stringify(items.map((i) => ({ description: i?.description ?? "" }))), raw: undefined }];
  }));
  const changes = Array.isArray(p.changes) ? p.changes.filter((c: any) => !SERVICE_COST_FIELDS.has(c?.field) && c?.field !== "service_items") : p.changes;
  return { ...p, fields, changes };
}
export const getImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ batchId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const canFinance = tierAllows(actor.tier, "manager");
    // Acquisition finance, liens, payoffs: Owner only (DB enforces the same).
    const canOwnership = (await import("@/lib/experience.server")).ownerView(actor);
    const sb = await admin();
    const { data: batch } = await sb.from("fleet_import_batches").select("*").eq("id", data.batchId).maybeSingle();
    if (!batch) throw new Error("Not found");
    const { data: items } = await sb.from("fleet_import_items").select("id,document_id,duplicate_of_document_id,file_name,mime_type,size_bytes,status,doc_class,class_confidence,classified_manually,warnings,error,attempts,extraction,created_at").eq("batch_id", data.batchId).order("created_at");
    const { data: proposals } = await sb.from("fleet_import_proposals").select("*").eq("batch_id", data.batchId).order("created_at").order("entry_index");
    const finance = canOwnership
      ? (await sb.from("fleet_import_finance_facts").select("proposal_id,field,value,confidence,page").in("item_id", (items ?? []).map((i: any) => i.id))).data ?? []
      : [];
    const { data: vehicles } = await sb.from("vehicles").select("id,year,make,model,vin,unit_number,license_plate,current_odometer").is("archived_at", null).order("created_at");
    // Strip finance facts from shared extraction for non-managers.
    const safeItems = (items ?? []).map((i: any) => {
      const ex = i.extraction ?? null;
      const strip = (o: any) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => (canOwnership || !isOwnerOnlyField(k)) && (canFinance || !SERVICE_COST_FIELDS.has(k))));
      return { ...i, extraction: ex ? { shared: strip(ex.shared), vehicleCount: (ex.vehicles ?? []).length, ...(canFinance && ex.financial ? { financial: ex.financial, financialReview: ex.financial_review ?? null } : {}) } : null };
    });
    // Coordinators never receive service amounts (totals, parts, labor, tax, line amounts) — stripped here, not hidden in the UI.
    const live = (proposals ?? []).filter((p: any) => p.status !== "superseded");
    const ownerSafe = canOwnership ? live : live.map(stripOwnershipFinance);
    const safeProposals = canFinance ? ownerSafe : ownerSafe.map(stripServiceCosts);
    const { data: txs } = await sb.from("fleet_service_transactions").select("*").eq("batch_id", data.batchId).neq("status", "superseded").order("created_at");
    const { operationalView } = await import("@/lib/service-ingest.server");
    // Coordinators get the operational half only; the financial half (amounts, payment, raw model text) never leaves the server.
    const transactions = canFinance ? txs ?? [] : (txs ?? []).map(operationalView);
    const serviceItemIds = new Set((txs ?? []).flatMap((t: any) => t.item_ids ?? []));
    const itemsOut = canFinance ? safeItems : safeItems.map((i: any) => serviceItemIds.has(i.id) || /receipt|invoice|oil_service|tires|brakes|payment|transfer|refund|deposit/.test(i.doc_class ?? "") ? { ...i, warnings: [], extraction: null } : i);
    // Email source: Managers/Owners see the preserved body; Coordinators get envelope only, money redacted.
    let email: any = null;
    if (batch.inbound_email_id) {
      const { data: em } = await sb.from("inbound_emails").select("from_address,from_name,intake_address,subject,received_at,text_body,attachments,status").eq("id", batch.inbound_email_id).maybeSingle();
      if (em) {
        const redact = (s: string | null) => (s ? s.replace(/\$\s?[\d,]+(\.\d+)?/g, "$•••") : s);
        email = canFinance
          ? { ...em, text_body: em.text_body ? String(em.text_body).slice(0, 20000) : null }
          : { ...em, subject: redact(em.subject), text_body: null, attachments: ((em.attachments as any[]) ?? []).map((a: any) => ({ file_name: a.file_name, outcome: a.outcome })) };
      }
    }
    // Background processing status: latest job per item, plus queue pause (no amounts or provider details).
    const { data: jobRows } = await sb.from("fleet_inbox_jobs").select("item_id,state,attempts,max_attempts,next_run_at,created_at").eq("batch_id", data.batchId).order("created_at", { ascending: false });
    const jobs: Record<string, { state: string; attempts: number; maxAttempts: number; nextRunAt: string | null }> = {};
    for (const j of jobRows ?? []) if (!jobs[j.item_id]) jobs[j.item_id] = { state: j.state, attempts: j.attempts, maxAttempts: j.max_attempts, nextRunAt: j.next_run_at };
    const { data: ws } = await sb.from("fleet_inbox_worker_state").select("paused_reason,paused_at").eq("id", 1).maybeSingle();
    const queue = { pausedReason: ws?.paused_reason ?? null, pausedAt: ws?.paused_at ?? null };
    return { batch, items: itemsOut.map((i: any) => ({ ...i, job: jobs[i.id] ?? null })), proposals: safeProposals, transactions, finance, vehicles: vehicles ?? [], canFinance, email, queue };
  });

// ---------------------------------------------------------------- apply
const Decision = z.object({
  proposalId: z.string().uuid(),
  action: z.enum(["create", "match", "ignore"]),
  vehicleId: z.string().uuid().optional(),
  acceptFields: z.array(z.string()).max(60).default([]),
  confirmHighRisk: z.array(z.string()).max(60).default([]),
  applyFinance: z.boolean().default(false),
  // Vehicle-profile review accepts some fields; the rest stay pending for later review.
  partial: z.boolean().default(false),
});

type ApplyResult = { proposalId: string; ok: boolean; vehicleId?: string; message: string };

const DATE_FIELDS = new Set(["registration_expires_on", "insurance_effective_on", "insurance_expires_on"]);
/** Body-type codes ("4D") become a body type only via verified model mappings; otherwise left for review. */
function withBodyType(fields: Record<string, ExtractedField>, model: string | null | undefined): Record<string, ExtractedField> {
  const b = fields.body_type;
  if (!b?.value) return fields;
  const mapped = normalizeBodyType(String(b.value), model);
  return mapped ? { ...fields, body_type: { ...b, raw: b.raw ?? b.value, value: mapped } } : fields;
}
function coerce(field: string, v: string): unknown {
  if (field === "year" || field === "current_odometer") { const n = parseInt(v.replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? n : null; }
  if (DATE_FIELDS.has(field)) return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  if (field === "body_type") { const b = v.toLowerCase(); return ["sedan","suv","xl","truck","van","minivan","coupe","hatchback","wagon","convertible","other"].includes(b) ? b : null; }
  return v;
}

export const applyImportDecisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ batchId: z.string().uuid(), decisions: z.array(Decision).min(1).max(200) }).parse(d))
  .handler(async ({ data, context }): Promise<{ results: ApplyResult[] }> => {
    const actor = await requireStaff(context.userId);
    const canFinance = tierAllows(actor.tier, "manager");
    // Acquisition finance, liens, payoffs: Owner only (DB enforces the same).
    const canOwnership = (await import("@/lib/experience.server")).ownerView(actor);
    const sb = await admin();
    const results: ApplyResult[] = [];

    for (const dec of data.decisions) {
      // Claim atomically; a second reviewer or a repeated click gets nothing.
      const { data: p } = await sb.from("fleet_import_proposals").update({ status: "applying" })
        .eq("id", dec.proposalId).eq("batch_id", data.batchId).in("status", ["pending", "failed"]).select("*").maybeSingle();
      if (!p) { results.push({ proposalId: dec.proposalId, ok: false, message: "Already handled (applied, ignored or in progress)." }); continue; }
      const finish = async (status: string, r: ApplyResult, vehicleId?: string) => {
        await sb.from("fleet_import_proposals").update({
          status, result: r, applied_vehicle_id: vehicleId ?? null,
          applied_by: actor.userId, applied_at: new Date().toISOString(),
        }).eq("id", p.id);
        results.push(r);
      };
      try {
        if (dec.action === "ignore") { await finish("ignored", { proposalId: p.id, ok: true, message: "Ignored." }); continue; }
        const { data: item } = await sb.from("fleet_import_items").select("document_id,doc_class,analyzed_at").eq("id", p.item_id).single();
        if (!item?.document_id) throw new Error("Source document is missing.");
        const docClass = item.doc_class ?? "unknown";

        // Re-derive the proposal from current data — never trust the preview.
        // Match loads only the chosen car (scale); create still checks the whole fleet for duplicates.
        const vehicles: ExistingVehicle[] = dec.action === "match"
          ? await (async () => { const { data: r } = await sb.from("vehicles").select("*").eq("id", dec.vehicleId!).is("archived_at", null).maybeSingle(); return r ? await (await core()).overlayTitles(sb, [r as any]) : []; })()
          : await loadVehicles(sb);
        const entry: ExtractedEntry = { page: p.page, fields: ((p.fields ?? {}) as unknown) as Record<string, ExtractedField> };
        let target: ExistingVehicle | null = null;
        if (dec.action === "match") {
          target = vehicles.find((v) => v.id === dec.vehicleId) ?? null;
          if (!target) throw new Error("Vehicle to match was not found.");
          entry.fields = withBodyType(entry.fields, (target as any).model);
        }
        const prov = await loadProvenance(sb, target ? [target.id] : []);
        const fresh = target ? buildProposal(entry, docClass, [target], prov) : buildProposal(entry, docClass, vehicles, prov);
        if (dec.action === "create") {
          if (!fresh.vin || !fresh.vinCheck?.formatValid) throw new Error("A valid VIN is required to create a vehicle.");
          if (fresh.kind !== "new") throw new Error("A vehicle with this VIN or identifier now exists — choose Match instead.");
          if (!entry.fields.year?.value || !entry.fields.make?.value || !entry.fields.model?.value) throw new Error("Year, make and model are required to create a vehicle.");
        }
        // When matching by explicit choice, a VIN that differs from the car on file is a hard stop.
        if (target && fresh.vin && target.vin && target.vin.toUpperCase() !== fresh.vin) throw new Error(`VIN conflict: ${target.vin} on file vs ${fresh.vin} in document.`);

        const changeBy = new Map<string, Change>(fresh.changes.map((c) => [c.field, c]));
        const accept = new Set(dec.action === "create" ? [...changeBy.keys()] : dec.acceptFields);
        // Title identifiers are Owner-only: a non-Owner request can never write them, even via the diverting trigger.
        if (!canOwnership) for (const f of [...accept]) if (isOwnerOnlyField(f)) accept.delete(f);
        const toWrite: Record<string, unknown> = {};
        const written: Change[] = [];
        for (const f of accept) {
          const c = changeBy.get(f);
          if (!c) continue;
          if (dec.action === "match") {
            if (HIGH_RISK.has(f) && !dec.confirmHighRisk.includes(f)) continue;
            if (c.kind === "conflict" && !dec.confirmHighRisk.includes(f)) continue;
          }
          const val = coerce(f, c.proposed);
          if (val == null) continue;
          // Display-only re-casing for descriptive fields; raw text stays in provenance.
          toWrite[f] = normalizeDisplayField(f, val); written.push(c);
        }

        // Mileage is never written straight onto the car: it becomes a dated,
        // evidence-backed reading and the history decides current mileage.
        const odo = toWrite.current_odometer != null ? Number(toWrite.current_odometer) : null;
        delete toWrite.current_odometer;
        let vehicleId: string;
        if (dec.action === "create") {
          const row: Record<string, unknown> = {
            ...toWrite, vin: fresh.vin,
            year: coerce("year", entry.fields.year!.value), make: normalizeDisplayText(String(entry.fields.make!.value)), model: normalizeDisplayText(String(entry.fields.model!.value)),
            // Documents never establish a price: rate stays Not Set and the car
            // starts as Needs Setup until a human prices it, adds a photo and
            // chooses Make Available.
            weekly_rate: null,
            status: "onboarding",
            // unit_number assigned by the vehicles_assign_unit_number trigger.
          };
          const { data: v, error } = await sb.from("vehicles").insert(row as any).select("id").single();
          if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "A vehicle with this VIN, plate or unit number already exists." : "Could not create the vehicle.");
          vehicleId = v.id;
        } else {
          vehicleId = target!.id;
          if (Object.keys(toWrite).length) {
            const { error } = await sb.from("vehicles").update(toWrite as any).eq("id", vehicleId);
            if (error) throw new Error("Could not update the vehicle.");
          }
        }

        await sb.from("document_vehicle_links").upsert({ document_id: item.document_id, vehicle_id: vehicleId, page: p.page, created_by: actor.userId }, { onConflict: "document_id,vehicle_id", ignoreDuplicates: true });

        let serviceNote = "";
        const isService = docGroupOf(docClass) === "Maintenance";
        const { recordServiceEvent, addOdometerReading } = await import("@/lib/maintenance.server");
        if (isService) {
          const fv = (k: string) => (entry.fields[k] as any)?.value as string | undefined;
          const num = (k: string) => { const v = fv(k); if (v == null) return null; const n = Number(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) && String(v).replace(/[^0-9.]/g, "") !== "" ? n : null; };
          let items: { description: string; amount: number | null }[] = [];
          try { items = JSON.parse(fv("service_items") ?? "[]"); } catch { items = []; }
          if (!items.length && fv("service_description")) items = [{ description: String(fv("service_description")), amount: null }];
          const date = fv("service_date") && /^\d{4}-\d{2}-\d{2}$/.test(String(fv("service_date"))) ? String(fv("service_date")) : null;
          const mileage = num("current_odometer");
          const res = await recordServiceEvent(sb, actor, {
            vehicleId, performedOn: date, mileage: date ? mileage : null, vendorNameRaw: fv("vendor") ?? null,
            invoiceNumber: fv("invoice_number") ?? null, description: fv("service_description") ?? null, items,
            laborCost: num("labor_total"), partsCost: num("parts_total"), taxAmount: num("tax_total"), totalCost: num("total"),
            source: "fleet_inbox", documentId: item.document_id, documentPage: p.page, proposalId: p.id,
            originalExtraction: entry.fields,
          });
          serviceNote = res.duplicate ? " Service record already exists." : ` Service recorded${res.odometerStatus === "conflict" ? " — mileage flagged for review (odometer conflict)" : ""}.`;
          if (!date && mileage != null) serviceNote += " Mileage not recorded: the receipt has no readable service date.";
          const svcProv = ["service_date", "vendor", "invoice_number", "current_odometer", "total", "labor_total", "parts_total", "tax_total"].filter((k) => fv(k));
          if (svcProv.length) await sb.from("vehicle_field_provenance").upsert(svcProv.map((k) => ({
            vehicle_id: vehicleId, field: `service.${k}`, value: String(fv(k)), raw_value: (entry.fields[k] as any)?.raw ?? String(fv(k)),
            document_id: item.document_id, doc_class: docClass, authority: authorityOf(k, docClass), page: p.page,
            method: "ai_extraction", confidence: (entry.fields[k] as any)?.confidence ?? "medium", extracted_at: item.analyzed_at, confirmed_by: actor.userId, proposal_id: p.id,
          })), { onConflict: "proposal_id,field", ignoreDuplicates: true });
        } else if (odo != null && Number.isFinite(odo)) {
          const obs = (entry.fields.service_date as any)?.value ?? (item.analyzed_at ?? new Date().toISOString()).slice(0, 10);
          const src = docClass === "title" ? "title" : docClass === "registration" ? "registration" : docClass === "odometer_photo" ? "odometer_photo" : "fleet_inbox";
          const r = await addOdometerReading(sb, actor, { vehicleId, mileage: odo, observedOn: String(obs).slice(0, 10), sourceType: src, documentId: item.document_id, documentPage: p.page, evidenceKey: `doc:${item.document_id}:${vehicleId}:${p.page ?? 0}` });
          if (r.status === "conflict") serviceNote = " Mileage flagged for review (odometer conflict).";
        }
        if (written.length) {
          await sb.from("vehicle_field_provenance").upsert(written.map((c) => ({
            vehicle_id: vehicleId, field: c.field, value: c.proposed, raw_value: (entry.fields[c.field] as any)?.raw ?? c.proposed,
            document_id: item.document_id, doc_class: docClass, authority: authorityOf(c.field, docClass), page: p.page,
            method: "ai_extraction", confidence: c.confidence, extracted_at: item.analyzed_at, confirmed_by: actor.userId, proposal_id: p.id,
          })), { onConflict: "proposal_id,field", ignoreDuplicates: true });
        }

        // Finance facts only through the vehicle_finance boundary, Manager+, explicit opt-in, blanks only.
        let financeNote = "";
        if (dec.applyFinance) {
          if (!canOwnership) financeNote = " Finance details skipped (Owner only).";
          else {
            const { data: facts } = await sb.from("fleet_import_finance_facts").select("field,value").eq("proposal_id", p.id);
            const { data: cur } = await sb.from("vehicle_finance").select("*").eq("vehicle_id", vehicleId).maybeSingle();
            const fin: Record<string, unknown> = {};
            for (const ff of facts ?? []) {
              if (!dec.confirmHighRisk.includes(ff.field)) continue;
              if (cur && (cur as any)[ff.field] != null && (cur as any)[ff.field] !== "") continue; // never overwrite
              const num = ["purchase_price", "payoff_amount", "monthly_payment"].includes(ff.field);
              fin[ff.field] = num ? Number(String(ff.value).replace(/[^0-9.]/g, "")) || null : ff.field === "purchase_date" ? (/^\d{4}-\d{2}-\d{2}$/.test(ff.value) ? ff.value : null) : ff.value;
            }
            if (Object.keys(fin).length) {
              await sb.from("vehicle_finance").upsert({ vehicle_id: vehicleId, ...fin, updated_by: actor.userId } as any, { onConflict: "vehicle_id" });
              financeNote = ` ${Object.keys(fin).length} finance detail(s) recorded.`;
            }
          }
        }

        await logAudit(actor, {
          action: dec.action === "create" ? "fleet_inbox.vehicle_created" : "fleet_inbox.vehicle_updated",
          summary: dec.action === "create" ? `Created vehicle from Fleet Inbox (VIN …${(fresh.vin ?? "").slice(-6)})` : `Applied ${written.length} Fleet Inbox change(s)`,
          entityType: "vehicle", entityId: vehicleId,
          metadata: { proposal_id: p.id, document_id: item.document_id, fields: written.map((c) => c.field) },
        });
        const writtenSet = new Set(written.map((c) => c.field));
        const remaining = dec.partial && dec.action === "match" ? fresh.changes.filter((c) => !writtenSet.has(c.field)) : [];
        await finish(remaining.length ? "pending" : "applied", { proposalId: p.id, ok: true, vehicleId, message: (dec.action === "create" ? "Vehicle created." : `${written.length} change(s) applied.`) + serviceNote + financeNote }, vehicleId);
      } catch (e: any) {
        await finish("failed", { proposalId: p.id, ok: false, message: e?.message ?? "Failed." });
      }
    }
    // Items whose proposals are all resolved become applied.
    const { data: items } = await sb.from("fleet_import_items").select("id").eq("batch_id", data.batchId);
    for (const it of items ?? []) {
      const { data: ps } = await sb.from("fleet_import_proposals").select("status").eq("item_id", it.id);
      if (ps?.length && ps.every((x: any) => x.status === "applied" || x.status === "ignored") && ps.some((x: any) => x.status === "applied")) {
        await sb.from("fleet_import_items").update({ status: "applied" }).eq("id", it.id);
      }
    }
    await refreshBatchStatus(data.batchId);
    return { results };
  });

// ---------------------------------------------------------------- secure file view
export const getFleetDocumentFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ documentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const { data: doc } = await sb.from("documents").select("storage_bucket,storage_path,file_name,mime_type,driver_id,category,kind,evidence_class").eq("id", data.documentId).maybeSingle();
    if (!doc || doc.driver_id) throw new Error("Not found");
    // Priced invoices are mixed evidence: the original image itself carries costs and payment details.
    if (((doc as any).evidence_class === "mixed" || (doc as any).evidence_class === "financial") && !tierAllows(actor.tier, "manager")) throw new Error("Forbidden: this original contains financial details (Manager or Owner only).");
    // Loan / payoff / purchase paperwork stays inside the finance boundary.
    if ((docGroupOf(doc.category) === "Finance" || isFinanceKind((doc as any).kind) || isFinanceKind(doc.category) || doc.category === "title" || (doc as any).kind === "title") && !(await import("@/lib/experience.server")).ownerView(actor)) throw new Error("Forbidden: title, ownership and loan paperwork is Owner only.");
    const { data: file } = await sb.storage.from(doc.storage_bucket || BUCKET).download(doc.storage_path as string);
    if (!file) throw new Error("File unavailable");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(bin), mimeType: doc.mime_type || file.type || "application/octet-stream", fileName: doc.file_name || "document" };
  });

/** Documents related to a vehicle via links (one document → many vehicles). */
export const listVehicleLinkedDocs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const isManager = actor.tier === "manager" || actor.tier === "owner";
    const sb = await admin();
    // Same canonical loader as the vehicle profile; finance paperwork is
    // withheld from Coordinators here, not merely hidden in the UI.
    const { loadVehicleDocPresence } = await import("@/lib/vehicle-doc-presence.server");
    const pres = await loadVehicleDocPresence(sb, data.vehicleId, (await import("@/lib/experience.server")).ownerView(actor));
    if (!pres.linked.length) return [];
    const ids = pres.linked.map((d) => d.id);
    const [{ data: docs }, { data: links }] = await Promise.all([
      sb.from("documents").select("id,kind,label,file_name,created_at,is_current,review_status,source,expires_at").in("id", ids),
      sb.from("document_vehicle_links").select("document_id,page").eq("vehicle_id", data.vehicleId),
    ]);
    const rel = Object.fromEntries(pres.linked.map((d) => [d.id, d.relatedVehicles ?? 1]));
    const pageBy = Object.fromEntries((links ?? []).map((l: any) => [l.document_id, l.page]));
    return (docs ?? []).map((d: any) => ({ ...d, page: pageBy[d.id] ?? null, relatedVehicles: rel[d.id] ?? 1 }))
      .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
  });

// ---------------------------------------------------------------- service transactions
/** Re-read one file as service evidence from its private original (Manager+). Does not apply anything. */
export const reprocessServiceItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ itemId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    if (!tierAllows(actor.tier, "manager")) throw new Error("Forbidden");
    const sb = await admin();
    const { readServiceItem } = await import("@/lib/service-ingest.server");
    return readServiceItem(sb, data.itemId);
  });

/** Regroup a batch's service evidence into transactions (Manager+). Never applies. */
export const rebuildBatchServiceTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ batchId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    if (!tierAllows(actor.tier, "manager")) throw new Error("Forbidden");
    const sb = await admin();
    const { rebuildServiceTransactions } = await import("@/lib/service-ingest.server");
    const drafts = await rebuildServiceTransactions(sb, data.batchId);
    await refreshBatchStatus(data.batchId);
    await logAudit(actor, { action: "fleet_inbox.service_regrouped", summary: `Regrouped service evidence into ${drafts.length} transaction(s)`, entityType: "fleet_import_batch", entityId: data.batchId, metadata: { transactions: drafts.length } });
    return { transactions: drafts.length };
  });

/** Apply ONE service transaction: one service record, at most one linked expense, at most one mileage observation. Manager+. */
export const applyServiceTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    transactionId: z.string().uuid(), vehicleId: z.string().uuid(),
    acceptFields: z.array(z.enum(["color", "license_plate"])).default([]),
    acceptMileage: z.boolean().default(true),
    confirmFinancial: z.boolean().default(false),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    if (!tierAllows(actor.tier, "manager")) throw new Error("Forbidden: service transactions carry costs (Manager or Owner only).");
    const sb = await admin();
    const { data: t } = await sb.from("fleet_service_transactions").update({ status: "applying" }).eq("id", data.transactionId).in("status", ["pending", "failed"]).select("*").maybeSingle();
    if (!t) return { ok: false as const, message: "Already handled or in progress." };
    const fail = async (message: string) => { await sb.from("fleet_service_transactions").update({ status: "failed", result: { ok: false, message } }).eq("id", t.id); return { ok: false as const, message }; };
    try {
      const op = t.operational as any; const fin = t.financial as any;
      const { data: v } = await sb.from("vehicles").select("id,vin,color,license_plate").eq("id", data.vehicleId).maybeSingle();
      if (!v) return fail("Vehicle not found.");
      const docVin = op.identity?.vin?.value;
      if (docVin && v.vin && String(v.vin).toUpperCase() !== docVin) return fail(`VIN conflict: ${v.vin} on file vs ${docVin} on the invoice.`);
      if (op.applyPreview?.serviceRecords === 0) return fail("This is payment evidence without an invoice — attach it to a transaction instead.");
      const recOk = fin.reconciliation?.status === "reconciled";
      if (!recOk && !data.confirmFinancial) return fail("Financial reconciliation needs review — confirm the figures before applying.");
      const updates: Record<string, unknown> = {};
      for (const f of data.acceptFields) {
        const c = (op.vehicleChanges ?? []).find((x: any) => x.field === f && x.kind === "fill");
        if (c && !(v as any)[f]) updates[f] = f === "color" ? normalizeDisplayText(c.proposed) : c.proposed;
      }
      if (Object.keys(updates).length) await sb.from("vehicles").update(updates as any).eq("id", v.id);
      const { recordServiceEvent } = await import("@/lib/maintenance.server");
      const docIds: string[] = (t.evidence as any[]).filter((e) => e.usedAs !== "possible_payment" && e.documentId).map((e) => e.documentId);
      const primaryDoc = (t.evidence as any[]).find((e) => e.usedAs === "primary")?.documentId ?? docIds[0] ?? null;
      const s = fin.summary ?? {};
      const mileage = data.acceptMileage && op.mileage?.status === "proposed" ? op.mileage.canonical : null;
      const res = await recordServiceEvent(sb, actor, {
        vehicleId: v.id, performedOn: op.dates?.completed ?? null, mileage,
        mileageIn: op.mileage?.in?.value ? Number(op.mileage.in.value) : null, mileageOut: op.mileage?.out?.value ? Number(op.mileage.out.value) : null,
        vendorNameRaw: op.vendor ?? null, invoiceNumber: op.invoiceNumber ?? null,
        description: (fin.operations ?? []).map((o: any) => o.heading).join(" · ") || null,
        items: (fin.operations ?? []).map((o: any) => ({
          description: o.heading, category: o.category, amount: o.cost, quantity: null,
          originalHeading: o.heading, customerRequest: o.request ?? null, workPerformed: o.work ?? null, technicianNotes: o.techNotes ?? null,
          chargeType: o.chargeType, partsAmount: o.partsAmount, laborAmount: o.laborAmount, details: { parts: o.parts, code: o.code ?? null, sourceFiles: o.sourceFiles },
        })),
        laborCost: s.labor ?? null, partsCost: s.parts ?? null, taxAmount: s.tax ?? null,
        otherCost: (s.misc ?? 0) + (s.shopSupplies ?? 0) + (s.other ?? 0) || null, totalCost: s.total ?? null,
        warrantyCovered: s.warrantyCredit ?? null,
        paymentMethod: fin.payment?.methodState === "conflict" ? null : (fin.payment?.method ? (/debit|visa|master|card|credit/i.test(fin.payment.method) ? "card" : /cash/i.test(fin.payment.method) ? "cash" : "other") : null),
        paymentStatus: fin.payment?.state === "corroborated" ? "paid" : null,
        source: "fleet_inbox", documentId: primaryDoc, transactionId: t.id, linkDocumentIds: docIds,
        odometerEvidenceKey: `svc-tx:${t.id}`, originalExtraction: { operational: op, financial: fin },
      });
      await sb.from("fleet_service_transactions").update({ status: "applied", applied_vehicle_id: v.id, applied_by: actor.userId, applied_at: new Date().toISOString(), result: { ok: true, serviceRecordId: res.id } }).eq("id", t.id);
      await logAudit(actor, { action: "fleet_inbox.service_applied", summary: `Applied service transaction (${op.vendor ?? "vendor"} ${op.invoiceNumber ?? ""})`.trim(), entityType: "vehicle", entityId: v.id, metadata: { transaction_id: t.id, maintenance_record_id: res.id, documents: docIds, fields: Object.keys(updates), confirmed_financial: data.confirmFinancial } });
      await refreshBatchStatus(t.batch_id);
      return { ok: true as const, message: res.duplicate ? "Service record already exists." : "Service recorded." };
    } catch (e: any) { return fail(e?.message ?? "Failed."); }
  });

export const ignoreServiceTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ transactionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const { data: t } = await sb.from("fleet_service_transactions").update({ status: "ignored", applied_by: actor.userId, applied_at: new Date().toISOString() }).eq("id", data.transactionId).in("status", ["pending", "failed"]).select("batch_id").maybeSingle();
    if (t) await refreshBatchStatus(t.batch_id);
    return { ok: !!t };
  });

// ---------------------------------------------------------------- vehicle profile suggestions
/**
 * Evidence-backed suggestions for one vehicle, re-derived from existing Fleet Inbox
 * extractions (no new document processing). Only exact-VIN or explicitly matched
 * proposals produce suggestions; near-VIN / plate-only items are listed as
 * possible matches for review and never contribute values. Owner-only fields are
 * removed server-side for everyone else.
 */
export const getVehicleSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const canOwnership = (await import("@/lib/experience.server")).ownerView(actor);
    const sb = await admin();
    // Scale: one vehicle row, indexed proposal lookups — never the whole fleet.
    const { data: row } = await sb.from("vehicles").select("*").eq("id", data.vehicleId).maybeSingle();
    if (!row) throw new Error("Vehicle not found");
    const [target] = await (await core()).overlayTitles(sb, [row as any]);
    const vin = (target.vin ?? "").toUpperCase();
    const plate = (target.license_plate ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const cols = "id,batch_id,item_id,page,kind,vin,fields,match_vehicle_id,status,created_at";
    const open = ["pending", "failed"];
    const [{ data: exactRows }, { data: looseRows }] = await Promise.all([
      vin
        ? sb.from("fleet_import_proposals").select(cols).in("status", open).or(`vin.eq.${vin},match_vehicle_id.eq.${target.id}`).order("created_at", { ascending: false }).limit(200)
        : sb.from("fleet_import_proposals").select(cols).in("status", open).eq("match_vehicle_id", target.id).order("created_at", { ascending: false }).limit(200),
      // Unmatched open items only (small review queue), for possible-match hints.
      sb.from("fleet_import_proposals").select(cols).in("status", open).in("kind", ["unidentified", "new", "conflict"]).order("created_at", { ascending: false }).limit(500),
    ]);
    const seenIds = new Set<string>();
    const props = [...(exactRows ?? []), ...(looseRows ?? [])].filter((p: any) => (seenIds.has(p.id) ? false : (seenIds.add(p.id), true)));
    const itemIds = [...new Set((props ?? []).map((p: any) => p.item_id))];
    const { data: items } = itemIds.length
      ? await sb.from("fleet_import_items").select("id,document_id,file_name,doc_class,analyzed_at").in("id", itemIds)
      : { data: [] as any[] };
    const itemBy = Object.fromEntries((items ?? []).map((i: any) => [i.id, i]));
    const prov = await loadProvenance(sb, [target.id]);
    const diff = (a: string, b: string) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

    const suggestions: any[] = [];
    const conflicts: any[] = [];
    const possible: any[] = [];
    for (const p of props ?? []) {
      const it = itemBy[p.item_id];
      if (!it) continue;
      const pVin = String(p.vin ?? "").toUpperCase();
      const exact = (!!vin && pVin === vin) || (!pVin && p.match_vehicle_id === target.id);
      const source = { proposalId: p.id, batchId: p.batch_id, documentId: it.document_id, fileName: it.file_name, docClass: it.doc_class, page: p.page, analyzedAt: it.analyzed_at };
      if (!exact) {
        // Ambiguous evidence: report why, never its values.
        const pPlate = String((p.fields as any)?.license_plate?.value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        let reason: string | null = null;
        if (vin && pVin.length === 17 && diff(pVin, vin) <= 2) reason = `VIN ${pVin} differs from this car by ${diff(pVin, vin)} character(s)`;
        else if (vin && pVin.length >= 6 && pVin.length < 17 && vin.endsWith(pVin.slice(-6))) reason = "Partial VIN ends like this car's VIN";
        else if (plate && pPlate && pPlate === plate) reason = "License plate matches, but no VIN on the document";
        if (reason) possible.push({ ...source, reason });
        continue;
      }
      const entry: ExtractedEntry = { page: p.page, fields: withBodyType(((p.fields ?? {}) as unknown) as Record<string, ExtractedField>, target.model) };
      const fresh = buildProposal(entry, it.doc_class ?? "unknown", [target], prov);
      for (const c of fresh.changes) {
        if (!canOwnership && isOwnerOnlyField(c.field)) continue;
        // Never offer a value the save path can't store (e.g. body type "4D").
        if (coerce(c.field, c.proposed) == null) continue;
        const f: any = (entry.fields as any)[c.field] ?? {};
        const row = {
          ...source, field: c.field, label: c.label, current: c.current, proposed: normalizeDisplayField(c.field, c.proposed),
          confidence: c.confidence, risk: c.risk, kind: c.kind,
          // Safe = blank, non-sensitive field. VIN, plate, title, finance and mileage always need individual confirmation.
          safe: c.kind === "fill" && c.risk === "normal" && !["license_plate", "plate_state", "current_odometer", "vin"].includes(c.field),
          evidence: { raw: f.raw ?? null, note: f.note ?? null },
        };
        (c.kind === "fill" ? suggestions : conflicts).push(row);
      }
    }
    // One suggestion per field: highest-authority/most recent first already (ordered by created_at desc).
    const seen = new Set<string>();
    const unique = suggestions.filter((s) => (seen.has(s.field) ? false : (seen.add(s.field), true)));
    return { suggestions: unique, conflicts, possibleMatches: possible, canOwnership };
  });
