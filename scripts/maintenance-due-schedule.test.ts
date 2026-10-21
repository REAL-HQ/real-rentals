// Next Service stays on the existing Maintenance Due list (run: bun scripts/maintenance-due-schedule.test.ts).
import { readFileSync } from "node:fs";
import { MAINTENANCE_DUE_ENABLED } from "../src/lib/maintenance-due";
import { mergeSchedules, scheduleDue, withHistory, type CompanyDefault, type VehicleSchedule } from "../src/lib/maintenance-schedule";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flag = readFileSync("src/lib/maintenance-due.ts", "utf8");
const rules = readFileSync("src/lib/maintenance-schedule.ts", "utf8");
const server = readFileSync("src/lib/maintenance-due-schedule.functions.ts", "utf8");
const service = readFileSync("src/lib/maintenance.functions.ts", "utf8");
const dueRules = readFileSync("src/lib/maintenance-rules.ts", "utf8");
const existing = readFileSync("src/lib/maintenance-due.functions.ts", "utf8");
const ui = readFileSync("src/components/admin/VehicleService.tsx", "utf8");
const log = readFileSync("src/components/admin/MaintenanceLog.tsx", "utf8");
const profile = readFileSync("src/components/admin/VehicleProfile.tsx", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");

ok(MAINTENANCE_DUE_ENABLED === false, "MAINTENANCE_DUE_ENABLED is false");
ok(flag.split("MAINTENANCE_DUE_ENABLED =").length === 2, "the hard-false flag is declared once");
ok(!rules.includes("MAINTENANCE_DUE_ENABLED ="), "the schedule does not declare a second flag");
ok(!/process\.env/.test(flag + rules + server), "no environment variable can open the flag");
ok(server.startsWith("// Maintenance due for one vehicle, using the vehicle-service schedule"), "the header names the vehicle-service computation");

const handler = server.slice(server.indexOf(".handler"));
const thrown = handler.indexOf("if (!MAINTENANCE_DUE_ENABLED) throw new Error(DISABLED)");
const role = handler.indexOf("requireManager");
const read = handler.indexOf('.from("maintenance_defaults")');
ok(thrown >= 0 && thrown < role && role < read, "the schedule throws before requireManager and before any read");
ok(thrown < handler.indexOf("import("), "the throw happens before any dynamic import");
ok(!server.slice(0, server.indexOf("export const listMaintenanceDueSchedule")).includes("roles.server"), "the role module is not a static import");
ok((server.match(/\.limit\(LIMIT \+ 1\)/g) ?? []).length === 3, "defaults, schedules, and records use limit plus one");
ok(server.includes('.eq("id", data.vehicleId).maybeSingle()'), "one vehicle is read by its id");
ok(!server.includes("vehicles.truncated"), "a single vehicle is not a truncated page");
ok(
  server.includes("defaults.truncated") &&
    server.includes("schedules.truncated") &&
    server.includes("records.truncated"),
  "a long page sets truncated and is not thrown",
);
ok(server.includes("mergeSchedules") && server.includes("withHistory") && server.includes("scheduleDue"), "the reader uses the vehicle-service schedule computation");
ok(service.includes("return mergeSchedules(defs, own)") && service.includes("withHistory("), "vehicle service loads schedules through the same computation");
ok(!service.includes("ordered: true") && !service.includes("tieBreakById"), "the live service list does not opt into the dark ordering");
ok(server.includes("ordered: true") && server.includes("tieBreakById: true"), "the dark schedule keeps a deterministic order");
ok(rules.includes('m.status === "completed" && m.performed_on'), "only a completed record with performed_on counts as last service");
ok(server.includes("nullsFirst: false"), "the dark record read puts null dates last");
ok(service.includes("nullsFirst: true") && !service.includes("nullsFirst: false"), "the live record read still puts null dates first");
ok(server.includes('.eq("is_active", true)') && rules.includes("is_active !== false"), "inactive defaults and schedules are ignored");
ok(!dueRules.includes("No Mileage On Record"), "the live due list does not gain a no-mileage reason");
ok(rules.includes('reason: "No Mileage On Record"'), "the dark schedule names a missing odometer");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(server + rules), "the schedule does not write");
ok(!/stripe|total_cost|notes|labor_cost/i.test(server), "the schedule does not read money, notes, or Stripe");
ok(server.includes('.from("maintenance_defaults")'), "company defaults are part of the read");
ok(server.includes("last_done_on,last_done_miles"), "vehicle overrides keep last_done_on");

