// Fleet Inbox: upload → classify → extract → identify → match → review → apply.
// AI proposes, the server validates, a person approves. Originals are stored
// once in the private vehicle-docs bucket and recorded in the existing
// `documents` vault; document_vehicle_links relates one document to many cars.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff } from "@/lib/roles.server";
import { tierAllows } from "@/lib/roles";
import { logAudit } from "@/lib/audit";
import {
  DOC_CLASSES, FINANCE_FIELDS, HIGH_RISK, VEHICLE_FIELDS, buildProposal, authorityOf, defaultWeeklyRate,
  isFinanceField, type ExistingVehicle, type ExtractedEntry, type ExtractedField, type ProvenanceIndex, type Change,
} from "@/lib/fleet-inbox";

const BUCKET = "vehicle-docs";
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
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
        id: b.id, label: b.label, status: b.status, created_at: b.created_at,
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
    return { itemId: item?.id as string, duplicate: false, existingFileName: null };
  });

// ---------------------------------------------------------------- analyze
const SYSTEM = `You read fleet paperwork for a car rental company: titles, registrations, insurance cards and policies, bills of sale, purchase agreements, loan/payoff statements, maintenance and repair invoices, inspection reports, tow receipts, accident reports, and photos (odometer, VIN plate, vehicle condition, damage).

Transcribe. Never infer, complete or correct. If a value is not printed, omit it. Unknown is better than invented. Never guess a VIN character; if any VIN character is uncertain, give confidence "low" and explain in note. Put the exact text as printed in "raw".

A single document may describe MANY vehicles (e.g. a PDF of several insurance cards, one per page). Return one entry per distinct vehicle, with the page number (1-based) where it appears. Values that apply to every vehicle (insurer, policy number, policy dates, named insured, shop name) go in "shared" once.

documentClass: one of ${DOC_CLASSES.join(", ")}. Use "unknown" if not confident.
Field names (only these): vin, year, make, model, trim, color, body_type, license_plate, plate_state, unit_number, title_number, title_status, registration_number, registration_state, registration_expires_on, insurance_carrier, insurance_policy_number, insurance_effective_on, insurance_expires_on, named_insured, current_odometer, service_date, vendor, service_description, parts_total, labor_total, total, legal_owner, lienholder, purchase_price, purchase_date, payoff_amount, loan_reference, monthly_payment.
body_type: sedan, suv, minivan, truck, van, coupe, hatchback, wagon, convertible, other. Dates YYYY-MM-DD. Money and mileage digits only (decimal point allowed for money).
confidence: high (clear), medium (legible but imperfect), low (unclear).

Respond ONLY with strict JSON:
{"documentClass":"...","classConfidence":"high|medium|low","pageCount":<int|null>,
 "shared":{"<field>":{"value":"...","raw":"...","confidence":"...","note":"..."}},
 "vehicles":[{"page":<int|null>,"fields":{"<field>":{...}}}],
 "warnings":["..."]}`;

const ALL_FIELDS = new Set<string>([
  ...VEHICLE_FIELDS, ...FINANCE_FIELDS, "unit_number", "named_insured", "service_date", "vendor",
  "service_description", "parts_total", "labor_total", "total",
]);

function cleanFields(o: any): Record<string, ExtractedField> {
  const out: Record<string, ExtractedField> = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    if (!ALL_FIELDS.has(k) || !v || typeof v !== "object") continue;
    const value = String((v as any).value ?? "").trim();
    if (!value) continue;
    const c = (v as any).confidence;
    out[k] = {
      value, raw: typeof (v as any).raw === "string" ? (v as any).raw : value,
      confidence: c === "high" || c === "medium" ? c : "low",
      note: typeof (v as any).note === "string" ? (v as any).note : undefined,
    };
  }
  return out;
}

async function loadVehicles(sb: any): Promise<ExistingVehicle[]> {
  const { data } = await sb.from("vehicles").select("*").is("archived_at", null);
  return (data ?? []) as ExistingVehicle[];
}
async function loadProvenance(sb: any, ids: string[]): Promise<ProvenanceIndex> {
  if (!ids.length) return {};
  const { data } = await sb.from("vehicle_field_provenance").select("vehicle_id,field,authority,confirmed_at").in("vehicle_id", ids).order("confirmed_at", { ascending: true });
  const idx: ProvenanceIndex = {};
  for (const r of data ?? []) (idx[r.vehicle_id] ??= {})[r.field] = r.authority; // latest wins
  return idx;
}

