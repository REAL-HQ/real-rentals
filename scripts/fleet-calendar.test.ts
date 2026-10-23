// Fleet Calendar stays dark, manager-only, and read-only (run: bun scripts/fleet-calendar.test.ts).
import { readFileSync } from "node:fs";
import { railEntries, resolveAdminTab, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { FLEET_CALENDAR_ENABLED } from "../src/lib/fleet-calendar-flag";
import {
  FLEET_CALENDAR_OMITTED,
  activeRentalSpan,
  addCalendarDays,
  buildFleetCalendar,
  easternCalendarDate,
  isScheduledPickup,
  mondayOf,
  serviceDay,
  weekDays,
} from "../src/lib/fleet-calendar";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const fn = readFileSync("src/lib/fleet-calendar.functions.ts", "utf8");
const board = readFileSync("src/lib/fleet-calendar.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const panel = readFileSync("src/components/admin/FleetCalendar.tsx", "utf8");
const flag = readFileSync("src/lib/fleet-calendar-flag.ts", "utf8");

ok(FLEET_CALENDAR_ENABLED === false, "FLEET_CALENDAR_ENABLED is false");
ok(!/process\.env/.test(flag), "no environment variable can open the flag");

const handler = fn.slice(fn.indexOf(".handler"));
const thrown = handler.indexOf("if (!FLEET_CALENDAR_ENABLED) throw");
ok(thrown >= 0 && thrown < handler.indexOf("requireManager") && handler.indexOf("requireManager") < handler.indexOf("supabaseAdmin"), "the handler throws before requireManager and before supabaseAdmin");
ok(thrown < handler.indexOf("import("), "the throw happens before any dynamic import");
ok(!fn.slice(0, fn.indexOf("export const getFleetCalendar")).includes("roles.server"), "the role module is not a static import");
ok(!fn.slice(0, fn.indexOf("export const getFleetCalendar")).includes("client.server"), "the admin client is not a static import");
ok(!/stripe/i.test(fn) && !/stripe/i.test(board) && !/stripe/i.test(panel), "Fleet Calendar does not mention Stripe");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(fn), "the server function does not write");
ok(fn.includes('.eq("status", "active"') && fn.includes('.is("end_date", null)') && fn.includes('.gte("end_date", weekStart)'), "active rentals include an open end date and a dated end as separate queries");
ok(!/\.(or|filter)\(\s*`/.test(fn), "calendar filters are not interpolated");
ok(fn.includes('.gte("performed_on", weekStart)') && fn.includes('.lte("performed_on", weekEnd)') && fn.includes('.gte("due_date", weekStart)') && fn.includes('.lte("due_date", weekEnd)'), "service days use performed_on or due_date as query arguments");
ok(fn.includes(".in(\"status\", [...PICKUP_STATUSES])") && fn.includes('.not("vehicle_id", "is", null)'), "pickups are scheduled applications that already have a vehicle");
ok(fn.includes(".in(\"status\", [...OPEN_MAINTENANCE_STATUSES])"), "service blocks use open maintenance record statuses");
ok(fn.includes('.is("archived_at", null)'), "archived vehicles are not loaded");

ok(!TABS.some((t) => t.id === "fleet_calendar"), "Fleet Calendar is not in TABS");
for (const tier of ["coordinator", "manager", "owner"] as const) {
  ok(!visibleTabs(tier).some((t) => t.id === "fleet_calendar"), `${tier} nav has no Fleet Calendar tab while the flag is off`);
  ok(!railEntries(tier).some((t) => t.id === "fleet_calendar"), `${tier} rail has no Fleet Calendar tab while the flag is off`);
}
ok(visibleTabs("owner").length === TABS.length, "owner still sees exactly the dark-build destinations");
ok(admin.includes('FLEET_CALENDAR_ENABLED && tab === "fleet_calendar" && <FleetCalendar />'), "the panel mounts only while the flag is on");
ok(panel.includes("if (!FLEET_CALENDAR_ENABLED) return null"), "the panel renders nothing while the flag is off");
ok(
  resolveAdminTab({ urlTab: "fleet_calendar", tier: "manager", navTabs: [{ id: "fleet_calendar" }] }) === "overview",
  "a direct Fleet Calendar link falls back to Overview while the flag is off",
);
ok(
  resolveAdminTab({ urlTab: "fleet_calendar", tier: null, navTabs: [] }) === "overview",
  "the direct-link fallback does not wait for the role lookup",
);
ok(resolveAdminTab({ urlTab: "drivers", tier: "manager", navTabs: [{ id: "drivers" }] }) === "drivers", "a known tab still opens");
ok(resolveAdminTab({ urlTab: null, tier: "owner", navTabs: TABS }) === "overview", "a missing tab falls back to Overview");

ok(easternCalendarDate(new Date("2026-10-21T03:30:00.000Z")) === "2026-10-20", "03:30 UTC is still the previous Eastern calendar day");
ok(mondayOf("2026-10-21") === "2026-10-19", "Wednesday snaps back to Monday");
ok(mondayOf("2026-10-25") === "2026-10-19", "Sunday belongs to the Monday that started that week");
ok(weekDays("2026-10-19")[6] === "2026-10-25", "a week is seven days");
ok(addCalendarDays("2026-10-19", 7) === "2026-10-26", "next week starts seven days later");

const weekStart = "2026-10-19";
const weekEnd = "2026-10-25";
ok(activeRentalSpan({ status: "active", start_date: "2026-10-18", end_date: null }, weekStart, weekEnd)?.end === weekEnd, "an open rental runs through the visible week");
ok(activeRentalSpan({ status: "active", start_date: "2026-10-21", end_date: "2026-10-22" }, weekStart, weekEnd)?.start === "2026-10-21", "a rental is clipped to its own dates");
ok(activeRentalSpan({ status: "completed", start_date: "2026-10-21", end_date: "2026-10-22" }, weekStart, weekEnd) === null, "a completed rental is omitted");
ok(isScheduledPickup({ status: "approved", pickup_date: "2026-10-20", deleted_at: null, vehicle_id: "veh" }, weekStart, weekEnd), "an approved pickup on a vehicle counts");
ok(!isScheduledPickup({ status: "approved", pickup_date: "2026-10-20", deleted_at: null, vehicle_id: null }, weekStart, weekEnd), "a pickup with no vehicle is omitted");
ok(serviceDay({ status: "scheduled", performed_on: null, due_date: "2026-10-21" }, weekStart, weekEnd) === "2026-10-21", "a scheduled record uses its due date");
ok(serviceDay({ status: "in_progress", performed_on: "2026-10-22", due_date: "2026-10-21" }, weekStart, weekEnd) === "2026-10-22", "performed_on wins when it is in the week");
ok(serviceDay({ status: "completed", performed_on: "2026-10-22", due_date: "2026-10-21" }, weekStart, weekEnd) === null, "a completed record is omitted");

const built = buildFleetCalendar({
  weekStart: "2026-10-21",
  vehicles: [
    { id: "shop", label: "#4 Civic", status: "maintenance", archived_at: null },
    { id: "road", label: "#5 Accord", status: "available", archived_at: null },
    { id: "old", label: "Old", status: "maintenance", archived_at: "2026-01-01" },
  ],
  rentals: [
    { id: "rent", vehicle_id: "road", status: "active", start_date: "2026-10-20", end_date: null, driver_name: "Ada" },
    { id: "done", vehicle_id: "road", status: "completed", start_date: "2026-10-20", end_date: "2026-10-21", driver_name: "Bea" },
  ],
  pickups: [
    { id: "pick", vehicle_id: "road", full_name: "Cy", status: "reviewing", pickup_date: "2026-10-23", deleted_at: null },
    { id: "loose", vehicle_id: null, full_name: "Dee", status: "approved", pickup_date: "2026-10-23", deleted_at: null },
  ],
  services: [
    { id: "svc", vehicle_id: "shop", status: "scheduled", item: "Oil", performed_on: null, due_date: "2026-10-21" },
  ],
});
const road = built.rows.find((row) => row.vehicleId === "road")!;
const shop = built.rows.find((row) => row.vehicleId === "shop")!;
ok(built.weekStart === "2026-10-19" && built.rows.length === 2 && !built.rows.some((row) => row.vehicleId === "old"), "the week snaps to Monday and archived vehicles drop out");
ok(road.blocks.some((block) => block.kind === "rental" && block.search.tab === "bookings" && block.end === weekEnd), "the open rental links to Bookings and stays open through Sunday");
ok(!road.blocks.some((block) => block.id === "done"), "the completed rental is not a block");
ok(road.blocks.some((block) => block.id === "pick" && block.search.tab === "drivers"), "the pickup links to Drivers");
ok(shop.blocks.some((block) => block.kind === "in_maintenance" && block.start === weekStart && block.end === weekEnd && block.search.id === "shop"), "In Maintenance covers the visible week and opens the vehicle");
ok(shop.blocks.some((block) => block.id === "svc" && block.search.tab === "maintenance" && !block.search.id), "a service day opens the Service list");
ok(built.omitted === FLEET_CALENDAR_OMITTED && built.omitted.some((line) => line.includes("out-of-service")), "the omitted list names the missing periods");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall fleet calendar checks pass");
process.exit(fails ? 1 : 0);
