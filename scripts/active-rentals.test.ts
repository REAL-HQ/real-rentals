import { readFileSync } from "node:fs";
import { visibleTabs, visibleWorkspaceTabs, railEntries } from "../src/components/admin/nav-config";
import {
  buildActiveRentalRows,
  calendarDaysBetween,
  documentsExpiring,
  etDateISO,
  formatBoardDate,
  isOpenIncidentStatus,
  overdueDays,
  paymentStatusLabel,
  sortActiveRentals,
  weeksIn,
  type ActiveRentalSource,
} from "../src/lib/active-rentals";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const today = "2026-10-21";
ok(etDateISO(new Date("2026-10-21T05:40:00.000Z")) === "2026-10-21", "early morning UTC is still Oct 21 in Eastern Time");
ok(etDateISO(new Date("2026-10-21T03:00:00.000Z")) === "2026-10-20", "late evening Eastern Time stays on the previous calendar day");
ok(formatBoardDate("2026-10-21") === "Oct 21, 2026 ET", "board dates render in Eastern Time");
ok(overdueDays(null, today) === null, "a missing due date is unknown, not zero days overdue");
ok(overdueDays("2026-10-21", today) === 0, "due today is current");
ok(overdueDays("2026-10-18", today) === 3, "three days past the due date is 3 overdue days");
ok(overdueDays("2026-11-01", today) === 0, "a future due date is not overdue");
ok(weeksIn("2026-10-01", today) === 2, "weeks in counts completed weeks from the start date");
ok(calendarDaysBetween("2026-10-21", "2026-12-05") === 45, "the document window is measured in calendar days");
ok(documentsExpiring(["2026-12-05"], today) && !documentsExpiring(["2026-12-06"], today), "a document expiring in 45 days flags, and one day later does not");
ok(documentsExpiring(["2026-10-01"], today), "an already expired document flags");
ok(!isOpenIncidentStatus("closed") && !isOpenIncidentStatus("written_off") && isOpenIncidentStatus("in_claim"), "closed and written-off incidents are not open");

const rental = (patch: Partial<ActiveRentalSource> & { id: string }): ActiveRentalSource => ({
  driverId: `driver-${patch.id}`,
  driverName: patch.id,
  applicationId: `app-${patch.id}`,
  vehicleId: `vehicle-${patch.id}`,
  vehicleLabel: patch.id,
  startDate: "2026-09-01",
  weeklyRate: 300,
  nextPaymentDue: "2026-10-28",
  ...patch,
});

const loaded = buildActiveRentalRows({
  today,
  rentals: [
    rental({ id: "rest", nextPaymentDue: "2026-10-28", startDate: "2026-10-01" }),
    rental({ id: "issues", nextPaymentDue: "2026-10-25", startDate: "2026-08-01" }),
    rental({ id: "overdue-more", nextPaymentDue: "2026-10-11", startDate: "2026-07-01" }),
    rental({ id: "overdue-less", nextPaymentDue: "2026-10-19", startDate: "2026-06-01" }),
    rental({ id: "no-due", nextPaymentDue: null, startDate: "2026-05-01" }),
  ],
  payments: {
    ok: true,
    rows: [
      { rentalId: "overdue-more", status: "failed", paidDate: null, dueDate: "2026-10-11", createdAt: "2026-10-11T12:00:00.000Z", stripeInvoiceId: "in_1", stripePaymentIntentId: null },
      { rentalId: "overdue-more", status: "paid", paidDate: "2026-09-01", dueDate: "2026-09-01", createdAt: "2026-09-01T12:00:00.000Z", stripeInvoiceId: null, stripePaymentIntentId: null },
      { rentalId: "rest", status: "paid", paidDate: "2026-10-14", dueDate: "2026-10-14", createdAt: "2026-10-14T12:00:00.000Z", stripeInvoiceId: null, stripePaymentIntentId: "pi_1" },
    ],
  },
  issues: {
    ok: true,
    rows: [
      { rentalId: "issues", driverId: "driver-issues", vehicleId: "vehicle-issues", status: "open" },
      { rentalId: "issues", driverId: "driver-issues", vehicleId: "vehicle-issues", status: "resolved" },
      { rentalId: "older", driverId: "driver-issues", vehicleId: "vehicle-issues", status: "open" },
    ],
  },
  incidents: {
    ok: true,
    rows: [
      { id: "i1", rentalId: "issues", vehicleId: "vehicle-issues", status: "repairing" },
      { id: "i1", rentalId: "issues", vehicleId: "vehicle-issues", status: "repairing" },
      { id: "i2", rentalId: "issues", vehicleId: "vehicle-issues", status: "written_off" },
    ],
  },
  documentDates: { ok: true, rows: [{ rentalId: "rest", dates: ["2026-12-05"] }] },
});