/** Build/refresh proposals for an item from its stored extraction. Never touches applied rows. */
async function buildItemProposals(sb: any, itemId: string) {
  const { data: item } = await sb.from("fleet_import_items").select("*").eq("id", itemId).single();
  const ex = item?.extraction ?? {};
  const docClass: string = item?.doc_class ?? "unknown";
  const shared = ex.shared ?? {};
  const entries: ExtractedEntry[] = (ex.vehicles ?? []).map((v: any) => ({ page: v.page ?? null, fields: { ...shared, ...(v.fields ?? {}) } }));

  const vehicles = await loadVehicles(sb);
  const prov = await loadProvenance(sb, vehicles.map((v) => v.id));
  const { data: existing } = await sb.from("fleet_import_proposals").select("id,entry_index,status").eq("item_id", itemId);
  const locked = new Set((existing ?? []).filter((p: any) => p.status !== "pending").map((p: any) => p.entry_index));
  await sb.from("fleet_import_proposals").delete().eq("item_id", itemId).eq("status", "pending");
  await sb.from("fleet_import_finance_facts").delete().eq("item_id", itemId);

  // VINs seen elsewhere in this batch (e.g. title + insurance for the same car).
  const { data: siblings } = await sb.from("fleet_import_proposals").select("vin,item_id").eq("batch_id", item.batch_id).neq("item_id", itemId);
  const seen = new Set((siblings ?? []).map((s: any) => s.vin).filter(Boolean));

  const vinCount: Record<string, number> = {};
  for (const e of entries) { const v = e.fields.vin?.value?.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (v) vinCount[v] = (vinCount[v] ?? 0) + 1; }

  for (let i = 0; i < entries.length; i++) {
    if (locked.has(i)) continue;
    const e = entries[i];
    const draft = buildProposal(e, docClass, vehicles, prov);
    if (draft.vin && vinCount[draft.vin] > 1) draft.issues.push("This VIN appears more than once in this document.");
    if (draft.vin && seen.has(draft.vin)) draft.issues.push("This VIN also appears in another file in this import.");
    const { data: p } = await sb.from("fleet_import_proposals").insert({
      batch_id: item.batch_id, item_id: itemId, entry_index: i, page: e.page ?? null, kind: draft.kind,
      vin: draft.vin, vin_raw: draft.vinRaw, vin_check: draft.vinCheck, identity: draft.identity,
      // Non-finance extracted facts only; finance goes to the manager-only table.
      fields: Object.fromEntries(Object.entries(e.fields).filter(([k]) => !isFinanceField(k))),
      match_vehicle_id: draft.matchVehicleId, match_basis: draft.matchBasis, changes: draft.changes, issues: draft.issues,
    }).select("id").single();
    const fin = Object.entries(e.fields).filter(([k]) => isFinanceField(k));
    if (fin.length && p) {
      await sb.from("fleet_import_finance_facts").insert(fin.map(([field, f]) => ({ item_id: itemId, proposal_id: p.id, field, value: (f as ExtractedField).value, confidence: (f as ExtractedField).confidence, page: e.page ?? null })));
    }
  }
}

async function refreshBatchStatus(batchId: string) {
  const sb = await admin();
  const { data: items } = await sb.from("fleet_import_items").select("status").eq("batch_id", batchId);
  const { data: props } = await sb.from("fleet_import_proposals").select("status,kind").eq("batch_id", batchId);
  const st = (items ?? []).map((i: any) => i.status);
  let status = "ready";
  if (st.some((s: string) => s === "uploaded" || s === "analyzing" || s === "matching")) status = "processing";
  else if (st.length && st.every((s: string) => s === "failed")) status = "failed";
  else {
    const ps = props ?? [];
    const pending = ps.filter((p: any) => p.status === "pending" || p.status === "failed");
    const done = ps.filter((p: any) => p.status === "applied" || p.status === "ignored");
    if (ps.length && !pending.length) status = done.some((p: any) => p.status === "applied") ? "applied" : "ready";
    else if (done.some((p: any) => p.status === "applied")) status = "partially_applied";
    else if (st.some((s: string) => s === "failed" || s === "needs_attention") || ps.some((p: any) => p.kind === "conflict" || p.kind === "unidentified")) status = "needs_attention";
  }
  await sb.from("fleet_import_batches").update({ status }).eq("id", batchId);
}

