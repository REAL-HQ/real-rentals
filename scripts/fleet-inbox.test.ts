// Fleet Inbox pure rules. Run: bun scripts/fleet-inbox.test.ts
import {
  buildProposal,
  matchVehicle,
  findNearVinMatch,
  identityMutationBlocked,
  vinEditDistance,
  suggestBatchVehicle,
  type ExistingVehicle,
} from "../src/lib/fleet-inbox";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };
const F = (o: Record<string, string>, conf: "high" | "medium" | "low" = "high") =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: conf }]));
// Valid check-digit VINs.
const V1 = "1FAHP3F28CL148530", V2 = "3FA6P0HD8ER123457", BAD = "3FA6P0HD5ER12345O";
const veh = (o: Partial<ExistingVehicle>): ExistingVehicle => ({ id: crypto.randomUUID(), vin: null, unit_number: null, license_plate: null, plate_state: null, title_number: null, registration_number: null, year: 2015, make: "Ford", model: "Fusion", ...o });

// A: title → new vehicle
let p = buildProposal({ fields: F({ vin: V2, year: "2015", make: "Ford", model: "Fusion" }) }, "title", []);
ok(p.kind === "new" && p.vin === V2, "A. title with unknown valid VIN → new vehicle");

// B: title → existing vehicle by VIN
const existing = veh({ vin: V2, current_odometer: 84210 } as any);
p = buildProposal({ fields: F({ vin: V2, year: "2015", make: "Ford", model: "Fusion", title_number: "T123" }) }, "title", [existing]);
ok(p.kind === "match" && p.matchVehicleId === existing.id && p.matchBasis === "vin", "B. title → existing vehicle matched by VIN");
ok(p.changes.some((c) => c.field === "title_number" && c.risk === "high" && !c.safe), "B. title number is high-risk, never safe");

// D: identical make/model, different VINs — no collapse
const fusionA = veh({ vin: V1 });
p = buildProposal({ fields: F({ vin: V2, year: "2015", make: "Ford", model: "Fusion" }) }, "insurance_card", [fusionA]);
ok(p.kind === "new", "D. same year/make/model but different VIN → still a new vehicle");
const m = matchVehicle(F({ year: "2015", make: "Ford", model: "Fusion" }), [fusionA, veh({ vin: V2 })]);
ok(m.vehicle === null, "D. year/make/model alone never matches");

// H: conflicting VIN when matched by plate
const plated = veh({ vin: V1, license_plate: "ABC123" });
p = buildProposal({ fields: F({ vin: V2, license_plate: "ABC 123" }) }, "insurance_card", [plated]);
ok(p.kind === "conflict" && p.issues.some((s) => /VIN conflict/.test(s)), "H. plate matches but VIN differs → conflict");

// Invalid VIN never auto-fixed
p = buildProposal({ fields: F({ vin: BAD, year: "2015", make: "Ford", model: "Fusion" }) }, "insurance_card", []);
ok(p.kind === "unidentified" && p.issues.some((s) => /not valid/.test(s)), "Invalid VIN → unidentified, not silently fixed");

// I: mileage regression
p = buildProposal({ fields: F({ vin: V2, current_odometer: "42118" }) }, "service_receipt", [existing]);
ok(p.changes.find((c) => c.field === "current_odometer")?.kind === "update" && p.issues.some((s) => /lower/i.test(s)), "I. lower mileage goes to dated history (flagged in issues), never a blind overwrite");

// Safe change: insurance fill on matched vehicle
p = buildProposal({ fields: F({ vin: V2, insurance_carrier: "Mobilitas", insurance_expires_on: "2027-07-01" }) }, "insurance_card", [existing]);
ok(p.kind === "match" && p.changes.every((c) => c.safe), "Insurance fills on matched vehicle are safe");

// Source authority: lower-authority source cannot replace higher one silently
const ins = veh({ vin: V2, license_plate: "XYZ999" });
p = buildProposal({ fields: F({ vin: V2, insurance_carrier: "Other Co" }) }, "service_receipt", [{ ...ins, insurance_carrier: "Mobilitas" } as any], { [ins.id]: { insurance_carrier: 90 } });
ok(p.changes.find((c) => c.field === "insurance_carrier")?.kind === "conflict", "Lower-authority source vs higher-authority value → conflict");

