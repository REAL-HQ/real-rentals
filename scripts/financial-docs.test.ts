// Step B rules: bun scripts/financial-docs.test.ts
import { readFileSync } from "node:fs";
import { cleanFinancialExtraction, reviewFinancial, isFinancialClass, type FleetVehicle } from "../src/lib/financial-docs";
import { DOC_CLASSES } from "../src/lib/fleet-inbox";

let n = 0;
const ok = (c: unknown, m: string) => { if (!c) { console.error("FAIL:", m); process.exit(1); } n++; };
const F = (v: string, c = "high") => ({ value: v, raw: v, confidence: c });

const fleet: FleetVehicle[] = [
  { id: "v1", unit_number: "RR-001", year: 2013, make: "Ford", model: "Fusion", color: "Red", vin: "3FA6P0H70DR102837", license_plate: "ABC123" },
  { id: "v2", unit_number: "RR-002", year: 2014, make: "Ford", model: "Fusion", color: "Red", vin: "3FA6P0H71ER000001", license_plate: "XYZ987" },
  { id: "v3", unit_number: "RR-003", year: 2015, make: "Ford", model: "Fusion", color: "White", vin: "3FA6P0H72FR000002", license_plate: null },
  { id: "v4", unit_number: "RR-004", year: 2018, make: "Toyota", model: "Camry", color: "Red", vin: "4T1B11HK0JU000003", license_plate: null },
];
const empty = { others: [], expenses: [], serviceTxs: [], fleet };

// Vocabulary
ok(isFinancialClass("payment_confirmation") && DOC_CLASSES.includes("payment_confirmation"), "payment confirmation is a class");
ok(!isFinancialClass("repair_invoice"), "service invoices stay on the service path");

// Sanitisation: full account numbers never kept
const clean = cleanFinancialExtraction({ event: "payment_completed", reference: F("123456789012"), accountLast4: "acct 9876543210", amount: F("590.00"), vehicleHints: {} });
ok(!clean.reference!.value.includes("123456789012") && clean.reference!.value.endsWith("9012"), "long numbers masked");
ok(clean.accountLast4 === "3210", "last 4 only");
ok(cleanFinancialExtraction({ event: "bogus" }).event === "unknown", "unknown event");

// $590 "Auto Tag Red Fusion": payment, ambiguous, Fusion suggestions, never assigned, no expense
const p590 = cleanFinancialExtraction({ event: "payment_completed", category: "registration", amount: F("590"), method: F("Zelle"), date: F("2026-10-06"), memo: F("Auto Tag Red Fusion"), vehicleHints: { make: "", model: "Fusion", color: "Red", raw: "Auto Tag Red Fusion" } });
const r590 = reviewFinancial({ itemId: "i590", fin: p590 }, empty);
ok(r590.vehicleStatus === "ambiguous", "590 vehicle ambiguous");
ok(r590.suggestions.length === 3 && r590.suggestions.every((s) => s.label.includes("Fusion")), "suggests the three Fusions only");
ok(r590.suggestions[0].vehicleId !== "v3" && r590.suggestions[2].vehicleId === "v3", "red Fusions rank above white");
ok(r590.wouldCreateExpense === false, "never creates an expense");

// Standalone receipt: no relations, no duplicates
const rec = cleanFinancialExtraction({ event: "expense_incurred", category: "preparation", vendor: F("AutoZone"), amount: F("42.17"), date: F("2026-10-01"), vehicleHints: {} });
const rRec = reviewFinancial({ itemId: "r1", fin: rec }, empty);
ok(!rRec.duplicates.length && !rRec.correspondences.length && rRec.vehicleStatus === "no_vehicle_info", "standalone receipt");

// Duplicate payment confirmations: same file, same reference, same amount/vendor/date
const pay = cleanFinancialExtraction({ event: "payment_completed", payee: F("Elder Ford"), amount: F("1334.26"), date: F("2026-09-30"), reference: F("ZL-88421"), vehicleHints: {} });
const other = (id: string, fin: any, sha?: string) => ({ itemId: id, batchId: "b", fileName: `${id}.png`, contentSha256: sha ?? null, fin });
ok(reviewFinancial({ itemId: "a", contentSha256: "h1", fin: pay }, { ...empty, others: [other("b", pay, "h1")] }).duplicates[0].strength === "certain", "same file certain");
ok(reviewFinancial({ itemId: "a", fin: pay }, { ...empty, others: [other("b", pay)] }).duplicates[0].kind === "same_reference", "same reference likely");
const payNoRef = { ...pay, reference: undefined };
const dupSoft = reviewFinancial({ itemId: "a", fin: payNoRef }, { ...empty, others: [other("b", { ...payNoRef, date: F("2026-10-02") })] });
ok(dupSoft.duplicates[0]?.strength === "possible", "same amount/vendor/date possible");
ok(dupSoft.uncertainties.some((u) => u.includes("duplicate")), "duplicate flagged as uncertainty");

