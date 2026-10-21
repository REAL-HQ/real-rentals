import { readFileSync } from "node:fs";
import { visibleTabs, railEntries } from "../src/components/admin/nav-config";
import {
  INCIDENT_BOARD_DISABLED,
  INCIDENT_BOARD_ENABLED,
  INCIDENT_STATUSES,
  assertIncidentBoardEnabled,
  formatCents,
  incidentBoardShowsClaims,
  incidentBoardTierAllowed,
  incidentClaimFacts,
  incidentClaimTotals,
  incidentCostCents,
  incidentCreateBlockers,
  incidentStatusMove,
  incidentWhenEt,
  isOpenIncidentStatus,
  linkedRoadsideLabel,
  proposedTableMissing,
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

ok(row.rental === "No Rental" && row.claims === null && row.vehicleId === "" && row.driverId === null, "an operational row does not invent a rental or claim columns");
ok(incidentBoardShowsClaims("owner") && incidentBoardShowsClaims("manager"), "owners and managers see claim columns");
ok(!incidentBoardShowsClaims("coordinator") && !incidentBoardShowsClaims(null), "a coordinator does not see claim columns");
ok(proposedTableMissing({ code: "42P01" }) && proposedTableMissing({ code: "PGRST205" }), "42P01 and PGRST205 mean the proposed table is not installed");
ok(!proposedTableMissing({ code: "42703" }) && !proposedTableMissing({ code: "PGRST204" }), "a missing column is not a missing table");
const messageOnly: { code?: string | null } = {};
ok(!proposedTableMissing(messageOnly) && !proposedTableMissing(null) && !proposedTableMissing(undefined), "a missing code is a failed read, not a missing table");
ok(incidentCostCents(400) === 40000 && incidentCostCents("80.50") === 8050 && incidentCostCents("12.1") === 1210, "dollar amounts become integer cents");
ok(incidentCostCents(0) === 0 && incidentCostCents("0.00") === 0, "a recorded zero stays zero");
ok(incidentCostCents(null) === null && incidentCostCents("") === null && incidentCostCents(-1) === null && incidentCostCents("1.005") === null, "a blank, negative, or unreadable amount stays unknown");
ok(formatCents(8050) === "$80.50" && formatCents(0) === "$0.00" && formatCents(100000) === "$1,000.00" && formatCents(null) === "Not Recorded", "cents format without turning null into zero");

const incidentId = "11111111-1111-4111-8111-111111111111";
const secondId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const vehicleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherVehicle = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const driverId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const darkFacts = incidentClaimFacts({
  ids: [incidentId],
  costs: [{ id: incidentId, estimated_cost: 400, actual_cost: 250, claim_number: " CLM-1 " }],
  recoveryInstalled: false,
  photoLinksInstalled: false,
  recovery: [{ incident_id: incidentId, amount_recovered: 10 }],
  links: [{ id: "link-doc", incident_id: incidentId, document_id: "doc-1", inspection_id: null }],
  documents: [{ id: "doc-1", file_name: "bumper.jpg", category: "damage" }],
  inspections: [],
});
const darkClaim = darkFacts.get(incidentId)!;
ok(darkClaim.estimatedCostCents === 40000 && darkClaim.actualCostCents === 25000 && darkClaim.claimNumber === "CLM-1", "estimated and actual costs are cents and the claim number is trimmed");
ok(darkClaim.amountRecoveredCents === null && darkClaim.photos === null, "uninstalled recovery and photo tables stay unknown even if rows were passed");

const linked = incidentClaimFacts({
  ids: [incidentId, secondId, otherId],
  costs: [
    { id: incidentId, estimated_cost: 400, actual_cost: 250, claim_number: "CLM-1" },
    { id: secondId, estimated_cost: 100, actual_cost: 0, claim_number: null },
    { id: otherId, estimated_cost: 50, actual_cost: null, claim_number: "" },
  ],
  recoveryInstalled: true,
  photoLinksInstalled: true,
  recovery: [
    { incident_id: incidentId, amount_recovered: "80.50" },
    { incident_id: secondId, amount_recovered: null },
  ],
  links: [
    { id: "link-doc", incident_id: incidentId, document_id: "doc-1", inspection_id: null },
    { id: "link-insp", incident_id: incidentId, document_id: null, inspection_id: "insp-1" },
    { id: "link-both", incident_id: incidentId, document_id: "doc-1", inspection_id: "insp-1" },
    { id: "link-none", incident_id: incidentId, document_id: null, inspection_id: null },
    { id: "link-missing", incident_id: incidentId, document_id: "doc-missing", inspection_id: null },
  ],
  documents: [{ id: "doc-1", file_name: "bumper.jpg", category: "damage" }],
  inspections: [{ id: "insp-1", inspection_type: "checkin", status: "passed" }],
});
ok(linked.get(incidentId)?.amountRecoveredCents === 8050, "a recovered dollar amount is integer cents");
ok(linked.get(incidentId)?.photos?.map((photo) => photo.id).join(",") === "link-doc,link-insp", "only a single document or inspection link is kept");
ok(linked.get(incidentId)?.photos?.[0]?.label === "bumper.jpg" && linked.get(incidentId)?.photos?.[1]?.label === "Checkin · Passed", "photo links use the document name and the inspection");
ok(linked.get(secondId)?.actualCostCents === 0 && linked.get(secondId)?.amountRecoveredCents === null && linked.get(secondId)?.photos?.length === 0, "zero stays zero, a null recovery stays null, and no links is an empty list");

function claimRow(id: string, vehicle: string, vehicleLabel: string, driver: string | null, driverLabel: string | null, rentalId: string | null) {
  return toIncidentBoardRow({
    id,
    incidentType: "accident",
    occurredAt: "2026-10-01T15:00:00.000Z",
    reportedAt: null,
    status: "open",
    location: null,
    description: null,
    severity: null,
    atFault: null,
    injuries: null,
    drivable: null,
    policeReportNumber: null,
    otherParty: null,
    notes: null,
    vehicleLabel,
    driverLabel,
    linkColumn: false,
    issueTitle: null,
    vehicleId: vehicle,
    driverId: driver,
    rentalId,
    claims: linked.get(id) ?? null,
  });
}
const claimedRows = [
  claimRow(incidentId, vehicleId, "Unit 12 · 2020 Honda Civic", driverId, "Ada Lovelace", "22222222-2222-4222-8222-222222222222"),
  claimRow(secondId, vehicleId, "Unit 12 · 2020 Honda Civic", driverId, "Ada Lovelace", "22222222-2222-4222-8222-222222222222"),
  claimRow(otherId, otherVehicle, "Unit 4 · 2019 Toyota Camry", null, null, null),
];
const totals = incidentClaimTotals(claimedRows);
const vehicleTotal = totals.vehicleTotals.find((item) => item.id === vehicleId)!;
const otherTotal = totals.vehicleTotals.find((item) => item.id === otherVehicle)!;
ok(vehicleTotal.incidents === 2 && vehicleTotal.estimatedCostCents === 50000 && vehicleTotal.actualCostCents === 25000, "vehicle totals sum known cents and keep a recorded zero");
ok(vehicleTotal.recoveredCostCents === 8050 && vehicleTotal.recoveredUnknown === 1, "a missing recovery is not treated as zero");
ok(totals.driverTotals.length === 1 && totals.driverTotals[0]?.incidents === 2 && totals.driverTotals[0]?.recoveredUnknown === 1, "an incident with no driver is left out of driver totals");
ok(otherTotal.estimatedCostCents === 5000 && otherTotal.actualCostCents === null && otherTotal.recoveredCostCents === null && otherTotal.recoveredUnknown === 1, "a null actual cost and a missing recovery stay unknown");
ok(claimedRows[0]?.rental === "22222222-2222-4222-8222-222222222222" && claimedRows[2]?.rental === "No Rental", "a rental id is shown and a missing rental says No Rental");

const columns = fn.slice(fn.indexOf("const COLUMNS ="), fn.indexOf("function missingIssueColumn"));
ok(!columns.includes("estimated_cost") && !columns.includes("actual_cost") && !columns.includes("claim_number"), "the operational select does not name claim columns");
const loadOpenSrc = fn.slice(fn.indexOf("async function loadOpen"), fn.indexOf("async function titlesFor"));
ok(!loadOpenSrc.includes("estimated_cost") && !loadOpenSrc.includes("claim_number"), "the open-incident read does not select claim costs");
const claimSrc = fn.slice(fn.indexOf("async function loadIncidentClaims"), fn.indexOf("async function loadOpen"));
ok(claimSrc.includes('select("id,estimated_cost,actual_cost,claim_number")'), "managers read the claim columns by name");
ok(claimSrc.includes('"incidents_log_v1"') && claimSrc.includes('"incidents_log_v1_links"'), "recovery and photo links use the proposed tables");
ok(claimSrc.includes("proposedTableMissing(") && !claimSrc.includes("PGRST204") && !claimSrc.includes("42703") && !claimSrc.includes("relation does not exist"), "claim tables are missing only through the 42P01 and PGRST205 predicate");
const listBody = fn.slice(fn.indexOf("export const listIncidentBoard"), fn.indexOf("export const createIncidentBoard"));
const listGate = listBody.indexOf("assertIncidentBoardEnabled()");
ok(listBody.indexOf("await requireStaff(") < listGate && listGate < listBody.indexOf("incidentBoardShowsClaims(") && listBody.indexOf("incidentBoardShowsClaims(") < listBody.indexOf("loadIncidentClaims("), "claim reads run after the flag check and the manager check");
ok(!fn.includes("deposit_deductions") && !fn.includes("driver_responsible_amount"), "the board does not read deductions or the responsibility amount");
ok(!fn.includes("company_share") && !fn.includes("createStripeClient") && !fn.includes("IncidentsLog"), "the board does not touch maintenance shares, Stripe, or a second screen");

const ui = readFileSync("src/components/admin/IncidentBoard.tsx", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
ok(ui.includes("Estimated Cost") && ui.includes("Actual Cost") && ui.includes("Claim Number") && ui.includes("Amount Recovered") && ui.includes("Photo Links Not Installed"), "the board shows the claim columns");
ok(ui.includes("claimsVisible") && ui.includes("open.claims"), "claim columns render only when the server included them");
ok(ui.includes("does not create a charge or deduct a deposit"), "the board says recovery is not a charge or a deduction");
ok(ui.includes("Vehicle Totals") && ui.includes("Driver Totals"), "vehicle and driver totals stay on the board");
ok(!/uppercase|text-transform/.test(ui), "labels are Title Case in the strings");
ok(admin.includes('{INCIDENT_BOARD_ENABLED && tab === "incident_board" && <IncidentBoard />}'), "the existing board stays behind its flag");
ok(!admin.includes("IncidentsLog"), "there is no second incidents log screen");

const claimSql = readFileSync("proposed/incident-board-claims-v1.sql", "utf8");
ok(claimSql.includes("NOT EXECUTED") && claimSql.includes("Do not run this against a hosted database"), "the claim tables are not applied");
ok(claimSql.includes("CREATE TABLE public.incidents_log_v1") && claimSql.includes("CREATE TABLE public.incidents_log_v1_links"), "recovery and photo links are proposed tables");
ok(claimSql.includes("amount_recovered") && claimSql.includes("private.is_manager()"), "recovery is a recorded number limited to Owner and Manager");
ok(!/FOR INSERT|FOR UPDATE|FOR DELETE|FOR ALL/.test(claimSql) && !/INSERT INTO/i.test(claimSql), "the proposal does not insert or write");

if (fails) {
  console.log(`\n${fails} failed`);
  process.exit(1);
}
console.log("\nAll incident board checks passed");
