// Server-only: the one write path for service events and odometer readings.
// Manual entry (maintenance.functions.ts) and Fleet Inbox apply both call
// these, so a receipt becomes exactly one service event, one linked expense
// (one dollar counted once) and at most one mileage reading per evidence.
import type { Actor } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import { netServiceCost, normalizeCategory, sumKnown, vendorKey } from "@/lib/maintenance-rules";
import {
  DEFAULT_OIL_INTERVAL_MILES, INSPECTION_HISTORY_LIMIT, MILEAGE_LOG_LIMIT, MONTHLY_INTERVAL_DAYS, MONTHLY_ITEM, OIL_ITEM,
  isMonthlyItem, isOilItem, parseMiles, shapeVehicleMaintenance, sniffMaintenancePhoto,
  type InspectionRecordRow, type ReadingRow, type ScheduleRow, type VehicleMaintenanceView,
} from "@/lib/vehicle-maintenance";

export type ServiceItemInput = {
  description: string; category?: string | null; amount?: number | null; quantity?: number | null;
  originalHeading?: string | null; customerRequest?: string | null; workPerformed?: string | null; technicianNotes?: string | null;
  chargeType?: string | null; partsAmount?: number | null; laborAmount?: number | null; details?: unknown;
};
export type ServiceEventInput = {
  vehicleId: string;
  performedOn: string | null;
  status?: "open" | "completed";
  mileage?: number | null;
  mileageIn?: number | null; mileageOut?: number | null;
  vendorId?: string | null;
  vendorNameRaw?: string | null;
  invoiceNumber?: string | null;
  description?: string | null;
  items: ServiceItemInput[];
  laborCost?: number | null; partsCost?: number | null; taxAmount?: number | null; otherCost?: number | null;
  totalCost?: number | null; warrantyCovered?: number | null;
  paymentStatus?: string | null; paymentMethod?: string | null; priority?: string | null;
  notes?: string | null;
  source: "manual" | "fleet_inbox";
  documentId?: string | null; documentPage?: number | null;
  proposalId?: string | null;
  transactionId?: string | null;
  linkDocumentIds?: string[];
  odometerEvidenceKey?: string | null;
  originalExtraction?: unknown;
};

/** Match a vendor by normalized name; never creates duplicates. Returns null when no deterministic match. */
export async function matchVendor(sb: any, name: string | null | undefined): Promise<string | null> {
  const key = vendorKey(name);
  if (key.length < 3) return null;
  const { data } = await sb.from("vendors").select("id").eq("name_key", key).limit(2);
  return data?.length === 1 ? data[0].id : null;
}

export async function addOdometerReading(sb: any, actor: Actor | null, r: {
  vehicleId: string; mileage: number; observedOn: string; sourceType: string; sourceId?: string | null;
  documentId?: string | null; documentPage?: number | null; evidenceKey?: string | null; note?: string | null;
}): Promise<{ id: string | null; status: string | null; duplicate: boolean }> {
  const { data, error } = await sb.from("odometer_readings").insert({
    vehicle_id: r.vehicleId, mileage: Math.round(r.mileage), observed_on: r.observedOn, source_type: r.sourceType,
    source_id: r.sourceId ?? null, document_id: r.documentId ?? null, document_page: r.documentPage ?? null,
    evidence_key: r.evidenceKey ?? null, note: r.note ?? null, entered_by: actor?.userId ?? null,
  }).select("id,status").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { id: null, status: null, duplicate: true };
    throw new Error("Could not record the mileage reading.");
  }
  return { id: data.id, status: data.status, duplicate: false };
}

