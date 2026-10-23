import { readFileSync } from "node:fs";
import { visibleTabs, railEntries } from "../src/components/admin/nav-config";
import {
  INCIDENT_BOARD_DISABLED,
  INCIDENT_BOARD_ENABLED,
  INCIDENT_STATUSES,
  assertIncidentBoardEnabled,
  incidentBoardTierAllowed,
  incidentCreateBlockers,
  incidentStatusMove,
  incidentWhenEt,
  isOpenIncidentStatus,
  linkedRoadsideLabel,
  toIncidentBoardRow,
} from "../src/lib/incident-board";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

ok(INCIDENT_BOARD_ENABLED === false, "flag stays off");
try {
  assertIncidentBoardEnabled();
  ok(false, "flag-off refusal throws");
} catch (error) {
  ok(error instanceof Error && error.message === INCIDENT_BOARD_DISABLED, "flag-off refusal throws before any read");
}

ok(incidentBoardTierAllowed("owner") && incidentBoardTierAllowed("manager") && incidentBoardTierAllowed("coordinator"), "owner, manager, and coordinator are allowed");
ok(!incidentBoardTierAllowed(null), "a missing role is refused");

for (const status of INCIDENT_STATUSES) {
  const move = incidentStatusMove("open", status);
  ok(move.ok === true, `open can move to ${status}`);
}
ok(incidentStatusMove("repairing", "closed").ok === true, "repairing can close");
ok(incidentStatusMove("closed", "open").ok === true, "closed can return to open; the table does not forbid it");
const same = incidentStatusMove("in_claim", "in_claim");
ok(same.ok === true && same.ok && same.unchanged, "the same status is not a second change");
ok(incidentStatusMove("open", "deleted").ok === false, "a status outside the column comment is refused");
ok(incidentStatusMove("mystery", "open").ok === false, "an unknown current status is refused");
ok(isOpenIncidentStatus("open") && isOpenIncidentStatus("in_claim") && isOpenIncidentStatus("repairing"), "open, in claim, and repairing stay on the board");
ok(!isOpenIncidentStatus("closed") && !isOpenIncidentStatus("written_off"), "closed and written off leave the board");

ok(incidentCreateBlockers({ vehicleId: "not-a-car", incidentType: "accident", occurredAt: "2026-10-21T14:00:00.000Z" }).includes("Choose a vehicle."), "create requires a vehicle id");
ok(incidentCreateBlockers({ vehicleId: "55555555-5555-4555-8555-555555555555", incidentType: "flat", occurredAt: "2026-10-21T14:00:00.000Z" }).includes("That is not an incident type."), "create refuses a type the table comment does not list");
ok(incidentCreateBlockers({ vehicleId: "55555555-5555-4555-8555-555555555555", incidentType: "breakdown", occurredAt: "" }).includes("Enter when it happened."), "create requires a real time");
ok(incidentCreateBlockers({ vehicleId: "55555555-5555-4555-8555-555555555555", incidentType: "tow", occurredAt: "2026-10-21T14:00:00.000Z" }).length === 0, "a tow with a vehicle and a time can be logged");

ok(linkedRoadsideLabel({ linkColumn: false, issueTitle: "Flat tire" }) === "Unknown", "without the link column the Roadside issue is Unknown");
ok(linkedRoadsideLabel({ linkColumn: true, issueTitle: null }) === "None", "an empty link is None");
ok(linkedRoadsideLabel({ linkColumn: true, issueTitle: "  Flat tire " }) === "Flat tire", "a stored Roadside title is shown");
ok(incidentWhenEt("2026-10-21T05:40:00.000Z") === "Oct 21, 2026, 1:40 AM ET", "the incident date is Eastern Time");
ok(incidentWhenEt("") === "Unknown", "a missing date is Unknown");

const row = toIncidentBoardRow({
  id: "1",
  incidentType: "breakdown",
  occurredAt: "2026-10-21T05:40:00.000Z",
  reportedAt: null,
  status: "open",
  location: null,
  description: "Stalled",
  severity: "minor",
  atFault: "unknown",
  injuries: false,
  drivable: null,
  policeReportNumber: null,
  otherParty: null,
  notes: null,
  vehicleLabel: null,
  driverLabel: null,
  linkColumn: false,
  issueTitle: null,
});
ok(row.vehicle === "Unknown" && row.driver === "Unknown" && row.drivable === "Unknown" && row.roadside === "Unknown", "missing car, driver, drivable, and Roadside stay Unknown");
ok(row.typeLabel === "Breakdown" && row.statusLabel === "Open" && row.occurredEt.includes("ET") && row.injuries === "No", "known type, status, time, and injuries are shown");

const fn = readFileSync("src/lib/incident-board.functions.ts", "utf8");
const incidents = readFileSync("src/lib/incidents.functions.ts", "utf8");
for (const name of ["listIncidentBoard", "createIncidentBoard", "setIncidentBoardStatus"]) {
  const start = fn.indexOf(`export const ${name}`);
  const next = fn.indexOf("export const ", start + 20);
  const body = fn.slice(start, next === -1 ? undefined : next);
  const gate = body.indexOf("assertIncidentBoardEnabled()");
  const staff = body.indexOf("await requireStaff(");
  const readAt = [".from(", ".rpc("].reduce((soonest, token) => {
    const at = body.indexOf(token);
    return at === -1 ? soonest : Math.min(soonest, at);
  }, Number.POSITIVE_INFINITY);
  ok(staff >= 0 && gate > staff && gate < readAt, `${name} checks staff, then refuses while the flag is off, before any read`);
}
ok(!/requireManager\(/.test(fn) && !/requireOwner\(/.test(fn), "the board does not raise the bar above coordinator");
const code = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
ok(!/sendEmail|sendSms|enrollRenterLifecycleNotice|incident_logged|from\("notifications"\)/.test(code), "the board does not notify the driver");
ok(!/\.delete\(/.test(fn), "the board does not delete incidents");
ok(fn.includes('action: "incident.status_changed"') && fn.includes('action: "incident.created"'), "create and status changes write audit_log");
ok(fn.includes(".update({ status: data.status })"), "a status change writes only the status column");
ok(incidents.includes('event: "incident_logged"'), "the existing claim screen still owns incident_logged");
ok(!incidents.includes("incident-board"), "the claim screen is not wired to this board");

const ids = (tier: "owner" | "manager" | "coordinator") => visibleTabs(tier).map((tab) => tab.id);
ok(!ids("coordinator").includes("incident_board") && !ids("manager").includes("incident_board") && !ids("owner").includes("incident_board"), "the nav hides the board while the flag is off");
ok(!railEntries("coordinator").some((tab) => tab.id === "incident_board"), "the rail hides the board while the flag is off");
const sql = readFileSync("proposed/incident-board-v1.sql", "utf8");
ok(sql.includes("NOT EXECUTED") && sql.includes("issue_id") && !/INSERT INTO/i.test(sql), "the link column is proposed and not installed");

if (fails) {
  console.log(`\n${fails} failed`);
  process.exit(1);
}
console.log("\nAll incident board checks passed");
