// Service transaction intelligence — pure, client-safe rules (no I/O).
//
// A service transaction is the REVIEW UNIT for maintenance evidence, not the
// uploaded file. Source files → per-page evidence → grouping (invoice number,
// vendor, VIN, page numbers, payment amount) → ONE proposed transaction with
// operations, one financial summary, payment reconciliation and at most one
// canonical mileage observation. Every chosen value keeps its source file.
//
// Output is split into OPERATIONAL facts (safe for Coordinators) and FINANCIAL
// facts (Manager/Owner only). Model free text (request / work / tech notes /
// warnings) is financial by construction: it can embed printed amounts, so it
// is never placed in the operational half.
import { checkVin, normalizeVin } from "@/lib/vin";
import { normalizeCategory, vendorKey } from "@/lib/maintenance-rules";

export type Conf = "high" | "medium" | "low";
export type FV = { value: string; raw?: string; confidence?: Conf; label?: string };

export type ServiceOp = {
  code?: string; heading: string; request?: string; work?: string; techNotes?: string;
  parts?: { description: string; partNumber?: string; quantity?: string; amount?: string }[];
  labor?: string; lineTotal?: string; chargeType?: string; category?: string;
};

/** What the reader returns per source file (one image / one PDF). */
export type ServicePageExtraction = {
  role: "invoice_page" | "invoice_with_payment" | "payment_receipt" | "estimate" | "other";
  legibility?: "clear" | "partial" | "poor";
  obscured?: boolean;
  vendor?: FV; invoiceNumber?: FV; pageNumber?: number | null; pageCount?: number | null; customer?: FV;
  vehicle?: { vin?: FV; year?: FV; make?: FV; model?: FV; color?: FV; license?: FV; licenseState?: FV; tag?: FV; ownerUnit?: FV };
  mileage?: { in?: FV; out?: FV };
  advisor?: { name?: string; number?: string };
  otherNumbers?: { label: string; value: string }[];
  dates?: { opened?: FV; promised?: FV; ready?: FV; invoiceDate?: FV; serviceDate?: FV };
  payment?: { invoicePaymentField?: FV; amount?: FV; method?: FV; cardType?: FV; date?: FV; time?: FV };
  operations?: ServiceOp[];
  summary?: {
    labor?: FV; parts?: FV; misc?: FV; shopSupplies?: FV; tax?: FV; warrantyCredit?: FV; vendorCredit?: FV; other?: FV;
    total?: FV; totalKind?: "final_total" | "page_subtotal" | "running_subtotal" | "line_total" | "unknown";
  };
  warnings?: string[];
};

export type SourceItem = { itemId: string; documentId: string | null; fileName: string; service: ServicePageExtraction };

export type CandidateVehicle = {
  id: string; unit_number: string | null; year: number | null; make: string | null; model: string | null;
  color?: string | null; license_plate: string | null; vin: string | null;
};

export type EvidenceRow = {
  itemId: string; documentId: string | null; fileName: string;
  role: string; pageNumber: number | null; pageCount: number | null;
  usedAs: "primary" | "alternate" | "payment" | "possible_payment" | "unrelated";
  alternateOf?: string | null; legibility: string; obscured: boolean;
};

export type OperationalOp = { heading: string; code?: string; category: string; chargeType: ChargeType; sourceFiles: string[] };
export type FinancialOp = OperationalOp & {
  request?: string; work?: string; techNotes?: string;
  parts: { description: string; partNumber?: string; quantity?: string; amount: number | null }[];
  partsAmount: number | null; laborAmount: number | null; cost: number | null;
};
export type ChargeType = "paid" | "recall" | "warranty" | "no_charge" | "unknown";

export type FieldDecision = { value: string | null; status: "agreed" | "single" | "conflict" | "none" | "normalized"; sources: { file: string; value: string; label?: string }[]; note?: string };

export type ServiceTxDraft = {
  groupKey: string; itemIds: string[];
  kind: "match" | "conflict" | "unidentified";
  matchVehicleId: string | null; matchBasis: string | null;
  operational: {
    vendor: string | null; invoiceNumber: string | null;
    identity: { vin: FieldDecision; year: FieldDecision; make: FieldDecision; model: FieldDecision; color: FieldDecision; plate: FieldDecision };
    unitNumber: string | null; unitSource: "matched_vehicle" | null;
    dates: { opened: string | null; completed: string | null; completedSource: string | null };
    mileage: { in: FieldDecision; out: FieldDecision; canonical: number | null; canonicalSource: string | null; status: "proposed" | "none" | "review" };
    operations: OperationalOp[];
    vehicleChanges: { field: string; label: string; current: string | null; proposed: string; kind: "fill" | "conflict"; safe: boolean; note?: string }[];
    candidates: (CandidateVehicle & { reason: string })[];
    evidence: EvidenceRow[];
    counts: { sourceFiles: number; invoicePages: number; duplicatePages: number; paymentEvidence: number; possiblePayments: number };
    issues: string[];
    applyPreview: { serviceRecords: number; expenses: number; mileageObservations: number; vehiclesCreated: number };
  };
  financial: {
    summary: Record<string, number | null>; summarySource: string | null; totalKind: string | null;
    reconciliation: { status: "reconciled" | "needs_review" | "unknown"; detail: string[] };
    operations: FinancialOp[]; operationsSum: number | null;
    payment: {
      amount: number | null; method: string | null; invoicePaymentField: string | null; date: string | null; time: string | null;
      state: "corroborated" | "partial" | "overpayment" | "conflict" | "unknown";
      methodState: "agreed" | "conflict" | "single" | "unknown"; methodSources: { file: string; value: string }[];
      association: "confirmed" | "possible" | "none";
    };
    actualCost: number | null;
    issues: string[];
    rawNotes: { file: string; warnings: string[] }[];
  };
};

