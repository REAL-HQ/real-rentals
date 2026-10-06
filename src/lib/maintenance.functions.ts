// Phase 2 maintenance API. Server authorization is authoritative:
// staff (Coordinator+) can read service history and add readings/service,
// costs are stripped for Coordinators server-side, intervals are Owner-only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAudit } from "@/lib/audit";
import { tierAllows } from "@/lib/roles";
import {
  dueStatus, sortTimeline, categoryLabel, normalizeCategory, SOURCE_LABELS,
  type DueResult, type TimelineEvent,
} from "@/lib/maintenance-rules";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;
const today = () => new Date().toISOString().slice(0, 10);
const money = z.number().min(0).max(1_000_000).nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const COST_FIELDS = ["labor_cost", "parts_cost", "tax_amount", "other_cost", "total_cost", "warranty_covered", "company_share", "partner_share", "payment_status", "payment_method"];
const stripCosts = (r: any) => { const o = { ...r }; for (const f of COST_FIELDS) delete o[f]; return o; };

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Resolve schedules for a vehicle: company defaults + this vehicle's overrides/extras. */
async function loadSchedules(sb: any, vehicleId: string) {
  const [{ data: defs }, { data: own }] = await Promise.all([
    sb.from("maintenance_defaults").select("*").eq("is_active", true).order("item"),
    sb.from("maintenance_schedules").select("*").eq("vehicle_id", vehicleId).eq("is_active", true),
  ]);
  const byDefault = new Map((own ?? []).filter((s: any) => s.default_id).map((s: any) => [s.default_id, s]));
  const rows: any[] = [];
  for (const d of defs ?? []) {
    const s: any = byDefault.get(d.id);
    rows.push({
      key: `d:${d.id}`, default_id: d.id, schedule_id: s?.id ?? null, item: d.item, category: d.category,
      interval_miles: s?.is_override ? s.interval_miles : d.interval_miles,
      interval_days: s?.is_override ? s.interval_days : d.interval_days,
      company_miles: d.interval_miles, company_days: d.interval_days, is_override: !!s?.is_override,
      last_done_on: s?.last_done_on ?? null, last_done_miles: s?.last_done_miles ?? null,
    });
  }
  for (const s of own ?? []) if (!s.default_id) rows.push({
    key: `s:${s.id}`, default_id: null, schedule_id: s.id, item: s.item, category: s.category,
    interval_miles: s.interval_miles, interval_days: s.interval_days, company_miles: null, company_days: null,
    is_override: false, last_done_on: s.last_done_on, last_done_miles: s.last_done_miles,
  });
  return rows;
}

/** Last completed service per normalized category → fills last_done when a schedule row has none. */
function withHistory(rows: any[], records: any[]) {
  return rows.map((r) => {
    if (r.last_done_on) return r;
    const cat = normalizeCategory(r.item);
    const hit = records.filter((m) => m.status === "completed" && m.performed_on && (normalizeCategory(m.category) === cat || (m.items ?? []).some((i: any) => normalizeCategory(i.category) === cat)))
      .sort((a, b) => (a.performed_on < b.performed_on ? 1 : -1))[0];
    return hit ? { ...r, last_done_on: hit.performed_on, last_done_miles: hit.odometer ?? null } : r;
  });
}

