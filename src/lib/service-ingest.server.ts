// Server-only: service-evidence reading and transaction (re)building for Fleet
// Inbox. The reader returns semantically labeled fields per source file; the
// pure rules in service-transaction.ts group files into transactions.
import { buildBatchTransactions, type ServicePageExtraction, type SourceItem, type CandidateVehicle, type ServiceTxDraft } from "@/lib/service-transaction";
import { docGroupOf } from "@/lib/fleet-inbox";

const BUCKET = "vehicle-docs";

export const SERVICE_SYSTEM = `You read ONE photo or PDF of automotive service paperwork for a car rental company: dealer repair orders / invoices (often multi-page), handwritten shop tickets, card-terminal payment slips, estimates.

Transcribe; never infer, complete or correct. Omit anything not printed. Put exact printed text in "raw". Use "label" for the printed header/label the value sits under.

Header semantics matter. Dealer invoices print a vehicle header table with distinct columns such as YEAR / MAKE/MODEL / VIN / LICENSE / MILEAGE IN / OUT / TAG. Read each value from ITS OWN column:
- vehicle.license = the LICENSE column only (a plate like 563BLU). Never put mileage, tag, RO or advisor numbers here.
- vehicle.tag = the dealer TAG / hang-tag number. It is NOT a plate and NOT the customer's unit number.
- vehicle.ownerUnit = only if the paperwork explicitly prints the CUSTOMER's own fleet unit number (e.g. "UNIT RR-005"). Otherwise omit.
- mileage.in / mileage.out = only values from MILEAGE / ODOMETER / MILES IN / OUT fields. Never take a number from the service advisor, RO, tag, phone, stock or part numbers.
- advisor = SERVICE ADVISOR name and number (e.g. "301957 ANDREW NELSON" → number "301957").
- vehicle.year: the printed vehicle year text as-is (may be "13"); label "vehicle_year".
Put every other 4+ digit identifier you see (RO, tag, stock, advisor, phone fragments) in otherNumbers with its label.

Pages: if the page prints "Page X of Y" (or a page number), set pageNumber/pageCount. invoiceNumber = the INVOICE / RO number as printed (it may be partly covered; give what is visible and note it).
legibility: clear | partial | poor. obscured=true if anything (a receipt, finger, fold) covers part of the document.

role: invoice_page (part of an invoice/RO), invoice_with_payment (an invoice photo that also shows a payment slip), payment_receipt (card terminal / payment slip alone), estimate, other.

Operations: one entry per automotive operation (a lettered/numbered job line, recall, inspection, diagnosis, repair). Keep the customer request, the work performed / cause / correction, technician notes, the parts (description, part number, quantity as printed, amount) and the labor amount INSIDE that one operation — do not split parts and labor into separate operations. Copy text in full. chargeType: paid | recall | warranty | no_charge | unknown as printed (recall/campaign codes like 20S30 are recall). lineTotal only if a total for that operation is printed.
NEVER list summary rows (LABOR AMOUNT, PARTS AMOUNT, MISC, PROVISIONS, SHOP SUPPLIES, SALES TAX, TOTAL CHARGES, AMOUNT DUE) as operations — put them in summary.
summary: the money summary printed on THIS page. totalKind: final_total only if this is the invoice's final total (TOTAL CHARGES / AMOUNT DUE / INVOICE TOTAL on the last page); page_subtotal / running_subtotal / line_total otherwise; unknown if unsure.
payment: invoicePaymentField = what the invoice's own PAYMENT / METHOD box says (e.g. CASH). For a card slip: amount, method (e.g. DEBIT), cardType (e.g. VISA), date, time. NEVER copy card numbers, auth codes or account digits.
dates (YYYY-MM-DD): opened, promised, ready, invoiceDate (INV. DATE), serviceDate (only if a single service date is printed).
Money: digits and decimal point only. Mileage: digits only.

warnings: short notes about legibility or uncertainty.

Respond ONLY with strict JSON:
{"role":"...","legibility":"...","obscured":false,"vendor":{"value":"","raw":"","confidence":"high|medium|low"},"invoiceNumber":{...},"pageNumber":null,"pageCount":null,"customer":{...},
 "vehicle":{"vin":{...},"year":{...,"label":"vehicle_year"},"make":{...},"model":{...},"color":{...},"license":{...},"licenseState":{...},"tag":{...},"ownerUnit":{...}},
 "mileage":{"in":{"value":"","label":"","confidence":""},"out":{...}},
 "advisor":{"name":"","number":""},"otherNumbers":[{"label":"","value":""}],
 "dates":{"opened":{...},"promised":{...},"ready":{...},"invoiceDate":{...},"serviceDate":{...}},
 "payment":{"invoicePaymentField":{...},"amount":{...},"method":{...},"cardType":{...},"date":{...},"time":{...}},
 "operations":[{"code":"","heading":"","request":"","work":"","techNotes":"","parts":[{"description":"","partNumber":"","quantity":"","amount":""}],"labor":"","lineTotal":"","chargeType":"","category":""}],
 "summary":{"labor":{...},"parts":{...},"misc":{...},"shopSupplies":{...},"tax":{...},"warrantyCredit":{...},"vendorCredit":{...},"other":{...},"total":{...},"totalKind":"..."},
 "warnings":[]}`;

