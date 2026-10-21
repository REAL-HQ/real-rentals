// Returns Due stays dark, manager-only, and read-only (run: bun scripts/returns-due.test.ts).
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { railEntries, resolveAdminTab, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { RETURNS_DUE_ENABLED } from "../src/lib/returns-due-flag";
import { buildReturnsDue, daysUntilDue, easternCalendarDate, returnsDueLabel } from "../src/lib/returns-due";

const fn = readFileSync("src/lib/returns-due.functions.ts", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const panel = readFileSync("src/components/admin/ReturnsDue.tsx", "utf8");
const flag = readFileSync("src/lib/returns-due-flag.ts", "utf8");
const rules = readFileSync("src/lib/returns-due.ts", "utf8");

assert.equal(RETURNS_DUE_ENABLED, false);
assert.equal(flag.split("RETURNS_DUE_ENABLED =").length, 2);
assert.doesNotMatch(flag, /process\.env/);

const handler = fn.slice(fn.indexOf(".handler"));
const thrown = handler.indexOf('if (!RETURNS_DUE_ENABLED) throw new Error("Returns Due is off")');
const role = handler.indexOf("requireManager");
const read = handler.indexOf('.from("rentals")');
assert.ok(thrown >= 0 && role >= 0 && read >= 0 && thrown < role && role < read);
assert.ok(thrown < handler.indexOf("import("));
assert.equal(fn.slice(0, fn.indexOf("export const listReturnsDue")).includes("roles.server"), false);
assert.equal(fn.slice(0, fn.indexOf("export const listReturnsDue")).includes("client.server"), false);
assert.doesNotMatch(fn, /stripe|weekly_rate|next_payment_due|payments|deposit/i);
assert.doesNotMatch(fn, /\.(insert|update|delete|upsert|rpc)\(/);
assert.doesNotMatch(rules, /\.(insert|update|delete|upsert|rpc)\(/);
assert.match(fn, /\.eq\("status", "active"\)/);
assert.match(fn, /\.not\("end_date", "is", null\)/);
assert.match(fn, /\.lte\("end_date", through\)/);
assert.doesNotMatch(fn, /\.gte\("end_date"/);

assert.equal(TABS.some((tab) => tab.id === "returns_due"), false);
for (const tier of ["coordinator", "manager", "owner"] as const) {
  assert.equal(visibleTabs(tier).some((tab) => tab.id === "returns_due"), false, tier);
  assert.equal(railEntries(tier).some((tab) => tab.id === "returns_due"), false, tier);
}
assert.match(admin, /RETURNS_DUE_ENABLED && tab === "returns_due" && <ReturnsDue \/>/);
assert.match(panel, /if \(!RETURNS_DUE_ENABLED\) return null/);
const hook = panel.indexOf("useServerFn(listReturnsDue)");
assert.ok(panel.indexOf("if (!RETURNS_DUE_ENABLED) return null") < hook);
assert.match(nav, /RETURNS_DUE_ENABLED/);
assert.match(nav, /id: "returns_due"/);
assert.match(nav, /label: "Returns Due"/);
assert.equal(resolveAdminTab({ urlTab: "returns_due", tier: "manager", navTabs: [{ id: "returns_due" }] }), "overview");
assert.equal(resolveAdminTab({ urlTab: "returns_due", tier: null, navTabs: [] }), "overview");
assert.equal(resolveAdminTab({ urlTab: "settings", tier: "coordinator", navTabs: [] }), "settings");

assert.equal(easternCalendarDate(new Date("2026-10-21T03:30:00.000Z")), "2026-10-20");
assert.equal(easternCalendarDate(new Date("2026-10-21T04:00:00.000Z")), "2026-10-21");
assert.equal(daysUntilDue("2026-10-21", "2026-10-18"), -3);
assert.equal(returnsDueLabel(-3), "3 Days Overdue");
assert.equal(returnsDueLabel(-1), "1 Day Overdue");
assert.equal(returnsDueLabel(0), "Due Today");
assert.equal(returnsDueLabel(1), "Due Tomorrow");
assert.equal(returnsDueLabel(7), "Due In 7 Days");

const today = "2026-10-21";
const board = buildReturnsDue(
  [
    { id: "overdue", status: "active", endDate: "2026-10-18", driverName: "Ada", vehicleLabel: "#12 2020 Kia Soul" },
    { id: "today", status: "active", endDate: "2026-10-21", driverName: "Bea", vehicleLabel: "#4 2019 Honda Civic" },
    { id: "window", status: "active", endDate: "2026-10-28", driverName: "  ", vehicleLabel: "#8 2021 Toyota Camry" },
    { id: "later", status: "active", endDate: "2026-10-29", driverName: "Cal", vehicleLabel: "#9 Ford" },
    { id: "open", status: "active", endDate: null, driverName: "Dee", vehicleLabel: "#1" },
    { id: "ended", status: "ended", endDate: "2026-10-10", driverName: "Eve", vehicleLabel: "#2" },
  ],
  today,
);
const ids = board.rows.map((row) => row.rentalId);
assert.deepEqual(ids, ["overdue", "today", "window"]);
assert.equal(ids.includes("later"), false);
assert.equal(ids.includes("open"), false);
assert.equal(ids.includes("ended"), false);
assert.equal(board.rows[0].state, "overdue");
assert.equal(board.rows[0].label, "3 Days Overdue");
assert.equal(board.rows[1].label, "Due Today");
assert.equal(board.rows[2].state, "due");
assert.equal(board.rows[2].driverName, "No Driver");
assert.equal(board.rows[2].label, "Due In 7 Days");
assert.equal(board.through, "2026-10-28");
assert.doesNotMatch(panel, /Weekly Rate|Next Billing|Last Payment|Renter Owes/);
assert.doesNotMatch(admin, /returns_due[\s\S]{0,80}ActiveRentalsPanel/);

console.log("returns due: ok");
