import { existsSync, readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { buildIncidentChargePrep } from "../src/lib/incident-charge-prep.ts";

const flag = readFileSync("src/lib/incident-charge-prep-flag.ts", "utf8");
const server = readFileSync("src/lib/incident-charge-prep.functions.ts", "utf8");
const panel = readFileSync("src/components/admin/IncidentsPanel.tsx", "utf8");

assert.match(flag, /export const INCIDENT_CHARGE_PREP_ENABLED = false;/);
assert.equal(flag.split("INCIDENT_CHARGE_PREP_ENABLED =").length, 2);

const flagAt = server.indexOf("if (!INCIDENT_CHARGE_PREP_ENABLED)");
const roleAt = server.indexOf("requireManager");
const readAt = server.indexOf('.from("incidents")');
const deductionsAt = server.indexOf('.from("deposit_deductions")');
assert.ok(flagAt !== -1 && roleAt !== -1 && readAt !== -1 && deductionsAt !== -1);
assert.ok(flagAt < roleAt && roleAt < readAt && readAt < deductionsAt);
assert.doesNotMatch(server, /stripe|payments|insert\(|\.rpc\(/i);
assert.doesNotMatch(server, /estimated_cost|actual_cost|insurance_payout|notes|police_report/);

assert.equal(existsSync("src/components/admin/IncidentChargePrep.tsx"), false);
const gate = panel.indexOf("if (!INCIDENT_CHARGE_PREP_ENABLED) return null");
const hook = panel.indexOf("useServerFn(listIncidentChargePrep)");
assert.ok(gate !== -1 && hook !== -1 && gate < hook);
assert.match(panel, /Remaining to Charge/);
assert.match(panel, /This Does Not Create a Charge\./);
assert.doesNotMatch(panel, /Incident Charge Prep/);
assert.doesNotMatch(panel, /function IncidentChargePrep\b/);
assert.doesNotMatch(panel, /from "\.\/IncidentChargePrep"/);
const label = panel.indexOf(">Remaining to Charge<");
assert.ok(panel.lastIndexOf("INCIDENT_CHARGE_PREP_ENABLED", label) !== -1 && panel.lastIndexOf("INCIDENT_CHARGE_PREP_ENABLED", label) < label);

const closed = "10000000-0000-4000-8000-000000000008";
const writtenOff = "10000000-0000-4000-8000-000000000007";
const zero = "10000000-0000-4000-8000-000000000009";
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
  { ...base, id: zero, occurredAt: "2026-10-01T15:00:00.000Z", driverResponsibleAmount: 0 },
  { ...base, id: closed, status: "closed", driverResponsibleAmount: 400 },
  { ...base, id: writtenOff, status: "written_off", driverResponsibleAmount: 80 },
  { ...base, id: "10000000-0000-4000-8000-000000000006", status: "repairing", occurredAt: "2026-09-01T15:00:00.000Z", driverResponsibleAmount: null },
]);

const ids = prepared.map((row) => row.incidentId);
assert.equal(ids.includes(closed), false);
assert.equal(ids.includes(writtenOff), false);
assert.equal(prepared.length, 3);
assert.equal(prepared[0].incidentId, "10000000-0000-4000-8000-000000000006");
assert.equal(prepared[0].proposedAmount, null);
assert.equal(prepared[0].basis, "no_driver_amount");
assert.equal(prepared.find((row) => row.incidentId === zero)?.proposedAmount, null);
assert.equal(prepared[2].proposedAmount, 125.5);
assert.equal(prepared[2].basis, "driver_responsible_amount");
assert.equal(prepared[2].vehicleLabel, "18 2021 Toyota Camry");

const negative = buildIncidentChargePrep([{ ...base, driverResponsibleAmount: -20 }]);
assert.equal(negative[0].proposedAmount, null);

const covered = "10000000-0000-4000-8000-000000000010";
const partial = "10000000-0000-4000-8000-000000000011";
const noRental = "10000000-0000-4000-8000-000000000012";
const over = "10000000-0000-4000-8000-000000000013";
const deducted = buildIncidentChargePrep(
  [
    { ...base, id: covered, driverResponsibleAmount: 80 },
    { ...base, id: partial, driverResponsibleAmount: 200 },
    { ...base, id: noRental, rentalId: null, driverResponsibleAmount: 90 },
    { ...base, id: over, driverResponsibleAmount: 40 },
  ],
  [
    { incidentId: covered, amount: 50 },
    { incidentId: covered, amount: 30 },
    { incidentId: partial, amount: 25.25 },
    { incidentId: over, amount: 100 },
    { incidentId: "10000000-0000-4000-8000-000000000099", amount: 999 },
  ],
);
assert.equal(deducted.find((row) => row.incidentId === covered)?.proposedAmount, null);
assert.equal(deducted.find((row) => row.incidentId === covered)?.basis, "already_deducted");
assert.equal(deducted.find((row) => row.incidentId === partial)?.proposedAmount, 174.75);
assert.equal(deducted.find((row) => row.incidentId === noRental)?.proposedAmount, null);
assert.equal(deducted.find((row) => row.incidentId === noRental)?.basis, "no_rental");
assert.equal(deducted.find((row) => row.incidentId === over)?.proposedAmount, null);
assert.equal(deducted.find((row) => row.incidentId === over)?.basis, "already_deducted");

console.log("incident charge prep: ok");