const existingHandler = existing.slice(existing.indexOf(".handler"));
const existingGate = existingHandler.indexOf('if (!MAINTENANCE_DUE_ENABLED) throw new Error(DISABLED);');
const existingRole = existingHandler.indexOf("requireManager");
const existingRead = existingHandler.indexOf('.from("vehicles")');
ok(existingGate >= 0 && existingGate < existingRole && existingRole < existingRead, "the existing reader also throws before the role check");

ok(ui.indexOf("if (!MAINTENANCE_DUE_ENABLED) return children") < ui.indexOf("useServerFn(listMaintenanceDueSchedule)"), "the schedule returns before its server call");
ok(ui.includes('title="Maintenance Due"') && ui.includes('label="Next Service"'), "due rows stay on the existing list and Next Service stat");
ok(ui.includes('MAINTENANCE_DUE_ENABLED && status === "error"') && ui.includes("Could Not Load Maintenance Due"), "the load error is behind the flag");
ok(ui.includes('MAINTENANCE_DUE_ENABLED && status === "loading"') && ui.includes("Loading Maintenance Due"), "the loading line is behind the flag");
ok(ui.includes("MAINTENANCE_DUE_ENABLED && truncated") && ui.includes("Maintenance Due Is Capped"), "the cap notice is behind the flag");
ok(!log.includes("listMaintenanceDueSchedule") && !log.includes('title="Next Service"'), "the log screen does not add a second card");
ok(!profile.includes("MaintenanceDueSchedule"), "vehicle detail does not mount a second card");
ok(profile.includes("{MAINTENANCE_LOG_ENABLED ? <MaintenanceLogHistory vehicleId={vehicleId} /> : null}"), "the log history stays behind its own flag");
ok(profile.includes("<VehicleService vehicleId={vehicleId} />"), "vehicle detail keeps the existing service list");
ok(!nav.includes("maintenance_due_schedule"), "there is no new screen");

type RecordRow = {
  id: string;
  status: string;
  item?: string | null;
  category?: string | null;
  performed_on: string | null;
  odometer: number | null;
  items?: { category?: string | null }[];
};

function listed(input: {
  today: string;
  currentMiles: number | null;
  defaults: CompanyDefault[];
  schedules: VehicleSchedule[];
  records: RecordRow[];
}) {
  return withHistory(mergeSchedules(input.defaults, input.schedules, { ordered: true }), input.records, { tieBreakById: true }).map((row) => ({
    ...row,
    due: scheduleDue(row, input.currentMiles, input.today),
  }));
}

