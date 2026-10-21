import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  APPLY_VEHICLE_PREFILL_ENABLED,
  PREFERRED_VEHICLE_GAP,
  PUBLIC_APPLY_VEHICLE_COLUMNS,
  presentPreferredVehicle,
} from "../src/lib/apply-vehicle-prefill";

const lib = readFileSync("src/lib/apply-vehicle-prefill.ts", "utf8");
const panel = readFileSync("src/components/site/ApplyVehiclePrefill.tsx", "utf8");
const apply = readFileSync("src/routes/apply.tsx", "utf8");
const wizard = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
const saves = readFileSync("src/lib/applications.functions.ts", "utf8");

function flagValue(source: string): string | null {
  const match = source.match(/const APPLY_VEHICLE_PREFILL_ENABLED: boolean = (false|true)/);
  return match?.[1] ?? null;
}

const listed = {
  id: "veh-1",
  status: "available",
  make: "Toyota",
  model: "Camry",
  year: 2022,
  weekly_rate: 350,
  plate: "PLATE-9XYZ",
  vin: "1HGCM82633A004352",
};

describe("apply vehicle prefill flag", () => {
  it("is a hard false, and /apply does not load the panel while it is off", () => {
    assert.equal(APPLY_VEHICLE_PREFILL_ENABLED, false);
    assert.equal(flagValue(lib), "false");
    assert.equal(flagValue(apply), null);
    assert.equal(flagValue(wizard), null);

    for (const source of [apply, wizard]) {
      const gate = source.indexOf("APPLY_VEHICLE_PREFILL_ENABLED !== true");
      const load = source.indexOf('import("@/components/site/ApplyVehiclePrefill")');
      assert.ok(gate !== -1 && load > gate);
      assert.match(source, /import \{ APPLY_VEHICLE_PREFILL_ENABLED \} from "@\/lib\/apply-vehicle-prefill"/);
      assert.doesNotMatch(source, /from "@\/components\/site\/ApplyVehiclePrefill"/);
    }
    assert.match(apply, /<ApplyVehiclePrefillSlot vehicleId=\{preVehicle\} \/>/);
    assert.match(wizard, /<ApplyVehiclePrefillSlot \/>/);
    assert.doesNotMatch(apply, /sessionStorage/);
    assert.doesNotMatch(wizard, /sessionStorage/);
  });

  it("validates with an explicit public select and adds no write or interpolated filter", () => {
    assert.match(panel, /\.from\("vehicles_public"\)/);
    assert.match(panel, /\.select\(PUBLIC_APPLY_VEHICLE_COLUMNS\)/);
    assert.match(panel, /\.eq\("id", id\)/);
    assert.doesNotMatch(PUBLIC_APPLY_VEHICLE_COLUMNS, /plate|vin/i);
    for (const source of [lib, panel]) {
      assert.doesNotMatch(source, /supabaseAdmin|\.or\(`|\.filter\(`|\.insert\(|\.update\(|\.delete\(|select\("\*"\)/);
    }
    assert.match(saves, /Deliberately NOT vehicle_id/);
    assert.doesNotMatch(panel, /vehicle_id\s*:/);
    assert.doesNotMatch(apply.slice(apply.indexOf("async function submit")), /vehicle_id/);
    const rentalFields = wizard.slice(wizard.indexOf('case "rental"'), wizard.indexOf('case "driving"'));
    assert.doesNotMatch(rentalFields, /vehicle_id/);
    assert.match(PREFERRED_VEHICLE_GAP, /applications\.vehicle_id/);
    assert.match(PREFERRED_VEHICLE_GAP, /this tab only/);
  });
});

describe("preferred vehicle", () => {
  it("keeps an available public row and drops plate and VIN", () => {
    const result = presentPreferredVehicle(listed);
    assert.deepEqual(result, {
      id: "veh-1",
      heading: "2022 Toyota Camry",
      weeklyRateLabel: "$350/week",
    });
    assert.doesNotMatch(JSON.stringify(result), /PLATE-9XYZ|1HGCM82633A004352|plate|vin/i);
    assert.match(panel, /Preferred Vehicle/);
    assert.doesNotMatch(panel, /uppercase|text-transform|invalid|unavailable|not found/i);
  });

  it("ignores an invalid or unavailable id", () => {
    assert.equal(presentPreferredVehicle(null), null);
    assert.equal(presentPreferredVehicle(listed, true), null);
    assert.equal(presentPreferredVehicle({ ...listed, id: " " }), null);
    for (const status of ["retired", "rented", "maintenance", "reserved", null, ""]) {
      assert.equal(presentPreferredVehicle({ ...listed, status }), null, String(status));
    }
  });
});
