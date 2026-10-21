import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OVERVIEW_TODAY_ENABLED } from "../src/lib/overview-today-flag.ts";
import { OUTSTANDING_STATUSES, owedOn } from "../src/lib/payment-collection.server.ts";
import {
  OVERVIEW_TODAY_LIMIT,
  assembleOverviewToday,
  dateOnly,
  disabledOverviewToday,
  isNewLead,
  isOverduePayment,
  isTodayPickup,
  isTodayReturn,
  overviewToday,
  recordedAmount,
  vehicleLabel,
  type TodayLead,
  type TodayPayment,
  type TodayRental,
} from "../src/lib/overview-today.ts";
import { loadOverviewToday } from "../src/lib/overview-today.functions.ts";

const TODAY = "2026-10-21";
let checks = 0;
const check = (cond: unknown, message: string) => {
  assert.equal(Boolean(cond), true, message);
  checks += 1;
};

check(OVERVIEW_TODAY_ENABLED === false, "flag stays off");
check(disabledOverviewToday(TODAY).enabled === false, "disabled result carries no rows");

const lib = readFileSync("src/lib/overview-today.ts", "utf8");
const flag = readFileSync("src/lib/overview-today-flag.ts", "utf8");
const fn = readFileSync("src/lib/overview-today.functions.ts", "utf8");
const ui = readFileSync("src/components/admin/OverviewToday.tsx", "utf8");
const panel = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
check(/export const OVERVIEW_TODAY_ENABLED: boolean = false;/.test(flag), "flag is a hard false constant");
check(!/export const OVERVIEW_TODAY_ENABLED/.test(lib), "the flag is declared once");
check(!/process\.env/.test(flag), "no environment variable can open the flag");
check(
  /import\s*\{[^}]*\bOUTSTANDING_STATUSES\b[^}]*\bowedOn\b[^}]*\}\s*from\s*"@\/lib\/payment-collection\.server"/.test(lib),
  "overdue statuses and owedOn are imported from the payments reader",
);
check(!/OVERVIEW_TODAY_OVERDUE_STATUSES/.test(lib + fn), "the overview overdue list is not copied");
const handler = fn.slice(fn.indexOf("export const getOverviewToday"));
const flagAt = handler.indexOf("if (!OVERVIEW_TODAY_ENABLED) return");
const roleAt = handler.indexOf("requireManager");
check(flagAt >= 0 && roleAt > flagAt, "flag check comes before any role check");
check(handler.includes("await requireManager(context.userId)"), "managers and owners are required");
check(!fn.includes("requireStaff"), "coordinators are not admitted");
check(!fn.slice(0, fn.indexOf("export const getOverviewToday")).includes("roles.server"), "the role module is not imported before the handler");
check(flagAt < handler.indexOf("client.server"), "flag-off handler returns before the service client");
check(!/\.(or|filter)\(\s*`[^`]*\$\{/.test(fn), "filters are not string-interpolated");
check(!handler.includes("loadOverviewToday(supabaseAdmin, today, true)"), "handler cannot force the read on");
check(!/\.(insert|update|delete|upsert)\(/.test(fn), "today reads do not write");
check(!fn.includes("vin"), "today reads do not select a VIN");
check(!fn.includes("stripe_"), "today reads do not select Stripe ids");
check(fn.includes("notes") === false, "today reads do not select payment notes");
check(panel.includes("<OverviewToday />"), "overview mounts the today list");
check(panel.split("<OverviewToday />").length === 2, "overview mounts it once");
const effect = ui.slice(ui.indexOf("useEffect"), ui.indexOf("if (!OVERVIEW_TODAY_ENABLED) return null"));
check(effect.indexOf("if (!OVERVIEW_TODAY_ENABLED) return;") < effect.indexOf("load("), "flag-off UI does not call the server");

check(overviewToday(new Date("2026-10-22T03:30:00.000Z")) === "2026-10-21", "late UTC evening is still the Eastern day");
check(overviewToday(new Date("2026-10-22T04:30:00.000Z")) === "2026-10-22", "after Eastern midnight the day advances");
check(dateOnly("2026-10-21T00:00:00.000Z") === null, "a timestamp is not treated as a calendar day");

const rental = (patch: Partial<TodayRental>): TodayRental => ({
  id: "r",
  status: "active",
  start_date: TODAY,
  end_date: "2026-10-28",
  application_id: "a",
  vehicle_id: "v",
  ...patch,
});
check(isTodayPickup(rental({}), TODAY), "active rental starting today is a pickup");
check(!isTodayPickup(rental({ status: "ended" }), TODAY), "an ended rental is not a pickup");
check(!isTodayPickup(rental({ status: "cancelled" }), TODAY), "a cancelled rental is not a pickup");
check(!isTodayPickup(rental({ start_date: "2026-10-22" }), TODAY), "tomorrow is not today's pickup");
check(!isTodayPickup(rental({ start_date: "2026-10-21T00:00:00.000Z" }), TODAY), "a timestamp pickup date is refused");
check(isTodayReturn(rental({ end_date: TODAY }), TODAY), "an active rental ending today is a return");
check(isTodayReturn(rental({ status: "ended", end_date: TODAY }), TODAY), "a rental ended today is a return");
check(!isTodayReturn(rental({ status: "cancelled", end_date: TODAY }), TODAY), "a cancelled rental is not a return");
check(!isTodayReturn(rental({ end_date: "2026-10-22" }), TODAY), "tomorrow is not today's return");
const pastDue = { status: "overdue", type: "rent", due_date: "2026-10-19" };
for (const status of OUTSTANDING_STATUSES) {
  check(isOverduePayment({ ...pastDue, status }, TODAY), `${status} due before today is overdue`);
}
for (const status of ["paid", "refunded", "waived", "void"]) {
  check(!isOverduePayment({ ...pastDue, status }, TODAY), `${status} is not overdue`);
}
check(!isOverduePayment({ ...pastDue, due_date: TODAY }, TODAY), "due today is not overdue");
check(!isOverduePayment({ ...pastDue, due_date: "2026-10-22" }, TODAY), "a later due date is not overdue");
check(!isOverduePayment({ ...pastDue, due_date: null }, TODAY), "a missing due date is not overdue");
check(!isOverduePayment({ ...pastDue, type: "deposit" }, TODAY), "a deposit is not an overdue payment");
check(owedOn({ amount: 80, balance_due: 95 }) === 95, "owedOn uses the balance when it includes late fees");

const lead = (patch: Partial<TodayLead>): TodayLead => ({
  id: "lead",
  full_name: "Sam Lee",
  phone: "8135550100",
  status: "new",
  created_at: "2026-10-20T15:00:00.000Z",
  contact_status: "new",
  contact_follow_up_on: null,
  ...patch,
});
check(isNewLead(lead({}), TODAY), "a new contact with no follow-up is a new lead");
check(!isNewLead(lead({ contact_follow_up_on: "2026-10-20" }), TODAY), "an overdue follow-up is not listed as new");
check(!isNewLead(lead({ contact_status: "interested" }), TODAY), "interested is not a new lead");
check(!isNewLead(lead({ contact_status: "unqualified" }), TODAY), "unqualified is not a new lead");
check(!isNewLead(lead({ status: "duplicate" }), TODAY), "a duplicate application is not a new lead");
check(recordedAmount(0) === 0, "zero is a recorded amount");
check(recordedAmount("40") === 40, "a numeric string is a recorded amount");
check(recordedAmount(-5) === null, "a negative amount stays unknown");
check(recordedAmount("nope") === null, "a bad amount stays unknown");
check(vehicleLabel({ year: 2022, make: "Toyota", model: "Camry", unit_number: "12" }) === "2022 Toyota Camry · 12", "vehicle label uses year make model and unit");
check(!vehicleLabel({ year: 2022, make: "Toyota", model: "Camry", unit_number: "12" }).includes("VIN"), "vehicle label has no VIN");

const assembled = assembleOverviewToday({
  today: TODAY,
  pickups: { rows: [rental({ id: "keep", application_id: "dana" }), rental({ id: "drop", status: "cancelled" })], total: 1 },
  returns: { rows: [rental({ id: "back", status: "ended", end_date: TODAY, application_id: "marcus" })], total: 1 },
  overduePayments: {
    rows: [
      { id: "pay", status: "overdue", type: "late_fee", amount: 40, balance_due: 55, due_date: "2026-10-19", application_id: "dana" },
      { id: "bad", status: "paid", type: "rent", amount: 10, balance_due: 0, due_date: "2026-10-19", application_id: "dana" },
      { id: "soon", status: "pending", type: "rent", amount: 80, balance_due: 80, due_date: TODAY, application_id: "dana" },
      { id: "dep", status: "unpaid", type: "deposit", amount: 500, balance_due: 500, due_date: "2026-10-01", application_id: "dana" },
    ],
    total: 1,
  },
  newLeads: { rows: [lead({ id: "sam" }), lead({ id: "old", contact_follow_up_on: "2026-10-20" })], total: 1 },
  names: [
    { id: "dana", full_name: "dana reyes" },
    { id: "marcus", full_name: "Marcus Hall" },
  ],
  vehicles: [{ id: "v", year: 2022, make: "Toyota", model: "Camry", unit_number: "12" }],
});
check(assembled.enabled === true, "assemble builds an enabled list");
if (assembled.enabled) {
  check(assembled.pickups.rows.length === 1 && assembled.pickups.rows[0].title === "dana reyes", "a cancelled pickup is dropped and the name comes from the application");
  check(assembled.pickups.rows[0].detail.includes("2022 Toyota Camry · 12"), "pickup detail names the vehicle");
  check(assembled.returns.rows[0].title === "Marcus Hall", "return name comes from the application");
  check(assembled.overduePayments.rows.length === 1, "paid, not-yet-due, and deposit rows are not overdue");
  check(assembled.overduePayments.rows[0].detail.includes("late_fee") && assembled.overduePayments.rows[0].detail.includes("55"), "overdue detail uses owedOn, including the late-fee balance");
  check(assembled.newLeads.rows.length === 1 && assembled.newLeads.rows[0].href?.includes("id=sam"), "only the new lead is linked");
}

const many: TodayPayment[] = Array.from({ length: OVERVIEW_TODAY_LIMIT + 1 }, (_, i) => ({
  id: `p${i}`,
  status: "overdue",
  type: "rent",
  amount: 5,
  balance_due: 5,
  due_date: "2026-10-01",
  application_id: null,
}));
const capped = assembleOverviewToday({
  today: TODAY,
  pickups: { rows: [], total: 0 },
  returns: { rows: [], total: 0 },
  overduePayments: { rows: many, total: many.length },
  newLeads: { rows: [], total: 0 },
  names: [],
  vehicles: [],
});
check(capped.enabled && capped.overduePayments.rows.length === OVERVIEW_TODAY_LIMIT && capped.overduePayments.truncated, "the list stops at the cap and says there are more");

type Filter = { op: string; k?: string; v?: unknown; expr?: string };
function memoryAdmin(tables: Record<string, Record<string, unknown>[]>, failTable?: string) {
  const calls: Array<{ table: string; select: string; head: boolean; limit: number | null; filters: Filter[] }> = [];
  const admin = {
    calls,
    from(table: string) {
      const state = { table, select: "", head: false, limit: null as number | null, filters: [] as Filter[] };
      const api = {
        select(cols: string, opts?: { head?: boolean }) {
          state.select = cols;
          state.head = !!opts?.head;
          return api;
        },
        eq(k: string, v: unknown) {
          state.filters.push({ op: "eq", k, v });
          return api;
        },
        in(k: string, v: unknown) {
          state.filters.push({ op: "in", k, v });
          return api;
        },
        is(k: string, v: unknown) {
          state.filters.push({ op: "is", k, v });
          return api;
        },
        gte(k: string, v: unknown) {
          state.filters.push({ op: "gte", k, v });
          return api;
        },
        lt(k: string, v: unknown) {
          state.filters.push({ op: "lt", k, v });
          return api;
        },
        neq(k: string, v: unknown) {
          state.filters.push({ op: "neq", k, v });
          return api;
        },
        or(expr: string) {
          state.filters.push({ op: "or", expr });
          return api;
        },
        order() {
          return api;
        },
        limit(n: number) {
          state.limit = n;
          return api;
        },
        then(resolve: (value: unknown) => void) {
          calls.push({ table, select: state.select, head: state.head, limit: state.limit, filters: state.filters.slice() });
          if (failTable === table && state.head) {
            resolve({ data: null, error: { message: "unavailable" }, count: null });
            return;
          }
          const rows = (tables[table] ?? []).filter((row) =>
            state.filters.every((filter) => {
              if (filter.op === "eq") return row[filter.k!] === filter.v;
              if (filter.op === "in") return (filter.v as unknown[]).includes(row[filter.k!]);
              if (filter.op === "is") return filter.v == null ? row[filter.k!] == null : row[filter.k!] === filter.v;
              if (filter.op === "gte") return row[filter.k!] != null && String(row[filter.k!]) >= String(filter.v);
              if (filter.op === "lt") return row[filter.k!] != null && String(row[filter.k!]) < String(filter.v);
              if (filter.op === "neq") return row[filter.k!] !== filter.v;
              if (filter.op === "or" && String(filter.expr).includes("contact_follow_up_on.gte.")) {
                const day = String(filter.expr).split("contact_follow_up_on.gte.")[1];
                return row.contact_follow_up_on == null || String(row.contact_follow_up_on) >= day;
              }
              return false;
            }),
          );
          if (state.head) resolve({ data: null, error: null, count: rows.length });
          else resolve({ data: state.limit ? rows.slice(0, state.limit) : rows, error: null, count: null });
        },
      };
      return api;
    },
  };
  return admin;
}

const tables = {
  rentals: [
    { id: "pickup", status: "active", start_date: TODAY, end_date: "2026-10-28", application_id: "dana", vehicle_id: "camry" },
    { id: "ended-start", status: "ended", start_date: TODAY, end_date: "2026-10-20", application_id: "dana", vehicle_id: "camry" },
    { id: "return", status: "active", start_date: "2026-10-14", end_date: TODAY, application_id: "marcus", vehicle_id: "civic" },
    { id: "cancelled", status: "cancelled", start_date: TODAY, end_date: TODAY, application_id: "priya", vehicle_id: "civic" },
  ],
  payments: [
    { id: "due", status: "overdue", type: "rent", amount: 80, balance_due: 95, due_date: "2026-10-18", driver_id: "dana" },
    { id: "paid", status: "paid", type: "rent", amount: 80, balance_due: 0, due_date: "2026-10-18", driver_id: "dana" },
    { id: "open", status: "current", type: "rent", amount: 80, balance_due: 80, due_date: TODAY, driver_id: "marcus" },
    { id: "deposit", status: "failed", type: "deposit", amount: 500, balance_due: 500, due_date: "2026-10-01", driver_id: "dana" },
    { id: "future", status: "pending", type: "rent", amount: 70, balance_due: 70, due_date: "2026-10-28", driver_id: "marcus" },
    { id: "fees", status: "late", type: "rent", amount: 40, balance_due: 55, due_date: "2026-10-10", driver_id: "dana" },
  ],
  applications: [
    { id: "dana", full_name: "Dana Reyes", phone: null, status: "approved", created_at: "2026-10-01T15:00:00.000Z", contact_status: "interested", contact_follow_up_on: null, deleted_at: null },
    { id: "marcus", full_name: "Marcus Hall", phone: null, status: "active", created_at: "2026-09-01T15:00:00.000Z", contact_status: "contacted", contact_follow_up_on: null, deleted_at: null },
    { id: "sam", full_name: "Sam Lee", phone: "8135550100", status: "new", created_at: "2026-10-20T15:00:00.000Z", contact_status: "new", contact_follow_up_on: null, deleted_at: null },
    { id: "soon", full_name: "Soon Lead", phone: "8135550103", status: "reviewing", created_at: "2026-10-21T15:00:00.000Z", contact_status: "new", contact_follow_up_on: TODAY, deleted_at: null },
    { id: "late", full_name: "Late Lead", phone: "8135550101", status: "new", created_at: "2026-10-18T15:00:00.000Z", contact_status: "new", contact_follow_up_on: "2026-10-20", deleted_at: null },
    { id: "gone", full_name: "Gone Lead", phone: "8135550102", status: "new", created_at: "2026-10-20T15:00:00.000Z", contact_status: "new", contact_follow_up_on: null, deleted_at: "2026-10-20T00:00:00.000Z" },
  ],
  vehicles: [
    { id: "camry", year: 2022, make: "Toyota", model: "Camry", unit_number: "12", vin: "SECRET" },
    { id: "civic", year: 2020, make: "Honda", model: "Civic", unit_number: "4", vin: "SECRET" },
  ],
};

const dark = memoryAdmin(tables);
const darkResult = await loadOverviewToday(dark, TODAY);
check(darkResult.enabled === false && dark.calls.length === 0, "the default read is skipped while the flag is off");

let threw = false;
try {
  await loadOverviewToday(memoryAdmin(tables), "2026-10-21T00:00:00.000Z", true);
} catch {
  threw = true;
}
check(threw, "a non-calendar day fails closed");

const live = memoryAdmin(tables);
const loaded = await loadOverviewToday(live, TODAY, true);
check(loaded.enabled === true, "an explicit read can be tested without changing the flag constant");
if (loaded.enabled) {
  check(loaded.pickups.rows.length === 1 && loaded.pickups.rows[0].title === "Dana Reyes", "the read keeps today's active pickup");
  check(loaded.pickups.rows[0].detail.includes("Camry") && !loaded.pickups.rows[0].detail.includes("SECRET"), "the pickup names the car and not the VIN");
  check(loaded.returns.rows.length === 1 && loaded.returns.rows[0].title === "Marcus Hall", "the read keeps today's active return and drops the cancelled row");
  check(loaded.overduePayments.rows.length === 2, "paid, deposit, due-today, and future rows stay out of overdue");
  check(
    loaded.overduePayments.rows.some((row) => row.detail.includes("95")) && loaded.overduePayments.rows.some((row) => row.detail.includes("55")),
    "overdue amounts come from owedOn",
  );
  check(loaded.newLeads.rows.length === 2 && loaded.newLeads.rows.some((row) => row.title === "Sam Lee"), "a follow-up today stays, and deleted or overdue follow-ups stay out");
  const paymentRead = live.calls.find((call) => call.table === "payments" && call.head);
  check(paymentRead?.filters.some((filter) => filter.op === "lt" && filter.k === "due_date" && filter.v === TODAY), "overdue payments are due before today");
  check(paymentRead?.filters.some((filter) => filter.op === "neq" && filter.k === "type" && filter.v === "deposit"), "deposit rows are excluded in the query");
  check(!live.calls.some((call) => call.filters.some((filter) => filter.op === "or")), "lead follow-ups are not one interpolated or filter");
}
check(live.calls.some((call) => call.table === "rentals" && !call.head && call.limit === OVERVIEW_TODAY_LIMIT), "rental reads are capped");
check(live.calls.some((call) => call.table === "vehicles" && call.select === "id,year,make,model,unit_number"), "vehicle reads leave the VIN in the database");
check(!live.calls.some((call) => call.select.includes("driver_id") && call.table === "rentals"), "rental reads do not take the portal user id");

let failedClosed = false;
try {
  await loadOverviewToday(memoryAdmin(tables, "payments"), TODAY, true);
} catch (error) {
  failedClosed = error instanceof Error && error.message === "Today could not be loaded.";
}
check(failedClosed, "a failed count is an error, not an empty today");

console.log(`overview today: ${checks} checks`);
