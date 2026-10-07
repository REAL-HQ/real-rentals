// Service transaction rules. Run: bun scripts/service-transaction.test.ts
// Synthetic fixtures shaped like the real Test A / Test B evidence; no I/O.
import { buildBatchTransactions, normalizeModelYear, scrubMoney, type SourceItem, type CandidateVehicle } from "../src/lib/service-transaction";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };
const f = (value: string, label?: string, confidence: "high" | "medium" | "low" = "high") => ({ value, label, confidence });
const VIN = "3FA6P0H70DR102837";
const fleet: CandidateVehicle[] = [
  { id: "rr5", unit_number: "RR-005", year: 2013, make: "Ford", model: "Fusion", color: null, license_plate: null, vin: VIN },
  { id: "rr1", unit_number: "RR-001", year: 2013, make: "Ford", model: "Fusion", color: null, license_plate: null, vin: "3FA6P0K92DR171975" },
  { id: "rr2", unit_number: "RR-002", year: 2013, make: "Ford", model: "Fusion", color: null, license_plate: null, vin: "3FA6P0H75DR198366" },
];
const header = (o: any = {}) => ({
  vendor: f("ELDER FORD OF TAMPA"), invoiceNumber: f("331441"), pageCount: 4,
  vehicle: { vin: f(VIN), year: f("13", "vehicle_year"), make: f("FORD"), model: f("FUSION"), color: f("BLACK"), license: f("563BLU", "LICENSE"), tag: f("T1234", "TAG") },
  mileage: { in: f("154782", "MILEAGE IN"), out: f("154783", "OUT") },
  advisor: { name: "ANDREW NELSON", number: "301957" },
  dates: { opened: f("2026-09-30"), invoiceDate: f("2026-10-05") },
  ...o,
});
const B: SourceItem[] = [
  { itemId: "8", documentId: "d8", fileName: "IMG_0008.JPG", service: { role: "invoice_with_payment", legibility: "partial", obscured: true, ...header({ invoiceNumber: f("1441"), vehicle: { vin: f("17ODR102837"), license: f("154782", "LICENSE") }, mileage: { in: f("101957", "MILEAGE") } }), pageNumber: 4,
    payment: { amount: f("1334.26"), method: f("DEBIT"), cardType: f("VISA"), date: f("2026-10-05"), time: f("11:32") },
    summary: { labor: f("827.61"), parts: f("345.67"), misc: f("68.30"), tax: f("93.08"), total: f("1334.26"), totalKind: "final_total" },
    operations: [{ heading: "LABOR AMOUNT", lineTotal: "827.61" }, { heading: "TOTAL CHARGES", lineTotal: "1334.26" }] } },
  { itemId: "9", documentId: "d9", fileName: "IMG_0009.JPG", service: { role: "invoice_page", legibility: "clear", ...header({ vehicle: { vin: f(VIN), year: f("13", "vehicle_year"), make: f("FORD"), model: f("FUSION"), color: f("BLACK"), license: f("154782", "LICENSE") } }), pageNumber: 4,
    payment: { invoicePaymentField: f("CASH") },
    summary: { labor: f("827.61"), parts: f("345.27"), misc: f("68.30"), tax: f("93.08"), total: f("1334.26"), totalKind: "final_total" },
    operations: [{ code: "E", heading: "REPLACE PURGE VALVE", parts: [{ description: "VALVE", amount: "93.53" }], labor: "298.56" }] } },
  { itemId: "10", documentId: "d10", fileName: "IMG_0010.JPG", service: { role: "invoice_page", legibility: "clear", ...header(), pageNumber: 1,
    summary: { total: f("0"), totalKind: "page_subtotal" },
    operations: [{ code: "A", heading: "RECALL 20S30 LATCH VERIFICATION", chargeType: "recall", lineTotal: "0" }, { code: "B", heading: "RECALL 23S12 FRONT BRAKE HOSE", chargeType: "recall", lineTotal: "0" }, { code: "C", heading: "MIRROR / WINDOW DIAGNOSIS", labor: "69.95" }] } },
  { itemId: "11", documentId: "d11", fileName: "IMG_0011.JPG", service: { role: "invoice_page", legibility: "clear", ...header(), pageNumber: 2,
    operations: [{ code: "D", heading: "SYNTHETIC OIL CHANGE + TIRE ROTATION", parts: [{ description: "OIL", quantity: "6", amount: "26.94" }, { description: "FILTER", amount: "12.71" }], labor: "60.00" }] } },
  { itemId: "12", documentId: "d12", fileName: "IMG_0012.JPG", service: { role: "invoice_page", legibility: "clear", ...header(), pageNumber: 3,
    operations: [{ code: "F", heading: "REPLACE SEAT BELT BUCKLE", parts: [{ description: "BUCKLE", amount: "212.09" }], labor: "399.10" }] } },
];
const txB = buildBatchTransactions(B, fleet);
ok(txB.length === 1, "B. five files → one service transaction");
const b = txB[0];
ok(b.matchVehicleId === "rr5" && b.matchBasis === "vin" && b.kind === "match", "B. exact VIN → RR-005, no year conflict");
ok(b.operational.unitNumber === "RR-005" && b.operational.unitSource === "matched_vehicle", "B. unit from REAL RENTALS record, never dealer tag");
ok(b.operational.identity.year.value === "2013", "B. '13' normalized to 2013");
ok(b.operational.identity.plate.value === "563BLU", "B. plate 563BLU; mileage-as-plate rejected");
ok(b.operational.mileage.in.value === "154782" && b.operational.mileage.out.value === "154783", "B. Mileage In / Out separated; advisor-like 101957 outvoted");
ok(b.operational.mileage.canonical === 154783 && b.operational.applyPreview.mileageObservations === 1, "B. one canonical mileage = Mileage Out");
ok(b.operational.counts.duplicatePages === 1 && b.operational.evidence.find((e) => e.itemId === "8")?.usedAs === "alternate", "B. covered page 4 is a duplicate photo of the clear page 4");
ok(!b.financial.operations.some((o) => /LABOR AMOUNT|TOTAL CHARGES/.test(o.heading)), "B. summary rows are not operations");
const belt = b.financial.operations.find((o) => /BELT/.test(o.heading));
ok(!!belt && belt.cost === 611.19 && belt.partsAmount === 212.09 && belt.laborAmount === 399.1, "B. seat belt parts + labor stay one operation (611.19)");
ok(b.financial.operations.filter((o) => o.chargeType === "recall").length === 2, "B. recalls kept as no-cost history");
ok(b.financial.summary.total === 1334.26 && b.financial.summarySource === "IMG_0009.JPG" && b.financial.summary.parts === 345.27, "B. one financial summary from the clear page");
ok(b.financial.reconciliation.status === "reconciled", "B. paid operations + summary reconcile");
ok(b.financial.payment.state === "corroborated" && b.financial.payment.methodState === "conflict", "B. payment corroborated; CASH vs DEBIT flagged");
ok(b.operational.applyPreview.expenses === 1 && b.operational.applyPreview.serviceRecords === 1 && b.financial.actualCost === 1334.26, "B. one service record, one expense of 1334.26");
ok(!JSON.stringify(b.operational).match(/1334|827\.61|399\.10|93\.08/), "B. operational half carries no amounts");

