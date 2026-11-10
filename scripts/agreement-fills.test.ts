// Gap fills for the agreement prepare screen. Run: npx tsx scripts/agreement-fills.test.ts
import { readFileSync } from "node:fs";
import { overlayAgreementFills, recordToFills, agreementRecord, FillsSchema, type AgreementFills } from "../src/lib/agreement-fills";

let fail = 0;
const ok = (c: unknown, m: string) => { console.log(c ? "  ok  " : "  FAIL", m); if (!c) fail++; };

const app = {
  full_name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  license_number: "",
  license_state: "",
  license_expiration: null,
  dob: null,
  weekly_rent: null,
  contract_start_date: null,
  contract_end_date: null,
  insurance_carrier: null,
  insurance_policy_number: null,
  vehicle_id: "22222222-2222-4222-8222-222222222222",
};
const vehicle = {
  id: "22222222-2222-4222-8222-222222222222",
  year: null,
  make: "",
  model: "",
  color: "",
  vin: "",
  license_plate: "",
  plate_state: "",
  weekly_rate: null,
  deposit: null,
};

const ctx = { datesFromRental: false, startIso: null as string | null, endIso: null as string | null };
const run = (fills: AgreementFills, source = app, veh: typeof vehicle | null = vehicle, extra = ctx) =>
  overlayAgreementFills(source, veh, fills, extra);

console.log("GAPS ACCEPT A REAL VALUE AND IGNORE WHAT IS ALREADY ON FILE");
let r = run({ fullName: "Jo" });
ok(r.rejected.some((b) => b.field === "driver_name") && !r.applied.some((a) => a.column === "full_name"), "a one-word name is rejected");
r = run({ fullName: "Jo Reed" });
ok(r.applied.some((a) => a.column === "full_name" && a.to === "Jo Reed"), "a two-word name is saved on the application");
r = run({ fullName: "Someone Else" }, { ...app, full_name: "Dana Reyes" });
ok(!r.applied.some((a) => a.column === "full_name") && r.app.full_name === "Dana Reyes", "an existing name is not overwritten");

r = run({ email: "Staff@Example.com" });
ok(r.applied.some((a) => a.column === "email" && a.to === "staff@example.com"), "email is stored lowercase");
r = run({ email: "other@example.com" }, { ...app, email: "dana@example.com" });
ok(r.app.email === "dana@example.com" && !r.applied.length, "an existing email is not overwritten");

r = run({ phone: "12" });
ok(r.rejected.some((b) => b.field === "driver_phone"), "a short phone is rejected");
r = run({ phone: "813-555-0142" });
ok(r.applied.some((a) => a.to === "813-555-0142"), "a real phone is saved");

r = run({ address: "1200 N Ashley Dr", city: "Tampa", state: "fl", zip: "33602" });
ok(r.app.address === "1200 N Ashley Dr" && r.app.state === "FL" && r.app.zip === "33602", "a full address is saved and the state is uppercased");
r = run({ address: "1 New St" }, { ...app, address: "1200 N Ashley Dr", city: "Tampa", state: "FL", zip: "33602" });
ok(r.app.address === "1200 N Ashley Dr", "a complete address is not edited from this form");

console.log("VEHICLE IDENTITY, NOT FLEET PRICING");
r = run({ vin: "not a vin" });
ok(r.rejected.some((b) => b.field === "vehicle_vin") && !r.vehicle?.vin, "an invalid VIN is not stored");
r = run({ vin: "1hgcm82633a004352" });
ok(r.vehicle?.vin === "1HGCM82633A004352", "a valid VIN is stored uppercase");
r = run({ vin: "4T1G11AK5NU000001" }, app, { ...vehicle, vin: "1HGCM82633A004352" });
ok(r.vehicle?.vin === "1HGCM82633A004352", "an existing valid VIN is not replaced");
r = run({ color: "BLU", make: "FORD", year: 2020 });
ok(r.vehicle?.color === "Blue" && r.vehicle?.make === "Ford" && r.vehicle?.year === 2020, "colour codes and all-caps makes are normalized");
r = run({ color: "DKB" });
ok(r.rejected.some((b) => b.field === "vehicle_color"), "an unknown colour code is refused");
r = run({ year: 2024, vin: "1HGCM82633A004352" }, app, null);
ok(r.rejected.some((b) => /Assign a vehicle/.test(b.why)) && !r.applied.length, "vehicle details without a vehicle are refused");