export async function recordServiceEvent(sb: any, actor: Actor, input: ServiceEventInput): Promise<{ id: string; duplicate: boolean; odometerStatus: string | null }> {
  if (input.transactionId) {
    const { data: existing } = await sb.from("maintenance_records").select("id").eq("transaction_id", input.transactionId).maybeSingle();
    if (existing) return { id: existing.id, duplicate: true, odometerStatus: null };
  }
  if (input.proposalId) {
    const { data: existing } = await sb.from("maintenance_records").select("id").eq("proposal_id", input.proposalId).maybeSingle();
    if (existing) return { id: existing.id, duplicate: true, odometerStatus: null };
  }
  const vendorId = input.vendorId ?? (await matchVendor(sb, input.vendorNameRaw));
  const items = input.items.filter((i) => i.description?.trim());
  const primaryCat = normalizeCategory(items[0]?.category ?? items[0]?.description ?? input.description);
  const title = items.length ? items.map((i) => i.description.trim()).slice(0, 3).join(" + ") + (items.length > 3 ? ` + ${items.length - 3} More` : "") : (input.description ?? "Service");
  const total = input.totalCost ?? sumKnown(input.laborCost, input.partsCost, input.taxAmount, input.otherCost) ?? sumKnown(...items.map((i) => i.amount ?? null));
  const completed = (input.status ?? "completed") === "completed";

  const { data: rec, error } = await sb.from("maintenance_records").insert({
    vehicle_id: input.vehicleId, item: title.slice(0, 200), category: primaryCat,
    status: completed ? "completed" : "in_progress", performed_on: input.performedOn, odometer: input.mileage ?? null,
    mileage_in: input.mileageIn ?? null, mileage_out: input.mileageOut ?? null, transaction_id: input.transactionId ?? null,
    vendor_id: vendorId, vendor_name_raw: input.vendorNameRaw ?? null, invoice_number: input.invoiceNumber ?? null,
    description: input.description ?? null, labor_cost: input.laborCost ?? null, parts_cost: input.partsCost ?? null,
    tax_amount: input.taxAmount ?? null, other_cost: input.otherCost ?? null, total_cost: total,
    warranty_covered: input.warrantyCovered ?? null, payment_status: input.paymentStatus ?? null,
    payment_method: input.paymentMethod ?? null, priority: input.priority ?? null, notes: input.notes ?? null,
    source: input.source, document_id: input.documentId ?? null, document_page: input.documentPage ?? null,
    proposal_id: input.proposalId ?? null, original_extraction: input.originalExtraction ?? null,
    completed_at: completed ? new Date().toISOString() : null, created_by: actor.userId,
  }).select("id").single();
  if (error) {
    if (input.transactionId && /duplicate|unique/i.test(error.message)) {
      const { data: again } = await sb.from("maintenance_records").select("id").eq("transaction_id", input.transactionId).single();
      return { id: again.id, duplicate: true, odometerStatus: null };
    }
    if (input.proposalId && /duplicate|unique/i.test(error.message)) {
      const { data: again } = await sb.from("maintenance_records").select("id").eq("proposal_id", input.proposalId).single();
      return { id: again.id, duplicate: true, odometerStatus: null };
    }
    throw new Error("Could not save the service record.");
  }
  if (items.length) {
    await sb.from("maintenance_record_items").insert(items.map((i, n) => ({
      // Full text is kept; the UI shows a preview with expandable details.
      record_id: rec.id, description: i.description.trim(), category: normalizeCategory(i.category ?? i.description),
      amount: i.amount ?? null, quantity: i.quantity ?? null, sort_order: n,
      original_heading: i.originalHeading ?? null, customer_request: i.customerRequest ?? null, work_performed: i.workPerformed ?? null,
      technician_notes: i.technicianNotes ?? null, charge_type: i.chargeType ?? null, parts_amount: i.partsAmount ?? null,
      labor_amount: i.laborAmount ?? null, details: i.details ?? null,
    })));
  }
  // Single financial truth: one expense row that points at this event.
  // The expense is what the business actually paid: invoice total minus warranty coverage.
  const net = netServiceCost(total, input.warrantyCovered ?? null);
  if (completed && net != null && net > 0) {
    await sb.from("vehicle_expenses").insert({
      vehicle_id: input.vehicleId, vendor_id: vendorId, category: "maintenance", description: title.slice(0, 200),
      amount: net, incurred_on: input.performedOn ?? new Date().toISOString().slice(0, 10),
      payment_method: input.paymentMethod ?? null, reference: input.invoiceNumber ?? null,
      maintenance_record_id: rec.id, created_by: actor.userId,
    });
  }
  let odometerStatus: string | null = null;
  if (input.mileage != null && input.performedOn) {
    const r = await addOdometerReading(sb, actor, {
      vehicleId: input.vehicleId, mileage: input.mileage, observedOn: input.performedOn, sourceType: "service",
      sourceId: rec.id, documentId: input.documentId ?? null, documentPage: input.documentPage ?? null,
      evidenceKey: input.odometerEvidenceKey ? input.odometerEvidenceKey : input.documentId ? `doc:${input.documentId}:${input.vehicleId}:${input.documentPage ?? 0}` : `service:${rec.id}`,
    });
    odometerStatus = r.status;
  }
  // Every supporting original (all pages, duplicate photos, payment slip) links to the vehicle once.
  for (const d of new Set([input.documentId, ...(input.linkDocumentIds ?? [])].filter(Boolean) as string[])) {
    await sb.from("document_vehicle_links").upsert({ document_id: d, vehicle_id: input.vehicleId, created_by: actor.userId }, { onConflict: "document_id,vehicle_id", ignoreDuplicates: true });
  }
  // Completed work rolls matching schedules forward (category match only — never guessed across categories).
  if (completed && input.performedOn) {
    const cats = new Set([primaryCat, ...items.map((i) => normalizeCategory(i.category ?? i.description))]);
    const { data: scheds } = await sb.from("maintenance_schedules").select("id,item,category,last_done_on").eq("vehicle_id", input.vehicleId).eq("is_active", true);
    for (const s of scheds ?? []) {
      if (!cats.has(normalizeCategory(s.item))) continue;
      if (s.last_done_on && s.last_done_on > input.performedOn) continue; // older receipt never rewinds
      await sb.from("maintenance_schedules").update({ last_done_on: input.performedOn, last_done_miles: input.mileage ?? null }).eq("id", s.id);
    }
  }
  await logAudit(actor, {
    action: "service.recorded", summary: `Recorded service: ${title.slice(0, 120)}`,
    entityType: "vehicle", entityId: input.vehicleId,
    metadata: { maintenance_record_id: rec.id, source: input.source, document_id: input.documentId ?? null, proposal_id: input.proposalId ?? null },
  });
  return { id: rec.id, duplicate: false, odometerStatus };
}

