// Rental Ready vs Listing Ready vs Fleet Profile, canonical doc presence and
// display normalization. Run: bun scripts/vehicle-readiness.test.ts
import { rentalReadyItems, listingReadyItems, profileItems, percent, notReadyMessage, isRentalReady } from "../src/lib/vehicle-readiness";
import { vehicleDocPresence, isFinanceKind } from "../src/lib/vehicle-doc-presence";
import { normalizeDisplayText, normalizeDisplayField } from "../src/lib/display-normalize";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };
const minimal = { year: 2015, make: "Ford", model: "Fusion", vin: "3FA6P0HD8ER123457", weekly_rate: 375 };

// A
ok(isRentalReady(minimal), "A: YMM + VIN + rate, no photo → Rental Ready YES");
ok(!listingReadyItems(minimal, 0).every((i) => i.done), "A: no published photo → Listing Ready NO");
// B
ok(listingReadyItems(minimal, 1).every((i) => i.done), "B: + published listing photo → Listing Ready YES");
// C
ok(!isRentalReady({ ...minimal, weekly_rate: null }), "C: missing rate → Rental Ready NO");
// D
ok(!isRentalReady({ ...minimal, weekly_rate: 0 }), "D: $0 rate → not rentable (free rentals unsupported)");
ok(rentalReadyItems({ ...minimal, weekly_rate: 0 }).find((i) => i.key === "weekly_rate")?.done === false, "D: $0 is blocked, distinct label from unknown is DB 'above $0'");
ok(!isRentalReady({ ...minimal, vin: "BAD" }), "Invalid VIN → not ready");
// E
const prof = profileItems(minimal, { docKinds: [], maintenanceCount: 0 });
ok(prof.every((i) => !i.done) && isRentalReady(minimal), "E: missing title/registration/mileage/GPS never affects Rental Ready");
// F
const before = percent(profileItems(minimal, { docKinds: [], maintenanceCount: 0 }));
const richer = { ...minimal, status: "onboarding", current_odometer: 90000, color: "Silver" };
const after = percent(profileItems(richer, { docKinds: ["insurance_card"], maintenanceCount: 0 }));
ok(after > before && richer.status === "onboarding", "F: Fleet Profile % rises; status untouched");
// G — shared insurance PDF
const shared = { id: "doc-1", kind: "insurance_card", relatedVehicles: 9 };
const results = Array.from({ length: 9 }, () => vehicleDocPresence([], [shared]));
ok(results.every((r) => r.bySlot.get("insurance_card")?.id === "doc-1" && r.documentCount === 1 && r.sharedCount === 1),
  "G: shared insurance PDF is Insurance on file for all 9 cars, 1 physical document each");
ok(new Set(results.map((r) => r.bySlot.get("insurance_card")!.id)).size === 1, "G: still one physical source document");
ok(profileItems(minimal, { docKinds: ["insurance_policy"], maintenanceCount: 0 }).find((i) => i.key === "insurance")?.done === true, "Insurance policy class also counts");
ok(vehicleDocPresence([], [{ id: "t", kind: "title" }, { id: "r", kind: "registration" }]).bySlot.size === 2, "Title/registration imports feed the same model");
ok(vehicleDocPresence([], [{ id: "s", kind: "service_receipt" }]).hasMaintenanceEvidence, "Service receipt = maintenance evidence, no slot");
ok(isFinanceKind("payoff_statement") && isFinanceKind("purchase") && !isFinanceKind("insurance_card"), "Finance kinds identified");
ok(vehicleDocPresence([{ id: "d", kind: "insurance_card" }], [shared]).bySlot.get("insurance_card")?.source === "direct", "Direct upload wins over linked evidence");
// Normalization
ok(normalizeDisplayText("FORD FUSION") === "Ford Fusion" && normalizeDisplayText("FORD") === "Ford", "FORD FUSION → Ford Fusion");
ok(normalizeDisplayText("BMW") === "BMW" && normalizeDisplayText("CX-5") === "CX-5" && normalizeDisplayText("F-150 XLT") === "F-150 XLT", "Acronyms/model codes kept");
ok(normalizeDisplayText("McLaren") === "McLaren", "Mixed case left alone");
ok(normalizeDisplayField("vin", "3FA6P0HRXDR153036") === "3FA6P0HRXDR153036" && normalizeDisplayField("license_plate", "ABC DEF") === "ABC DEF", "Identifiers never re-cased");

ok(notReadyMessage("vehicle_not_rental_ready:weekly_rate") === "Not rental ready yet — add a weekly rate above $0 first.", "DB refusal translated");

console.log(fail ? `\n${fail} failed` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
