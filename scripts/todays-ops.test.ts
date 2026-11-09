// Today's Ops stays dark, manager-only, and read-only (run: bun scripts/todays-ops.test.ts).
import { readFileSync } from "node:fs";
import { railEntries, resolveAdminTab, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { COLLECTIONS_WATCH_STATUSES } from "../src/lib/collections-watch";
import { TODAYS_OPS_ENABLED } from "../src/lib/todays-ops-flag";
import {
  OPS_ROW_LIMIT,
  TODAYS_OPS_OMITTED,
  addCalendarDays,
  buildTodaysOps,
  easternCalendarDate,
  formatOpsDate,
  isApprovedReady,
  isCollectionsWatchStatus,
  isInMaintenance,
  isOpenIncidentStatus,
  isOpenRoadsideIssue,
  isPaymentDueToday,
  isReturnWindow,
  isScheduledPickup,
  type TodaysOpsInput,
} from "../src/lib/todays-ops";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const fn = readFileSync("src/lib/todays-ops.functions.ts", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const panel = readFileSync("src/components/admin/TodaysOps.tsx", "utf8");
const docs = readFileSync("src/lib/vehicle-docs.functions.ts", "utf8");
const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
const payments = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
const board = readFileSync("src/lib/todays-ops.ts", "utf8");

ok(TODAYS_OPS_ENABLED === false, "TODAYS_OPS_ENABLED is false");
ok(!/process\.env/.test(readFileSync("src/lib/todays-ops-flag.ts", "utf8")), "no environment variable can open the flag");

const handler = fn.slice(fn.indexOf(".handler"));
const thrown = handler.indexOf("if (!TODAYS_OPS_ENABLED) throw");
const role = handler.indexOf("requireManager");
const read = handler.indexOf("supabaseAdmin");
ok(thrown >= 0 && thrown < role && role < read, "the handler throws before requireManager and before supabaseAdmin");
ok(thrown < handler.indexOf("import("), "the throw happens before any dynamic import");
ok(!fn.slice(0, fn.indexOf("export const getTodaysOps")).includes("roles.server"), "the role module is not a static import");
ok(!fn.slice(0, fn.indexOf("export const getTodaysOps")).includes("client.server"), "the admin client is not a static import");
ok(!/stripe/i.test(fn), "the server function does not mention Stripe");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(fn), "the server function does not write");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(board), "the board rules do not write");
ok(fn.includes("loadExpiringItems(supabaseAdmin, 7)"), "documents reuse the existing helper with a 7 day window");
ok(fn.includes('.eq("pickup_date", today)') && fn.includes(".in(\"status\", [...PICKUP_STATUSES])"), "pickups are today's new, reviewing, and approved applications");
ok(fn.includes('.eq("status", "approved")') && fn.includes('.is("deleted_at", null)'), "approved-ready is status approved and not deleted");
ok(fn.includes('.in("end_date", [today, tomorrow])') && fn.includes('.eq("next_payment_due", today)'), "returns use end_date and due today uses next_payment_due");
ok(fn.includes(".in(\"status\", [...COLLECTIONS_WATCH_STATUSES])"), "overdue payments use the Collections Watch statuses");
ok(fn.includes('.not("status", "in", "(closed,written_off)")'), "open incidents exclude closed and written off");
ok(fn.includes('.in("kind", ["breakdown", "tow"])') && fn.includes('.not("status", "in", "(resolved,closed)")'), "roadside is open breakdown and tow issues");
ok(fn.includes('.eq("status", "maintenance")') && fn.includes('.is("archived_at", null)'), "maintenance is the vehicle status, not a second record list");

const listExpiring = docs.slice(docs.indexOf("export const listExpiring"), docs.indexOf("export async function loadExpiringItems"));
ok(listExpiring.indexOf("requireStaff") < listExpiring.indexOf("loadExpiringItems"), "listExpiring still checks staff before the shared read");
ok(listExpiring.includes("data.withinDays ?? 45"), "listExpiring still defaults to 45 days");