const DOC_BUCKET = "vehicle-docs";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Store one maintenance photo in the private vehicle-docs bucket and a
 * documents row. Staff pass bytes already uploaded under existingPath.
 * FLEET passes bytes and this function uploads them. Same-bytes for the
 * same vehicle and kind reuses the existing document.
 */
export async function saveMaintenancePhoto(
  sb: any,
  input: {
    vehicleId: string;
    bytes: Uint8Array;
    fileName: string;
    label: string;
    kind: "odometer_photo" | "inspection_photo";
    uploadedBy: string | null;
    uploadedByRole: string | null;
    existingPath?: string | null;
  },
): Promise<{ id: string; sha256: string; mime: string; size: number }> {
  if (input.bytes.byteLength > 20 * 1024 * 1024) throw new Error("The photo is over 20 MB.");
  const type = sniffMaintenancePhoto(input.bytes);
  if (!type) throw new Error("Only JPEG, PNG, WebP, or HEIC photos are accepted.");
  const sha = await sha256Hex(input.bytes);
  const { data: dups, error: dupErr } = await sb
    .from("documents")
    .select("id")
    .eq("content_sha256", sha)
    .eq("vehicle_id", input.vehicleId)
    .eq("kind", input.kind)
    .limit(1);
  if (dupErr) throw new Error("Could not check the photo.");
  const dup = (dups ?? [])[0];
  if (dup) {
    if (input.existingPath) await sb.storage.from(DOC_BUCKET).remove([input.existingPath]);
    return { id: dup.id as string, sha256: sha, mime: type.mime, size: input.bytes.byteLength };
  }
  let path = input.existingPath ?? null;
  if (!path) {
    path = `maintenance/${input.vehicleId}/${input.kind}-${crypto.randomUUID()}.${type.ext}`;
    const up = await sb.storage
      .from(DOC_BUCKET)
      .upload(path, input.bytes, { contentType: type.mime, upsert: false });
    if (up?.error) throw new Error("Could not store the photo.");
  }
  const { data: doc, error } = await sb
    .from("documents")
    .insert({
      kind: input.kind,
      category: input.kind,
      label: input.label.slice(0, 140),
      vehicle_id: input.vehicleId,
      storage_bucket: DOC_BUCKET,
      storage_path: path,
      file_name: input.fileName.slice(0, 200),
      mime_type: type.mime,
      size_bytes: input.bytes.byteLength,
      content_sha256: sha,
      is_current: true,
      visibility: ["admin"],
      evidence_class: "operational",
      uploaded_by: input.uploadedBy,
      uploaded_by_role: input.uploadedByRole,
      source: input.uploadedBy ? "service" : "fleet",
      review_status: "uploaded",
    })
    .select("id")
    .single();
  if (error || !doc) {
    if (!input.existingPath && path) await sb.storage.from(DOC_BUCKET).remove([path]);
    throw new Error("Could not save the photo.");
  }
  await sb
    .from("document_vehicle_links")
    .upsert(
      { document_id: doc.id, vehicle_id: input.vehicleId, created_by: input.uploadedBy },
      { onConflict: "document_id,vehicle_id", ignoreDuplicates: true },
    );
  return { id: doc.id as string, sha256: sha, mime: type.mime, size: input.bytes.byteLength };
}