export const getVehicleService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const canCost = tierAllows(actor.tier, "manager");
    const sb = await admin();
    const [{ data: v }, { data: recs }, { data: readings }, { data: down }] = await Promise.all([
      sb.from("vehicles").select("id,current_odometer,odometer_updated_at,status").eq("id", data.vehicleId).single(),
      sb.from("maintenance_records").select("*, vendors(name), maintenance_record_items(*)").eq("vehicle_id", data.vehicleId).order("performed_on", { ascending: false, nullsFirst: true }).limit(300),
      sb.from("odometer_readings").select("*").eq("vehicle_id", data.vehicleId).order("observed_on", { ascending: false }).order("mileage", { ascending: false }).limit(500),
      sb.from("vehicle_downtime").select("*").eq("vehicle_id", data.vehicleId).order("started_at", { ascending: false }).limit(50),
    ]);
    const records = ((recs ?? []) as any[]).map((r) => {
      const base = { ...r, vendor_name: r.vendors?.name ?? r.vendor_name_raw ?? null, items: (r.maintenance_record_items ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order) };
      delete base.vendors; delete base.maintenance_record_items; delete base.original_extraction;
      if (!canCost) base.items = base.items.map((i: any) => ({ ...i, amount: null }));
      return canCost ? base : stripCosts(base);
    });
    const current = v?.current_odometer ?? null;
    const schedules = withHistory(await loadSchedules(sb, data.vehicleId), records).map((s) => ({ ...s, due: dueStatus(s, current, today()) as DueResult }));
    const spend = canCost ? records.filter((r) => r.status === "completed").reduce((a, r) => a + Number(r.total_cost ?? 0), 0) : null;
    const downtimeDays = (down ?? []).reduce((a: number, d: any) => a + Math.max(0, ((d.ended_at ? Date.parse(d.ended_at) : Date.now()) - Date.parse(d.started_at)) / 86400000), 0);
    return {
      canCost, canManage: tierAllows(actor.tier, "manager"),
      currentMileage: current, mileageAsOf: v?.odometer_updated_at ?? null,
      records, readings: readings ?? [], schedules, downtime: down ?? [], downtimeDays: Math.round(downtimeDays * 10) / 10, spend,
    };
  });

const ServiceInput = z.object({
  vehicleId: z.string().uuid(),
  status: z.enum(["completed", "open"]).default("completed"),
  performedOn: isoDate.nullable(),
  mileage: z.number().int().min(0).max(2_000_000).nullable().optional(),
  vendorId: z.string().uuid().nullable().optional(),
  vendorName: z.string().trim().max(160).nullable().optional(),
  invoiceNumber: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  items: z.array(z.object({ description: z.string().trim().min(1).max(300), category: z.string().max(40).nullable().optional(), amount: money })).max(50).default([]),
  laborCost: money, partsCost: money, taxAmount: money, otherCost: money, totalCost: money, warrantyCovered: money,
  paymentMethod: z.string().max(20).nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  receiptPath: z.string().regex(/^inbox\/service-[A-Za-z0-9._-]+$/).nullable().optional(),
  receiptName: z.string().trim().max(200).nullable().optional(),
  receiptMime: z.string().max(120).nullable().optional(),
});

/** Store an uploaded receipt once in the private vault (content-deduped). */
async function storeReceipt(sb: any, actor: any, vehicleId: string, path: string, name: string | null, mime: string | null) {
  const { data: file } = await sb.storage.from("vehicle-docs").download(path);
  if (!file) throw new Error("Receipt upload not found.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = await sha256Hex(bytes);
  const { data: dup } = await sb.from("documents").select("id").eq("content_sha256", sha).is("driver_id", null).maybeSingle();
  if (dup) { await sb.storage.from("vehicle-docs").remove([path]); return { id: dup.id as string, duplicate: true }; }
  const { data: doc, error } = await sb.from("documents").insert({
    kind: "service_receipt", category: "service_receipt", label: name ?? "Service Receipt", vehicle_id: vehicleId,
    storage_bucket: "vehicle-docs", storage_path: path, file_name: name, mime_type: mime || file.type || null,
    size_bytes: bytes.byteLength, content_sha256: sha, is_current: true, visibility: ["admin"],
    uploaded_by: actor.userId, uploaded_by_role: actor.role, source: "service", review_status: "uploaded",
  }).select("id").single();
  if (error) throw new Error("Could not store the receipt.");
  await sb.from("document_vehicle_links").upsert({ document_id: doc.id, vehicle_id: vehicleId, created_by: actor.userId }, { onConflict: "document_id,vehicle_id", ignoreDuplicates: true });
  return { id: doc.id as string, duplicate: false };
}

export const addServiceEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ServiceInput.parse(d))
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const canCost = tierAllows(actor.tier, "manager");
    const sb = await admin();
    let documentId: string | null = null;
    if (data.receiptPath) {
      const r = await storeReceipt(sb, actor, data.vehicleId, data.receiptPath, data.receiptName ?? null, data.receiptMime ?? null);
      if (r.duplicate) {
        const { data: already } = await sb.from("maintenance_records").select("id").eq("document_id", r.id).limit(1);
        if (already?.length) return { ok: false as const, error: "This receipt is already on file for a service record." };
      }
      documentId = r.id;
    }
    const { recordServiceEvent } = await import("@/lib/maintenance.server");
    const c = (n: number | null | undefined) => (canCost ? n ?? null : null); // Coordinators can't enter finance
    const res = await recordServiceEvent(sb, actor, {
      vehicleId: data.vehicleId, performedOn: data.performedOn, status: data.status === "open" ? "open" : "completed",
      mileage: data.mileage ?? null, vendorId: data.vendorId ?? null, vendorNameRaw: data.vendorName ?? null,
      invoiceNumber: data.invoiceNumber ?? null, description: data.description ?? null,
      items: data.items.map((i) => ({ ...i, amount: c(i.amount) })),
      laborCost: c(data.laborCost), partsCost: c(data.partsCost), taxAmount: c(data.taxAmount), otherCost: c(data.otherCost),
      totalCost: c(data.totalCost), warrantyCovered: c(data.warrantyCovered), paymentMethod: canCost ? data.paymentMethod ?? null : null,
      priority: data.priority ?? null, notes: data.notes ?? null, source: "manual", documentId,
    });
    return { ok: true as const, id: res.id, odometerStatus: res.odometerStatus };
  });

