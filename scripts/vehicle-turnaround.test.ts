// Vehicle Turnaround stays dark, manager-only, and read-only (run: bun scripts/vehicle-turnaround.test.ts).
import { readFileSync } from "node:fs";
import { railEntries, resolveAdminTab, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { PHASE_STATUSES } from "../src/lib/bookings-list";
import { VEHICLE_TURNAROUND_ENABLED } from "../src/lib/vehicle-turnaround-flag";
import {
  ENDED_RENTAL_STATUSES,
  OPEN_SERVICE_STATUSES,
  PICKUP_STATUSES,
  VEHICLE_TURNAROUND_OMITTED,
  buildVehicleTurnaround,
  easternCalendarDate,
  formatTurnaroundHeading,
  type TurnaroundVehicle,
  type VehicleTurnaroundInput,
} from "../src/lib/vehicle-turnaround";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const fn = readFileSync("src/lib/vehicle-turnaround.functions.ts", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const panel = readFileSync("src/components/admin/VehicleTurnaround.tsx", "utf8");
const board = readFileSync("src/lib/vehicle-turnaround.ts", "utf8");

ok(VEHICLE_TURNAROUND_ENABLED === false, "VEHICLE_TURNAROUND_ENABLED is false");
ok(!/process\.env/.test(readFileSync("src/lib/vehicle-turnaround-flag.ts", "utf8")), "no environment variable can open the flag");

const handler = fn.slice(fn.indexOf(".handler"));
const thrown = handler.indexOf("if (!VEHICLE_TURNAROUND_ENABLED) throw");
const role = handler.indexOf("requireManager");
const read = handler.indexOf("supabaseAdmin");
ok(thrown >= 0 && thrown < role && role < read, "the handler throws before requireManager and before supabaseAdmin");
ok(thrown < handler.indexOf("import("), "the throw happens before any dynamic import");
ok(!fn.slice(0, fn.indexOf("export const getVehicleTurnaround")).includes("roles.server"), "the role module is not a static import");
ok(!fn.slice(0, fn.indexOf("export const getVehicleTurnaround")).includes("client.server"), "the admin client is not a static import");
ok(!/stripe/i.test(fn) && !/stripe/i.test(panel), "the server function and the panel do not mention Stripe");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(fn), "the server function does not write");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(board), "the board rules do not write");
ok(fn.includes('.is("archived_at", null)'), "archived vehicles are left out of the read");
ok(fn.includes('.eq("status", "active")'), "active rentals are read so a car still on rent is excluded");
ok(fn.includes(".in(\"status\", [...ENDED_RENTAL_STATUSES])"), "ended rentals use the bookings completed statuses");
ok(fn.includes('.gte("pickup_date", today)') && fn.includes(".in(\"status\", [...PICKUP_STATUSES])") && fn.includes('.is("deleted_at", null)'), "the next pickup is an upcoming application that names the vehicle");
ok(fn.includes(".in(\"status\", [...OPEN_SERVICE_STATUSES])"), "open service is scheduled and in progress");
ok(fn.includes("registration_expires_on") && fn.includes("insurance_expires_on"), "registration and insurance dates are read from the vehicle");

ok(!TABS.some((t) => t.id === "vehicle_turnaround"), "Vehicle Turnaround is not in TABS");
for (const tier of ["coordinator", "manager", "owner"] as const) {
  ok(!visibleTabs(tier).some((t) => t.id === "vehicle_turnaround"), `${tier} nav has no Vehicle Turnaround tab while the flag is off`);
  ok(!railEntries(tier).some((t) => t.id === "vehicle_turnaround"), `${tier} rail has no Vehicle Turnaround tab while the flag is off`);
}
ok(visibleTabs("owner").length === TABS.length, "owner still sees exactly the dark-build destinations");
ok(admin.includes("VEHICLE_TURNAROUND_ENABLED && tab === \"vehicle_turnaround\" && <VehicleTurnaround />"), "the panel mounts only while the flag is on");
ok(panel.includes("if (!VEHICLE_TURNAROUND_ENABLED) return null"), "the panel renders nothing while the flag is off");
ok(nav.includes("VEHICLE_TURNAROUND_ENABLED") && nav.includes('id: "vehicle_turnaround"'), "the nav knows the tab and gates it on the flag");