/** Download a staff inbox upload, check it is a photo, and file it. */
export async function attachInboxPhoto(
  sb: any,
  input: {
    vehicleId: string;
    path: string;
    fileName: string | null;
    label: string;
    kind: "odometer_photo" | "inspection_photo";
    uploadedBy: string | null;
    uploadedByRole: string | null;
  },
): Promise<{ id: string; sha256: string; mime: string; size: number }> {
  const { data: file, error } = await sb.storage.from(DOC_BUCKET).download(input.path);
  if (error || !file) throw new Error("Photo upload was not found.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return await saveMaintenancePhoto(sb, {
      vehicleId: input.vehicleId,
      bytes,
      fileName: input.fileName || `photo.${sniffMaintenancePhoto(bytes)?.ext ?? "jpg"}`,
      label: input.label,
      kind: input.kind,
      uploadedBy: input.uploadedBy,
      uploadedByRole: input.uploadedByRole,
      existingPath: input.path,
    });
  } catch (err) {
    await sb.storage.from(DOC_BUCKET).remove([input.path]);
    throw err;
  }
}

const VEHICLE_COLUMNS =
  "id,license_plate,vin,year,make,model,current_odometer,odometer_updated_at,oil_interval_miles,archived_at";

export async function loadVehicleMaintenance(
  sb: any,
  vehicleId: string,
): Promise<VehicleMaintenanceView | null> {
  const [{ data: vehicle, error: vehicleErr }, schedules, readings, records] = await Promise.all([
    sb.from("vehicles").select(VEHICLE_COLUMNS).eq("id", vehicleId).maybeSingle(),
    sb
      .from("maintenance_schedules")
      .select(
        "id,item,interval_miles,interval_days,last_done_on,last_done_miles,next_due_on,next_due_miles,notes,is_active",
      )
      .eq("vehicle_id", vehicleId),
    sb
      .from("odometer_readings")
      .select("id,mileage,observed_on,source_type,note,status,document_id,evidence_key")
      .eq("vehicle_id", vehicleId)
      .order("observed_on", { ascending: false })
      .order("mileage", { ascending: false })
      .limit(MILEAGE_LOG_LIMIT + 1),
    sb
      .from("maintenance_records")
      .select("id,item,schedule_id,performed_on,odometer,notes,document_id,status,source")
      .eq("vehicle_id", vehicleId)
      .ilike("item", "monthly inspection")
      .order("performed_on", { ascending: false })
      .limit(INSPECTION_HISTORY_LIMIT + 1),
  ]);
  if (vehicleErr) throw new Error("Could not load the vehicle.");
  if (!vehicle) return null;
  if (schedules.error || readings.error || records.error)
    throw new Error("Could not load maintenance.");
  return shapeVehicleMaintenance({
    vehicle,
    schedules: (schedules.data ?? []) as ScheduleRow[],
    readings: (readings.data ?? []) as ReadingRow[],
    records: (records.data ?? []) as InspectionRecordRow[],
  });
}