// ------------------------------------------------------------------ helpers
const money = (f?: FV | string | null): number | null => {
  const s = typeof f === "string" ? f : f?.value;
  if (s == null) return null;
  const c = String(s).replace(/[^0-9.\-]/g, "");
  if (!c || c === "." || c === "-") return null;
  const n = Number(c);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const digits = (s?: string | null) => String(s ?? "").replace(/[^0-9]/g, "");
const up = (s?: string | null) => String(s ?? "").trim().toUpperCase();
const close = (a: number | null, b: number | null, tol = 0.02) => a != null && b != null && Math.abs(a - b) <= tol;
const LEG: Record<string, number> = { clear: 3, partial: 2, poor: 1 };

function legScore(p: ServicePageExtraction) {
  return (LEG[p.legibility ?? "partial"] ?? 2) - (p.obscured ? 1.5 : 0);
}
function weight(p: ServicePageExtraction, used: EvidenceRow["usedAs"]) {
  const base = used === "primary" ? 2 : used === "alternate" ? 1 : 0.5;
  return base * (p.obscured ? 0.5 : 1) * ((LEG[p.legibility ?? "partial"] ?? 2) / 3);
}

/** Two-digit model year → four digits, ONLY when the field is labeled as a vehicle year. */
export function normalizeModelYear(raw: string | null | undefined, label: string | null | undefined, nowYear = new Date().getUTCFullYear()): { value: string | null; normalized: boolean } {
  const d = digits(raw);
  if (d.length === 4) return { value: d, normalized: false };
  const labeled = /\b(yr|year|model\s*year|my)\b/i.test(String(label ?? "")) || label === "vehicle_year";
  if (d.length === 2 && labeled) {
    const n = Number(d);
    const yy = (nowYear + 1) % 100;
    return { value: String(n <= yy ? 2000 + n : 1900 + n), normalized: true };
  }
  return { value: null, normalized: false };
}

/** Weighted consensus across pages. Conflicts are reported, never averaged. */
function decide(entries: { file: string; value: string | null | undefined; label?: string; w: number }[], eq: (a: string) => string = (a) => up(a)): FieldDecision {
  const ok = entries.filter((e) => e.value != null && String(e.value).trim() !== "");
  if (!ok.length) return { value: null, status: "none", sources: [] };
  const tally = new Map<string, { w: number; value: string }>();
  for (const e of ok) {
    const k = eq(String(e.value));
    const t = tally.get(k) ?? { w: 0, value: String(e.value) };
    t.w += e.w; tally.set(k, t);
  }
  const sorted = [...tally.values()].sort((a, b) => b.w - a.w);
  const sources = ok.map((e) => ({ file: e.file, value: String(e.value), label: e.label }));
  if (sorted.length === 1) return { value: sorted[0].value, status: ok.length > 1 ? "agreed" : "single", sources };
  // Clear winner: at least twice the weight of the runner-up.
  if (sorted[0].w >= sorted[1].w * 2) return { value: sorted[0].value, status: "agreed", sources, note: "Minority reading rejected by cross-page agreement." };
  return { value: null, status: "conflict", sources };
}

function invoiceKey(vendor: string | null | undefined, inv: string | null | undefined) {
  return `${vendorKey(vendor)}|${digits(inv) || up(inv).replace(/[^A-Z0-9]/g, "")}`;
}
function sameInvoice(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  // A partly covered photo can show a truncated invoice number (e.g. 1441 vs 331441).
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.endsWith(s);
}

const SUMMARY_ROW = /^(total\s*)?(labor|labour|parts|sales\s*tax|tax|sub\s*-?\s*total|total(\s*charges)?|amount\s*due|balance|grand\s*total|less\s*insurance|deductible|misc(ellaneous)?|provisions?|shop\s*suppl(y|ies)|hazmat|env(ironmental)?\s*fee|gas,?\s*oil\s*(&|and)\s*lube)\b/i;
const MISC_ROW = /^(misc(ellaneous)?|provisions?|shop\s*suppl(y|ies)|hazmat|env(ironmental)?\s*fee)/i;

function chargeTypeOf(op: ServiceOp, cost: number | null): ChargeType {
  const t = `${op.chargeType ?? ""} ${op.heading} ${op.code ?? ""}`.toLowerCase();
  if (/recall|campaign|\b\d{2}[a-z]\d{2}\b/.test(t)) return "recall";
  if (/warrant/.test(t)) return "warranty";
  if (/no\s*charge|n\/c|courtesy/.test(t)) return "no_charge";
  if (cost != null && cost > 0) return "paid";
  if (cost === 0) return "no_charge";
  return "unknown";
}
function opKey(op: ServiceOp) {
  const c = up(op.code).replace(/[^A-Z0-9]/g, "");
  return c || up(op.heading).replace(/[^A-Z0-9]/g, "").slice(0, 40);
}

// ------------------------------------------------------------------ grouping
type Group = { key: string; vendor: string | null; inv: string; vin: string | null; items: SourceItem[]; payments: SourceItem[]; possible: SourceItem[] };

export function groupServiceEvidence(items: SourceItem[]): { groups: Group[]; orphanPayments: SourceItem[] } {
  const groups: Group[] = [];
  const receipts: SourceItem[] = [];
  for (const it of items) {
    const s = it.service;
    if (s.role === "payment_receipt") { receipts.push(it); continue; }
    const inv = digits(s.invoiceNumber?.value) || up(s.invoiceNumber?.value).replace(/[^A-Z0-9]/g, "");
    const vk = vendorKey(s.vendor?.value);
    const vin = s.vehicle?.vin?.value ? normalizeVin(s.vehicle.vin.value) : null;
    const g = groups.find((x) => {
      if (vk && vendorKey(x.vendor) && vendorKey(x.vendor) !== vk) return false;
      if (inv && x.inv) return sameInvoice(inv, x.inv);
      // Without invoice numbers: same vendor + same full VIN, or same vendor and neither has a VIN/invoice
      // (e.g. two photos of one handwritten shop ticket).
      if (vin && x.vin && vin.length === 17 && x.vin.length === 17) return vin === x.vin;
      return !!vk && vk === vendorKey(x.vendor) && !inv && !x.inv;
    });
    if (g) {
      g.items.push(it);
      if (inv.length > g.inv.length) g.inv = inv;
      if (!g.vin && vin && vin.length === 17) g.vin = vin;
    } else groups.push({ key: invoiceKey(s.vendor?.value, inv || it.itemId), vendor: s.vendor?.value ?? null, inv, vin: vin && vin.length === 17 ? vin : null, items: [it], payments: [], possible: [] });
  }
  const orphanPayments: SourceItem[] = [];
  for (const r of receipts) {
    const amt = money(r.service.payment?.amount);
    const vk = vendorKey(r.service.vendor?.value);
    const scored = groups.map((g) => {
      const total = groupFinalTotal(g);
      let score = 0;
      if (vk && vendorKey(g.vendor) === vk) score += 2;
      if (amt != null && close(amt, total)) score += 3;
      if (r.service.invoiceNumber?.value && sameInvoice(digits(r.service.invoiceNumber.value), g.inv)) score += 3;
      return { g, score };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score >= 5) best.g.payments.push(r);
    else if (best && best.score >= 2) best.g.possible.push(r);
    else orphanPayments.push(r);
  }
  return { groups, orphanPayments };
}

function groupFinalTotal(g: Group): number | null {
  const finals = g.items.filter((i) => i.service.summary?.totalKind === "final_total" && money(i.service.summary?.total) != null)
    .sort((a, b) => legScore(b.service) - legScore(a.service));
  return finals.length ? money(finals[0].service.summary!.total) : null;
}

// ------------------------------------------------------------------ build
export function buildServiceTransaction(g: Group, vehicles: CandidateVehicle[], nowYear = new Date().getUTCFullYear()): ServiceTxDraft {
  // Evidence roles: page duplicates resolved by legibility; clearer image outranks a covered one.
  const evidence: EvidenceRow[] = [];
  const byPage = new Map<string, SourceItem[]>();
  for (const it of g.items) {
    const pn = it.service.pageNumber ?? (it.service.pageCount === 1 || it.service.pageCount == null ? 1 : null);
    const k = pn == null ? `x:${it.itemId}` : `p:${pn}`;
    byPage.set(k, [...(byPage.get(k) ?? []), it]);
  }
  const used = new Map<string, EvidenceRow["usedAs"]>();
  let duplicatePages = 0;
  for (const [, arr] of byPage) {
    const sorted = [...arr].sort((a, b) => legScore(b.service) - legScore(a.service));
    sorted.forEach((it, i) => {
      used.set(it.itemId, i === 0 ? "primary" : "alternate");
      if (i > 0) duplicatePages++;
      evidence.push({
        itemId: it.itemId, documentId: it.documentId, fileName: it.fileName, role: it.service.role,
        pageNumber: it.service.pageNumber ?? null, pageCount: it.service.pageCount ?? null,
        usedAs: i === 0 ? "primary" : "alternate", alternateOf: i === 0 ? null : sorted[0].fileName,
        legibility: it.service.legibility ?? "partial", obscured: !!it.service.obscured,
      });
    });
  }
  for (const r of g.payments) evidence.push({ itemId: r.itemId, documentId: r.documentId, fileName: r.fileName, role: "payment_receipt", pageNumber: null, pageCount: null, usedAs: "payment", legibility: r.service.legibility ?? "partial", obscured: !!r.service.obscured });
  for (const r of g.possible) evidence.push({ itemId: r.itemId, documentId: r.documentId, fileName: r.fileName, role: "payment_receipt", pageNumber: null, pageCount: null, usedAs: "possible_payment", legibility: r.service.legibility ?? "partial", obscured: !!r.service.obscured });

  const pages = g.items.map((it) => ({ it, s: it.service, w: weight(it.service, used.get(it.itemId) ?? "primary") }));
  const issues: string[] = [];
  const finIssues: string[] = [];

  // ---- identity consensus
  const vinDec = decide(pages.map(({ it, s, w }) => {
    const v = s.vehicle?.vin?.value ? normalizeVin(s.vehicle.vin.value) : null;
    return { file: it.fileName, value: v && checkVin(v).formatValid ? v : null, w };
  }));
  const truncatedVins = pages.filter(({ s }) => s.vehicle?.vin?.value && !checkVin(normalizeVin(s.vehicle.vin.value)).formatValid).map(({ it }) => it.fileName);
  if (truncatedVins.length && vinDec.value) issues.push(`Partial VIN on ${truncatedVins.join(", ")} is consistent with the full VIN on the other pages; used as supporting evidence only.`);
  if (vinDec.status === "conflict") issues.push("Different VINs appear on pages of this invoice — Review Required.");

  const yearDec = decide(pages.map(({ it, s, w }) => {
    const y = normalizeModelYear(s.vehicle?.year?.value, s.vehicle?.year?.label ?? "vehicle_year", nowYear);
    return { file: it.fileName, value: y.value, label: y.normalized ? `normalized from "${s.vehicle?.year?.raw ?? s.vehicle?.year?.value}"` : s.vehicle?.year?.label, w };
  }));
  if (yearDec.sources.some((x) => x.label?.startsWith("normalized"))) yearDec.note = "Two-digit model year normalized (labeled vehicle-year field); original text preserved.";
  const makeDec = decide(pages.map(({ it, s, w }) => ({ file: it.fileName, value: s.vehicle?.make?.value, w })));
  const modelDec = decide(pages.map(({ it, s, w }) => ({ file: it.fileName, value: s.vehicle?.model?.value, w })));
  const colorDec = decide(pages.map(({ it, s, w }) => ({ file: it.fileName, value: s.vehicle?.color?.value, w })));

  // ---- mileage: only from labeled mileage fields; never from advisor / tag / RO / plate numbers.
  const forbidden = new Set<string>();
  for (const { s } of pages) {
    for (const n of [s.advisor?.number, s.vehicle?.tag?.value, s.invoiceNumber?.value, ...(s.otherNumbers ?? []).filter((o) => !/mile|odo/i.test(o.label)).map((o) => o.value)]) {
      const d = digits(n); if (d.length >= 3) forbidden.add(d);
    }
  }
  const mileCand = (which: "in" | "out") => pages.map(({ it, s, w }) => {
    const f = s.mileage?.[which];
    const d = digits(f?.value);
    const labelOk = !f?.label || /mile|odo|in|out|km/i.test(f.label);
    if (!d || !labelOk) return { file: it.fileName, value: null, w };
    // Exact or one-digit-off copies of an advisor/tag/RO number are OCR misreads, not odometer values.
    if (forbidden.has(d) || [...forbidden].some((x) => x.length === d.length && [...x].filter((ch, i) => ch !== d[i]).length === 1)) return { file: it.fileName, value: null, w };
    const n = Number(d);
    if (n < 1 || n >= 2_000_000) return { file: it.fileName, value: null, w };
    return { file: it.fileName, value: String(n), label: f?.label, w: w * (f?.confidence === "low" ? 0.3 : 1) };
  });
  const rejectedMileage = pages.flatMap(({ it, s }) => (["in", "out"] as const).filter((k) => { const d = digits(s.mileage?.[k]?.value); return d && (forbidden.has(d) || [...forbidden].some((x) => x.length === d.length && [...x].filter((ch, i) => ch !== d[i]).length === 1)); }).map((k) => `${it.fileName} (${k})`));
  if (rejectedMileage.length) issues.push(`Rejected mileage readings that match a non-mileage number (advisor, tag or invoice): ${rejectedMileage.join(", ")}.`);
  const inDec = decide(mileCand("in"), (a) => digits(a));
  const outDec = decide(mileCand("out"), (a) => digits(a));
  let canonical: number | null = null; let canonicalSource: string | null = null;
  let mileStatus: "proposed" | "none" | "review" = "none";
  const mi = inDec.value ? Number(inDec.value) : null;
  const mo = outDec.value ? Number(outDec.value) : null;
  if (inDec.status === "conflict" || outDec.status === "conflict") { mileStatus = "review"; issues.push("Mileage disagrees across pages — Review Required. No mileage observation proposed."); }
  else if (mi != null && mo != null && (mo < mi || mo - mi > 2000)) { mileStatus = "review"; issues.push(`Mileage Out (${mo}) is inconsistent with Mileage In (${mi}) — Review Required.`); }
  else if (mo != null) { canonical = mo; canonicalSource = "Mileage Out (service completion)"; mileStatus = "proposed"; }
  else if (mi != null && (inDec.status === "agreed")) { canonical = mi; canonicalSource = "Mileage In (intake; no Mileage Out printed)"; mileStatus = "proposed"; }
  else if (mi != null) { mileStatus = "review"; issues.push("Only a single unconfirmed Mileage In reading — no mileage observation proposed."); }

  // ---- plate: only from the LICENSE field; a number that equals mileage/tag/advisor is an extraction error.
  const mileageDigits = new Set(pages.flatMap(({ s }) => [digits(s.mileage?.in?.value), digits(s.mileage?.out?.value)]).filter(Boolean));
  if (mi) mileageDigits.add(String(mi)); if (mo) mileageDigits.add(String(mo));
  const plateRejected: string[] = [];
  const plateDec = decide(pages.map(({ it, s, w }) => {
    const v = up(s.vehicle?.license?.value).replace(/[^A-Z0-9]/g, "");
    if (!v) return { file: it.fileName, value: null, w };
    const d = digits(v);
    if ((d === v && mileageDigits.has(d)) || (d === v && digits(s.vehicle?.tag?.value) === d) || (d === v && digits(s.advisor?.number) === d) || v.length < 2 || v.length > 8) {
      plateRejected.push(`${it.fileName}: "${v}"`); return { file: it.fileName, value: null, w };
    }
    return { file: it.fileName, value: v, w };
  }));
  if (plateRejected.length) issues.push(`Rejected plate readings that are not license plates (mileage/tag/advisor numbers): ${plateRejected.join(", ")}.`);
  if (plateDec.status === "conflict") issues.push("License plate disagrees across pages — Conflict, Review Required.");

  // ---- dates
  const dateDec = (k: keyof NonNullable<ServicePageExtraction["dates"]>) => decide(pages.map(({ it, s, w }) => ({ file: it.fileName, value: /^\d{4}-\d{2}-\d{2}$/.test(String(s.dates?.[k]?.value ?? "")) ? s.dates![k]!.value : null, w })));
  const invDate = dateDec("invoiceDate"), ready = dateDec("ready"), svc = dateDec("serviceDate"), opened = dateDec("opened");
  const completed = invDate.value ?? ready.value ?? svc.value ?? null;
  const completedSource = invDate.value ? "Invoice Date" : ready.value ? "Ready Date" : svc.value ? "Service Date" : null;
  if (!completed) issues.push("No readable completion date — no mileage observation can be dated.");
  if (invDate.status === "conflict") issues.push("Invoice date disagrees across pages — Review Required.");
  if (!completed && mileStatus === "proposed") { mileStatus = "review"; canonical = null; }

  // ---- operations: merged across pages, summary rows excluded, parts + labor stay on their operation.
  const opMap = new Map<string, FinancialOp & { _w: number }>();
  const miscFromRows: number[] = [];
  const primaryFirst = [...pages].sort((a, b) => b.w - a.w);
  for (const { it, s, w } of primaryFirst) {
    for (const op of s.operations ?? []) {
      const heading = String(op.heading ?? "").trim();
      if (!heading) continue;
      if (SUMMARY_ROW.test(heading) && !(op.parts?.length)) {
        if (MISC_ROW.test(heading)) { const m = money(op.lineTotal ?? op.labor); if (m != null) miscFromRows.push(m); }
        continue;
      }
      const parts = (op.parts ?? []).filter((p) => p.description?.trim()).map((p) => ({ description: p.description.trim(), partNumber: p.partNumber, quantity: p.quantity, amount: money(p.amount) }));
      const partsAmount = parts.some((p) => p.amount != null) ? parts.reduce((a, p) => a + (p.amount ?? 0), 0) : null;
      const laborAmount = money(op.labor);
      const lineTotal = money(op.lineTotal);
      const cost = lineTotal ?? (partsAmount != null || laborAmount != null ? Math.round(((partsAmount ?? 0) + (laborAmount ?? 0)) * 100) / 100 : null);
      const k = opKey(op);
      const existing = opMap.get(k);
      if (existing) {
        existing.sourceFiles.push(it.fileName);
        if (w > existing._w) Object.assign(existing, { request: op.request ?? existing.request, work: op.work ?? existing.work, techNotes: op.techNotes ?? existing.techNotes, parts: parts.length ? parts : existing.parts, partsAmount: partsAmount ?? existing.partsAmount, laborAmount: laborAmount ?? existing.laborAmount, cost: cost ?? existing.cost, _w: w });
        continue;
      }
      opMap.set(k, {
        heading, code: op.code, category: normalizeCategory(op.category ?? `${op.heading} ${op.work ?? ""}`),
        chargeType: chargeTypeOf(op, cost), sourceFiles: [it.fileName],
        request: op.request, work: op.work, techNotes: op.techNotes, parts, partsAmount, laborAmount, cost, _w: w,
      });
    }
  }
  const finOps: FinancialOp[] = [...opMap.values()].map(({ _w, ...o }) => ({ ...o, chargeType: chargeTypeOf({ heading: o.heading, code: o.code, chargeType: o.chargeType === "unknown" ? undefined : o.chargeType }, o.cost) }));
  const operationsSum = finOps.some((o) => o.cost != null) ? Math.round(finOps.reduce((a, o) => a + (o.cost ?? 0), 0) * 100) / 100 : null;

  // ---- financial summary: ONE, from the final-total page (clearest image wins), never per-page subtotals.
  const sumPages = pages.filter(({ s }) => s.summary && money(s.summary.total) != null)
    .sort((a, b) => (Number(b.s.summary?.totalKind === "final_total") - Number(a.s.summary?.totalKind === "final_total")) || (legScore(b.s) - legScore(a.s)));
  const summaryOf = (s: ServicePageExtraction): Record<string, number | null> => ({
    labor: money(s.summary?.labor), parts: money(s.summary?.parts), misc: money(s.summary?.misc), shopSupplies: money(s.summary?.shopSupplies),
    tax: money(s.summary?.tax), warrantyCredit: money(s.summary?.warrantyCredit), vendorCredit: money(s.summary?.vendorCredit), other: money(s.summary?.other), total: money(s.summary?.total),
  });
  const reconciles = (x: Record<string, number | null>) => {
    if (x.total == null) return false;
    const comps = ["labor", "parts", "misc", "shopSupplies", "other", "tax"].map((k) => x[k]);
    if (comps.every((c) => c == null)) return false;
    const sum = comps.reduce((a: number, c) => a + (c ?? 0), 0) - (x.warrantyCredit ?? 0) - (x.vendorCredit ?? 0);
    return close(Math.round(sum * 100) / 100, x.total);
  };
  let summary: Record<string, number | null> = {}; let summarySource: string | null = null; let totalKind: string | null = null;
  const recDetail: string[] = [];
  let recStatus: "reconciled" | "needs_review" | "unknown" = "unknown";
  const finals = sumPages.filter(({ s }) => s.summary?.totalKind === "final_total");
  const pool = finals.length ? finals : sumPages;
  const winner = pool.find(({ s }) => reconciles(summaryOf(s))) ?? pool[0];
  if (winner) {
    summary = summaryOf(winner.s); summarySource = winner.it.fileName; totalKind = winner.s.summary?.totalKind ?? "unknown";
    if (pool[0] && winner !== pool[0]) recDetail.push(`${pool[0].it.fileName} summary did not add up; used ${winner.it.fileName}, whose components reconcile.`);
    if (!finals.length) finIssues.push("No page is marked as the final invoice total — Financial Review Required.");
    if (reconciles(summary)) { recStatus = "reconciled"; recDetail.push("Labor + parts + misc + tax − credits equals the invoice total."); }
    else { recStatus = "needs_review"; recDetail.push("Invoice components do not add up to the total — Financial Reconciliation Needs Review."); }
    // Same-page alternates that disagree.
    for (const alt of pool.filter((p) => p !== winner)) {
      const a = summaryOf(alt.s);
      for (const k of ["labor", "parts", "tax", "total"]) if (a[k] != null && summary[k] != null && !close(a[k], summary[k])) recDetail.push(`${alt.it.fileName} reads ${k} differently; the reconciling source was preferred.`);
    }
    if (summary.misc == null && miscFromRows.length) summary.misc = miscFromRows[0];
    if (operationsSum != null && summary.labor != null && summary.parts != null) {
      const lp = Math.round((summary.labor + summary.parts) * 100) / 100;
      const paidSum = Math.round(finOps.filter((o) => o.chargeType === "paid").reduce((a, o) => a + (o.cost ?? 0), 0) * 100) / 100;
      if (close(paidSum, lp)) recDetail.push("Paid operations add up to labor + parts.");
      else { recDetail.push(`Paid operations (${paidSum.toFixed(2)}) do not equal labor + parts (${lp.toFixed(2)}).`); if (recStatus === "reconciled") recStatus = "needs_review"; }
    }
  } else finIssues.push("No invoice total found — Financial Review Required.");

  // ---- payment evidence (separate receipts and payment slips captured on invoice photos)
  const payItems = [...g.payments, ...g.items.filter((i) => i.service.payment?.amount?.value)];
  const possItems = g.possible;
  const payAmounts = payItems.map((p) => ({ file: p.fileName, v: money(p.service.payment?.amount) })).filter((x) => x.v != null);
  const amount = payAmounts.length ? payAmounts.sort((a, b) => (b.v! - a.v!))[0].v : null;
  const total = summary.total ?? null;
  let state: ServiceTxDraft["financial"]["payment"]["state"] = "unknown";
  if (amount != null && total != null) state = close(amount, total) ? "corroborated" : amount < total ? "partial" : "overpayment";
  if (amount != null && total != null && !close(amount, total)) {
    finIssues.push(`Payment ${amount.toFixed(2)} vs invoice total ${total.toFixed(2)} — ${state === "partial" ? "Partial Payment" : "Overpayment"}? Financial Review Required (one may be a subtotal).`);
  }
  if (new Set(payAmounts.map((x) => x.v!.toFixed(2))).size > 1) { state = "conflict"; finIssues.push(`Payment evidence shows different amounts (${payAmounts.map((x) => `${x.file}: ${x.v!.toFixed(2)}`).join(", ")}) — Payment Conflict.`); }
  if (amount == null && total != null && (payItems.length || possItems.length)) finIssues.push("Payment evidence present but the amount could not be read.");
  const methodSrc: { file: string; value: string }[] = [];
  for (const p of payItems) { const m = p.service.payment?.method?.value || p.service.payment?.cardType?.value; if (m) methodSrc.push({ file: `${p.fileName} (payment receipt)`, value: m }); }
  for (const p of g.items) { const m = p.service.payment?.invoicePaymentField?.value; if (m) methodSrc.push({ file: `${p.fileName} (invoice PAYMENT field)`, value: m }); }
  const normMethod = (m: string) => /debit|visa|master|amex|discover|card|credit/i.test(m) ? "card" : /cash/i.test(m) ? "cash" : /check|chk/i.test(m) ? "check" : m.toLowerCase();
  const methods = new Set(methodSrc.map((m) => normMethod(m.value)));
  const methodState = !methodSrc.length ? "unknown" : methods.size === 1 ? (methodSrc.length > 1 ? "agreed" : "single") : "conflict";
  if (methodState === "conflict") finIssues.push(`Payment Method Conflict: ${methodSrc.map((m) => `${m.file} says ${m.value}`).join("; ")}. A card-terminal receipt is usually stronger evidence of tender — Review resolves it.`);
  const receiptMethod = payItems.map((p) => p.service.payment?.method?.value || p.service.payment?.cardType?.value).find(Boolean) ?? null;
  const association: "confirmed" | "possible" | "none" = payItems.length ? "confirmed" : possItems.length ? "possible" : "none";
  if (possItems.length) issues.push(`Possible Payment Match — Review Required (${possItems.map((p) => p.fileName).join(", ")}).`);
  const payDate = payItems.map((p) => p.service.payment?.date?.value).find(Boolean) ?? null;
  const payTime = payItems.map((p) => p.service.payment?.time?.value).find(Boolean) ?? null;

  const actualCost = total != null && recStatus !== "unknown" ? Math.round((total - (summary.warrantyCredit ?? 0) - (summary.vendorCredit ?? 0)) * 100) / 100 : null;

  // ---- vehicle match (deterministic only: VIN, then plate). Unit number NEVER comes from dealer paperwork.
  let match: CandidateVehicle | null = null; let basis: string | null = null; let kind: ServiceTxDraft["kind"] = "unidentified";
  if (vinDec.value) { match = vehicles.find((v) => up(v.vin) === vinDec.value) ?? null; if (match) basis = "vin"; }
  if (!match && plateDec.value) { const hits = vehicles.filter((v) => up(v.license_plate).replace(/[^A-Z0-9]/g, "") === plateDec.value); if (hits.length === 1) { match = hits[0]; basis = "plate"; } }
  if (match) kind = "match";
  if (match && vinDec.value && match.vin && up(match.vin) !== vinDec.value) { kind = "conflict"; issues.push(`VIN conflict: ${match.vin} on file vs ${vinDec.value} on the invoice.`); }
  if (match && yearDec.value && match.year != null && Number(yearDec.value) !== match.year) { kind = "conflict"; issues.push(`Model year on invoice (${yearDec.value}) differs from the vehicle on file (${match.year}).`); }

  // ---- candidate assistance (never auto-selected)
  const candidates: (CandidateVehicle & { reason: string })[] = [];
  if (!match) {
    const makes = new Set(pages.map(({ s }) => up(s.vehicle?.make?.value)).filter(Boolean));
    const models = new Set(pages.map(({ s }) => up(s.vehicle?.model?.value)).filter(Boolean));
    for (const v of vehicles) {
      const mk = makes.has(up(v.make)), md = models.has(up(v.model));
      if (mk && md) candidates.push({ ...v, reason: `${v.make} ${v.model} reading on the evidence${yearDec.value && v.year === Number(yearDec.value) ? " (year agrees)" : " (year not confirmed)"}` });
    }
    issues.push(candidates.length ? `Vehicle Match Required — no VIN, plate or unit on the evidence. ${candidates.length} possible vehicle(s) shown for a person to choose; none selected automatically.` : "Vehicle Match Required — no VIN, plate or unit on the evidence.");
    if (makeDec.status === "conflict" || modelDec.status === "conflict") issues.push("Make/model readings disagree between images (handwriting) — Review Required.");
  }

  // ---- proposed blank-field fills on the matched vehicle
  const vehicleChanges: ServiceTxDraft["operational"]["vehicleChanges"] = [];
  if (match) {
    const m = match as CandidateVehicle;
    if (colorDec.value && colorDec.status !== "conflict") {
      if (!m.color) vehicleChanges.push({ field: "color", label: "Color", current: null, proposed: colorDec.value, kind: "fill", safe: true });
      else if (up(m.color) !== up(colorDec.value)) vehicleChanges.push({ field: "color", label: "Color", current: m.color, proposed: colorDec.value, kind: "conflict", safe: false, note: "Differs from the color on file." });
    }
    if (plateDec.value && plateDec.status !== "conflict") {
      if (!m.license_plate) vehicleChanges.push({ field: "license_plate", label: "Plate", current: null, proposed: plateDec.value, kind: "fill", safe: plateDec.status === "agreed" });
      else if (up(m.license_plate) !== plateDec.value) vehicleChanges.push({ field: "license_plate", label: "Plate", current: m.license_plate, proposed: plateDec.value, kind: "conflict", safe: false, note: "Differs from the plate on file." });
    }
  }

  const invoicePages = new Set(g.items.map((i) => i.service.pageNumber ?? 1)).size;
  const willExpense = actualCost != null && actualCost > 0 ? 1 : 0;
  const rawNotes = [...g.items, ...g.payments, ...g.possible].map((i) => ({ file: i.fileName, warnings: i.service.warnings ?? [] })).filter((x) => x.warnings.length);

  return {
    groupKey: g.key, itemIds: [...g.items, ...g.payments, ...g.possible].map((i) => i.itemId),
    kind, matchVehicleId: match?.id ?? null, matchBasis: basis,
    operational: {
      vendor: g.vendor ? g.vendor.trim() : null, invoiceNumber: g.inv || null,
      identity: { vin: vinDec, year: yearDec, make: makeDec, model: modelDec, color: colorDec, plate: plateDec },
      unitNumber: match?.unit_number ?? null, unitSource: match ? "matched_vehicle" : null,
      dates: { opened: opened.value, completed, completedSource },
      mileage: { in: inDec, out: outDec, canonical: mileStatus === "proposed" ? canonical : null, canonicalSource: mileStatus === "proposed" ? canonicalSource : null, status: mileStatus },
      operations: finOps.map(({ heading, code, category, chargeType, sourceFiles }) => ({ heading: scrubMoney(heading), code, category, chargeType, sourceFiles })),
      vehicleChanges, candidates, evidence,
      counts: { sourceFiles: evidence.length, invoicePages, duplicatePages, paymentEvidence: g.payments.length + g.items.filter((i) => i.service.payment?.amount?.value).length, possiblePayments: g.possible.length },
      issues,
      applyPreview: { serviceRecords: 1, expenses: willExpense, mileageObservations: mileStatus === "proposed" && canonical != null ? 1 : 0, vehiclesCreated: 0 },
    },
    financial: {
      summary, summarySource, totalKind,
      reconciliation: { status: recStatus, detail: recDetail },
      operations: finOps, operationsSum,
      payment: { amount, method: receiptMethod, invoicePaymentField: g.items.map((i) => i.service.payment?.invoicePaymentField?.value).find(Boolean) ?? null, date: payDate, time: payTime, state, methodState, methodSources: methodSrc, association },
      actualCost, issues: finIssues, rawNotes,
    },
  };
}

/** Receipt that could not be associated with any invoice: its own transaction, flagged. */
export function buildReceiptOnlyTransaction(r: SourceItem): ServiceTxDraft {
  const g: Group = { key: `receipt|${r.itemId}`, vendor: r.service.vendor?.value ?? null, inv: "", vin: null, items: [], payments: [r], possible: [] };
  const d = buildServiceTransaction(g, []);
  d.operational.issues.unshift("Payment receipt with no matching invoice in this import — Review Required.");
  d.operational.applyPreview = { serviceRecords: 0, expenses: 0, mileageObservations: 0, vehiclesCreated: 0 };
  return d;
}

/** Defense in depth only (the boundary is the operational/financial split): drop money-looking tokens from headings. */
export function scrubMoney(s: string): string {
  return s.replace(/\$?\s?\d{1,3}(,\d{3})*\.\d{2}\b/g, "").replace(/\s{2,}/g, " ").trim();
}

export function buildBatchTransactions(items: SourceItem[], vehicles: CandidateVehicle[]): ServiceTxDraft[] {
  const { groups, orphanPayments } = groupServiceEvidence(items);
  return [...groups.map((g) => buildServiceTransaction(g, vehicles)), ...orphanPayments.map(buildReceiptOnlyTransaction)];
}
