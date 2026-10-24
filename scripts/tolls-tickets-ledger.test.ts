// Tolls And Tickets stays dark, manager-only, and read-only (run: bun scripts/tolls-tickets-ledger.test.ts).
import { readFileSync } from "node:fs";
import { railEntries, resolveTollsTicketsTab, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { TOLLS_TICKETS_LEDGER_ENABLED } from "../src/lib/tolls-tickets-flag";
import {
  TOLLS_TICKETS_GAPS,
  buildTollsTicketsLedger,
  tollsDateEt,
  type TollsChargeRow,
  type TollsIncidentRow,
  type TollsPaymentRow,
  type TollsRead,
  type TollsTicketsInput,
} from "../src/lib/tolls-tickets";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const fn = readFileSync("src/lib/tolls-tickets.functions.ts", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const panel = readFileSync("src/components/admin/TollsTickets.tsx", "utf8");
const board = readFileSync("src/lib/tolls-tickets.ts", "utf8");
const flag = readFileSync("src/lib/tolls-tickets-flag.ts", "utf8");

ok(TOLLS_TICKETS_LEDGER_ENABLED === false, "TOLLS_TICKETS_LEDGER_ENABLED is false");
ok(!/process\.env/.test(flag), "no environment variable can open the flag");

const handlerStart = fn.indexOf("export const getTollsTicketsLedger");
const body = fn.slice(handlerStart).slice(fn.slice(handlerStart).indexOf(".handler"));
const thrown = body.indexOf('if (!TOLLS_TICKETS_LEDGER_ENABLED) throw new Error("Tolls And Tickets is off")');
const role = body.indexOf("requireManager");
const read = body.indexOf("supabaseAdmin");
ok(thrown >= 0 && thrown < role && role < read, "getTollsTicketsLedger throws before requireManager and before supabaseAdmin");
ok(thrown < body.indexOf("import("), "getTollsTicketsLedger throws before any dynamic import");

const beforeExports = fn.slice(0, handlerStart);
ok(!beforeExports.includes("roles.server"), "the role module is not a static import");
ok(!beforeExports.includes("client.server"), "the admin client is not a static import");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(fn), "the server function does not write");
ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(board), "the ledger rules do not write");
ok(!/\.or\(/.test(fn) && !/\.filter\(/.test(fn), "the reads do not use or or filter");
ok(!/\.(or|filter)\(\s*`[^`]*\$\{/.test(fn + board), "the reads do not interpolate a filter");
ok(!/select\(\s*["'`]\*/.test(fn), "the reads name their columns");
ok(fn.includes("id,vehicle_id,rental_id,application_id,charge_type") && fn.includes("driver_responsible_amount"), "charge and incident columns are named");
ok(fn.includes('.in("charge_type", [...CHARGE_TYPES])'), "charge types are an eq list");
ok(fn.includes('const PAYMENT_TYPES = ["toll", "fee"]') && fn.includes('.in("type", [...PAYMENT_TYPES])'), "payments are toll and fee");
ok(fn.includes("linkedIds.length") && fn.includes("renterIds.length") && fn.includes("vehicleIds.length") && fn.includes("rentalIds.length"), "empty id lists are not sent");
ok(!/vehicleReadinessChecks\(/.test(fn + board + panel + nav + admin), "this feature does not call the readiness helper");

ok(!TABS.some((t) => t.id === "tolls_tickets"), "Tolls And Tickets is not in TABS");
for (const tier of ["coordinator", "manager", "owner"] as const) {
  ok(!visibleTabs(tier).some((t) => t.id === "tolls_tickets"), `${tier} nav has no Tolls And Tickets tab while the flag is off`);
  ok(!railEntries(tier).some((t) => t.id === "tolls_tickets" || t.label === "Tolls And Tickets"), `${tier} rail has no Tolls And Tickets tab while the flag is off`);
}
ok(visibleTabs("owner").length === TABS.length, "owner still sees exactly the dark-build destinations");
ok(
  railEntries("owner").map((entry) => entry.label).join(",") ===
    "Overview,Drivers,Bookings,Active Rentals,Payments,Vehicles,Fleet Inbox,Service,Incidents,Driver Issues,Expenses,Partners",
  "the owner rail is unchanged while the flag is off",
);
ok(nav.includes('minTier: "manager"') && nav.includes('id: "tolls_tickets"'), "the tab is manager and owner only");
ok(nav.includes("TOLLS_TICKETS_LEDGER_ENABLED") && nav.includes('next.splice(at + 1, 0, TOLLS_TAB)'), "a lit flag inserts the tab after Payments");
ok(admin.includes('TOLLS_TICKETS_LEDGER_ENABLED && tab === "tolls_tickets" && <TollsTickets />'), "the panel mounts only while the flag is on");
ok(panel.indexOf("if (!TOLLS_TICKETS_LEDGER_ENABLED) return null") >= 0 && panel.indexOf("if (!TOLLS_TICKETS_LEDGER_ENABLED) return null") < panel.indexOf("useServerFn("), "the panel returns null before hooks");
ok(!/uppercase|text-transform/.test(panel), "labels are Title Case in the strings");

const memo = admin.slice(admin.indexOf("const tab: Tab = useMemo"), admin.indexOf("}, [urlTab, tier, navTabs]"));
ok(memo.indexOf("resolveTollsTicketsTab") >= 0 && memo.indexOf("resolveTollsTicketsTab") < memo.indexOf("TABS.some"), "a direct link is decided before the known-tab list");
ok(resolveTollsTicketsTab("tolls_tickets", "manager") === "overview", "a direct link falls back to Overview while the flag is off");
ok(resolveTollsTicketsTab("tolls_tickets", null) === "overview", "the direct-link fallback does not wait for the role lookup");
ok(resolveTollsTicketsTab("tolls_tickets", "coordinator") === "overview", "a coordinator direct link falls back to Overview");
ok(resolveTollsTicketsTab("tolls_tickets", "owner") === "overview", "an owner direct link falls back to Overview while the flag is off");
ok(resolveTollsTicketsTab("drivers", "manager") === null, "another tab is left to the existing resolver");
ok(
  nav.includes('if (!TOLLS_TICKETS_LEDGER_ENABLED || (tier && !tierAllows(tier, "manager"))) return "overview"') &&
    nav.includes('return "tolls_tickets"'),
  "a lit flag opens the tab for a manager, and a coordinator still falls back",
);

function charge(over: Partial<TollsChargeRow> = {}): TollsChargeRow {
  return {
    id: "charge-1",
    vehicleId: "vehicle-1",
    rentalId: "rental-1",
    applicationId: "ada",
    chargeType: "toll",
    occurredAt: "2026-10-21T03:30:00.000Z",
    amount: 10,
    adminFee: 2,
    status: "assigned",
    paymentId: null,
    notes: "EZ Pass",
    referenceNumber: "T-1",
    ...over,
  };
}

function payment(over: Partial<TollsPaymentRow> = {}): TollsPaymentRow {
  return {
    id: "pay-1",
    type: "toll",
    amount: 12,
    status: "pending",
    driverId: "ada",
    rentalId: "rental-1",
    vehicleId: "vehicle-1",
    notes: null,
    dueDate: "2026-10-21",
    paidDate: null,
    createdAt: "2026-10-21T15:00:00.000Z",
    ...over,
  };
}

function incident(over: Partial<TollsIncidentRow> = {}): TollsIncidentRow {
  return {
    id: "incident-1",
    incidentType: "other",
    description: "Parking ticket on the windshield",
    notes: null,
    occurredAt: "2026-10-19T16:00:00.000Z",
    applicationId: "ada",
    rentalId: "rental-1",
    vehicleId: "vehicle-1",
    driverResponsibleAmount: 3,
    ...over,
  };
}

function loaded<T>(rows: T[] | null, count: number | null = rows?.length ?? null, error = false): TollsRead<T> {
  return { rows, count, error };
}

function input(over: Partial<TollsTicketsInput> = {}): TollsTicketsInput {
  return {
    charges: loaded([]),
    payments: loaded([]),
    incidents: loaded([]),
    linkedPayments: loaded([]),
    renters: [
      { id: "ada", label: "Ada Driver" },
      { id: "bea", label: "Bea Driver" },
    ],
    vehicles: [{ id: "vehicle-1", label: "12 2020 Honda Civic ABC123" }],
    rentals: [{ id: "rental-1", label: "active 2026-10-01" }],
    ...over,
  };
}

ok(tollsDateEt("2026-10-21T03:30:00.000Z") === "Oct 20, 2026", "a UTC timestamp just after midnight is the previous Eastern Time date");
ok(tollsDateEt("2026-10-21") === "Oct 21, 2026", "a date-only value is not shifted");

const ledger = buildTollsTicketsLedger(input({
  charges: loaded([
    charge({ paymentId: "pay-1", status: "rebilled" }),
    charge({ id: "charge-admin", chargeType: "admin_fee", amount: 99, adminFee: 0, paymentId: "pay-admin" }),
    charge({ id: "charge-open", status: "assigned", paymentId: null, amount: 4, adminFee: 0, occurredAt: "2026-10-18T15:00:00.000Z" }),
    charge({ id: "charge-paid", status: "paid", paymentId: null, amount: 1, adminFee: 0, applicationId: null, occurredAt: "2026-10-17T15:00:00.000Z" }),
    charge({ id: "charge-missing-pay", status: "assigned", paymentId: "pay-missing", amount: 6, adminFee: 0, applicationId: "bea", occurredAt: "2026-10-16T15:00:00.000Z" }),
  ]),
  payments: loaded([
    payment({ id: "pay-1", status: "paid", paidDate: "2026-10-22", amount: 12 }),
    payment({ id: "pay-fee", type: "fee", amount: 8, status: "pending", driverId: "bea", dueDate: "2026-10-15", notes: "cleaning" }),
    payment({ id: "pay-loose", type: "toll", amount: 5, status: "pending", driverId: "bea", dueDate: null, paidDate: null, createdAt: "2026-10-14T15:00:00.000Z" }),
    payment({ id: "pay-rent", type: "rent", amount: 400, driverId: "ada" }),
  ]),
  incidents: loaded([
    incident(),
    incident({ id: "incident-crash", description: "Rear end collision", driverResponsibleAmount: 800, incidentType: "accident" }),
    incident({ id: "incident-toll", description: "Unpaid toll", incidentType: "note", driverResponsibleAmount: 2.5, applicationId: "bea", occurredAt: "2026-10-13T15:00:00.000Z" }),
  ]),
  linkedPayments: loaded([payment({ id: "pay-1", status: "paid", paidDate: "2026-10-22", amount: 12 })]),
}));

ok(ledger.withheld === null, "a complete page is shown");
ok(ledger.lines.some((line) => line.id === "charge-1" && line.kind === "Ticket") === false, "a toll charge is not labeled a ticket");
const tollCharge = ledger.lines.find((line) => line.id === "charge-1");
ok(tollCharge?.kind === "Toll" && tollCharge.dateEt === "Oct 20, 2026" && tollCharge.amount === 12, "the toll charge uses the Eastern Time date and amount plus admin fee");
ok(tollCharge?.billedToRenter === true && tollCharge.paid === true, "a rebilled charge linked to a paid payment is billed and paid");
ok(tollCharge?.renter === "Ada Driver" && tollCharge.rental === "active 2026-10-01" && tollCharge.vehicle === "12 2020 Honda Civic ABC123", "renter, rental, and vehicle labels are shown");
ok(tollCharge?.link === "/admin?tab=charges", "a charge links to Charges");
ok(!ledger.lines.some((line) => line.id === "charge-admin"), "an admin fee charge is omitted");
ok(!ledger.lines.some((line) => line.id === "incident-crash"), "an accident that does not name a toll or ticket is omitted");
ok(!ledger.lines.some((line) => line.id === "pay-rent"), "a rent payment is omitted");

const openCharge = ledger.lines.find((line) => line.id === "charge-open");
ok(openCharge?.billedToRenter === false && openCharge.paid === false, "an assigned charge with no payment is not billed and not paid");
const paidCharge = ledger.lines.find((line) => line.id === "charge-paid");
ok(paidCharge?.billedToRenter === true && paidCharge.paid === true && paidCharge.renter === "Not Assigned", "a paid charge with no renter is its own bucket");
const missingPay = ledger.lines.find((line) => line.id === "charge-missing-pay");
ok(missingPay?.paid === null && missingPay.billedToRenter === true, "a charge whose payment row is missing does not claim paid");

const fee = ledger.lines.find((line) => line.id === "pay-fee");
ok(fee?.kind === "Fee" && fee.dateEt === "Oct 15, 2026" && fee.billedToRenter === true && fee.paid === false && fee.link === "/admin?tab=payments", "a fee payment is listed on its calendar date");
const loose = ledger.lines.find((line) => line.id === "pay-loose");
ok(loose?.dateEt === "Oct 14, 2026", "an unpaid toll payment with no due date uses the Eastern Time created date");
const ticket = ledger.lines.find((line) => line.id === "incident-1");
ok(ticket?.kind === "Ticket" && ticket.amount === 3 && ticket.billedToRenter === null && ticket.paid === null, "a parking ticket incident has no billed or paid flag");
ok(ticket?.link === "/admin?tab=incidents&issue=incident-1", "an incident links to its record");
const tollIncident = ledger.lines.find((line) => line.id === "incident-toll");
ok(tollIncident?.kind === "Toll" && tollIncident.amount === 2.5, "an incident that names a toll uses the driver responsible amount");

const ada = ledger.totals.find((total) => total.renterId === "ada");
const bea = ledger.totals.find((total) => total.renterId === "bea");
const none = ledger.totals.find((total) => total.renterId === null);
ok(ada?.amount === 19 && ada.lineCount === 3, "Ada's total counts the charge once, the open charge, and the ticket, not the rebilled payment");
ok(bea?.amount === 21.5 && bea.lineCount === 4, "Bea's total adds the unlinked toll, the fee, the missing-payment charge, and the toll incident");
ok(none?.amount === 1, "the unassigned paid charge is totaled on its own");
ok(ledger.totals.map((total) => total.renter).join(",") === "Ada Driver,Bea Driver,Not Assigned", "totals are sorted by renter");
ok(ledger.lines[0]?.id === "pay-1" && ledger.lines.at(-1)?.id === "incident-toll", "lines sort by Eastern Time date, newest first");

const capped = buildTollsTicketsLedger(input({
  charges: loaded([charge({ amount: 40, adminFee: 0 })], 101),
}));
ok(capped.withheld === "page_cap" && capped.lines.length === 0 && capped.totals.length === 0 && capped.csv === "Ledger Withheld\n", "a page cap withholds lines, totals, and the CSV even when rows were passed");

const failed = buildTollsTicketsLedger(input({
  payments: loaded([payment({ amount: 80 })], null, true),
}));
ok(failed.withheld === "failed_read" && failed.lines.length === 0 && failed.totals.length === 0 && failed.csv === "Ledger Withheld\n", "a failed read withholds the ledger and does not sum the rows");
ok(failed.gaps === TOLLS_TICKETS_GAPS && capped.gaps.length === TOLLS_TICKETS_GAPS.length, "schema gaps are still listed when the ledger is withheld");

const both = buildTollsTicketsLedger(input({
  charges: loaded([charge()], 101),
  incidents: loaded(null, null, true),
}));
ok(both.withheld === "failed_read", "a failed read wins over a page cap");

const quoted = buildTollsTicketsLedger(input({
  renters: [{ id: "ada", label: "=Ada, \"Driver\"" }],
  charges: loaded([charge({ notes: "+toll\nline", amount: 1.2, adminFee: 0 })]),
}));
ok(quoted.csv.startsWith("Date ET,Renter,Rental,Vehicle,Kind,Amount,Billed To Renter,Paid,Link,Notes,Source\n"), "the CSV has the ledger columns");
ok(quoted.csv.includes("\"'=Ada, \"\"Driver\"\"\"") && quoted.csv.includes("\"'+toll\nline\""), "CSV cells quote commas and prefix formula characters");
ok(quoted.csv.includes("1.20") && quoted.csv.includes(",No,No,"), "the CSV writes cents and Yes or No");

ok(
  TOLLS_TICKETS_GAPS.some((line) => line.includes("No Tickets Table")) &&
    TOLLS_TICKETS_GAPS.some((line) => line.includes("Every Fee Payment Is Listed")) &&
    TOLLS_TICKETS_GAPS.some((line) => line.includes("Estimated Cost And Actual Cost")) &&
    TOLLS_TICKETS_GAPS.some((line) => line.includes("No Issuing Authority URL")) &&
    TOLLS_TICKETS_GAPS.some((line) => line.includes("More Than 100 Rows")),
  "the gap list names the missing tables, fee payments, repair amounts, URLs, and the page cap",
);

if (fails) {
  console.error(`\n${fails} failed`);
  process.exit(1);
}
console.log("\ntolls tickets ledger ok");
