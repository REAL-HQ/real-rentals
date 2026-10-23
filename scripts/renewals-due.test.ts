// Rental Renewal Due stays dark, manager-only, and read-only (run: bun scripts/renewals-due.test.ts).
import { readFileSync } from "node:fs";
import { railEntries, resolveAdminTab, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { RENEWALS_DUE_ENABLED } from "../src/lib/renewals-due-flag";
import {
  RENEWALS_DUE_OMITTED,
  addCalendarDays,
  buildRenewalsDue,
  easternCalendarDate,
  formatRenewalHeading,
  inRenewalWindow,
  lastPaymentStatusLabel,
  renewalHorizon,
  type RenewalRental,
  type RenewalsDueInput,
} from "../src/lib/renewals-due";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const fn = readFileSync("src/lib/renewals-due.functions.ts", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const panel = readFileSync("src/components/admin/RenewalsDue.tsx", "utf8");
const board = readFileSync("src/lib/renewals-due.ts", "utf8");
const flag = readFileSync("src/lib/renewals-due-flag.ts", "utf8");

ok(RENEWALS_DUE_ENABLED === false, "RENEWALS_DUE_ENABLED is false");
ok(!/process\.env/.test(flag), "no environment variable can open the flag");

const handler = fn.slice(fn.indexOf(".handler"));
const thrown = handler.indexOf('if (!RENEWALS_DUE_ENABLED) throw new Error("Rental Renewal Due is off")');
const role = handler.indexOf("requireManager");
const read = handler.indexOf("supabaseAdmin");
ok(thrown >= 0 && thrown < role && role < read, "the handler throws before requireManager and before supabaseAdmin");
ok(thrown < handler.indexOf("import("), "the throw happens before any dynamic import");
ok(!fn.slice(0, fn.indexOf("export const getRenewalsDue")).includes("roles.server"), "the role module is not a static import");
ok(!fn.slice(0, fn.indexOf("export const getRenewalsDue")).includes("client.server"), "the admin client is not a static import");
ok(!/stripe/i.test(fn) && !/stripe/i.test(panel), "the server function and the panel do not mention Stripe");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(fn), "the server function does not write");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(board), "the board rules do not write");
ok(!/\.(or|filter)\(\s*`[^`]*\$\{/.test(fn), "the server function has no interpolated filter");
ok(fn.includes('.eq("status", "active")'), "only active rentals are read");
ok(fn.includes('.gte("next_payment_due", today)') && fn.includes('.lte("next_payment_due", horizon)'), "next billing uses its own date bounds");
ok(fn.includes('.gte("end_date", today)') && fn.includes('.lte("end_date", horizon)'), "end date uses its own date bounds");
ok(!/\.or\(/.test(fn) && !/\.filter\(\s*["'`]/.test(fn), "the two date windows are separate reads");

ok(!TABS.some((t) => t.id === "renewals_due"), "Renewal Due is not in TABS");
for (const tier of ["coordinator", "manager", "owner"] as const) {
  ok(!visibleTabs(tier).some((t) => t.id === "renewals_due"), `${tier} nav has no Renewal Due tab while the flag is off`);
  ok(!railEntries(tier).some((t) => t.id === "renewals_due"), `${tier} rail has no Renewal Due tab while the flag is off`);
}
ok(visibleTabs("owner").length === TABS.length, "owner still sees exactly the dark-build destinations");
ok(admin.includes('RENEWALS_DUE_ENABLED && tab === "renewals_due" && <RenewalsDue />'), "the panel mounts only while the flag is on");
ok(panel.includes("if (!RENEWALS_DUE_ENABLED) return null"), "the panel renders nothing while the flag is off");
ok(nav.includes("RENEWALS_DUE_ENABLED") && nav.includes('id: "renewals_due"') && nav.includes('label: "Renewal Due"'), "the nav knows the tab and gates it on the flag");

ok(
  resolveAdminTab({ urlTab: "renewals_due", tier: "manager", navTabs: [{ id: "renewals_due" }] }) === "overview",
  "a direct Renewal Due link falls back to Overview while the flag is off",
);
ok(
  resolveAdminTab({ urlTab: "renewals_due", tier: null, navTabs: [] }) === "overview",
  "the direct-link fallback does not wait for the role lookup",
);
ok(resolveAdminTab({ urlTab: "finance", tier: "owner", navTabs: [] }) === "overview", "Unified Finance still falls back while its flag is off");
ok(resolveAdminTab({ urlTab: "settings", tier: "coordinator", navTabs: [] }) === "settings", "Settings stays reachable");
ok(resolveAdminTab({ urlTab: "drivers", tier: null, navTabs: [] }) === "drivers", "a known tab still opens before the role lookup");
ok(
  resolveAdminTab({ urlTab: "payments", tier: "coordinator", navTabs: [{ id: "overview" }] }) === "overview",
  "a tab this tier cannot open still falls back to Overview",
);
ok(resolveAdminTab({ urlTab: "missing", tier: "owner", navTabs: TABS }) === "overview", "an unknown tab falls back to Overview");

ok(easternCalendarDate(new Date("2026-10-21T03:30:00.000Z")) === "2026-10-20", "03:30 UTC is still the previous Eastern calendar day");
ok(easternCalendarDate(new Date("2026-10-21T04:00:00.000Z")) === "2026-10-21", "04:00 UTC is Eastern midnight");
ok(formatRenewalHeading("2026-10-21") === "Wednesday, October 21, 2026", "the heading uses the Eastern calendar date");
const today = "2026-10-21";
ok(renewalHorizon(today) === "2026-10-28" && addCalendarDays(today, 7) === "2026-10-28", "the window runs seven calendar days out");
ok(inRenewalWindow(today, today) && inRenewalWindow("2026-10-28", today), "today and today plus 7 are inside the window");
ok(!inRenewalWindow("2026-10-20", today) && !inRenewalWindow("2026-10-29", today), "the day before and eight days out are outside the window");
ok(inRenewalWindow("2026-10-28T23:59:00Z", today), "a date-only prefix is compared without a timezone shift");

ok(lastPaymentStatusLabel(null) === "No Payment", "no payment reads No Payment");
ok(lastPaymentStatusLabel("past_due") === "Past Due", "a known payment status uses the Payments label");
ok(lastPaymentStatusLabel("mystery_status") === "mystery_status", "an unknown payment status stays as stored");

function rental(over: Partial<RenewalRental> & { id: string }): RenewalRental {
  return {
    status: "active",
    driver_id: "auth-user",
    application_id: "app-1",
    vehicle_id: "veh-1",
    weekly_rate: 250,
    end_date: null,
    next_payment_due: null,
    ...over,
  };
}

const built = buildRenewalsDue({
  today,
  rentals: [
    rental({ id: "both", application_id: "app-ada", vehicle_id: "veh-1", driver_id: "auth-ada", next_payment_due: "2026-10-24", end_date: "2026-10-26", weekly_rate: 250 }),
    rental({ id: "billing", application_id: "app-bea", vehicle_id: "veh-2", driver_id: "auth-bea", next_payment_due: "2026-10-21", end_date: "2026-11-30", weekly_rate: 300 }),
    rental({ id: "ending", application_id: null, vehicle_id: "veh-3", driver_id: "auth-cy", next_payment_due: "2026-09-01", end_date: "2026-10-28", weekly_rate: 175.5 }),
    rental({ id: "soon-end", application_id: "app-dee", vehicle_id: "veh-4", next_payment_due: "2026-11-01", end_date: "2026-10-22" }),
    rental({ id: "late", next_payment_due: "2026-10-20", end_date: "2026-10-19" }),
    rental({ id: "far", next_payment_due: "2026-10-29", end_date: "2026-12-01" }),
    rental({ id: "closed", status: "completed", next_payment_due: "2026-10-21", end_date: "2026-10-21" }),
    rental({ id: "cased", status: "Active", next_payment_due: "2026-10-21" }),
    rental({ id: "neither", next_payment_due: null, end_date: null }),
  ],
  applications: [
    { id: "app-ada", full_name: "Ada Driver" },
    { id: "app-bea", full_name: "Bea Driver" },
    { id: "app-dee", full_name: "  " },
  ],
  vehicles: [
    { id: "veh-1", year: 2020, make: "Honda", model: "Civic", unit_number: "12", license_plate: "ABC123" },
    { id: "veh-2", year: 2021, make: "Toyota", model: "Camry", unit_number: "4", license_plate: null },
  ],
  payments: [
    { id: "p-old", rental_id: "both", status: "paid", created_at: "2026-10-01T12:00:00.000Z" },
    { id: "p-new", rental_id: "both", status: "failed", created_at: "2026-10-20T12:00:00.000Z" },
    { id: "p-a", rental_id: "billing", status: "paid", created_at: "2026-10-18T12:00:00.000Z" },
    { id: "p-b", rental_id: "billing", status: "past_due", created_at: "2026-10-18T12:00:00.000Z" },
    { id: "p-other", rental_id: "far", status: "paid", created_at: "2026-10-21T12:00:00.000Z" },
    { id: "p-raw", rental_id: "soon-end", status: "mystery_status", created_at: "2026-10-02T12:00:00.000Z" },
  ],
} satisfies RenewalsDueInput);

ok(built.rows.map((row) => row.rentalId).join() === "billing,soon-end,both,ending", "soonest triggering date is first, and out-of-window or inactive rentals are omitted");
const billing = built.rows[0];
ok(billing.triggerDate === "2026-10-21" && billing.reasons.join() === "Next Billing" && billing.endDate === "2026-11-30", "a rental is listed from next billing alone and still shows its later end date");
ok(billing.driverSearch?.id === "app-bea" && billing.driverSearch.id !== "auth-bea" && billing.driverName === "Bea Driver", "the driver link uses the application id");
ok(billing.lastPaymentStatus === "Past Due", "the same timestamp keeps the later payment id");
ok(billing.vehicleLabel === "#4 · 2021 Toyota Camry", "the vehicle label uses year, make, model, and unit");
ok(billing.paymentsSearch.tab === "payments" && !("id" in billing.paymentsSearch), "the Payments link opens Payments with no rental id");
const soon = built.rows[1];
ok(soon.reasons.join() === "End Date" && soon.nextPaymentDue === "2026-11-01" && soon.lastPaymentStatus === "mystery_status" && soon.driverName === "Unnamed Driver", "end date alone lists the rental, an unknown status stays raw, and a blank name stays unnamed");
const both = built.rows[2];
ok(both.reasons.join(" · ") === "Next Billing · End Date" && both.triggerDate === "2026-10-24" && both.lastPaymentStatus === "Failed" && both.weeklyRate === 250, "both in-window dates list once, the earlier date sorts it, and the newest charge wins over the rental payment status");
ok(both.vehicleLabel === "#12 · 2020 Honda Civic · ABC123", "the vehicle label includes the plate");
const ending = built.rows[3];
ok(ending.driverSearch == null && ending.driverName === "No Driver" && ending.lastPaymentStatus === "No Payment" && ending.vehicleLabel === "Unknown Vehicle" && ending.triggerDate === "2026-10-28", "no application has no driver link, no payment reads No Payment, and today plus 7 is included");
ok(built.omitted === RENEWALS_DUE_OMITTED, "the omitted list is returned");
ok(
  built.omitted.some((line) => line.includes("paid-through")) &&
    built.omitted.some((line) => line.includes("late_fee_applied_through")) &&
    built.omitted.some((line) => line.includes("before the Eastern today")) &&
    built.omitted.some((line) => line.includes("no rental deep link")) &&
    built.omitted.some((line) => line.includes("rentals.payment_status")) &&
    built.omitted.some((line) => line.includes("Stripe")) &&
    built.omitted.some((line) => line.includes("does not write")) &&
    built.omitted.some((line) => line.includes("1000")),
  "the omitted list names the gaps",
);

const empty = buildRenewalsDue({ today, rentals: [], applications: [], vehicles: [], payments: [] });
ok(empty.rows.length === 0 && empty.heading === "Wednesday, October 21, 2026" && empty.through === "2026-10-28", "an empty list still names the Eastern window");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall renewal due checks pass");
process.exit(fails ? 1 : 0);
