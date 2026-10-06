// Fleet Inbox pure rules. Run: bun scripts/fleet-inbox.test.ts
import { buildProposal, matchVehicle, type ExistingVehicle } from "../src/lib/fleet-inbox";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };
const F = (o: Record<string, string>, conf: "high" | "medium" | "low" = "high") =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, confidence: conf }]));
// Valid check-digit VINs.
const V1 = "1FAHP3F20CL148530", V2 = "3FA6P0HD5ER123457", BAD = "3FA6P0HD5ER12345O";
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
ok(p.kind === "conflict" && p.changes.find((c) => c.field === "current_odometer")?.kind === "conflict", "I. mileage lower than on file → conflict");

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

console.log(fail ? `\n${fail} failed` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