r = run({ weeklyRent: 400 }, { ...app, weekly_rent: null }, { ...vehicle, weekly_rate: 329 });
ok(!r.applied.some((a) => a.column === "weekly_rent"), "a vehicle weekly rate already on file is not replaced");
r = run({ weeklyRent: 400 });
ok(r.applied.some((a) => a.table === "applications" && a.column === "weekly_rent" && a.to === 400), "a missing rate is saved on the application");
ok(!r.applied.some((a) => a.column === "deposit" || a.column === "weekly_rate"), "fleet deposit and fleet rate are never written");

console.log("DATES");
r = run(
  { contractStart: "2026-11-01", contractEnd: "2026-12-01" },
  app,
  vehicle,
  { datesFromRental: true, startIso: "2026-10-11", endIso: "2027-04-11" },
);
ok(!r.applied.length && !r.rejected.length, "live rental dates are left alone");
r = run({ contractStart: "2026-12-01", contractEnd: "2026-11-01" });
ok(r.rejected.some((b) => b.field === "contract_end_date") && !r.applied.some((a) => a.column === "contract_end_date"), "an end date on or before the start is rejected");
r = run({ contractStart: "2026-11-01", contractEnd: "2026-12-01" });
ok(r.app.contract_start_date === "2026-11-01" && r.app.contract_end_date === "2026-12-01", "agreed dates are saved when none exist");

console.log("SEEDING DOES NOT CHANGE A COMPLETE RECORD");
const complete = agreementRecord(
  { ...app, full_name: "Dana Reyes", email: "dana@example.com", phone: "813-555-0142", address: "1200 N Ashley Dr", city: "Tampa", state: "FL", zip: "33602", weekly_rent: 329, contract_start_date: "2026-10-11", contract_end_date: "2027-04-11" },
  { ...vehicle, year: 2023, make: "Toyota", model: "Camry", color: "Silver", vin: "1HGCM82633A004352" },
  false,
  "2026-10-11",
  "2027-04-11",
);
const seeded = recordToFills(complete);
ok(FillsSchema.safeParse(seeded).success, "a seeded form still passes the server schema");
r = overlayAgreementFills(
  { ...app, full_name: "Dana Reyes", email: "dana@example.com", phone: "813-555-0142", address: "1200 N Ashley Dr", city: "Tampa", state: "FL", zip: "33602", weekly_rent: 329, contract_start_date: "2026-10-11", contract_end_date: "2027-04-11" },
  { ...vehicle, year: 2023, make: "Toyota", model: "Camry", color: "Silver", vin: "1HGCM82633A004352" },
  seeded,
  { datesFromRental: false, startIso: "2026-10-11", endIso: "2027-04-11" },
);
ok(r.applied.length === 0 && r.rejected.length === 0, "seeding the form applies nothing");

console.log("SCREEN");
const ui = readFileSync("src/components/admin/PrepareAgreementDialog.tsx", "utf8");
ok(ui.includes('data-testid="agreement-missing-fields"'), "the prepare screen has a missing-information form");
ok(ui.includes("flex-col") && ui.includes("md:flex-row") && !ui.includes('role="tablist"'), "on a phone the form stacks above the preview");
ok(ui.includes("layoutToText"), "the preview shows the agreement text while fields are still missing");
const fn = readFileSync("src/lib/agreements.functions.ts", "utf8");
ok(fn.includes("pdfBase64") && /fingerprint: blockers\.length \? null : prep\.fingerprint/.test(fn), "the PDF and fingerprint stay withheld while anything blocks sending");
ok(!fn.includes("_fills"), "fills are not a merge key, so a retry fingerprint still matches after the save");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
