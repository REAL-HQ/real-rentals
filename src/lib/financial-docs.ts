// Fleet Inbox — pure, client-safe rules for financial documents (Step B).
// Classifies the money event, detects duplicates, recognises when a payment
// corresponds to an existing invoice/expense, and suggests (never assigns)
// vehicles. No I/O: the analyzer, review screen and tests share these rules.
// Nothing here posts expenses or changes vehicle records.

export const FINANCIAL_CLASSES = [
  "payment_confirmation", "bank_transfer", "vendor_invoice", "expense_receipt",
  "purchase_payment", "prep_cost_receipt", "registration_fee_receipt", "refund_confirmation", "deposit_receipt",
] as const;

export function isFinancialClass(c: string | null | undefined): boolean {
  return !!c && (FINANCIAL_CLASSES as readonly string[]).includes(c);
}

export const MONEY_EVENTS = ["invoice_received", "expense_incurred", "payment_completed", "refund_received", "deposit_paid", "account_transfer", "unknown"] as const;
export type MoneyEvent = (typeof MONEY_EVENTS)[number];
export const MONEY_EVENT_LABELS: Record<MoneyEvent, string> = {
  invoice_received: "Invoice Received",
  expense_incurred: "Expense Incurred",
  payment_completed: "Payment Completed",
  refund_received: "Refund Received",
  deposit_paid: "Deposit Paid",
  account_transfer: "Transfer Between Accounts",
  unknown: "Unclear",
};

export const COST_CATEGORIES = ["purchase", "preparation", "repair", "registration", "insurance", "fees", "other"] as const;

export type FinField = { value: string; raw?: string; confidence: "high" | "medium" | "low" };
export type FinancialExtraction = {
  event: MoneyEvent;
  category: (typeof COST_CATEGORIES)[number];
  vendor?: FinField; payee?: FinField; payer?: FinField;
  amount?: FinField; currency?: string;
  date?: FinField; reference?: FinField; invoiceNumber?: FinField;
  method?: FinField; memo?: FinField; description?: FinField;
  status?: FinField; // e.g. Completed / Pending as printed
  accountLast4?: string; // last 4 only, never full account numbers
  vehicleHints: { vin?: string; plate?: string; unit?: string; year?: string; make?: string; model?: string; color?: string; raw?: string };
  warnings: string[];
};

const conf = (c: unknown): FinField["confidence"] => (c === "high" || c === "medium" ? c : "low");
function fv(v: any): FinField | undefined {
  if (!v || typeof v !== "object") return undefined;
  const value = String(v.value ?? "").trim();
  if (!value) return undefined;
  return { value, raw: typeof v.raw === "string" ? v.raw : value, confidence: conf(v.confidence) };
}
const s = (x: any) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 80) : undefined);

/** Normalise the reader's JSON; drops unknown keys and anything that looks like a full account/card number. */
export function cleanFinancialExtraction(p: any): FinancialExtraction {
  const event = (MONEY_EVENTS as readonly string[]).includes(p?.event) ? p.event : "unknown";
  const category = (COST_CATEGORIES as readonly string[]).includes(p?.category) ? p.category : "other";
  const last4 = typeof p?.accountLast4 === "string" ? p.accountLast4.replace(/\D/g, "").slice(-4) : "";
  const scrub = (f?: FinField) => (f ? { ...f, value: f.value.replace(/\b\d{9,}\b/g, (m) => `••••${m.slice(-4)}`), raw: f.raw?.replace(/\b\d{9,}\b/g, (m) => `••••${m.slice(-4)}`) } : f);
  const vh = p?.vehicleHints ?? {};
  return {
    event, category,
    vendor: fv(p?.vendor), payee: fv(p?.payee), payer: fv(p?.payer),
    amount: fv(p?.amount), currency: s(p?.currency) ?? "USD",
    date: fv(p?.date), reference: scrub(fv(p?.reference)), invoiceNumber: fv(p?.invoiceNumber),
    method: fv(p?.method), memo: scrub(fv(p?.memo)), description: scrub(fv(p?.description)), status: fv(p?.status),
    accountLast4: last4.length === 4 ? last4 : undefined,
    vehicleHints: { vin: s(vh.vin), plate: s(vh.plate), unit: s(vh.unit), year: s(vh.year), make: s(vh.make), model: s(vh.model), color: s(vh.color), raw: s(vh.raw) },
    warnings: (Array.isArray(p?.warnings) ? p.warnings : []).filter((w: unknown) => typeof w === "string").slice(0, 10),
  };
}