export function isServiceClass(docClass: string | null | undefined) {
  return docGroupOf(docClass) === "Maintenance" || docClass === "tow_receipt";
}

function cleanFV(v: any) {
  if (!v || typeof v !== "object") return undefined;
  const value = String(v.value ?? "").trim();
  if (!value) return undefined;
  const c = v.confidence;
  return { value, raw: typeof v.raw === "string" ? v.raw : value, confidence: c === "high" || c === "medium" ? c : "low", label: typeof v.label === "string" ? v.label : undefined } as any;
}

/** Normalize the reader's JSON into ServicePageExtraction; drops unknown keys and card digits. */
export function cleanServiceExtraction(p: any): ServicePageExtraction {
  const fvObj = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, cleanFV(o?.[k])]).filter(([, v]) => v));
  const roles = ["invoice_page", "invoice_with_payment", "payment_receipt", "estimate", "other"];
  const num = (x: any) => (Number.isFinite(Number(x)) && x !== null && x !== "" ? Number(x) : null);
  const ops = (Array.isArray(p?.operations) ? p.operations : []).slice(0, 80).map((o: any) => ({
    code: o?.code ? String(o.code) : undefined, heading: String(o?.heading ?? "").trim(),
    request: o?.request ? String(o.request) : undefined, work: o?.work ? String(o.work) : undefined, techNotes: o?.techNotes ? String(o.techNotes) : undefined,
    parts: (Array.isArray(o?.parts) ? o.parts : []).slice(0, 40).map((x: any) => ({ description: String(x?.description ?? "").trim(), partNumber: x?.partNumber ? String(x.partNumber) : undefined, quantity: x?.quantity ? String(x.quantity) : undefined, amount: x?.amount ? String(x.amount) : undefined })).filter((x: any) => x.description),
    labor: o?.labor ? String(o.labor) : undefined, lineTotal: o?.lineTotal ? String(o.lineTotal) : undefined,
    chargeType: o?.chargeType ? String(o.chargeType) : undefined, category: o?.category ? String(o.category) : undefined,
  })).filter((o: any) => o.heading);
  const payment = fvObj(p?.payment, ["invoicePaymentField", "amount", "method", "cardType", "date", "time"]);
  return {
    role: roles.includes(p?.role) ? p.role : "other",
    legibility: ["clear", "partial", "poor"].includes(p?.legibility) ? p.legibility : "partial",
    obscured: !!p?.obscured,
    vendor: cleanFV(p?.vendor), invoiceNumber: cleanFV(p?.invoiceNumber), customer: cleanFV(p?.customer),
    pageNumber: num(p?.pageNumber), pageCount: num(p?.pageCount),
    vehicle: fvObj(p?.vehicle, ["vin", "year", "make", "model", "color", "license", "licenseState", "tag", "ownerUnit"]),
    mileage: fvObj(p?.mileage, ["in", "out"]),
    advisor: p?.advisor ? { name: p.advisor.name ? String(p.advisor.name) : undefined, number: p.advisor.number ? String(p.advisor.number) : undefined } : undefined,
    otherNumbers: (Array.isArray(p?.otherNumbers) ? p.otherNumbers : []).slice(0, 30).map((o: any) => ({ label: String(o?.label ?? ""), value: String(o?.value ?? "") })).filter((o: any) => o.value),
    dates: fvObj(p?.dates, ["opened", "promised", "ready", "invoiceDate", "serviceDate"]),
    payment,
    operations: ops,
    summary: { ...fvObj(p?.summary, ["labor", "parts", "misc", "shopSupplies", "tax", "warrantyCredit", "vendorCredit", "other", "total"]), totalKind: ["final_total", "page_subtotal", "running_subtotal", "line_total", "unknown"].includes(p?.summary?.totalKind) ? p.summary.totalKind : "unknown" },
    warnings: (Array.isArray(p?.warnings) ? p.warnings : []).filter((w: unknown) => typeof w === "string").slice(0, 12),
  };
}

