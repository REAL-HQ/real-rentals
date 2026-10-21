// Maintenance log stays dark, manager-only, and read-only (run: bun scripts/maintenance-log.test.ts).
import { readFileSync } from "node:fs";
import { MAINTENANCE_LOG_ENABLED } from "../src/lib/maintenance-log-flag";
import {
  BRAKE_INTERVAL_MONTHS,
  DATE_DUE_SOON_DAYS,
  OIL_DUE_SOON_MILES,
  TIRE_INTERVAL_MONTHS,
  buildMaintenanceLog,
  reminderBadges,
  type InspectionHistorySource,
  type ServiceHistorySource,
  type VehicleLogSource,
} from "../src/lib/maintenance-log";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flag = readFileSync("src/lib/maintenance-log-flag.ts", "utf8");
const rules = readFileSync("src/lib/maintenance-log.ts", "utf8");
const fn = readFileSync("src/lib/maintenance-log.functions.ts", "utf8");
const ui = readFileSync("src/components/admin/MaintenanceLog.tsx", "utf8");
const vehicles = readFileSync("src/components/admin/VehiclesPanel.tsx", "utf8");
const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
const profile = readFileSync("src/components/admin/VehicleProfile.tsx", "utf8");
const sql = readFileSync("proposed/maintenance-log-v1.sql", "utf8");
const liveService = readFileSync("src/lib/maintenance.functions.ts", "utf8");
const liveServer = readFileSync("src/lib/maintenance.server.ts", "utf8");
const livePanel = readFileSync("src/components/admin/MaintenancePanel.tsx", "utf8");
const liveIncidents = readFileSync("src/lib/incidents.functions.ts", "utf8");

ok(MAINTENANCE_LOG_ENABLED === false, "MAINTENANCE_LOG_ENABLED is false");
ok(flag.includes("export const MAINTENANCE_LOG_ENABLED = false;"), "the flag is a hard false constant");
ok(!/process\.env/.test(flag), "no environment variable can open the flag");

