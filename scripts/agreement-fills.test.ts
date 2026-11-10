/**
 * Gap-only saves from the agreement details staff already review.
 * Run: npx tsx scripts/agreement-fills.test.ts
 */
import { readFileSync } from "node:fs";
import { recordFillsFromDetails } from "../src/lib/agreement-fills";

let fail = 0;
const ok = (cond: boolean, label: string) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
};

const app = {
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Dana Reyes",
  email: "dana@example.com",
  phone: "8135550142",
  address: "1200 N Ashley Dr",
  city: "Tampa",
  state: "FL",
  zip: "33602",
  license_number: "R123",
  license_state: "FL",
  license_expiration: "2030-04-30",
  dob: "1991-07-02",
  weekly_rent: 329,
  contract_start_date: "2026-11-10",
  contract_end_date: "2026-12-08",
  insurance_carrier: "Progressive",
  insurance_policy_number: "PP-1",
  vehicle_id: "22222222-2222-4222-8222-222222222222",
};
const vehicle = {
  id: "22222222-2222-4222-8222-222222222222",
  vin: "1HGCM82633A004352",
  color: "Silver",
  license_plate: "ABC1234",
  weekly_rate: 329,
};
const details = {
  driverName: "Dana Reyes",
  driverEmail: "dana@example.com",
  driverPhone: "8135550142",
  address: "1200 N Ashley Dr",
  city: "Tampa",
  state: "FL",
  zip: "33602",
  dob: "1991-07-02",
  licenseNumber: "R123",
  licenseState: "FL",
  licenseExpiration: "2030-04-30",
  vehicleColor: "Silver",
  vehicleVin: "1HGCM82633A004352",
  licensePlate: "ABC1234",
  startDate: "2026-11-10",
  endDate: "2026-12-08",
  weeklyRate: "329",
  insuranceCarrier: "Progressive",
  insurancePolicy: "PP-1",
};
const ctx = { datesFromRental: false, startIso: "2026-11-10", endIso: "2026-12-08" };

const none = recordFillsFromDetails(app, vehicle, details, ctx);
ok(none.length === 0, "a complete record is not rewritten");

const corrected = recordFillsFromDetails(
  app,
  vehicle,
  { ...details, driverName: "Other Person", vehicleVin: "2HGCM82633A004352" },
  ctx,
);
ok(corrected.length === 0, "a correction of a valid value stays on the agreement");

const gaps = recordFillsFromDetails(
  { ...app, full_name: "", email: "  ", phone: null, weekly_rent: null, vin: undefined },
  { ...vehicle, vin: "", color: "", license_plate: "", weekly_rate: null },
  {
    ...details,
    driverName: "Dana Reyes",
    driverEmail: "Dana@Example.com",
    driverPhone: "813-555-0142",
    weeklyRate: "350",
    vehicleVin: "1HGCM82633A004352",
    vehicleColor: "Blue",
    licensePlate: "xyz 12",
  },
  ctx,
);
const cols = gaps.map((g) => `${g.table}.${g.column}`).sort();
ok(
  cols.includes("applications.full_name") &&
    cols.includes("applications.email") &&
    cols.includes("applications.phone"),
  "blank driver fields are saved",
);
ok(
  cols.includes("applications.weekly_rent") &&
    gaps.find((g) => g.column === "weekly_rent")?.value === 350,
  "a missing rate is saved on the application",
);
ok(
  cols.includes("vehicles.vin") &&
    cols.includes("vehicles.color") &&
    cols.includes("vehicles.license_plate"),
  "blank vehicle identity is saved",
);
ok(
  !cols.some((c) => c.includes("weekly_rate") || c.includes("deposit")),
  "fleet rate and deposit are not written",
);

const rented = recordFillsFromDetails(
  { ...app, contract_start_date: null, contract_end_date: null },
  vehicle,
  { ...details, startDate: "2026-12-01", endDate: "2026-12-29" },
  { datesFromRental: true, startIso: "2026-11-01", endIso: "2026-11-29" },
);
ok(!rented.some((g) => g.column.startsWith("contract_")), "live rental dates are not overwritten");

const dialog = readFileSync("src/components/admin/PrepareAgreementDialog.tsx", "utf8");
const fn = readFileSync("src/lib/agreements.functions.ts", "utf8");
ok(
  /data-testid="agreement-missing-fields"/.test(dialog),
  "the existing details panel is the missing-information form",
);
ok(
  /data-testid="prepare-layout"/.test(dialog) &&
    /flex-col md:flex-row/.test(dialog) &&
    !/role="tablist"/.test(dialog),
  "the form stacks above the preview",
);
ok(
  /layoutToText\(res\.body\)/.test(dialog),
  "the preview shows the contract text while the PDF is withheld",
);
ok(
  /fingerprint: blockers\.length \? null : prep\.fingerprint/.test(fn),
  "the fingerprint stays withheld while blockers remain",
);
ok(
  /persistReviewedGaps/.test(fn) && !fn.includes("_fills"),
  "saves happen on the server and are not a fingerprint key",
);

if (fail) {
  console.error(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nagreement fills ok");