ok(
  resolveAdminTab({ urlTab: "vehicle_turnaround", tier: "manager", navTabs: [{ id: "vehicle_turnaround" }] }) === "overview",
  "a direct Vehicle Turnaround link falls back to Overview while the flag is off",
);
ok(
  resolveAdminTab({ urlTab: "vehicle_turnaround", tier: null, navTabs: [] }) === "overview",
  "the direct-link fallback does not wait for the role lookup",
);
ok(resolveAdminTab({ urlTab: "finance", tier: "owner", navTabs: [] }) === "overview", "Unified Finance still falls back while its flag is off");
ok(resolveAdminTab({ urlTab: "settings", tier: "coordinator", navTabs: [] }) === "settings", "Settings stays reachable");
ok(
  resolveAdminTab({ urlTab: "drivers", tier: "manager", navTabs: [{ id: "drivers" }] }) === "drivers",
  "a known tab still opens",
);
ok(
  resolveAdminTab({ urlTab: "payments", tier: "coordinator", navTabs: [{ id: "overview" }] }) === "overview",
  "a tab this tier cannot open still falls back to Overview",
);
ok(resolveAdminTab({ urlTab: "missing", tier: "owner", navTabs: TABS }) === "overview", "an unknown tab falls back to Overview");

ok(easternCalendarDate(new Date("2026-10-21T03:30:00.000Z")) === "2026-10-20", "03:30 UTC is still the previous Eastern calendar day");
ok(easternCalendarDate(new Date("2026-10-21T04:00:00.000Z")) === "2026-10-21", "04:00 UTC is Eastern midnight");
ok(formatTurnaroundHeading("2026-10-21") === "Wednesday, October 21, 2026", "the heading uses the Eastern calendar date");
ok(
  JSON.stringify(ENDED_RENTAL_STATUSES) === JSON.stringify(PHASE_STATUSES.completed),
  "ended rentals are the bookings completed statuses",
);
ok(
  JSON.stringify(PICKUP_STATUSES) === JSON.stringify(["new", "reviewing", "approved"]),
  "pickups are new, reviewing, and approved",
);
ok(JSON.stringify(OPEN_SERVICE_STATUSES) === JSON.stringify(["scheduled", "in_progress"]), "open service is scheduled and in progress");

const today = "2026-10-21";
function vehicle(over: Partial<TurnaroundVehicle> & { id: string }): TurnaroundVehicle {
  return {
    year: 2020,
    make: "Honda",
    model: "Civic",
    license_plate: "ABC",
    unit_number: "1",
    status: "available",
    archived_at: null,
    registration_expires_on: "2027-10-21",
    insurance_expires_on: "2027-10-21",
    ...over,
  };
}

