/**
 * Overview Today stays dark. No SQL, no Stripe, no mail.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-overview-today-"));
let passed = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  passed += 1;
  console.log("PASS", label);
}

const empty = {
  payments: [],
  rentals: [],
  vehicleDates: [],
  documents: [],
  issues: [],
  applications: [],
};

try {
  await build({
    entryPoints: ["src/lib/overview-today.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "today.mjs"),
    alias: { "@": resolve("src") },
  });
  const today = await import(pathToFileURL(join(out, "today.mjs")).href);

  check(today.OVERVIEW_TODAY_ENABLED === false, "the flag is a hard false");
  let roleCalls = 0;
  let readCalls = 0;
  const disabled = await today.loadOverviewToday({
    enabled: false,
    userId: "user-1",
    requireManager: async () => {
      roleCalls += 1;
      throw new Error("Forbidden");
    },
    read: async () => {
      readCalls += 1;
      throw new Error("read");
    },
  });
  check(disabled.ok === false && disabled.error === "Overview Today is disabled.", "a disabled call returns before any work");
  check(roleCalls === 0 && readCalls === 0, "a disabled call does not check the role and does not read");

  let order = [];
  const enabled = await today.loadOverviewToday({
    enabled: true,
    userId: "manager-1",
    now: new Date("2026-10-22T02:00:00.000Z"),
    requireManager: async () => {
      order.push("role");
    },
    read: async (day) => {
      order.push(`read:${day}`);
      return empty;
    },
  });
  check(order[0] === "role" && order[1] === "read:2026-10-21", "the role check runs before the read, on the Eastern day");
  check(enabled.ok === true && enabled.today === "2026-10-21", "UTC evening is still the previous Eastern day");

  let threw = false;
  try {
    await today.loadOverviewToday({
      enabled: true,
      userId: "coord",
      requireManager: async () => {
        throw new Error("Forbidden");
      },
      read: async () => {
        readCalls += 1;
        return empty;
      },
    });
  } catch (error) {
    threw = error instanceof Error && error.message === "Forbidden";
  }
  check(threw && readCalls === 0, "a forbidden manager check does not read");

  const sources = {
    ...empty,
    applications: [
      { id: "app-dana", full_name: "Dana Reyes", user_id: "user-dana" },
      { id: "app-priya", full_name: "Priya Shah", user_id: "user-priya" },
    ],
    payments: [
      { id: "pay-due", type: "rent", status: "pending", amount: 90, balance_due: 90, due_date: "2026-10-21", driver_id: "app-dana", rental_id: "rent-1" },
      { id: "pay-over", type: "rent", status: "overdue", amount: 40, balance_due: 55, due_date: "2026-10-18", driver_id: "app-priya", rental_id: null },
      { id: "pay-later", type: "rent", status: "pending", amount: 10, balance_due: 10, due_date: "2026-10-22", driver_id: "app-dana", rental_id: "rent-1" },
      { id: "pay-blank", type: "rent", status: "late", amount: 10, balance_due: null, due_date: null, driver_id: "app-dana", rental_id: "rent-1" },
      { id: "pay-deposit", type: "deposit", status: "overdue", amount: 200, balance_due: 200, due_date: "2026-10-18", driver_id: "app-dana", rental_id: "rent-1" },
    ],
    rentals: [
      { id: "rent-1", status: "reserved", start_date: "2026-10-21", end_date: "2026-10-28", application_id: "app-dana" },
      { id: "rent-back", status: "active", start_date: "2026-10-14", end_date: "2026-10-21T23:30:00.000Z", application_id: "app-priya" },
      { id: "rent-void", status: "cancelled", start_date: "2026-10-21", end_date: "2026-10-21", application_id: "app-dana" },
    ],
    vehicleDates: [
      { id: "veh-1", label: "2019 Toyota Camry", what: "Registration", expires_on: "2026-10-28" },
      { id: "veh-2", label: "2020 Honda Civic", what: "Insurance", expires_on: "2026-10-29" },
      { id: "veh-3", label: "2018 Nissan", what: "Plate", expires_on: "2026-10-20" },
    ],
    documents: [],
    issues: [
      { id: "iss-open", title: "Broken mirror", status: "open", driver_id: "user-dana", rental_id: "rent-1" },
      { id: "iss-closed", title: "Resolved noise", status: "Resolved", driver_id: "user-priya", rental_id: null },
      { id: "iss-loose", title: "Account lock", status: "open", driver_id: "user-missing", rental_id: null },
    ],
  };
  const sections = today.buildTodayItems(sources, "2026-10-21");
  const byKind = Object.fromEntries(sections.map((section) => [section.kind, section]));
  check(byKind.rent_due.count === 1 && byKind.rent_due.items[0].link.tab === "bookings" && byKind.rent_due.items[0].link.id === "rent-1", "rent due today links to the booking");
  check(byKind.rent_overdue.count === 1 && byKind.rent_overdue.items[0].amount === 55 && byKind.rent_overdue.items[0].daysOverdue === 3, "rent overdue shows the balance and the Eastern day count");
  check(byKind.rent_overdue.items[0].link.tab === "drivers" && byKind.rent_overdue.items[0].link.id === "app-priya", "rent without a booking links to the driver application");
  check(byKind.pickup.count === 1 && byKind.pickup.items[0].id === "rent-1", "today's pickup stays and a cancelled one does not");
  check(byKind.return.count === 1 && byKind.return.items[0].link.id === "rent-back", "a timestamp return uses the Eastern calendar day");
  check(byKind.document.count === 1 && byKind.document.items[0].link.tab === "vehicles" && byKind.document.items[0].link.id === "veh-1", "day 7 is included, day 8 and yesterday are not");
  check(byKind.issue.count === 2 && byKind.issue.items[0].link.tab === "drivers" && byKind.issue.items[0].link.id === "app-dana", "an open issue links to the driver and a closed one is dropped");
  check(byKind.issue.items[1].link.tab === "driver_issues" && !byKind.issue.items[1].link.id, "an issue with no driver or booking uses the existing issues tab");

  await build({
    entryPoints: ["src/lib/overview-today.functions.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, "fns.mjs"),
    alias: { "@": resolve("src") },
    plugins: [{
      name: "stub-server-fn",
      setup(b) {
        b.onResolve({ filter: /^@tanstack\/react-start$|^@\/integrations\/supabase\/auth-middleware$/ }, () => ({ path: "stub", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export const createServerFn = () => { const api = { middleware: () => api, handler: (fn) => fn }; return api }; export const requireSupabaseAuth = {};",
          loader: "js",
        }));
      },
    }],
  });
  const fns = await import(pathToFileURL(join(out, "fns.mjs")).href);
  const calls = [];
  function chain(table) {
    const q = {
      select() { return q; },
      eq(column, value) { calls.push([table, "eq", column, value]); return q; },
      in(column, value) { calls.push([table, "in", column, value]); return q; },
      gte(column, value) { calls.push([table, "gte", column, value]); return q; },
      lt(column, value) { calls.push([table, "lt", column, value]); return q; },
      lte(column, value) { calls.push([table, "lte", column, value]); return q; },
      neq(column, value) { calls.push([table, "neq", column, value]); return q; },
      not(column, op, value) { calls.push([table, "not", column, op, value]); return q; },
      is(column, value) { calls.push([table, "is", column, value]); return q; },
      order() { return q; },
      limit() { return q; },
      then(ok, bad) { return Promise.resolve({ data: [], error: null }).then(ok, bad); },
    };
    return q;
  }
  const read = await fns.readOverviewToday({ from: chain }, "2026-10-21");
  check(read.payments.length === 0, "an empty read returns no rows");
  check(calls.some((call) => call[0] === "payments" && call[1] === "gte" && call[3] === "2026-10-21"), "rent due uses a computed Eastern start");
  check(calls.some((call) => call[0] === "payments" && call[1] === "lt" && call[3] === "2026-10-22"), "rent due stops before the next Eastern day");
  check(calls.some((call) => call[0] === "documents" && call[1] === "lte" && call[3] === "2026-10-28"), "documents stop on day 7");
  check(calls.some((call) => call[0] === "issues" && call[1] === "neq" && call[3] === "resolved"), "open issues exclude resolved without a filter string");
  check(!calls.some((call) => call[1] === "or"), "the reader does not build an or filter");

  const fn = readFileSync("src/lib/overview-today.functions.ts", "utf8");
  const handler = fn.slice(fn.indexOf(".handler"), fn.indexOf("export async function readOverviewToday") === -1 ? fn.length : fn.indexOf("async function rowsOf"));
  check(fn.includes("enabled: OVERVIEW_TODAY_ENABLED"), "the server passes the hard flag");
  check(!fn.includes("stripe") && !fn.includes("createReadOnlyStripe"), "the reader does not call Stripe");
  check(!/\.(insert|update|delete|upsert)\(/.test(fn), "the reader does not write");
  check(!fn.includes(".or(") && !fn.includes("${"), "filters are not interpolated");
  check(fn.indexOf("enabled: OVERVIEW_TODAY_ENABLED") < fn.indexOf("client.server"), "the flag is applied before the database import");
  const panel = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
  check(panel.includes("OVERVIEW_TODAY_ENABLED && canSeeCollections ? <OverviewTodayCard /> : null"), "Overview mounts the card only for a manager while the flag is on");
  const helper = readFileSync("src/lib/overview-today.ts", "utf8");
  check(helper.indexOf("if (!deps.enabled) return") < helper.indexOf("await deps.requireManager"), "the helper returns before the role check");
  check(helper.indexOf("await deps.requireManager") < helper.indexOf("await deps.read"), "the helper checks the role before the read");
  void handler;

  console.log(`${passed} overview today checks passed`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