ok(loaded.map((row) => row.id).join(",") === "overdue-more,overdue-less,issues,no-due,rest", "overdue rows lead, then open issues, then the rest");
const overdueMore = loaded.find((row) => row.id === "overdue-more")!;
ok(overdueMore.overdueDays === 10 && overdueMore.lastPaymentStatus === "failed" && overdueMore.lastPaymentViaStripe === true, "the latest Stripe payment status wins, and overdue days come from the due date");
ok(loaded.find((row) => row.id === "issues")!.openIssues === 1, "a resolved issue and an issue on another rental stay out of the count");
ok(loaded.find((row) => row.id === "issues")!.openIncidents === 1, "a repeated open incident counts once, and a written-off incident does not");
ok(loaded.find((row) => row.id === "rest")!.documentsExpiring === true, "the expiring document flag uses the loaded dates");
ok(loaded.find((row) => row.id === "issues")!.documentsExpiring === false, "no expiry dates is a current flag when the read succeeded");
ok(loaded.find((row) => row.id === "no-due")!.overdueDays === null && loaded.find((row) => row.id === "no-due")!.lastPaymentStatus === null, "no due date and no payment row stay empty after a successful read");
ok(paymentStatusLabel(null, true) === "None" && paymentStatusLabel(null, false) === "Unavailable", "a failed payment read is distinct from zero payments");

const failed = buildActiveRentalRows({
  today,
  rentals: [rental({ id: "solo", nextPaymentDue: "2026-10-01" })],
  payments: { ok: false },
  issues: { ok: false },
  incidents: { ok: false },
  documentDates: { ok: false },
});
ok(failed[0].overdueDays === 20, "overdue still comes from the rental due date when the payment read fails");
ok(failed[0].paymentsLoaded === false && failed[0].lastPaymentStatus === null && failed[0].lastPaymentViaStripe === null, "a failed payment read does not look like no payment");
ok(failed[0].openIssues === null && failed[0].openIncidents === null && failed[0].documentsExpiring === null, "failed issue, incident, and document reads stay null instead of zero");
ok(sortActiveRentals(failed)[0].id === "solo", "a null issue count does not sort into the issues group");

const fn = readFileSync("src/lib/active-rentals.functions.ts", "utf8");
const tabs = (tier: "coordinator" | "manager" | "owner") => visibleTabs(tier).map((tab) => tab.id);
ok(!tabs("coordinator").includes("active_rentals"), "a Coordinator does not see Active Rentals");
ok(tabs("manager").includes("active_rentals") && tabs("owner").includes("active_rentals"), "a Manager and an Owner do");
ok(!visibleWorkspaceTabs("bookings", "coordinator").some((tab) => tab.id === "active_rentals"), "Bookings stays the Coordinator rental screen");
ok(!railEntries("coordinator").some((tab) => tab.id === "active_rentals"), "Active Rentals is absent from the Coordinator rail");
ok(/requireManager\(/.test(fn) && !/requireStaff\(/.test(fn), "the board gate is requireManager, matching payments, incidents, and issues");
const imports = fn.split("\n").filter((line) => /^\s*import\b/.test(line) || line.includes("await import(")).join("\n");
ok(!/stripe-collections|vehicle-finance|reconciliation|rentals\.functions|incidents\.functions|payment-collection/i.test(imports), "the board does not import finance, reconciliation, or the locked writers");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall active rental checks pass");
process.exit(fails ? 1 : 0);