export const analyzeInboxItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ itemId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const sb = await admin();
    // Claim: only one analysis per item at a time.
    const { data: claimed } = await sb.from("fleet_import_items")
      .update({ status: "analyzing", error: null })
      .eq("id", data.itemId).in("status", ["uploaded", "failed", "needs_attention", "ready"])
      .select("*").maybeSingle();
    if (!claimed) return { ok: false as const, error: "This file is already being analyzed or has been applied." };
    await sb.from("fleet_import_items").update({ attempts: (claimed.attempts ?? 0) + 1 }).eq("id", data.itemId);

    const fail = async (msg: string) => {
      await sb.from("fleet_import_items").update({ status: "failed", error: msg }).eq("id", data.itemId);
      await refreshBatchStatus(claimed.batch_id);
      return { ok: false as const, error: msg };
    };
    const { data: doc } = await sb.from("documents").select("storage_bucket,storage_path,mime_type").eq("id", claimed.document_id).single();
    if (!doc) return fail("The original file record is missing.");
    const { data: file } = await sb.storage.from(doc.storage_bucket || BUCKET).download(doc.storage_path);
    if (!file) return fail("Could not read the original file.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = doc.mime_type || file.type || "application/octet-stream";
    if (!/^image\/(jpeg|png|webp|gif)$|^application\/pdf$/.test(mime)) {
      return fail(`This file type (${mime}) can't be analyzed. Classify it manually or attach it to a vehicle.`);
    }
    const { readDocument, parseModelJson } = await import("@/lib/document-reader.server");
    const read = await readDocument({ bytes, mime, system: SYSTEM, prompt: "Read this fleet document. Strict JSON only.", maxTokens: 8000 });
    if (!read.ok) return fail(read.error);
    let parsed: any;
    try { parsed = parseModelJson(read.text); } catch { return fail("The document could not be read. Retry, or classify it manually."); }

    const docClass = DOC_CLASSES.includes(parsed?.documentClass) ? parsed.documentClass : "unknown";
    const classConf = ["high", "medium", "low"].includes(parsed?.classConfidence) ? parsed.classConfidence : "low";
    const extraction = {
      shared: cleanFields(parsed?.shared),
      vehicles: (Array.isArray(parsed?.vehicles) ? parsed.vehicles : []).slice(0, 100).map((v: any) => ({
        page: Number.isFinite(Number(v?.page)) ? Number(v.page) : null, fields: cleanFields(v?.fields),
      })),
    };
    const warnings = Array.isArray(parsed?.warnings) ? parsed.warnings.filter((w: unknown) => typeof w === "string").slice(0, 10) : [];
    const pageCount = Number.isFinite(Number(parsed?.pageCount)) ? Number(parsed.pageCount) : null;

    await sb.from("fleet_import_items").update({
      status: "matching", doc_class: docClass, class_confidence: classConf, extraction, warnings, analyzed_at: new Date().toISOString(),
    }).eq("id", data.itemId);
    await sb.from("documents").update({ kind: docClass, category: docClass, page_count: pageCount }).eq("id", claimed.document_id);

    await buildItemProposals(sb, data.itemId);
    const needs = docClass === "unknown" || classConf === "low" || extraction.vehicles.length === 0;
    await sb.from("fleet_import_items").update({ status: needs ? "needs_attention" : "ready" }).eq("id", data.itemId);
    await refreshBatchStatus(claimed.batch_id);
    return { ok: true as const };
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
    if (item.extraction) await buildItemProposals(sb, data.itemId); // authority depends on class
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
export const getImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ batchId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireStaff(context.userId);
    const canFinance = tierAllows(actor.tier, "manager");
    const sb = await admin();
    const { data: batch } = await sb.from("fleet_import_batches").select("*").eq("id", data.batchId).maybeSingle();
    if (!batch) throw new Error("Not found");
    const { data: items } = await sb.from("fleet_import_items").select("id,document_id,duplicate_of_document_id,file_name,mime_type,size_bytes,status,doc_class,class_confidence,classified_manually,warnings,error,attempts,extraction,created_at").eq("batch_id", data.batchId).order("created_at");
    const { data: proposals } = await sb.from("fleet_import_proposals").select("*").eq("batch_id", data.batchId).order("created_at").order("entry_index");
    const finance = canFinance
      ? (await sb.from("fleet_import_finance_facts").select("proposal_id,field,value,confidence,page").in("item_id", (items ?? []).map((i: any) => i.id))).data ?? []
      : [];
    const { data: vehicles } = await sb.from("vehicles").select("id,year,make,model,vin,unit_number,license_plate,current_odometer").is("archived_at", null).order("created_at");
    // Strip finance facts from shared extraction for non-managers.
    const safeItems = (items ?? []).map((i: any) => {
      const ex = i.extraction ?? null;
      const strip = (o: any) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => canFinance || !isFinanceField(k)));
      return { ...i, extraction: ex ? { shared: strip(ex.shared), vehicleCount: (ex.vehicles ?? []).length } : null };
    });
    return { batch, items: safeItems, proposals: proposals ?? [], finance, vehicles: vehicles ?? [], canFinance };
  });

