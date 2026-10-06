import { dueStatus, isOdometerConflict, currentMileage, vendorKey, normalizeCategory, sumKnown } from "../src/lib/maintenance-rules";
import { matchVehicle } from "../src/lib/fleet-inbox";

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`); if (!c) fails++; };

const hist = [
  { mileage: 92150, observed_on: "2026-09-20", status: "valid" },
  { mileage: 88000, observed_on: "2026-06-01", status: "valid" },
];
ok(!isOdometerConflict(hist, { mileage: 84300, observed_on: "2026-03-01" }), "A. older receipt with lower miles is not a conflict");
ok(currentMileage([...hist, { mileage: 84300, observed_on: "2026-03-01", status: "valid" }])!.mileage === 92150, "B. older reading never lowers current mileage");
ok(isOdometerConflict(hist, { mileage: 80000, observed_on: "2026-10-01" }), "C. newer date + materially lower miles is flagged");
ok(!isOdometerConflict(hist, { mileage: 91900, observed_on: "2026-10-01" }), "D. small difference within tolerance is not flagged");
ok(vendorKey("PEP BOYS") === vendorKey("Pep Boys") && vendorKey("PepBoys") === vendorKey("pep-boys"), "E. vendor names normalize for matching");
ok(normalizeCategory("Front Brake Pads") === "brakes" && normalizeCategory("Synthetic Oil Change") === "oil_change" && normalizeCategory("Mystery thing") === "other", "F. category normalization; unknown stays other");
ok(sumKnown(null, undefined) === null && sumKnown(10, null, 5.5) === 15.5, "G. unknown costs stay unknown, known costs sum");

const s = { item: "Oil Change", interval_miles: 5000, interval_days: 180, last_done_on: "2026-06-01", last_done_miles: 85000 };
let r = dueStatus(s, 90612, "2026-07-01");
ok(r.state === "overdue" && r.reason === "Overdue By 612 Miles", "H. overdue by miles with clear reason");
r = dueStatus(s, 89700, "2026-07-01");
ok(r.state === "due_soon", "I. due soon within 500 miles");
r = dueStatus(s, 86000, "2026-12-15");
ok(r.state === "overdue" && /Days/.test(r.reason), "J. time interval can make it overdue first");
r = dueStatus({ ...s, last_done_on: null, last_done_miles: null }, 90000, "2026-07-01");
ok(r.state === "unknown", "K. no service on record → Unknown, never invented");

const fusions: any[] = [
  { id: "a", vin: "3FA6P0H71ER118769", unit_number: "RR-006", license_plate: null, plate_state: null, title_number: null, registration_number: null, year: 2015, make: "Ford", model: "Fusion" },
  { id: "b", vin: "3FA6P0H74FR131701", unit_number: "RR-007", license_plate: null, plate_state: null, title_number: null, registration_number: null, year: 2015, make: "Ford", model: "Fusion" },
];
const ymm = { year: { value: "2015", confidence: "high" as const }, make: { value: "Ford", confidence: "high" as const }, model: { value: "Fusion", confidence: "high" as const } };
ok(matchVehicle(ymm, fusions).vehicle === null, "L. year/make/model alone never picks one of several Fusions");
ok(matchVehicle({ ...ymm, vin: { value: "3FA6P0H74FR131701", confidence: "high" } }, fusions).vehicle?.id === "b", "M. VIN matches the right car");
ok(matchVehicle({ unit_number: { value: "rr-006", confidence: "high" } }, fusions).vehicle?.id === "a", "N. unit number matches");

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log("\nAll maintenance rule checks passed");