// Low confidence never safe
p = buildProposal({ fields: { vin: { value: V2, confidence: "high" }, color: { value: "Blue", confidence: "low" } } as any }, "registration", [existing]);
ok(p.changes.find((c) => c.field === "color")?.safe === false, "Low-confidence values are never safe");

// Finance fields never become vehicle changes
p = buildProposal({ fields: F({ vin: V2, purchase_price: "9000", lienholder: "Bank" }) }, "bill_of_sale", [existing]);
ok(!p.changes.some((c) => ["purchase_price", "lienholder"].includes(c.field)), "Finance facts never appear as vehicle-record changes");

// ---- Match hardening ----
const REAL_CZ = "1FA6P0H74F5118769"; // RR-006 windshield — valid check digit
const BAD_TITLE = "1FABP0H74F5118789"; // title OCR — format ok, check digit bad
const SHORT_DATE = "7122027"; // XLK331-style garbage "VIN" from an expiration date

const platedWrong = veh({
  vin: REAL_CZ,
  license_plate: "XLK331",
  year: 2013,
  make: "Ford",
  model: "Fusion",
  unit_number: "RR-001",
});

p = buildProposal(
  {
    fields: F({
      vin: SHORT_DATE,
      license_plate: "XLK331",
      year: "2019",
      make: "Toyota",
      model: "Camry",
      color: "Blue",
    }),
  },
  "registration",
  [platedWrong],
);
ok(p.matchBasis === "plate" && p.matchVehicleId === platedWrong.id, "XLK331: plate matches existing car");
ok(
  !p.changes.some((c) => ["year", "make", "model", "vin"].includes(c.field) && c.kind !== "conflict"),
  "XLK331: plate match must NOT propose identity change as fill/update",
);
ok(p.changes.some((c) => ["year", "make", "model"].includes(c.field) && c.kind === "conflict") || p.issues.some((s) => /identity/i.test(s)), "XLK331: identity flagged for human review");
ok(p.changes.some((c) => c.field === "color"), "XLK331: non-identity fill (color) still allowed");
ok(p.vinCheck?.formatValid === false, "XLK331: short VIN is not format-valid");

const existingCz = veh({ vin: REAL_CZ, unit_number: "RR-006", year: 2015, make: "Ford", model: "Fusion" });
p = buildProposal(
  { fields: F({ vin: BAD_TITLE, year: "2015", make: "Ford", model: "Fusion", title_number: "153502409" }) },
  "title",
  [existingCz],
);
ok(p.kind === "conflict" && p.matchBasis === "vin_near" && p.matchVehicleId === existingCz.id, "Title OCR VIN near-matches RR-006, does not create new");
ok(p.vinCheck?.formatValid === true && p.vinCheck?.checkDigitValid === false, "Title OCR VIN reports bad check digit");
ok(!p.changes.some((c) => c.field === "vin" && c.kind !== "conflict"), "Near-VIN does not propose VIN overwrite as non-conflict write");

p = buildProposal(
  { fields: F({ vin: REAL_CZ, year: "2015", make: "Ford", model: "Fusion" }) },
  "vin_photo",
  [existingCz],
);
ok(p.kind === "match" && p.matchBasis === "vin" && p.matchVehicleId === existingCz.id, "Windshield VIN exact match still works (RR-006 / 1FA6P0H74F5118769)");

ok(vinEditDistance(BAD_TITLE, REAL_CZ) <= 2, "OCR title VIN is within edit distance 2 of real VIN");
ok(findNearVinMatch(BAD_TITLE, [existingCz])?.vehicle.id === existingCz.id, "findNearVinMatch returns the real car");
ok(identityMutationBlocked("plate", "year") && identityMutationBlocked("vin_near", "vin"), "apply guard blocks identity on plate/near bases");
ok(!identityMutationBlocked("vin", "year"), "apply guard allows identity on exact VIN basis");
ok(suggestBatchVehicle([existingCz.id, existingCz.id, null]) === existingCz.id, "batch soft-suggest when all matched ids agree");
ok(suggestBatchVehicle([existingCz.id, platedWrong.id]) === null, "batch soft-suggest null when matched ids disagree");

p = buildProposal({ fields: F({ vin: V2, year: "2015", make: "Ford", model: "Fusion" }) }, "title", []);
ok(p.kind === "new", "Unknown valid VIN still proposes new vehicle");

console.log(fail ? `\n${fail} failed` : "\nall assertions passed");
if (fail) process.exit(1);