const today = "2026-10-21";
const oil = "10000000-0000-4000-8000-0000000000b2";
const olderOil = "10000000-0000-4000-8000-0000000000a1";
const defaults: CompanyDefault[] = [
  { id: "d-tires", item: "Tires", category: "tire_replacement", interval_miles: null, interval_days: 30, is_active: true },
  { id: "d-brakes", item: "Brakes", category: "brakes", interval_miles: 10000, interval_days: 365, is_active: true },
  { id: "d-oil", item: "Oil Change", category: "oil_change", interval_miles: 5000, interval_days: 180, is_active: true },
  { id: "d-align", item: "Alignment", category: "alignment", interval_miles: 1, interval_days: 1, is_active: false },
];
const schedules: VehicleSchedule[] = [
  {
    id: "s-oil",
    default_id: "d-oil",
    item: "Oil Change",
    category: "oil_change",
    is_override: true,
    interval_miles: 7500,
    interval_days: 180,
    last_done_on: null,
    last_done_miles: null,
    is_active: true,
  },
  {
    id: "s-dead",
    default_id: null,
    item: "Inactive Extra",
    interval_miles: 1,
    interval_days: 1,
    is_active: false,
  },
];
const rows = listed({
  today,
  currentMiles: 17400,
  defaults,
  schedules,
  records: [
    { id: olderOil, status: "completed", item: "Oil Change", category: "Oil Change", performed_on: "2026-01-01", odometer: 1000 },
    { id: "10000000-0000-4000-8000-0000000000c3", status: "open", item: "Oil Change", category: "Oil Change", performed_on: "2026-10-20", odometer: 20000 },
    { id: "10000000-0000-4000-8000-0000000000d4", status: "completed", item: "Oil Change", category: "Oil Change", performed_on: null, odometer: 20000 },
    { id: oil, status: "completed", item: "Oil Change", category: "Oil Change", performed_on: "2026-10-01", odometer: 10000 },
    { id: olderOil, status: "completed", item: "Oil Change", category: "Oil Change", performed_on: "2026-10-01", odometer: 11111 },
  ],
});
const names = rows.map((row) => row.item);
const brakes = rows.find((row) => row.item === "Brakes");
const oilRow = rows.find((row) => row.item === "Oil Change");
ok(names.join(",") === "Brakes,Oil Change,Tires", "defaults stay in item order and inactive rows drop out");
ok(brakes?.due.state === "unknown" && brakes.due.reason === "No Service On Record" && brakes.last_done_on == null, "Brakes with no history stays Unknown");
ok(oilRow?.is_override === true && oilRow.interval_miles === 7500 && oilRow.company_miles === 5000, "a vehicle override replaces the company interval and keeps the company miles");
ok(oilRow?.last_done_on === "2026-10-01" && oilRow.last_done_miles === 10000, "the later completed oil service wins, including an equal-date id tie");
ok(oilRow?.due.state === "due_soon" && oilRow.due.reason === "Due In 100 Miles", "remaining miles use the override interval");
ok(!rows.some((row) => row.item === "Alignment" || row.item === "Inactive Extra"), "inactive defaults and extra schedules are ignored");

const sameDay = listed({
  today,
  currentMiles: null,
  defaults: [],
  schedules: [{ id: "s-brakes", item: "Brakes", interval_miles: 5000, interval_days: null, last_done_on: null, last_done_miles: 1000, is_active: true }],
  records: [],
});
ok(sameDay[0]?.item === "Brakes" && sameDay[0].due.reason === "No Mileage On Record", "Brakes with a mileage interval and no current odometer says No Mileage On Record");

const tied = withHistory(
  mergeSchedules([], [{ id: "s-oil", item: "Oil Change", interval_miles: 5000, interval_days: null, is_active: true }], { ordered: true }),
  [
    { id: "b", status: "completed", category: "oil_change", performed_on: "2026-10-01", odometer: 2 },
    { id: "a", status: "completed", category: "oil_change", performed_on: "2026-10-01", odometer: 1 },
  ],
  { tieBreakById: true },
);
ok(tied[0]?.last_done_miles === 2, "equal performed_on dates break the tie by id");

const spring = listed({
  today: "2026-03-09",
  currentMiles: null,
  defaults: [{ id: "d-oil", item: "Oil Change", interval_miles: null, interval_days: 1, is_active: true }],
  schedules: [],
  records: [{ id: oil, status: "completed", category: "Oil Change", performed_on: "2026-03-08", odometer: null }],
});
ok(spring[0]?.due.dueOn === "2026-03-09" && spring[0].due.reason === "Due Today", "one interval day is the next calendar date");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall next service checks pass");
process.exit(fails ? 1 : 0);