export const addManualReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    vehicleId: z.string().uuid(), mileage: z.number().int().min(0).max(2_000_000), observedOn: isoDate,
    note: z.string().trim().max(500).nullable().optional(),
    supersedesId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    if (data.observedOn > today()) return { ok: false as const, error: "The reading date can't be in the future." };
    if (data.supersedesId && !data.reason) return { ok: false as const, error: "A correction needs a reason." };
    const sb = await admin();
    const { addOdometerReading } = await import("@/lib/maintenance.server");
    const r = await addOdometerReading(sb, actor, {
      vehicleId: data.vehicleId, mileage: data.mileage, observedOn: data.observedOn, sourceType: "manual",
      note: [data.note, data.reason ? `Correction: ${data.reason}` : null].filter(Boolean).join(" — ") || null,
    });
    if (data.supersedesId && r.id) {
      await sb.from("odometer_readings").update({ status: "superseded" }).eq("id", data.supersedesId).eq("vehicle_id", data.vehicleId);
      await sb.from("odometer_readings").update({ supersedes_id: data.supersedesId } as any).eq("id", r.id);
    }
    await logAudit(actor, {
      action: data.supersedesId ? "odometer.corrected" : "odometer.recorded",
      summary: `${data.supersedesId ? "Corrected" : "Recorded"} mileage ${data.mileage.toLocaleString("en-US")} mi`,
      entityType: "vehicle", entityId: data.vehicleId,
      metadata: { reading_id: r.id, supersedes: data.supersedesId ?? null, reason: data.reason ?? null, status: r.status },
    });
    return { ok: true as const, status: r.status };
  });

/** Staff confirm a flagged conflict as valid (evidence kept; nothing auto-corrected). */
export const resolveOdometerConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ readingId: z.string().uuid(), decision: z.enum(["valid", "superseded"]), reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const sb = await admin();
    const { data: r } = await sb.from("odometer_readings").update({ status: data.decision }).eq("id", data.readingId).eq("status", "conflict").select("vehicle_id,mileage").maybeSingle();
    if (!r) return { ok: false as const, error: "Reading is no longer flagged." };
    await logAudit(actor, { action: "odometer.conflict_resolved", summary: `Marked ${r.mileage} mi reading ${data.decision === "valid" ? "Valid" : "Not Used"}`, entityType: "vehicle", entityId: r.vehicle_id, metadata: { reading_id: data.readingId, reason: data.reason } });
    return { ok: true as const };
  });

