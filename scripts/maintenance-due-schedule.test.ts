// Next Service stays dark, manager/team, and read-only (run: bun scripts/maintenance-due-schedule.test.ts).
import { readFileSync } from "node:fs";
import { MAINTENANCE_DUE_ENABLED } from "../src/lib/maintenance-due";
import { addCalendarDays } from "../src/lib/maintenance-log";
import { buildMaintenanceDueSchedule } from "../src/lib/maintenance-due-schedule";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flag = readFileSync("src/lib/maintenance-due.ts", "utf8");
const rules = readFileSync("src/lib/maintenance-due-schedule.ts", "utf8");
const server = readFileSync("src/lib/maintenance-due-schedule.functions.ts", "utf8");
const existing = readFileSync("src/lib/maintenance-due.functions.ts", "utf8");
const ui = readFileSync("src/components/admin/MaintenanceLog.tsx", "utf8");
const profile = readFileSync("src/components/admin/VehicleProfile.tsx", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");

ok(MAINTENANCE_DUE_ENABLED === false, "MAINTENANCE_DUE_ENABLED is false");
ok(flag.split("MAINTENANCE_DUE_ENABLED =").length === 2, "the hard-false flag is declared once");
ok(!rules.includes("MAINTENANCE_DUE_ENABLED ="), "the schedule does not declare a second flag");
ok(!/process\.env/.test(flag + rules + server), "no environment variable can open the flag");

const handler = server.slice(server.indexOf(".handler"));
const thrown = handler.indexOf("if (!MAINTENANCE_DUE_ENABLED) throw new Error(DISABLED)");
const role = handler.indexOf("requireManager");
const read = handler.indexOf('.from("maintenance_records")');
ok(thrown >= 0 && thrown < role && role < read, "the schedule throws before requireManager and before any read");
ok(thrown < handler.indexOf("import("), "the throw happens before any dynamic import");
ok(!server.slice(0, server.indexOf("export const listMaintenanceDueSchedule")).includes("roles.server"), "the role module is not a static import");
ok((server.match(/\.limit\(LIMIT \+ 1\)/g) ?? []).length === 3, "service, interval, and vehicle reads each use limit plus one");
ok(
  server.includes("recordPage.length > LIMIT") &&
    server.includes("schedulePage.length > LIMIT") &&
    server.includes("vehiclePage.length > LIMIT"),
  "a long page sets truncated and is not thrown",
);
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(server + rules), "the schedule does not write");
ok(!/stripe|total_cost|notes|labor_cost/i.test(server), "the schedule does not read money, notes, or Stripe");
ok(server.includes('.select("id,item,performed_on,odometer,schedule_id")'), "service reads are the last logged row");
ok(server.includes('.select("id,item,interval_days,interval_miles,is_active")'), "intervals are the stored date and mileage intervals");

const existingHandler = existing.slice(existing.indexOf(".handler"));
const existingGate = existingHandler.indexOf('if (!MAINTENANCE_DUE_ENABLED) throw new Error(DISABLED);');
const existingRole = existingHandler.indexOf("requireManager");
const existingRead = existingHandler.indexOf('.from("vehicles")');
ok(existingGate >= 0 && existingGate < existingRole && existingRole < existingRead, "the existing reader also throws before the role check");

ok(ui.indexOf("if (!MAINTENANCE_DUE_ENABLED) return null") < ui.indexOf("useServerFn(listMaintenanceDueSchedule)"), "the schedule returns before its server call");
ok(ui.includes('title="Next Service"') && ui.includes("Next Service Is Capped"), "the log screen shows Next Service and the cap");
ok(profile.includes("<MaintenanceDueSchedule vehicleId={vehicleId} />"), "vehicle detail mounts the schedule on the service tab");
ok(profile.includes("{MAINTENANCE_LOG_ENABLED ? <MaintenanceLogHistory vehicleId={vehicleId} /> : null}"), "the log history stays behind its own flag");
ok(!nav.includes("maintenance_due_schedule"), "there is no new screen");

const today = "2026-10-21";
const none = buildMaintenanceDueSchedule({ today, currentMiles: 10000, services: [], intervals: [] });
ok(none.length === 1 && none[0].state === "unknown" && none[0].flag === "Unknown" && none[0].reason === "No Service History", "no history is Unknown");

const oil = "10000000-0000-4000-8000-000000000001";
const tires = "10000000-0000-4000-8000-000000000002";
const olderOil = "10000000-0000-4000-8000-000000000003";
const rows = buildMaintenanceDueSchedule({
  today,
  currentMiles: 14900,
  services: [
    { id: olderOil, item: "Oil Change", performedOn: "2026-01-01", odometer: 1000, scheduleId: null },
    { id: oil, item: "Oil Change", performedOn: "2026-10-01", odometer: 10000, scheduleId: "sched-oil" },
    { id: tires, item: "Tires", performedOn: "2026-09-01", odometer: 12000, scheduleId: null },
  ],
  intervals: [
    { id: "sched-oil", item: "Oil Change", intervalDays: 30, intervalMiles: 5000, active: true },
    { id: "sched-tires", item: "Tires", intervalDays: 30, intervalMiles: null, active: true },
    { id: "sched-other", item: "Brakes", intervalDays: 1, intervalMiles: 1, active: true },
  ],
});
const oilRow = rows.find((row) => row.item === "Oil Change");
const tireRow = rows.find((row) => row.item === "Tires");
ok(oilRow?.lastOn === "2026-10-01" && oilRow.lastMiles === 10000, "the later logged oil service is the one that counts");
ok(oilRow?.nextOn === "2026-10-31" && oilRow.nextMiles === 15000, "next service adds the date interval and the mileage interval");
ok(oilRow?.state === "due_soon" && oilRow.flag === "Due Soon", "100 miles remaining is Due Soon and does not use the tire interval");
ok(tireRow?.nextOn === "2026-10-01" && tireRow.state === "overdue" && tireRow.flag === "Overdue" && tireRow.reason === "20 Days Overdue", "the tire date interval is overdue on its own");
ok(tireRow?.nextMiles == null, "a tire row with no mileage interval does not borrow the oil interval");

const drifted = buildMaintenanceDueSchedule({
  today: "2026-03-09",
  currentMiles: null,
  services: [{ id: oil, item: "Oil Change", performedOn: "2026-03-08", odometer: null, scheduleId: "sched-oil" }],
  intervals: [{ id: "sched-oil", item: "Oil Change", intervalDays: 1, intervalMiles: null, active: true }],
});
ok(addCalendarDays("2026-03-08", 1) === "2026-03-09" && drifted[0].nextOn === "2026-03-09" && drifted[0].reason === "Due Today", "a spring-forward day still counts as one calendar day");

const bare = buildMaintenanceDueSchedule({
  today,
  currentMiles: 1000,
  services: [{ id: oil, item: "Oil Change", performedOn: "2026-10-01", odometer: 1000, scheduleId: null }],
  intervals: [],
});
ok(bare[0].state === "unknown" && bare[0].reason === "No Interval On Record", "history without an interval stays Unknown");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall next service checks pass");
process.exit(fails ? 1 : 0);