export function moneyOf(f?: FinField | string | number | null): number | null {
  if (f == null) return null;
  const raw = typeof f === "object" ? f.value : String(f);
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && String(raw).match(/\d/) ? Math.round(n * 100) / 100 : null;
}
const norm = (x?: string | null) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** References compared with look-alike characters folded (OCR reads B/8, O/0, I/1, S/5 interchangeably). */
const normRef = (x?: string | null) => norm(x).replace(/o/g, "0").replace(/[il]/g, "1").replace(/b/g, "8").replace(/s/g, "5").replace(/z/g, "2");
const dayDiff = (a?: string | null, b?: string | null) => {
  const ta = a ? Date.parse(a) : NaN, tb = b ? Date.parse(b) : NaN;
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.abs(ta - tb) / 86_400_000 : null;
};
const nameClose = (a?: string | null, b?: string | null) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y)));
};

// ------------------------------------------------------------ comparisons
export type OtherFinDoc = { itemId: string; batchId: string; fileName: string; documentId?: string | null; contentSha256?: string | null; fin: FinancialExtraction };
export type ExistingExpense = { id: string; vehicle_id: string | null; amount: number | null; incurred_on: string | null; reference: string | null; description: string | null; category: string | null };
export type ExistingServiceTx = { id: string; batch_id: string; status: string; vendor: string | null; invoiceNumber: string | null; total: number | null; date: string | null; vehicleId: string | null };
export type FleetVehicle = { id: string; unit_number: string | null; year: number | null; make: string | null; model: string | null; color: string | null; vin: string | null; license_plate: string | null };

export type DuplicateHit = { kind: "same_file" | "same_reference" | "same_amount_vendor_date"; strength: "certain" | "likely" | "possible"; target: { type: "fleet_document" | "expense"; id: string; label: string }; reason: string };
export type Correspondence = { target: { type: "fleet_document" | "service_transaction" | "expense"; id: string; label: string }; relation: "pays" | "paid_by" | "partially_pays" | "same_expense"; reason: string; amountDelta: number | null };
export type VehicleSuggestion = { vehicleId: string; label: string; basis: "identifier" | "description"; evidence: string[]; score: number };
export type FinancialReview = {
  duplicates: DuplicateHit[];
  correspondences: Correspondence[];
  suggestions: VehicleSuggestion[];
  vehicleStatus: "identified_unassigned" | "ambiguous" | "none_found" | "no_vehicle_info";
  uncertainties: string[];
  wouldCreateExpense: false; // Step B never posts. Kept explicit for reviewers and tests.
  relatedItemIds: string[];
};

const vLabel = (v: FleetVehicle) => [v.unit_number, [v.year, v.make, v.model].filter(Boolean).join(" "), v.color].filter(Boolean).join(" · ");