/** Correct an evidence-backed service field: keeps original value, actor, time, reason. */
export const correctServiceEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(), reason: z.string().trim().max(500).nullable().optional(),
    changes: z.object({
      performed_on: isoDate.nullable().optional(), invoice_number: z.string().max(80).nullable().optional(),
      description: z.string().max(2000).nullable().optional(), notes: z.string().max(4000).nullable().optional(),
      total_cost: money, status: z.enum(["completed", "in_progress", "scheduled"]).optional(),
      vendor_id: z.string().uuid().nullable().optional(),
    }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const sb = await admin();
    const { data: before } = await sb.from("maintenance_records").select("*").eq("id", data.id).single();
    if (!before) return { ok: false as const, error: "Not found." };
    if (before.document_id && !data.reason) return { ok: false as const, error: "This record comes from a receipt — give a reason for the correction." };
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(data.changes)) if (v !== undefined && (before as any)[k] !== v) diff[k] = { from: (before as any)[k], to: v };
    if (!Object.keys(diff).length) return { ok: true as const };
    const patch: any = Object.fromEntries(Object.entries(diff).map(([k, d]) => [k, d.to]));
    if (patch.status === "completed" && !before.completed_at) patch.completed_at = new Date().toISOString();
    await sb.from("maintenance_records").update({ ...patch, updated_by: actor.userId }).eq("id", data.id);
    if ("total_cost" in patch) await sb.from("vehicle_expenses").update({ amount: patch.total_cost ?? 0 }).eq("maintenance_record_id", data.id);
    await logAudit(actor, { action: "service.corrected", summary: `Corrected service record (${Object.keys(diff).join(", ")})`, entityType: "vehicle", entityId: before.vehicle_id, metadata: { maintenance_record_id: data.id, diff, reason: data.reason ?? null } });
    return { ok: true as const };
  });

// ---------------------------------------------------------------- intervals (Settings → Fleet → Maintenance)
export const listMaintenanceDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const sb = await admin();
    const { data } = await sb.from("maintenance_defaults").select("*").order("item");
    return { defaults: data ?? [], canEdit: actor.tier === "owner" };
  });

export const saveMaintenanceDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid().nullable().optional(), item: z.string().trim().min(2).max(80),
    interval_miles: z.number().int().positive().max(200000).nullable(), interval_days: z.number().int().positive().max(3650).nullable(),
  }).refine((x) => x.interval_miles != null || x.interval_days != null, "Set miles, time or both.").parse(d))
  .handler(async ({ data, context }) => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const sb = await admin();
    const row = { item: data.item, category: normalizeCategory(data.item), interval_miles: data.interval_miles, interval_days: data.interval_days, updated_by: actor.userId };
    const { data: before } = data.id ? await sb.from("maintenance_defaults").select("*").eq("id", data.id).maybeSingle() : { data: null };
    const { error } = data.id ? await sb.from("maintenance_defaults").update(row).eq("id", data.id) : await sb.from("maintenance_defaults").insert(row);
    if (error) return { ok: false as const, error: /unique|duplicate/i.test(error.message) ? "That interval already exists." : "Could not save." };
    await logAudit(actor, { action: before ? "maintenance_default.updated" : "maintenance_default.created", summary: `${before ? "Changed" : "Added"} maintenance interval: ${data.item}`, entityType: "maintenance_default", entityId: data.id ?? null, metadata: { before, after: row } });
    return { ok: true as const };
  });

export const deleteMaintenanceDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const sb = await admin();
    const { data: before } = await sb.from("maintenance_defaults").update({ is_active: false }).eq("id", data.id).select("*").maybeSingle();
    if (before) await logAudit(actor, { action: "maintenance_default.retired", summary: `Retired maintenance interval: ${before.item}`, entityType: "maintenance_default", entityId: data.id, metadata: { before } });
    return { ok: true as const };
  });

/** Per-vehicle override of a company interval (null both = revert to company default). */
export const setVehicleInterval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    vehicleId: z.string().uuid(), defaultId: z.string().uuid(),
    interval_miles: z.number().int().positive().max(200000).nullable(), interval_days: z.number().int().positive().max(3650).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const sb = await admin();
    const { data: def } = await sb.from("maintenance_defaults").select("*").eq("id", data.defaultId).single();
    if (!def) return { ok: false as const, error: "Interval not found." };
    const revert = data.interval_miles == null && data.interval_days == null;
    const { data: existing } = await sb.from("maintenance_schedules").select("id").eq("vehicle_id", data.vehicleId).eq("default_id", data.defaultId).maybeSingle();
    const row = { vehicle_id: data.vehicleId, default_id: data.defaultId, item: def.item, category: def.category, is_override: !revert, interval_miles: revert ? def.interval_miles : data.interval_miles, interval_days: revert ? def.interval_days : data.interval_days, is_active: true };
    if (existing) await sb.from("maintenance_schedules").update(row).eq("id", existing.id);
    else await sb.from("maintenance_schedules").insert(row);
    await logAudit(actor, { action: "maintenance_interval.override", summary: revert ? `Reverted ${def.item} to company interval` : `Set vehicle ${def.item} interval`, entityType: "vehicle", entityId: data.vehicleId, metadata: { default_id: def.id, company: { miles: def.interval_miles, days: def.interval_days }, vehicle: revert ? null : { miles: data.interval_miles, days: data.interval_days } } });
    return { ok: true as const };
  });

