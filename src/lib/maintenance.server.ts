// Server-only: the one write path for service events and odometer readings.
// Manual entry (maintenance.functions.ts) and Fleet Inbox apply both call
// these, so a receipt becomes exactly one service event, one linked expense
// (one dollar counted once) and at most one mileage reading per evidence.
import type { Actor } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import { netServiceCost, normalizeCategory, sumKnown, vendorKey } from "@/lib/maintenance-rules";

export type ServiceItemInput = { description: string; category?: string | null; amount?: number | null; quantity?: number | null };
export type ServiceEventInput = {
  vehicleId: string;
  performedOn: string | null;
  status?: "open" | "completed";
  mileage?: number | null;
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
    if (input.proposalId && /duplicate|unique/i.test(error.message)) {
      const { data: again } = await sb.from("maintenance_records").select("id").eq("proposal_id", input.proposalId).single();
      return { id: again.id, duplicate: true, odometerStatus: null };
    }
    throw new Error("Could not save the service record.");
  }
  if (items.length) {
    await sb.from("maintenance_record_items").insert(items.map((i, n) => ({
      record_id: rec.id, description: i.description.trim().slice(0, 300), category: normalizeCategory(i.category ?? i.description),
      amount: i.amount ?? null, quantity: i.quantity ?? null, sort_order: n,
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
      evidenceKey: input.documentId ? `doc:${input.documentId}:${input.vehicleId}:${input.documentPage ?? 0}` : `service:${rec.id}`,
    });
    odometerStatus = r.status;
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