/** Suggest vehicles. Exact identifiers rank highest but are still only suggestions in Step B. */
export function suggestVehicles(fin: FinancialExtraction, fleet: FleetVehicle[]): { suggestions: VehicleSuggestion[]; status: FinancialReview["vehicleStatus"] } {
  const h = fin.vehicleHints;
  const text = [h.raw, h.make, h.model, h.color, h.year, fin.memo?.value, fin.description?.value].filter(Boolean).join(" ").toLowerCase();
  const out: VehicleSuggestion[] = [];
  for (const v of fleet) {
    const ev: string[] = []; let score = 0; let basis: VehicleSuggestion["basis"] = "description";
    if (h.vin && v.vin && norm(h.vin) === norm(v.vin)) { ev.push("VIN matches exactly"); score += 100; basis = "identifier"; }
    if (h.plate && v.license_plate && norm(h.plate) === norm(v.license_plate)) { ev.push("Plate matches"); score += 80; basis = "identifier"; }
    if (h.unit && v.unit_number && norm(h.unit) === norm(v.unit_number)) { ev.push("Unit number matches"); score += 80; basis = "identifier"; }
    const make = norm(v.make), model = norm(v.model);
    const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
    const hasModel = !!model && (words.has(model) || norm(text).includes(model));
    const hasMake = !!make && words.has(make);
    if (hasModel) { ev.push(`Mentions "${v.model}"`); score += 30; }
    if (hasMake) { ev.push(`Mentions "${v.make}"`); score += 10; }
    if ((hasModel || hasMake) && v.color && words.has(norm(v.color))) { ev.push(`Colour "${v.color}" matches`); score += 15; }
    if ((hasModel || hasMake) && v.year && (words.has(String(v.year)) || words.has(String(v.year).slice(2)))) { ev.push(`Year ${v.year} mentioned`); score += 10; }
    if (basis === "identifier" || hasModel) out.push({ vehicleId: v.id, label: vLabel(v), basis, evidence: ev, score });
  }
  out.sort((a, b) => b.score - a.score);
  const hasHints = !!(h.vin || h.plate || h.unit || h.make || h.model || h.raw || fin.memo?.value);
  const ids = out.filter((o) => o.basis === "identifier");
  const status: FinancialReview["vehicleStatus"] =
    ids.length === 1 ? "identified_unassigned" : out.length ? "ambiguous" : hasHints ? "none_found" : "no_vehicle_info";
  return { suggestions: out.slice(0, 8), status };
}

const PAY_EVENTS: MoneyEvent[] = ["payment_completed", "deposit_paid"];
const BILL_EVENTS: MoneyEvent[] = ["invoice_received", "expense_incurred"];