async function scheduleByItem(
  sb: any,
  vehicleId: string,
  match: (item: unknown) => boolean,
): Promise<any | null> {
  const { data, error } = await sb
    .from("maintenance_schedules")
    .select("*")
    .eq("vehicle_id", vehicleId);
  if (error) throw new Error("Could not load the service schedule.");
  return ((data ?? []) as any[]).find((row) => match(row.item)) ?? null;
}

async function readSchedule(sb: any, id: string): Promise<any> {
  const { data, error } = await sb
    .from("maintenance_schedules")
    .select(
      "id,item,interval_miles,interval_days,last_done_on,last_done_miles,next_due_on,next_due_miles,notes",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw new Error("Could not read the service schedule.");
  return data;
}

/** Oil next due miles and date. Does not invent a last oil change and does not write vehicles.current_odometer. */
export async function saveOilNextDue(
  sb: any,
  input: {
    vehicleId: string;
    nextDueMiles?: number | null;
    nextDueOn?: string | null;
    notes?: string | null;
    intervalMiles?: number | null;
  },
): Promise<{ scheduleId: string; created: boolean; row: any }> {
  const existing = await scheduleByItem(sb, input.vehicleId, isOilItem);
  const patch: Record<string, unknown> = { is_active: true };
  if (input.nextDueMiles !== undefined) patch.next_due_miles = input.nextDueMiles;
  if (input.nextDueOn !== undefined) patch.next_due_on = input.nextDueOn;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.intervalMiles != null) patch.interval_miles = input.intervalMiles;
  if (existing) {
    const { error } = await sb.from("maintenance_schedules").update(patch).eq("id", existing.id);
    if (error) throw new Error("Could not save the next service due.");
    return { scheduleId: existing.id, created: false, row: await readSchedule(sb, existing.id) };
  }
  let interval = input.intervalMiles ?? null;
  if (interval == null) {
    const { data: vehicle } = await sb
      .from("vehicles")
      .select("oil_interval_miles")
      .eq("id", input.vehicleId)
      .maybeSingle();
    const fromVehicle = parseMiles(vehicle?.oil_interval_miles);
    interval = fromVehicle && fromVehicle > 0 ? fromVehicle : DEFAULT_OIL_INTERVAL_MILES;
  }
  const { data, error } = await sb
    .from("maintenance_schedules")
    .insert({
      vehicle_id: input.vehicleId,
      item: OIL_ITEM,
      category: "oil_change",
      interval_miles: interval,
      interval_days: null,
      next_due_miles: input.nextDueMiles ?? null,
      next_due_on: input.nextDueOn ?? null,
      notes: input.notes ?? null,
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("Could not save the next service due.");
  return { scheduleId: data.id, created: true, row: await readSchedule(sb, data.id) };
}

/**
 * Monthly inspection schedule plus one history row when a check is logged.
 * A check with no cost does not create an expense. Mileage, when sent, is
 * one odometer_readings row (current mileage stays trigger-derived).
 */
export async function saveMonthlyInspection(
  sb: any,
  actor: Actor | null,
  input: {
    vehicleId: string;
    lastDoneOn?: string | null;
    nextDueOn?: string | null;
    notes?: string | null;
    odometer?: number | null;
    documentId?: string | null;
    source: "manual" | "fleet";
  },
): Promise<{
  scheduleId: string;
  recordId: string | null;
  readingId: string | null;
  readingStatus: string | null;
  row: any;
}> {
  const existing = await scheduleByItem(sb, input.vehicleId, isMonthlyItem);
  const patch: Record<string, unknown> = {
    is_active: true,
    item: MONTHLY_ITEM,
    category: "inspection",
  };
  if (input.lastDoneOn !== undefined) patch.last_done_on = input.lastDoneOn;
  if (input.odometer !== undefined && input.lastDoneOn) patch.last_done_miles = input.odometer;
  if (input.nextDueOn !== undefined) patch.next_due_on = input.nextDueOn;
  if (input.notes !== undefined) patch.notes = input.notes;
  let scheduleId = existing?.id as string | undefined;
  if (existing) {
    if (existing.interval_days == null) patch.interval_days = MONTHLY_INTERVAL_DAYS;
    const { error } = await sb.from("maintenance_schedules").update(patch).eq("id", existing.id);
    if (error) throw new Error("Could not save the monthly inspection.");
  } else {
    const { data, error } = await sb
      .from("maintenance_schedules")
      .insert({
        vehicle_id: input.vehicleId,
        item: MONTHLY_ITEM,
        category: "inspection",
        interval_days: MONTHLY_INTERVAL_DAYS,
        interval_miles: null,
        last_done_on: input.lastDoneOn ?? null,
        last_done_miles: input.lastDoneOn ? (input.odometer ?? null) : null,
        next_due_on: input.nextDueOn ?? null,
        notes: input.notes ?? null,
        is_active: true,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error("Could not save the monthly inspection.");
    scheduleId = data.id;
  }
  let recordId: string | null = null;
  let readingId: string | null = null;
  let readingStatus: string | null = null;
  if (input.lastDoneOn) {
    const { data: rec, error } = await sb
      .from("maintenance_records")
      .insert({
        vehicle_id: input.vehicleId,
        schedule_id: scheduleId,
        item: MONTHLY_ITEM,
        category: "inspection",
        status: "completed",
        performed_on: input.lastDoneOn,
        completed_at: `${input.lastDoneOn}T17:00:00.000Z`,
        odometer: input.odometer ?? null,
        notes: input.notes ?? null,
        document_id: input.documentId ?? null,
        source: input.source,
        total_cost: 0,
        created_by: actor?.userId ?? null,
      })
      .select("id")
      .single();
    if (error || !rec) throw new Error("Could not save the monthly inspection history.");
    recordId = rec.id;
    if (input.documentId) {
      await sb
        .from("document_vehicle_links")
        .upsert(
          {
            document_id: input.documentId,
            vehicle_id: input.vehicleId,
            created_by: actor?.userId ?? null,
          },
          { onConflict: "document_id,vehicle_id", ignoreDuplicates: true },
        );
    }
    if (input.odometer != null) {
      const reading = await addOdometerReading(sb, actor, {
        vehicleId: input.vehicleId,
        mileage: input.odometer,
        observedOn: input.lastDoneOn,
        sourceType: "inspection",
        sourceId: rec.id,
        documentId: input.documentId ?? null,
        evidenceKey: `inspection:${rec.id}`,
        note: "Monthly Inspection",
      });
      readingId = reading.id;
      readingStatus = reading.status;
    }
  }
  return {
    scheduleId: scheduleId as string,
    recordId,
    readingId,
    readingStatus,
    row: await readSchedule(sb, scheduleId as string),
  };
}