/** Read one item as service evidence and store it under extraction.service (original extraction kept). */
export async function readServiceItem(sb: any, itemId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: item } = await sb.from("fleet_import_items").select("id,document_id,extraction").eq("id", itemId).single();
  if (!item?.document_id) return { ok: false, error: "Source document is missing." };
  const { data: doc } = await sb.from("documents").select("storage_bucket,storage_path,mime_type").eq("id", item.document_id).single();
  if (!doc) return { ok: false, error: "The original file record is missing." };
  const { data: file } = await sb.storage.from(doc.storage_bucket || BUCKET).download(doc.storage_path);
  if (!file) return { ok: false, error: "Could not read the original file." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = doc.mime_type || file.type || "image/jpeg";
  const { readDocument, parseModelJson } = await import("@/lib/document-reader.server");
  const read = await readDocument({ bytes, mime, system: SERVICE_SYSTEM, prompt: "Read this service document. Strict JSON only.", maxTokens: 12000 });
  if (!read.ok) return { ok: false, error: read.error };
  let parsed: any;
  try { parsed = parseModelJson(read.text); } catch { return { ok: false, error: "The service document could not be read." }; }
  const service = cleanServiceExtraction(parsed);
  await sb.from("fleet_import_items").update({ extraction: { ...(item.extraction ?? {}), service, service_read_at: new Date().toISOString() } }).eq("id", itemId);
  await sb.from("documents").update({ evidence_class: "mixed" }).eq("id", item.document_id);
  return { ok: true };
}

/** Rebuild all pending service transactions for a batch from stored per-file evidence. Applied ones are never touched. */
export async function rebuildServiceTransactions(sb: any, batchId: string): Promise<ServiceTxDraft[]> {
  const { data: items } = await sb.from("fleet_import_items").select("id,document_id,file_name,status,extraction").eq("batch_id", batchId);
  const { data: applied } = await sb.from("fleet_service_transactions").select("item_ids").eq("batch_id", batchId).eq("status", "applied");
  const lockedItems = new Set((applied ?? []).flatMap((t: any) => t.item_ids ?? []));
  const src: SourceItem[] = (items ?? [])
    .filter((i: any) => i.extraction?.service && i.status !== "duplicate" && !lockedItems.has(i.id))
    .map((i: any) => ({ itemId: i.id, documentId: i.document_id, fileName: i.file_name, service: i.extraction.service }));
  const { data: vehicles } = await sb.from("vehicles").select("id,unit_number,year,make,model,color,license_plate,vin").is("archived_at", null);
  const drafts = buildBatchTransactions(src, (vehicles ?? []) as CandidateVehicle[]);
  await sb.from("fleet_service_transactions").update({ status: "superseded" }).eq("batch_id", batchId).in("status", ["pending", "failed"]);
  for (const d of drafts) {
    await sb.from("fleet_service_transactions").insert({
      batch_id: batchId, group_key: d.groupKey, item_ids: d.itemIds, kind: d.kind, match_vehicle_id: d.matchVehicleId,
      match_basis: d.matchBasis, operational: d.operational, financial: d.financial, evidence: d.operational.evidence,
    });
  }
  // The old one-file-one-proposal rows for service evidence are kept but retired.
  const ids = src.map((s) => s.itemId);
  if (ids.length) await sb.from("fleet_import_proposals").update({ status: "superseded" }).in("item_id", ids).in("status", ["pending", "failed"]);
  return drafts;
}

/** Coordinator-safe projection: operational half only. Financial half and raw model text never leave the server. */
export function operationalView(t: any) {
  const { financial: _f, ...rest } = t;
  return { ...rest, financial: null };
}