// ---------------------------------------------------------------- apply
const Decision = z.object({
  proposalId: z.string().uuid(),
  action: z.enum(["create", "match", "ignore"]),
  vehicleId: z.string().uuid().optional(),
  acceptFields: z.array(z.string()).max(60).default([]),
  confirmHighRisk: z.array(z.string()).max(60).default([]),
  applyFinance: z.boolean().default(false),
});

type ApplyResult = { proposalId: string; ok: boolean; vehicleId?: string; message: string };

const DATE_FIELDS = new Set(["registration_expires_on", "insurance_effective_on", "insurance_expires_on"]);
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
        const vehicles = await loadVehicles(sb);
        const entry: ExtractedEntry = { page: p.page, fields: p.fields ?? {} };
        let target: ExistingVehicle | null = null;
        if (dec.action === "match") {
          target = vehicles.find((v) => v.id === dec.vehicleId) ?? null;
          if (!target) throw new Error("Vehicle to match was not found.");
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
          toWrite[f] = val; written.push(c);
        }

        let vehicleId: string;
        if (dec.action === "create") {
          const row: Record<string, unknown> = {
            ...toWrite, vin: fresh.vin,
            year: coerce("year", entry.fields.year!.value), make: entry.fields.make!.value, model: entry.fields.model!.value,
            weekly_rate: defaultWeeklyRate((toWrite.body_type as string) ?? null),
          };
          if (row.current_odometer) row.odometer_updated_at = new Date().toISOString();
          const { data: v, error } = await sb.from("vehicles").insert(row as any).select("id").single();
          if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "A vehicle with this VIN, plate or unit number already exists." : "Could not create the vehicle.");
          vehicleId = v.id;
        } else {
          vehicleId = target!.id;
          if (Object.keys(toWrite).length) {
            if (toWrite.current_odometer) toWrite.odometer_updated_at = new Date().toISOString();
            const { error } = await sb.from("vehicles").update(toWrite as any).eq("id", vehicleId);
            if (error) throw new Error("Could not update the vehicle.");
          }
        }

        await sb.from("document_vehicle_links").upsert({ document_id: item.document_id, vehicle_id: vehicleId, page: p.page, created_by: actor.userId }, { onConflict: "document_id,vehicle_id", ignoreDuplicates: true });
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
          if (!canFinance) financeNote = " Finance details skipped (Manager or Owner only).";
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
        await finish("applied", { proposalId: p.id, ok: true, vehicleId, message: (dec.action === "create" ? "Vehicle created." : `${written.length} change(s) applied.`) + financeNote }, vehicleId);
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
    await requireStaff(context.userId);
    const sb = await admin();
    const { data: doc } = await sb.from("documents").select("storage_bucket,storage_path,file_name,mime_type,driver_id,category").eq("id", data.documentId).maybeSingle();
    if (!doc || doc.driver_id) throw new Error("Not found");
    const { data: file } = await sb.storage.from(doc.storage_bucket || BUCKET).download(doc.storage_path);
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
    await requireStaff(context.userId);
    const sb = await admin();
    const { data: links } = await sb.from("document_vehicle_links").select("document_id,page").eq("vehicle_id", data.vehicleId);
    const ids = (links ?? []).map((l: any) => l.document_id);
    if (!ids.length) return [];
    const { data: docs } = await sb.from("documents").select("id,kind,label,file_name,created_at,is_current,review_status,source,expires_at").in("id", ids).is("driver_id", null);
    const { data: all } = await sb.from("document_vehicle_links").select("document_id").in("document_id", ids);
    const count: Record<string, number> = {};
    for (const l of all ?? []) count[l.document_id] = (count[l.document_id] ?? 0) + 1;
    const pageBy = Object.fromEntries((links ?? []).map((l: any) => [l.document_id, l.page]));
    return (docs ?? []).map((d: any) => ({ ...d, page: pageBy[d.id] ?? null, relatedVehicles: count[d.id] ?? 1 }))
      .sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
  });