const built = buildVehicleTurnaround({
  today,
  vehicles: [
    vehicle({ id: "shop", unit_number: "1", status: "maintenance", registration_expires_on: "2026-10-01", insurance_expires_on: "2026-11-10" }),
    vehicle({ id: "back", unit_number: "2", status: "rented", registration_expires_on: "2027-10-21", insurance_expires_on: null }),
    vehicle({ id: "idle", unit_number: "30", status: "available" }),
    vehicle({ id: "onrent", unit_number: "4", status: "available" }),
    vehicle({ id: "hold", unit_number: "5", status: "reserved" }),
    vehicle({ id: "old", unit_number: "6", status: "available", archived_at: "2026-01-01" }),
    vehicle({ id: "gone", unit_number: "7", status: "retired" }),
    vehicle({ id: "voided", unit_number: "40", status: "available" }),
    vehicle({ id: "later", unit_number: "50", status: "available" }),
    vehicle({ id: "busy", unit_number: "10", status: "maintenance" }),
    vehicle({ id: "prep", unit_number: "11", status: "onboarding" }),
    vehicle({ id: "stuck", unit_number: "12", status: "rented" }),
    vehicle({ id: "cased", unit_number: "60", status: "Available" }),
  ],
  rentals: [
    { id: "r-shop", vehicle_id: "shop", status: "closed", end_date: "2026-10-01" },
    { id: "r-back", vehicle_id: "back", status: "returned", end_date: "2026-10-20" },
    { id: "r-on", vehicle_id: "onrent", status: "active", end_date: "2026-10-21" },
    { id: "r-gone", vehicle_id: "gone", status: "ended", end_date: "2026-09-01" },
    { id: "r-void", vehicle_id: "voided", status: "cancelled", end_date: "2026-10-01" },
    { id: "r-later", vehicle_id: "later", status: "completed", end_date: "2026-10-25" },
    { id: "r-busy", vehicle_id: "busy", status: "active", end_date: "2026-10-22" },
    { id: "r-old", vehicle_id: "prep", status: "finished", end_date: "2026-09-01" },
    { id: "r-new", vehicle_id: "prep", status: "closed", end_date: "2026-10-11" },
  ],
  pickups: [
    { id: "past", vehicle_id: "prep", full_name: "Past", status: "approved", pickup_date: "2026-10-01", deleted_at: null },
    { id: "gone", vehicle_id: "prep", full_name: "Deleted", status: "approved", pickup_date: "2026-10-22", deleted_at: "2026-10-02" },
    { id: "no", vehicle_id: "prep", full_name: "No", status: "declined", pickup_date: "2026-10-22", deleted_at: null },
    { id: "ada", vehicle_id: "prep", full_name: "Ada Pickup", status: "approved", pickup_date: "2026-10-24", deleted_at: null },
    { id: "bea", vehicle_id: "prep", full_name: "Bea Review", status: "reviewing", pickup_date: "2026-10-23", deleted_at: null },
  ],
  services: [
    { id: "oil", vehicle_id: "shop", status: "scheduled", item: "Oil Change", performed_on: null, due_date: "2026-10-22" },
    { id: "brakes", vehicle_id: "shop", status: "in_progress", item: "Brakes", performed_on: "2026-10-18", due_date: null },
    { id: "tires", vehicle_id: "shop", status: "completed", item: "Tires", performed_on: "2026-10-01", due_date: null },
    { id: "filter", vehicle_id: "shop", status: "upcoming", item: "Filter", performed_on: null, due_date: "2026-10-30" },
  ],
} satisfies VehicleTurnaroundInput);

const ids = built.rows.map((row) => row.vehicleId);
ok(ids.join() === "shop,prep,back,idle,voided,later,cased", "longest idle is first, unknown idle is last, and the other vehicles are omitted");
const shop = built.rows[0];
ok(shop.idleDays === 20 && shop.lastRentalEnd === "2026-10-01" && shop.reasons.join(" · ") === "Returned · In Maintenance", "a shop car returned 20 Eastern days ago is in maintenance and returned");
ok(shop.registration.value === "Expired" && shop.registration.status === "not_ready", "an expired registration uses the readiness helper");
ok(shop.insurance.value === "Expiring Soon" && shop.insurance.status === "attention", "insurance inside 30 days is Expiring Soon");
ok(shop.openService.map((item) => item.item).join() === "Oil Change,Brakes", "open service keeps scheduled and in progress");
ok(shop.vehicleSearch.tab === "vehicles" && shop.vehicleSearch.id === "shop", "the vehicle link opens that vehicle");
ok(shop.serviceSearch.tab === "maintenance", "the service link opens the Service list");
const prep = built.rows.find((row) => row.vehicleId === "prep")!;
ok(prep.idleDays === 10 && prep.reasons.join() === "Returned", "the latest ended rental sets idle days");
ok(prep.nextPickup?.date === "2026-10-23" && prep.nextPickup.name === "Bea Review", "the next pickup is the earliest upcoming application");
const back = built.rows.find((row) => row.vehicleId === "back")!;
ok(back.idleDays === 1 && back.insurance.value === "Not Verified" && back.registration.value === "Current", "a missing insurance date reads as Not Verified and a current registration stays Current");
ok(built.totalIdleDays === 31 && built.unknownIdleCount === 4, "the total adds known idle days and leaves unknown idle out");
ok(built.omitted === VEHICLE_TURNAROUND_OMITTED, "the omitted list is returned");
ok(
  built.omitted.some((line) => line.includes("idle-since")) &&
    built.omitted.some((line) => line.includes("recently")) &&
    built.omitted.some((line) => line.includes("Stripe")) &&
    built.omitted.some((line) => line.includes("cleaning")),
  "the omitted list names the gaps",
);

const empty = buildVehicleTurnaround({ today, vehicles: [], rentals: [], pickups: [], services: [] });
ok(empty.rows.length === 0 && empty.totalIdleDays === 0 && empty.heading === "Wednesday, October 21, 2026", "an empty fleet still names the Eastern day and a zero total");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall vehicle turnaround checks pass");
process.exit(fails ? 1 : 0);
