import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { buildIncidentChargePrep } from "../src/lib/incident-charge-prep.ts";

const flag = readFileSync("src/lib/incident-charge-prep-flag.ts", "utf8");
const server = readFileSync("src/lib/incident-charge-prep.functions.ts", "utf8");
const ui = readFileSync("src/components/admin/IncidentChargePrep.tsx", "utf8");
const panel = readFileSync("src/components/admin/IncidentsPanel.tsx", "utf8");

assert.match(flag, /export const INCIDENT_CHARGE_PREP_ENABLED = false;/);
assert.equal(flag.split("INCIDENT_CHARGE_PREP_ENABLED =").length, 2);

const flagAt = server.indexOf("if (!INCIDENT_CHARGE_PREP_ENABLED)");
const roleAt = server.indexOf("requireManager");
const readAt = server.indexOf('.from("incidents")');
assert.ok(flagAt !== -1 && roleAt !== -1 && readAt !== -1 && flagAt < roleAt && roleAt < readAt);
assert.doesNotMatch(server, /stripe|payments|insert\(|\.rpc\(/i);
assert.doesNotMatch(server, /estimated_cost|actual_cost|insurance_payout|notes|police_report/);

const gate = ui.indexOf("if (!INCIDENT_CHARGE_PREP_ENABLED) return null");
const hook = ui.indexOf("useServerFn(listIncidentChargePrep)");
assert.ok(gate !== -1 && hook !== -1 && gate < hook);
assert.match(panel, /INCIDENT_CHARGE_PREP_ENABLED \? <IncidentChargePrep \/> : null/);
assert.match(ui, /This Does Not Create a Charge\./);

const base = {
  id: "10000000-0000-4000-8000-000000000001",
  status: "open",
  incidentType: "collision",
  occurredAt: "2026-10-02T15:00:00.000Z",
  vehicleId: "20000000-0000-4000-8000-000000000002",
  rentalId: "30000000-0000-4000-8000-000000000003",
  driverResponsibleAmount: 125.5,
  unitNumber: "18",
  vehicle: "2021 Toyota Camry",
};

const prepared = buildIncidentChargePrep([
  base,
  { ...base, id: "10000000-0000-4000-8000-000000000009", occurredAt: "2026-10-01T15:00:00.000Z", driverResponsibleAmount: 0 },
  { ...base, id: "10000000-0000-4000-8000-000000000008", status: "closed", driverResponsibleAmount: 400 },
  { ...base, id: "10000000-0000-4000-8000-000000000007", status: "written_off", driverResponsibleAmount: 80 },
  { ...base, id: "10000000-0000-4000-8000-000000000006", status: "repairing", occurredAt: "2026-09-01T15:00:00.000Z", driverResponsibleAmount: null },
]);

assert.equal(prepared.length, 3);
assert.equal(prepared[0].incidentId, "10000000-0000-4000-8000-000000000006");
assert.equal(prepared[0].proposedAmount, null);
assert.equal(prepared[0].basis, "no_driver_amount");
assert.equal(prepared[1].proposedAmount, null);
assert.equal(prepared[2].proposedAmount, 125.5);
assert.equal(prepared[2].basis, "driver_responsible_amount");
assert.equal(prepared[2].vehicleLabel, "18 2021 Toyota Camry");
assert.equal(prepared.some((row) => row.incidentId.endsWith("8") || row.incidentId.endsWith("9") && row.status === "closed"), false);

const negative = buildIncidentChargePrep([{ ...base, driverResponsibleAmount: -20 }]);
assert.equal(negative[0].proposedAmount, null);

console.log("incident charge prep: ok");