const handlerStart = fn.indexOf("export const listMaintenanceLog");
const body = fn.slice(handlerStart);
const thrown = body.indexOf('if (!MAINTENANCE_LOG_ENABLED) throw new Error("Maintenance Log is off")');
const role = body.indexOf("requireManager");
const read = body.indexOf("supabaseAdmin");
ok(thrown >= 0 && thrown < role && role < read, "listMaintenanceLog throws before requireManager and before supabaseAdmin");
ok(thrown < body.indexOf("import("), "listMaintenanceLog throws before any dynamic import");
ok(!fn.slice(0, handlerStart).includes("roles.server"), "the role module is not a static import");
ok(!fn.slice(0, handlerStart).includes("client.server"), "the admin client is not a static import");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(fn + rules), "the log does not write");
ok(!fn.includes("maintenance.server"), "the log does not call the live service writer");
ok(!/\.or\(/.test(fn) && !/\.filter\(/.test(fn), "the reads do not use or or filter");
ok(!/select\(\s*["'`]\*/.test(fn), "the reads name their columns");
ok(fn.includes("last_oil_change_miles") && fn.includes("registration_expires_on") && fn.includes("insurance_expires_on"), "vehicle service columns are named");
ok(fn.includes('from("maintenance_records")') && fn.includes('from("inspections")'), "history is read from the existing tables");
ok(fn.includes('error.message.includes("relation does not exist")'), "only a missing relation counts as not installed");
ok(fn.indexOf('error.message.includes("relation does not exist")') < fn.indexOf("maintenance_log_v1 is not installed"), "a real read error is not reported as a missing table");
ok(fn.includes("maintenance_log_v1 is not installed"), "a missing inspection table is logged and does not fail the read");
ok(!rules.includes("?? 5000") && !fn.includes("5000"), "a missing oil interval is not replaced with 5000");
ok(!liveService.includes("MAINTENANCE_LOG_ENABLED"), "the live maintenance API does not know this flag");
ok(!liveServer.includes("MAINTENANCE_LOG_ENABLED"), "the live service writer does not know this flag");
ok(!livePanel.includes("MAINTENANCE_LOG_ENABLED"), "the live Service panel does not know this flag");
ok(!liveIncidents.includes("MAINTENANCE_LOG_ENABLED"), "incident writes do not know this flag");
ok(liveServer.includes("export async function recordServiceEvent"), "recordServiceEvent is still the service writer");
ok(overview.includes("getFleetMaintenance") && overview.includes('eyebrow="Service"'), "the existing Service card stays");
ok(overview.includes("{MAINTENANCE_LOG_ENABLED ? <MaintenanceDueTile /> : null}"), "the Maintenance Due tile is mounted only while the flag is on");
ok(profile.includes("{MAINTENANCE_LOG_ENABLED ? <MaintenanceLogHistory vehicleId={vehicleId} /> : null}"), "per-vehicle history is mounted only while the flag is on");
ok(profile.includes("<VehicleService vehicleId={vehicleId} />"), "the existing service tab stays");
ok(vehicles.includes("<MaintenanceLogBadgeSource>"), "Vehicles asks the dark reminder source");
ok(ui.indexOf("if (!MAINTENANCE_LOG_ENABLED) return children({}, false);") < ui.indexOf("useServerFn(listMaintenanceLog)"), "the badge source returns before the server call");
ok(ui.indexOf("if (!MAINTENANCE_LOG_ENABLED) return null;") < ui.indexOf("function MaintenanceDueTileLive"), "the Overview tile returns before its hooks");
ok(ui.includes('data-testid="maintenance-due-tile"') && ui.includes("Maintenance Due"), "the tile title is Maintenance Due");
ok(ui.includes("Overdue") && ui.includes("Due Soon"), "badges say Overdue and Due Soon");
ok(!/uppercase|text-transform/.test(ui), "labels are Title Case in the strings");
ok(!vehicles.includes(">Maintenance<") && !/uppercase|text-transform/.test(ui), "the vehicle table does not gain a maintenance column");

ok(sql.includes("CREATE TABLE public.maintenance_log_v1"), "the inspection expiry table is proposed");
ok(sql.includes("ENABLE ROW LEVEL SECURITY") && sql.includes("private.is_manager()"), "the proposed table is limited to Owner and Manager");
ok(!/FOR INSERT|FOR UPDATE|FOR DELETE|FOR ALL/.test(sql), "the proposed policy is select only");
ok(sql.includes("NOT EXECUTED") && sql.includes("Do not run this against a hosted database"), "the proposal says it is not applied");
ok(OIL_DUE_SOON_MILES === 500 && DATE_DUE_SOON_DAYS === 14, "due soon is 500 miles or 14 days");
ok(TIRE_INTERVAL_MONTHS === 12 && BRAKE_INTERVAL_MONTHS === 12, "tires and brakes use the staff panel's 12 months");

const today = "2026-10-21";
const vehicle = (patch: Partial<VehicleLogSource> = {}): VehicleLogSource => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  unit_number: "12",
  year: 2020,
  make: "honda",
  model: "civic",
  current_odometer: 10000,
  last_oil_change_miles: 10000,
  oil_interval_miles: 5000,
  last_tire_date: "2026-06-01",
  last_brake_inspection_date: "2026-06-01",
  registration_expires_on: "2027-01-01",
  insurance_expires_on: "2027-01-01",
  ...patch,
});

function log(patch: Partial<VehicleLogSource> = {}, extra?: {
  services?: ServiceHistorySource[];
  inspections?: InspectionHistorySource[];
  inspectionDue?: { vehicle_id: string; inspection_due_on: string | null }[];
  installed?: boolean;
}) {
  return buildMaintenanceLog({
    today,
    vehicles: [vehicle(patch)],
    services: extra?.services ?? [],
    inspections: extra?.inspections ?? [],
    inspectionDue: extra?.inspectionDue ?? [],
    inspectionExpiryInstalled: extra?.installed ?? false,
  }).vehicles[0];
}

function item(row: ReturnType<typeof log>, kind: string) {
  return row.items.find((entry) => entry.kind === kind)!;
}

const clear = log();
ok(clear.attention === null, "a car inside every window has no badge");
ok(item(clear, "oil").state === "ok" && item(clear, "oil").dueMiles === 15000, "oil due mileage is last plus the stored interval");
ok(item(clear, "registration").state === "ok" && item(clear, "insurance").state === "ok", "future registration and insurance are clear");
ok(item(clear, "inspection").state === "unknown", "inspection expiry is unknown when the table is absent");

const oilOver = log({ current_odometer: 16000 });
ok(item(oilOver, "oil").state === "overdue" && oilOver.attention === "overdue", "oil past the stored interval is overdue");
const oilSoon = log({ current_odometer: 14500 });
ok(item(oilSoon, "oil").state === "due_soon" && oilSoon.attention === "due_soon", "oil within 500 miles is due soon");
ok(item(oilSoon, "oil").reason === "Due In 500 Miles", "due soon oil names the miles left");
ok(item(log({ current_odometer: 14499 }), "oil").state === "ok", "oil with 501 miles left is clear");
ok(item(log({ current_odometer: 15000 }), "oil").reason === "Due Now", "oil on the due mile is overdue");
ok(item(log({ oil_interval_miles: null, current_odometer: 20000 }), "oil").state === "unknown", "a missing oil interval stays unknown");
ok(item(log({ oil_interval_miles: null, current_odometer: 20000, last_oil_change_miles: 1000 }), "oil").reason === "No Interval On Record", "the missing interval is not treated as 5000");
ok(item(log({ current_odometer: null }), "oil").state === "unknown", "oil without a current reading stays unknown");
ok(item(log({ last_oil_change_miles: null }), "oil").reason === "No Mileage On Record", "oil without a last change stays unknown");

ok(item(log({ last_tire_date: "2025-10-21" }), "tires").state === "overdue", "tires on the 12-month anniversary are overdue");
ok(item(log({ last_tire_date: "2025-10-22" }), "tires").state === "due_soon", "tires one day before 12 months are due soon");
ok(item(log({ last_tire_date: "2025-11-05" }), "tires").state === "ok", "tires more than 14 days from 12 months are clear");
ok(item(log({ last_tire_date: null }), "tires").state === "unknown", "tires without a date stay unknown");
ok(item(log({ last_brake_inspection_date: "2025-09-01" }), "brakes").state === "overdue", "brakes past 12 months are overdue");
ok(item(log({ last_brake_inspection_date: null }), "brakes").reason === "No Date On Record", "brakes without a date stay unknown");

ok(item(log({ registration_expires_on: "2026-10-20" }), "registration").state === "overdue", "a past registration is overdue");
ok(item(log({ registration_expires_on: "2026-11-04" }), "registration").state === "due_soon", "registration inside 14 days is due soon");
ok(item(log({ registration_expires_on: "2026-11-05" }), "registration").state === "ok", "registration 15 days out is clear");
ok(item(log({ registration_expires_on: null }), "registration").reason === "No Expiry On Record", "a missing registration expiry stays unknown");
ok(item(log({ insurance_expires_on: "2026-10-01" }), "insurance").state === "overdue", "a past insurance expiry is overdue");
ok(item(log({ insurance_expires_on: null }), "insurance").state === "unknown", "a missing insurance expiry stays unknown");

const inspected = log({}, {
  inspections: [{
    id: "insp-1",
    vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    inspection_type: "pre_delivery",
    status: "passed",
    completed_at: "2026-10-01",
    created_at: "2026-10-01",
    odometer: 14000,
  }],
  inspectionDue: [{ vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", inspection_due_on: "2026-10-20" }],
  installed: true,
});
ok(item(inspected, "inspection").state === "overdue", "a stored inspection expiry in the past is overdue");
ok(item(inspected, "inspection").history.some((line) => line.id === "insp-1" && line.miles === 14000), "checklist history stays on the inspection row");

const serviced = log({}, {
  services: [{
    id: "svc-1",
    vehicle_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    item: "Oil and filter",
    category: "oil_change",
    performed_on: "2026-08-01",
    odometer: 12000,
    status: "completed",
  }],
});
ok(item(serviced, "oil").history.some((line) => line.id === "svc-1" && line.miles === 12000), "oil history includes the service record");
ok(!item(serviced, "tires").history.some((line) => line.id === "svc-1"), "an oil record does not land on tires");

const mixed = log({ current_odometer: 16000, registration_expires_on: "2026-11-01" });
ok(mixed.attention === "overdue", "overdue wins over due soon on the same car");
const counts = buildMaintenanceLog({
  today,
  vehicles: [vehicle({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", current_odometer: 16000 }), vehicle()],
  services: [],
  inspections: [],
  inspectionDue: [],
  inspectionExpiryInstalled: false,
});
ok(counts.counts.overdue === 1 && counts.counts.dueSoon === 0, "the tile counts cars, and a clear car is not due soon");
ok(reminderBadges(counts.vehicles)["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"] === "overdue", "only overdue and due soon cars get a badge");
ok(reminderBadges(counts.vehicles)[vehicle().id] === undefined, "a clear car has no badge");

if (fails) {
  console.error(`\n${fails} FAILURE(S)`);
  process.exit(1);
}
console.log("\nall maintenance log checks pass");