ok(!TABS.some((t) => t.id === "todays_ops"), "Today's Ops is not in TABS");
for (const tier of ["coordinator", "manager", "owner"] as const) {
  ok(!visibleTabs(tier).some((t) => t.id === "todays_ops"), `${tier} nav has no Today's Ops tab while the flag is off`);
  ok(!railEntries(tier).some((t) => t.id === "todays_ops"), `${tier} rail has no Today's Ops tab while the flag is off`);
}
ok(visibleTabs("owner").length === TABS.length, "owner still sees exactly the dark-build destinations");
ok(admin.includes("TODAYS_OPS_ENABLED && tab === \"todays_ops\" && <TodaysOps />"), "the panel mounts only while the flag is on");
ok(panel.includes("if (!TODAYS_OPS_ENABLED) return null"), "the panel renders nothing while the flag is off");
ok(!/stripe/i.test(panel), "the panel does not mention Stripe");

ok(
  resolveAdminTab({ urlTab: "todays_ops", tier: "manager", navTabs: [{ id: "todays_ops" }] }) === "overview",
  "a direct Today's Ops link falls back to Overview while the flag is off",
);
ok(
  resolveAdminTab({ urlTab: "todays_ops", tier: null, navTabs: [] }) === "overview",
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
ok(addCalendarDays("2026-10-21", 1) === "2026-10-22", "tomorrow is the next calendar date");
ok(addCalendarDays("2026-10-31", 1) === "2026-11-01", "adding a day crosses the month");
ok(formatOpsDate("2026-10-21") === "Wednesday, October 21, 2026", "the heading uses the Eastern calendar date");

ok(
  JSON.stringify(COLLECTIONS_WATCH_STATUSES) === JSON.stringify(["late", "past_due", "collections", "overdue", "failed", "unpaid"]),
  "Collections Watch is the six overdue statuses and does not include current",
);
ok(!isCollectionsWatchStatus("current") && !isCollectionsWatchStatus("paid") && isCollectionsWatchStatus("late"), "current and paid are not overdue");
ok(overview.includes("COLLECTIONS_WATCH_STATUSES") && !overview.includes("const OVERDUE_STATUSES"), "Overview uses the shared Collections Watch list");
ok(payments.includes("COLLECTIONS_WATCH_STATUSES") && !payments.includes('new Set(["late"'), "Payments uses the shared Collections Watch list");

const today = "2026-10-21";
const tomorrow = "2026-10-22";
ok(isScheduledPickup({ status: "reviewing", pickup_date: today, deleted_at: null }, today), "a reviewing pickup today counts");
ok(!isScheduledPickup({ status: "declined", pickup_date: today, deleted_at: null }, today), "a declined pickup does not count");
ok(!isScheduledPickup({ status: "approved", pickup_date: tomorrow, deleted_at: null }, today), "a pickup on another day does not count");
ok(!isScheduledPickup({ status: "approved", pickup_date: today, deleted_at: "2026-10-01" }, today), "a deleted pickup does not count");
ok(isApprovedReady({ status: "approved", deleted_at: null }) && !isApprovedReady({ status: "active", deleted_at: null }), "approved-ready is approved and not already active");
ok(isReturnWindow({ status: "active", end_date: tomorrow }, today, tomorrow), "an active rental ending tomorrow counts");
ok(!isReturnWindow({ status: "completed", end_date: today }, today, tomorrow), "a completed rental is not a return");
ok(isPaymentDueToday({ status: "active", next_payment_due: today }, today), "an active rental due today counts");
ok(!isPaymentDueToday({ status: "active", next_payment_due: tomorrow }, today), "a rental due tomorrow is not due today");
ok(!isPaymentDueToday({ status: "completed", next_payment_due: today }, today), "a completed rental's due date is omitted");
ok(isOpenIncidentStatus("in_claim") && isOpenIncidentStatus("repairing") && !isOpenIncidentStatus("closed") && !isOpenIncidentStatus("written_off"), "open incidents exclude closed and written off");
ok(isOpenRoadsideIssue({ kind: "tow", status: "open" }) && !isOpenRoadsideIssue({ kind: "vehicle", status: "open" }), "roadside is breakdown and tow only");
ok(!isOpenRoadsideIssue({ kind: "breakdown", status: "resolved" }), "a resolved breakdown is not open");
ok(isInMaintenance({ status: "maintenance", archived_at: null }) && !isInMaintenance({ status: "maintenance", archived_at: "2026-10-01" }), "an archived maintenance vehicle is omitted");

const built = buildTodaysOps({
  today,
  tomorrow,
  applications: [
    { id: "pick", full_name: "Ada Pickup", status: "approved", pickup_date: today, deleted_at: null },
    { id: "pick", full_name: "Ada Pickup", status: "approved", pickup_date: today, deleted_at: null },
    { id: "ready", full_name: "Bea Ready", status: "approved", pickup_date: null, deleted_at: null },
    { id: "nope", full_name: "Cy Closed", status: "declined", pickup_date: today, deleted_at: null },
  ],
  rentals: [
    { id: "ret", status: "active", end_date: today, next_payment_due: today, driver_name: "Dee", vehicle_label: "Car A" },
    { id: "later", status: "active", end_date: "2026-10-23", next_payment_due: tomorrow, driver_name: "Eve", vehicle_label: "Car B" },
  ],
  payments: [
    { id: "owe", status: "past_due", amount: 120, driver_name: "Dee" },
    { id: "fine", status: "current", amount: 80, driver_name: "Eve" },
  ],
  documents: [{ vehicle_id: "veh", label: "Car A", what: "Registration", expires_on: "2026-10-25", days: 4 }],
  incidents: [
    { id: "inc", status: "open", incident_type: "accident", vehicle_label: "Car A" },
    { id: "done", status: "written_off", incident_type: "damage", vehicle_label: "Car B" },
  ],
  issues: [
    { id: "tow", kind: "tow", status: "open", title: "Needs a tow" },
    { id: "acct", kind: "account", status: "open", title: "Login" },
  ],
  vehicles: [
    { id: "shop", status: "maintenance", archived_at: null, label: "#12 · Civic" },
    { id: "old", status: "maintenance", archived_at: "2026-01-01", label: "Old" },
  ],
} satisfies TodaysOpsInput);

const byId = (id: string) => built.sections.find((section) => section.id === id)!;
ok(byId("pickups").items.length === 1 && byId("pickups").items[0].search.tab === "drivers", "an approved pickup is listed once and links to Drivers");
ok(byId("approved_ready").items.map((item) => item.id).join() === "pick,ready", "approved-ready includes the pickup and the other approved driver");
ok(byId("returns").items[0].detail === "Ends Today" && byId("returns").items[0].search.tab === "bookings", "a return today links to Bookings");
ok(byId("payments_due").items.length === 1 && byId("payments_due").items[0].detail === "Due Today", "only the rental due today is in Payments Due Today");
ok(byId("overdue").items.length === 1 && byId("overdue").items[0].search.filter === "overdue" && byId("overdue").items[0].detail.includes("$120.00"), "overdue links to the Payments overdue filter");
ok(byId("documents").items[0].search.id === "veh" && byId("documents").items[0].detail === "Registration · Expires In 4 Days", "a document links to its vehicle");
ok(byId("incidents").items.length === 1 && byId("incidents").items[0].search.tab === "incidents" && !byId("incidents").items[0].search.id, "an incident opens the Incidents list");
ok(byId("roadside").items.length === 1 && byId("roadside").items[0].search.tab === "driver_issues", "a tow opens Driver Issues");
ok(byId("maintenance").items.length === 1 && byId("maintenance").items[0].search.id === "shop", "a maintenance vehicle opens that vehicle");
ok(built.sections.every((section) => section.items.length >= 0) && built.omitted === TODAYS_OPS_OMITTED, "every section is present and the omitted list is returned");
ok(built.omitted.some((line) => line.includes("licence")) && built.omitted.some((line) => line.includes("Stripe")), "the omitted list names the gaps");

const empty = buildTodaysOps({
  today,
  tomorrow,
  applications: [],
  rentals: [],
  payments: [],
  documents: [],
  incidents: [],
  issues: [],
  vehicles: [],
});
ok(empty.sections.length === 9 && empty.sections.every((section) => section.items.length === 0), "empty sections stay on the board");

const many = Array.from({ length: OPS_ROW_LIMIT + 1 }, (_, index) => ({
  id: `p${index}`,
  status: "late",
  amount: 1,
  driver_name: "Pat",
}));
const capped = buildTodaysOps({
  today,
  tomorrow,
  applications: [],
  rentals: [],
  payments: many,
  documents: [],
  incidents: [],
  issues: [],
  vehicles: [],
});
ok(bySection(capped, "overdue").items.length === OPS_ROW_LIMIT && bySection(capped, "overdue").truncated, "a section stops at 100 rows");

function bySection(result: { sections: { id: string; items: unknown[]; truncated: boolean }[] }, id: string) {
  return result.sections.find((section) => section.id === id)!;
}

ok(nav.includes("TODAYS_OPS_ENABLED") && nav.includes('id: "todays_ops"'), "the nav knows the tab and gates it on the flag");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall today's ops checks pass");
process.exit(fails ? 1 : 0);