// ---------------------------------------------------------------- fleet-wide (Service page)
export const getFleetMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const sb = await admin();
    const [{ data: vehicles }, { data: recs }, { data: conflicts }] = await Promise.all([
      sb.from("vehicles").select("id,unit_number,year,make,model,status,current_odometer").is("archived_at", null).order("unit_number"),
      sb.from("maintenance_records").select("id,vehicle_id,item,category,status,performed_on,odometer,maintenance_record_items(category)").not("vehicle_id", "is", null).limit(5000),
      sb.from("odometer_readings").select("vehicle_id,mileage,observed_on").eq("status", "conflict"),
    ]);
    const byVehicle = new Map<string, any[]>();
    for (const r of (recs ?? []) as any[]) { const a = byVehicle.get(r.vehicle_id) ?? []; a.push({ ...r, items: r.maintenance_record_items ?? [] }); byVehicle.set(r.vehicle_id, a); }
    const attention: any[] = []; const upcoming: any[] = [];
    for (const v of (vehicles ?? []) as any[]) {
      const rs = byVehicle.get(v.id) ?? [];
      const scheds = withHistory(await loadSchedules(sb, v.id), rs);
      for (const s of scheds) {
        const due = dueStatus(s, v.current_odometer, today());
        const row = { vehicle: v, item: s.item, due };
        if (due.state === "overdue" || due.state === "due") attention.push(row);
        else if (due.state === "due_soon") upcoming.push(row);
      }
      for (const r of rs.filter((x) => x.status === "in_progress" || x.status === "scheduled")) attention.push({ vehicle: v, item: r.item, due: { state: "open", reason: r.status === "in_progress" ? "Open Repair" : "Scheduled" } });
      if (v.status === "maintenance" && !rs.some((x) => x.status === "in_progress")) attention.push({ vehicle: v, item: "In Maintenance", due: { state: "open", reason: "Vehicle Status Is Maintenance" } });
    }
    for (const c of conflicts ?? []) {
      const v = (vehicles ?? []).find((x: any) => x.id === c.vehicle_id);
      if (v) attention.push({ vehicle: v, item: "Odometer", due: { state: "conflict", reason: `Needs Review — Odometer Conflict (${Number(c.mileage).toLocaleString("en-US")} mi on ${c.observed_on})` } });
    }
    const rank: Record<string, number> = { overdue: 0, conflict: 1, open: 2, due: 3 };
    attention.sort((a, b) => (rank[a.due.state] ?? 9) - (rank[b.due.state] ?? 9));
    return { attention, upcoming };
  });

