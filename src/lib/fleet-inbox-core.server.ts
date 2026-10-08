// Server-only core of Fleet Inbox analysis. Shared by the staff "Analyze /
// Retry" action and the background job worker, so there is exactly one
// analysis path (claim → read → classify → proposals / service transactions).
import { isFinanceField, DOC_CLASSES, FINANCE_FIELDS, VEHICLE_FIELDS, buildProposal, docGroupOf, type ExistingVehicle, type ExtractedEntry, type ExtractedField, type ProvenanceIndex } from "@/lib/fleet-inbox";

const BUCKET = "vehicle-docs";
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

const SYSTEM = `You read fleet paperwork for a car rental company: titles, registrations, insurance cards and policies, bills of sale, purchase agreements, loan/payoff statements, maintenance and repair invoices, inspection reports, tow receipts, accident reports, and photos (odometer, VIN plate, vehicle condition, damage).

Transcribe. Never infer, complete or correct. If a value is not printed, omit it. Unknown is better than invented. Never guess a VIN character; if any VIN character is uncertain, give confidence "low" and explain in note. Put the exact text as printed in "raw".

A single document may describe MANY vehicles (e.g. a PDF of several insurance cards, one per page). Return one entry per distinct vehicle, with the page number (1-based) where it appears. Values that apply to every vehicle (insurer, policy number, policy dates, named insured, shop name) go in "shared" once.

documentClass: one of ${DOC_CLASSES.join(", ")}. Use "unknown" if not confident.
Field names (only these): vin, year, make, model, trim, color, body_type, license_plate, plate_state, unit_number, title_number, title_status, registration_number, registration_state, registration_expires_on, insurance_carrier, insurance_policy_number, insurance_effective_on, insurance_expires_on, named_insured, current_odometer, service_date, vendor, invoice_number, service_description, parts_total, labor_total, tax_total, total, legal_owner, lienholder, purchase_price, purchase_date, payoff_amount, loan_reference, monthly_payment.
body_type: sedan, suv, minivan, truck, van, coupe, hatchback, wagon, convertible, other. Dates YYYY-MM-DD. Money and mileage digits only (decimal point allowed for money).
confidence: high (clear), medium (legible but imperfect), low (unclear).
For service/repair/maintenance receipts: current_odometer is the mileage printed on the invoice; also list each service line on that vehicle's entry as "serviceItems":[{"description":"as printed","amount":"digits or omit"}]. Never invent a line, amount, mileage, date, vendor or invoice number.

Respond ONLY with strict JSON:
{"documentClass":"...","classConfidence":"high|medium|low","pageCount":<int|null>,
 "shared":{"<field>":{"value":"...","raw":"...","confidence":"...","note":"..."}},
 "vehicles":[{"page":<int|null>,"fields":{"<field>":{...}},"serviceItems":[...]}],
 "warnings":["..."]}`;

const ALL_FIELDS = new Set<string>([
  ...VEHICLE_FIELDS, ...FINANCE_FIELDS, "unit_number", "named_insured", "service_date", "vendor",
  "service_description", "parts_total", "labor_total", "total", "invoice_number", "tax_total", "service_items",
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

/** Service lines kept as one JSON field so the existing proposal shape carries them unchanged. */
function withServiceItems(f: Record<string, ExtractedField>, items: unknown): Record<string, ExtractedField> {
  if (!Array.isArray(items)) return f;
  const clean = items.slice(0, 50).map((i: any) => ({
    description: String(i?.description ?? "").trim().slice(0, 300),
    amount: i?.amount != null && String(i.amount).replace(/[^0-9.]/g, "") !== "" ? Number(String(i.amount).replace(/[^0-9.]/g, "")) : null,
  })).filter((i) => i.description);
  if (!clean.length) return f;
  return { ...f, service_items: { value: JSON.stringify(clean), confidence: "medium" } };
}

export async function loadVehicles(sb: any): Promise<ExistingVehicle[]> {
  const { data } = await sb.from("vehicles").select("*").is("archived_at", null);
  return (data ?? []) as ExistingVehicle[];
}
export async function loadProvenance(sb: any, ids: string[]): Promise<ProvenanceIndex> {
  if (!ids.length) return {};
  const { data } = await sb.from("vehicle_field_provenance").select("vehicle_id,field,authority,confirmed_at").in("vehicle_id", ids).order("confirmed_at", { ascending: true });
  const idx: ProvenanceIndex = {};
  for (const r of data ?? []) (idx[r.vehicle_id] ??= {})[r.field] = r.authority; // latest wins
  return idx;
}

/** Build/refresh proposals for an item from its stored extraction. Never touches applied rows. */
export async function buildItemProposals(sb: any, itemId: string) {
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

export async function refreshBatchStatus(batchId: string) {
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
  const { data: txs } = await sb.from("fleet_service_transactions").select("status,kind").eq("batch_id", batchId).neq("status", "superseded");
  const openTx = (txs ?? []).filter((t: any) => t.status === "pending" || t.status === "failed");
  if (status !== "processing" && openTx.some((t: any) => t.kind !== "match")) status = "needs_attention";
  else if (status === "ready" && (txs ?? []).some((t: any) => t.status === "applied") && !openTx.length) status = "applied";
  await sb.from("fleet_import_batches").update({ status }).eq("id", batchId);
}