export function reviewFinancial(
  self: { itemId: string; contentSha256?: string | null; fin: FinancialExtraction },
  ctx: { others: OtherFinDoc[]; expenses: ExistingExpense[]; serviceTxs: ExistingServiceTx[]; fleet: FleetVehicle[] },
): FinancialReview {
  const f = self.fin;
  const amt = moneyOf(f.amount);
  const date = f.date?.value ?? null;
  const party = f.vendor?.value || f.payee?.value || null;
  const ref = normRef(f.reference?.value) || null;
  const inv = norm(f.invoiceNumber?.value) || null;
  const duplicates: DuplicateHit[] = [];
  const correspondences: Correspondence[] = [];
  const uncertainties: string[] = [];
  const related = new Set<string>();

  for (const o of ctx.others) {
    if (o.itemId === self.itemId) continue;
    const of = o.fin; const oa = moneyOf(of.amount); const od = of.date?.value ?? null;
    const oParty = of.vendor?.value || of.payee?.value || null;
    const label = o.fileName;
    if (self.contentSha256 && o.contentSha256 && self.contentSha256 === o.contentSha256) {
      duplicates.push({ kind: "same_file", strength: "certain", target: { type: "fleet_document", id: o.itemId, label }, reason: "Identical file already received." });
      related.add(o.itemId); continue;
    }
    const sameRef = (ref && ref.length >= 4 && ref === normRef(of.reference?.value)) || (inv && inv.length >= 3 && inv === norm(of.invoiceNumber?.value) && f.event === of.event);
    if (sameRef && (amt == null || oa == null || amt === oa)) {
      duplicates.push({ kind: "same_reference", strength: "likely", target: { type: "fleet_document", id: o.itemId, label }, reason: "Same transaction or invoice reference and amount." });
      related.add(o.itemId); continue;
    }
    const dd = dayDiff(date, od);
    if (amt != null && oa === amt && f.event === of.event && nameClose(party, oParty) && (dd == null || dd <= 3)) {
      duplicates.push({ kind: "same_amount_vendor_date", strength: "possible", target: { type: "fleet_document", id: o.itemId, label }, reason: "Same amount, same party and close date." });
      related.add(o.itemId); continue;
    }
    // Payment ↔ invoice relationships across documents.
    const pairs = (PAY_EVENTS.includes(f.event) && BILL_EVENTS.includes(of.event)) || (BILL_EVENTS.includes(f.event) && PAY_EVENTS.includes(of.event));
    if (pairs && amt != null && oa != null && (nameClose(party, oParty) || (inv && inv === norm(of.invoiceNumber?.value))) && (dd == null || dd <= 45)) {
      const iPay = PAY_EVENTS.includes(f.event);
      const payAmt = iPay ? amt : oa, billAmt = iPay ? oa : amt;
      const relation = payAmt === billAmt ? (iPay ? "pays" : "paid_by") : payAmt < billAmt ? "partially_pays" : null;
      if (relation) {
        correspondences.push({ target: { type: "fleet_document", id: o.itemId, label }, relation, reason: relation === "partially_pays" ? `Partial payment: $${payAmt.toFixed(2)} of $${billAmt.toFixed(2)}.` : "Amount and party match.", amountDelta: Math.round((payAmt - billAmt) * 100) / 100 });
        related.add(o.itemId);
      } else uncertainties.push(`Payment is larger than the related invoice (${label}). Check the amounts.`);
    }
  }

  for (const e of ctx.expenses) {
    const ea = e.amount == null ? null : Math.round(Number(e.amount) * 100) / 100;
    const label = `Expense ${e.incurred_on ?? ""} ${e.description ?? ""}`.trim();
    if (ref && ref.length >= 4 && normRef(e.reference) === ref) {
      duplicates.push({ kind: "same_reference", strength: "likely", target: { type: "expense", id: e.id, label }, reason: "An expense with this reference is already recorded." });
      continue;
    }
    const dd = dayDiff(date, e.incurred_on);
    if (amt != null && ea === amt && (dd == null || dd <= 10) && (nameClose(party, e.description) || dd != null && dd <= 3)) {
      correspondences.push({ target: { type: "expense", id: e.id, label }, relation: "same_expense", reason: "An expense with this amount and date is already recorded; this document is supporting evidence, not a new expense.", amountDelta: 0 });
    }
  }

  for (const t of ctx.serviceTxs) {
    if (t.total == null || amt == null) continue;
    const dd = dayDiff(date, t.date);
    const sameInv = inv && t.invoiceNumber && inv === norm(t.invoiceNumber);
    if ((sameInv || nameClose(party, t.vendor)) && (dd == null || dd <= 45) && PAY_EVENTS.includes(f.event)) {
      const label = `${t.vendor ?? "Service"} invoice${t.invoiceNumber ? ` ${t.invoiceNumber}` : ""}`;
      if (amt === t.total) correspondences.push({ target: { type: "service_transaction", id: t.id, label }, relation: "pays", reason: "Pays this service invoice — would not create a second expense.", amountDelta: 0 });
      else if (amt < t.total) correspondences.push({ target: { type: "service_transaction", id: t.id, label }, relation: "partially_pays", reason: `Partial payment: $${amt.toFixed(2)} of $${t.total.toFixed(2)}.`, amountDelta: Math.round((amt - t.total) * 100) / 100 });
      else uncertainties.push(`Payment is larger than the ${label} total. Check the amounts.`);
    }
  }

  const { suggestions, status } = suggestVehicles(f, ctx.fleet);
  if (amt == null) uncertainties.push("No amount could be read.");
  if (f.amount && f.amount.confidence === "low") uncertainties.push("The amount is hard to read.");
  if (!date) uncertainties.push("No transaction date found.");
  if (!party) uncertainties.push("No vendor or payee found.");
  if (f.event === "unknown") uncertainties.push("Unclear whether this is an invoice, a payment or a refund.");
  if (status === "ambiguous") uncertainties.push(`Vehicle is ambiguous: ${suggestions.length} possible match${suggestions.length === 1 ? "" : "es"}. Choose one manually.`);
  if (status === "none_found") uncertainties.push("The document mentions a vehicle, but none in the fleet matches.");
  if (status === "identified_unassigned") uncertainties.push("A vehicle identifier matches; confirm before assigning.");
  if (duplicates.length) uncertainties.push("Possible duplicate. Compare before recording anything.");

  return { duplicates, correspondences, suggestions, vehicleStatus: status, uncertainties, wouldCreateExpense: false, relatedItemIds: [...related] };
}