// ---------------------------------------------------------------- vehicle timeline
export const getVehicleTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ events: TimelineEvent[] }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const isManager = tierAllows(actor.tier, "manager");
    const sb = await admin();
    const id = data.vehicleId;
    const [veh, links, recs, reads, insp, rents, incs, media, audits] = await Promise.all([
      sb.from("vehicles").select("created_at,unit_number").eq("id", id).single(),
      sb.from("document_vehicle_links").select("document_id,created_at,documents(kind,label,file_name,created_at)").eq("vehicle_id", id),
      sb.from("maintenance_records").select("id,item,status,performed_on,created_at,odometer,document_id,vendor_name_raw,vendors(name)").eq("vehicle_id", id),
      sb.from("odometer_readings").select("id,mileage,observed_on,source_type,status,document_id").eq("vehicle_id", id),
      sb.from("inspections").select("id,inspection_type,status,completed_at,created_at,odometer").eq("vehicle_id", id),
      sb.from("rentals").select("id,start_date,end_date,status").eq("vehicle_id", id),
      sb.from("incidents").select("id,incident_type,occurred_at,severity,status").eq("vehicle_id", id),
      sb.from("vehicle_media").select("id,created_at,published").eq("vehicle_id", id).eq("published", true),
      sb.from("audit_log").select("id,action,summary,created_at,metadata").eq("entity_type", "vehicle").eq("entity_id", id).ilike("action", "%status%").limit(200),
    ]);
    const ev: TimelineEvent[] = [];
    if (veh.data) ev.push({ id: `v:${id}`, kind: "vehicle", at: veh.data.created_at ?? "", title: "Vehicle Added", ref: { table: "vehicles", id } });
    const directDocs = await sb.from("documents").select("id,kind,label,file_name,created_at").eq("vehicle_id", id).is("driver_id", null);
    const seenDocs = new Set<string>();
    const pushDoc = (docId: string, d: any, at: string) => {
      if (seenDocs.has(docId) || !d) return; seenDocs.add(docId);
      const { isFinanceKind } = { isFinanceKind: (k: string) => /loan|payoff|purchase|lender/.test(k ?? "") };
      if (!isManager && isFinanceKind(d.kind)) return;
      ev.push({ id: `d:${docId}`, kind: "document", at, title: "Document Added", detail: d.label || d.file_name, ref: { table: "documents", id: docId }, evidenceDocumentId: docId });
    };
    for (const l of (links.data ?? []) as any[]) pushDoc(l.document_id, l.documents, l.documents?.created_at ?? l.created_at);
    for (const d of (directDocs.data ?? []) as any[]) pushDoc(d.id, d, d.created_at);
    for (const r of (recs.data ?? []) as any[]) ev.push({
      id: `m:${r.id}`, kind: "service", at: r.performed_on ?? r.created_at,
      title: r.status === "completed" ? "Service Completed" : "Service Opened",
      detail: [r.item, r.vendors?.name ?? r.vendor_name_raw, r.odometer != null ? `${Number(r.odometer).toLocaleString("en-US")} mi` : null].filter(Boolean).join(" · "),
      ref: { table: "maintenance_records", id: r.id }, evidenceDocumentId: r.document_id,
    });
    for (const r of (reads.data ?? []) as any[]) if (r.source_type !== "service") ev.push({
      id: `o:${r.id}`, kind: "mileage", at: r.observed_on, title: "Mileage Recorded",
      detail: `${Number(r.mileage).toLocaleString("en-US")} mi · ${SOURCE_LABELS[r.source_type] ?? r.source_type}${r.status === "conflict" ? " · Needs Review" : r.status === "superseded" ? " · Corrected" : ""}`,
      ref: { table: "odometer_readings", id: r.id }, evidenceDocumentId: r.document_id,
    });
    for (const i of (insp.data ?? []) as any[]) if (i.completed_at) ev.push({ id: `i:${i.id}`, kind: "inspection", at: i.completed_at, title: "Inspection Completed", detail: [categoryLabel(i.inspection_type), i.odometer ? `${Number(i.odometer).toLocaleString("en-US")} mi` : null].filter(Boolean).join(" · "), ref: { table: "inspections", id: i.id } });
    for (const r of (rents.data ?? []) as any[]) {
      ev.push({ id: `rs:${r.id}`, kind: "rental", at: r.start_date, title: "Rental Started", ref: { table: "rentals", id: r.id } });
      if (r.status !== "active" && r.end_date) ev.push({ id: `re:${r.id}`, kind: "rental", at: r.end_date, title: "Rental Ended", ref: { table: "rentals", id: r.id } });
    }
    for (const i of (incs.data ?? []) as any[]) ev.push({ id: `x:${i.id}`, kind: "incident", at: i.occurred_at, title: "Incident Recorded", detail: [categoryLabel(i.incident_type), i.severity].filter(Boolean).join(" · "), ref: { table: "incidents", id: i.id } });
    for (const m of (media.data ?? []) as any[]) ev.push({ id: `p:${m.id}`, kind: "photo", at: m.created_at, title: "Photo Published", ref: { table: "vehicle_media", id: m.id } });
    for (const a of (audits.data ?? []) as any[]) ev.push({ id: `a:${a.id}`, kind: "status", at: a.created_at, title: "Status Changed", detail: a.summary, ref: { table: "audit_log", id: a.id } });
    return { events: sortTimeline(ev.filter((e) => !!e.at)) };
  });