ok(reviewFinancial({ itemId: "a", fin: { ...pay, reference: F("ZL-8842I"), date: F("2026-10-09") } }, { ...empty, others: [other("b", pay)] }).duplicates[0]?.kind === "same_reference", "OCR look-alike reference still a duplicate");

// Payment corresponds to an existing service invoice (multi-page invoice grouped elsewhere)
const tx = { id: "t1", batch_id: "b", status: "pending", vendor: "Elder Ford", invoiceNumber: "R12345", total: 1334.26, date: "2026-09-30", vehicleId: "v1" };
const rTx = reviewFinancial({ itemId: "a", fin: payNoRef }, { ...empty, serviceTxs: [tx] });
ok(rTx.correspondences[0]?.relation === "pays" && rTx.correspondences[0].target.type === "service_transaction", "payment pays service invoice");

// Partial payment
const part = { ...payNoRef, amount: F("500") };
ok(reviewFinancial({ itemId: "a", fin: part }, { ...empty, serviceTxs: [tx] }).correspondences[0]?.relation === "partially_pays", "partial payment");

// Conflicting amounts: payment larger than invoice → uncertainty, not a match
const over = { ...payNoRef, amount: F("2000") };
const rOver = reviewFinancial({ itemId: "a", fin: over }, { ...empty, serviceTxs: [tx] });
ok(!rOver.correspondences.length && rOver.uncertainties.some((u) => u.includes("larger")), "conflicting amount flagged");

// Multiple documents for one expense: invoice doc + payment doc, and an already-recorded expense
const inv = cleanFinancialExtraction({ event: "invoice_received", vendor: F("Tag Agency"), amount: F("590"), date: F("2026-10-05"), invoiceNumber: F("INV-7"), vehicleHints: {} });
const pay2 = cleanFinancialExtraction({ event: "payment_completed", payee: F("Tag Agency"), amount: F("590"), date: F("2026-10-06"), vehicleHints: {} });
const rPair = reviewFinancial({ itemId: "p", fin: pay2 }, { ...empty, others: [other("i", inv)] });
ok(rPair.correspondences[0]?.relation === "pays" && rPair.relatedItemIds.includes("i"), "payment linked to invoice document");
const rExp = reviewFinancial({ itemId: "p", fin: pay2 }, { ...empty, expenses: [{ id: "e1", vehicle_id: null, amount: 590, incurred_on: "2026-10-06", reference: null, description: "Tag Agency tag", category: "registration" }] });
ok(rExp.correspondences[0]?.relation === "same_expense", "recognises existing expense");

// Exact identifier is still only a suggestion
const vinDoc = cleanFinancialExtraction({ event: "expense_incurred", amount: F("20"), vehicleHints: { vin: "3FA6P0H70DR102837" } });
const rVin = reviewFinancial({ itemId: "v", fin: vinDoc }, empty);
ok(rVin.vehicleStatus === "identified_unassigned" && rVin.suggestions[0].vehicleId === "v1", "VIN identified but unassigned");

// Privacy + no-posting static guards
const fns = readFileSync("src/lib/fleet-inbox.functions.ts", "utf8");
ok(/canFinance && ex\.financial/.test(fns), "financial extraction only returned to Manager+");
ok(/payment\|transfer\|refund\|deposit/.test(fns), "Coordinators get no warnings/extraction for payment docs");
for (const f of ["src/lib/financial-ingest.server.ts", "src/lib/financial-docs.ts"]) {
  const src = readFileSync(f, "utf8");
  ok(!/from\("vehicle_expenses"\)\.(insert|update|upsert|delete)/.test(src) && !/from\("vehicles"\)\.(insert|update|upsert)/.test(src) && !/vehicle_finance/.test(src), `${f} never writes expenses/vehicles/finance`);
}
console.log(`financial-docs: ${n} assertions passed`);
