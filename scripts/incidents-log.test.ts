// Incidents log stays dark, manager-only, and read-only (run: bun scripts/incidents-log.test.ts).
import { readFileSync } from "node:fs";
import { INCIDENTS_LOG_ENABLED } from "../src/lib/incidents-log-flag";
import {
  buildIncidentsLog,
  type IncidentLogSource,
  type PhotoLinkSource,
} from "../src/lib/incidents-log";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flag = readFileSync("src/lib/incidents-log-flag.ts", "utf8");
const rules = readFileSync("src/lib/incidents-log.ts", "utf8");
const fn = readFileSync("src/lib/incidents-log.functions.ts", "utf8");
const ui = readFileSync("src/components/admin/IncidentsLog.tsx", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const sql = readFileSync("proposed/incidents-log-v1.sql", "utf8");
const liveIncidents = readFileSync("src/lib/incidents.functions.ts", "utf8");
const livePanel = readFileSync("src/components/admin/IncidentsPanel.tsx", "utf8");
const liveIssues = readFileSync("src/lib/driver-issues.functions.ts", "utf8");
const liveInspections = readFileSync("src/lib/inspections.functions.ts", "utf8");
const livePortal = readFileSync("src/lib/portal.functions.ts", "utf8");

ok(INCIDENTS_LOG_ENABLED === false, "INCIDENTS_LOG_ENABLED is false");
ok(flag.includes("export const INCIDENTS_LOG_ENABLED = false;"), "the flag is a hard false constant");
ok(!/process\.env/.test(flag), "no environment variable can open the flag");

const handlerStart = fn.indexOf("export const listIncidentsLog");
const body = fn.slice(handlerStart);
const thrown = body.indexOf('if (!INCIDENTS_LOG_ENABLED) throw new Error("Incidents Log is off")');
const role = body.indexOf("requireManager");
const read = body.indexOf("supabaseAdmin");
ok(thrown >= 0 && thrown < role && role < read, "listIncidentsLog throws before requireManager and before supabaseAdmin");
ok(thrown < body.indexOf("import("), "listIncidentsLog throws before any dynamic import");
ok(!fn.slice(0, handlerStart).includes("roles.server"), "the role module is not a static import");
ok(!fn.slice(0, handlerStart).includes("client.server"), "the admin client is not a static import");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(fn + rules + ui), "the log does not write");
ok(!fn.includes("deposit_deductions") && !fn.includes("driver_responsible_amount"), "the log does not read deductions or the responsibility amount");
ok(!fn.includes("payments") && !fn.includes("addDepositDeduction") && !fn.includes("saveIncident"), "the log does not call a charge or incident writer");
ok(!/\.or\(/.test(fn) && !/\.filter\(/.test(fn), "the reads do not use or or filter");
ok(!/select\(\s*["'`]\*/.test(fn), "the reads name their columns");
ok(fn.includes('from("incidents")') && fn.includes("claim_number") && fn.includes("estimated_cost") && fn.includes("actual_cost"), "the incident row is read from the existing table");
ok(fn.includes("incidents_log_v1 is not installed") && fn.includes("incidents_log_v1_links is not installed"), "a missing proposed table is logged and does not fail the read");
ok(!liveIncidents.includes("INCIDENTS_LOG_ENABLED"), "incident writes do not know this flag");
ok(!livePanel.includes("INCIDENTS_LOG_ENABLED"), "the live Incidents panel does not know this flag");
ok(!liveIssues.includes("INCIDENTS_LOG_ENABLED"), "driver issue writes do not know this flag");
ok(!liveInspections.includes("INCIDENTS_LOG_ENABLED"), "inspection writes do not know this flag");
ok(!livePortal.includes("INCIDENTS_LOG_ENABLED"), "the portal issue writer does not know this flag");
ok(liveIncidents.includes("export const saveIncident"), "saveIncident is still the incident writer");
ok(liveIncidents.includes("export const addDepositDeduction"), "addDepositDeduction is still the deposit writer");
ok(admin.includes("{INCIDENTS_LOG_ENABLED ? <IncidentsLog /> : null}"), "the log is mounted only while the flag is on");
ok(admin.includes("<IncidentsPanel seedIssueId={search.issue ?? null} />"), "the existing Incidents panel stays");
ok(ui.indexOf("if (!INCIDENTS_LOG_ENABLED) return null;") < ui.indexOf("useServerFn(listIncidentsLog)"), "the log returns before the server call");
ok(ui.includes('data-testid="incidents-log"') && ui.includes("Incidents Log"), "the section title is Incidents Log");
ok(ui.includes("Vehicle Totals") && ui.includes("Driver Totals") && ui.includes("Amount Recovered"), "totals and recovery are labeled");
ok(ui.includes("does not create a charge or deduct a deposit"), "the screen says it does not charge or deduct");
ok(!/uppercase|text-transform/.test(ui), "labels are Title Case in the strings");

ok(sql.includes("CREATE TABLE public.incidents_log_v1"), "the recovery table is proposed");
ok(sql.includes("CREATE TABLE public.incidents_log_v1_links"), "the photo link table is proposed");
ok(sql.includes("document_id") && sql.includes("inspection_id") && sql.includes("incidents_log_v1_links_one_target"), "a link names a document or an inspection");
ok(sql.includes("amount_recovered"), "recovery is a recorded number");
ok(sql.includes("ENABLE ROW LEVEL SECURITY") && sql.includes("private.is_manager()"), "the proposed tables are limited to Owner and Manager");
ok(!/FOR INSERT|FOR UPDATE|FOR DELETE|FOR ALL/.test(sql), "the proposed policies are select only");
ok(sql.includes("NOT EXECUTED") && sql.includes("Do not run this against a hosted database"), "the proposal says it is not applied");
ok(!sql.includes("deposit_deductions") || sql.includes("does not insert"), "the proposal does not create a deduction");

const vehicleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherVehicle = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const driverId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherDriver = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function incident(patch: Partial<IncidentLogSource> = {}): IncidentLogSource {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    vehicle_id: vehicleId,
    rental_id: "22222222-2222-4222-8222-222222222222",
    application_id: driverId,
    incident_type: "accident",
    occurred_at: "2026-10-01T15:00:00.000Z",
    description: "Front bumper",
    estimated_cost: 400,
    actual_cost: 250,
    claim_number: "CLM-1",
    status: "in_claim",
    ...patch,
  };
}

function log(extra?: {
  incidents?: IncidentLogSource[];
  recovery?: { incident_id: string; amount_recovered: number | string | null }[];
  links?: PhotoLinkSource[];
  documents?: { id: string; file_name: string | null; category: string | null }[];
  inspections?: { id: string; inspection_type: string | null; status: string | null }[];
  photos?: boolean;
  recoveryInstalled?: boolean;
}) {
  return buildIncidentsLog({
    incidents: extra?.incidents ?? [incident()],
    vehicles: [
      { id: vehicleId, unit_number: "12", year: 2020, make: "honda", model: "civic" },
      { id: otherVehicle, unit_number: "4", year: 2019, make: "toyota", model: "camry" },
    ],
    drivers: [
      { id: driverId, full_name: "ada lovelace" },
      { id: otherDriver, full_name: "Grace Hopper" },
    ],
    recovery: extra?.recovery ?? [],
    links: extra?.links ?? [],
    documents: extra?.documents ?? [],
    inspections: extra?.inspections ?? [],
    photoLinksInstalled: extra?.photos ?? false,
    recoveryInstalled: extra?.recoveryInstalled ?? false,
  });
}

const dark = log();
ok(dark.incidents.length === 1, "one incident row is shown");
ok(dark.incidents[0].typeLabel === "Accident" && dark.incidents[0].claimStatusLabel === "In Claim", "type and claim status are titled");
ok(dark.incidents[0].vehicleLabel === "Unit 12 · 2020 Honda Civic", "the vehicle label uses the stored unit and name");
ok(dark.incidents[0].driverLabel === "Ada Lovelace", "the driver name is displayed");
ok(dark.incidents[0].estimatedCost === 400 && dark.incidents[0].actualCost === 250, "estimated and actual cost come from the incident");
ok(dark.incidents[0].claimNumber === "CLM-1", "the claim number is the stored number");
ok(dark.incidents[0].amountRecovered === null, "recovery stays unknown when the table is absent");
ok(dark.incidents[0].photos === null, "photo links stay unknown when the table is absent");
ok(dark.recoveryInstalled === false && dark.photoLinksInstalled === false, "both proposed tables are reported absent");
ok(dark.vehicleTotals.length === 1 && dark.vehicleTotals[0].recovered.amount === null, "a vehicle total does not invent a recovered amount");
ok(dark.driverTotals.length === 1 && dark.driverTotals[0].estimated === 400, "a driver total sums the estimated cost");

const recorded = log({
  recoveryInstalled: true,
  photos: true,
  recovery: [{ incident_id: incident().id, amount_recovered: "80.50" }],
  links: [
    { id: "link-doc", incident_id: incident().id, document_id: "doc-1", inspection_id: null },
    { id: "link-insp", incident_id: incident().id, document_id: null, inspection_id: "insp-1" },
    { id: "link-both", incident_id: incident().id, document_id: "doc-1", inspection_id: "insp-1" },
    { id: "link-none", incident_id: incident().id, document_id: null, inspection_id: null },
    { id: "link-missing", incident_id: incident().id, document_id: "doc-missing", inspection_id: null },
  ],
  documents: [{ id: "doc-1", file_name: "bumper.jpg", category: "damage" }],
  inspections: [{ id: "insp-1", inspection_type: "checkin", status: "passed" }],
});
ok(recorded.incidents[0].amountRecovered === 80.5, "a recorded recovery is the stored number");
ok(recorded.incidents[0].photos?.map((photo) => photo.id).join(",") === "link-doc,link-insp", "only a single document or inspection link is shown");
ok(recorded.incidents[0].photos?.[0].kind === "document" && recorded.incidents[0].photos?.[0].label === "bumper.jpg", "a document link uses the existing file name");
ok(recorded.incidents[0].photos?.[1].kind === "inspection" && recorded.incidents[0].photos?.[1].label === "Checkin · Passed", "an inspection link uses the existing inspection");

const second = incident({
  id: "33333333-3333-4333-8333-333333333333",
  vehicle_id: vehicleId,
  application_id: driverId,
  occurred_at: "2026-10-20T15:00:00.000Z",
  estimated_cost: 100,
  actual_cost: 0,
  claim_number: null,
  status: "open",
  incident_type: "damage",
  description: null,
});
const unassigned = incident({
  id: "44444444-4444-4444-8444-444444444444",
  vehicle_id: otherVehicle,
  application_id: null,
  rental_id: null,
  estimated_cost: 50,
  actual_cost: null,
  occurred_at: "2026-09-01T15:00:00.000Z",
});
const summed = log({
  incidents: [incident(), second, unassigned],
  recoveryInstalled: true,
  recovery: [
    { incident_id: incident().id, amount_recovered: 25 },
    { incident_id: second.id, amount_recovered: null },
  ],
});
ok(summed.incidents[0].id === second.id, "newer incidents are listed first");
ok(summed.incidents[2].rentalId === null && summed.incidents[2].driverLabel === "No Driver", "an incident without a rental or driver says so");
const vehicle = summed.vehicleTotals.find((row) => row.id === vehicleId)!;
ok(vehicle.incidents === 2 && vehicle.estimated === 500 && vehicle.actual === 250, "vehicle totals sum estimated and actual cost");
ok(vehicle.recovered.amount === 25 && vehicle.recovered.unknown === 1, "a missing recovery is not treated as zero");
ok(summed.driverTotals.length === 1 && summed.driverTotals[0].incidents === 2, "an incident with no driver is left out of driver totals");
ok(summed.driverTotals[0].recovered.amount === 25 && summed.driverTotals[0].recovered.unknown === 1, "driver totals keep the unknown recovery");
const other = summed.vehicleTotals.find((row) => row.id === otherVehicle)!;
ok(other.actual === null && other.recovered.amount === null && other.recovered.unknown === 1, "a null actual cost and a missing recovery stay unknown");
ok(summed.incidents.find((row) => row.id === second.id)?.amountRecovered === null, "a null recovered amount stays null");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall incidents log checks pass");
process.exit(fails ? 1 : 0);