// Test A: handwritten ticket + photo with card slip, no identifiers.
const A: SourceItem[] = [
  { itemId: "6", documentId: "d6", fileName: "IMG_0006.JPG", service: { role: "invoice_with_payment", legibility: "partial", obscured: true, vendor: f("Hillsborough Auto Repair"), vehicle: { year: f("2017", "vehicle_year"), make: f("FORD"), model: f("FUSION") }, payment: { amount: f("1152.80"), cardType: f("VISA"), method: f("DEBIT"), date: f("2026-09-05") }, operations: [{ heading: "A/C repair" }] } },
  { itemId: "7", documentId: "d7", fileName: "IMG_0007.JPG", service: { role: "invoice_page", legibility: "partial", vendor: f("Hillsborough Auto Repair"), vehicle: { year: f("2011", "vehicle_year"), make: f("FORD"), model: f("FUSION", undefined, "medium") }, summary: { total: f("1048", undefined, "medium"), totalKind: "unknown" }, operations: [{ heading: "Rear & front struts" }] } },
];
const txA = buildBatchTransactions(A, fleet);
ok(txA.length === 1, "A. invoice + slip photos grouped as one transaction");
const a = txA[0];
ok(a.kind === "unidentified" && !a.matchVehicleId, "A. no automatic vehicle match");
ok(a.operational.candidates.length === 3, "A. Fusion candidates offered, none selected");
ok(a.operational.applyPreview.mileageObservations === 0 && a.operational.mileage.status === "none", "A. no mileage → zero observations");
ok(a.financial.payment.amount === 1152.8 && a.financial.payment.state !== "corroborated" && a.financial.issues.length > 0, "A. 1152.80 vs 1048 flagged for financial review, not two expenses");

ok(normalizeModelYear("13", "vehicle_year").value === "2013" && normalizeModelYear("13", "RO").value === null, "Year normalization only on labeled year fields");
ok(scrubMoney("LABOR: 399.10 OTHER: 0.00") === "LABOR: OTHER:", "scrubMoney removes amounts (defense in depth)");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
