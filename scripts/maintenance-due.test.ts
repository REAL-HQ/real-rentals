import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAINTENANCE_DUE_ENABLED,
  badgeFromDate,
  buildMaintenanceDue,
  businessToday,
  milesOverdue,
  parseIsoDate,
  parseMiles,
  serviceBadge,
  type ExpenseDueSource,
  type VehicleDueSource,
} from "../src/lib/maintenance-due";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const TODAY = "2026-10-21";
const vehicle = (over: Partial<VehicleDueSource> = {}): VehicleDueSource => ({
  id: "v1",
  unitNumber: "12",
  year: 2019,
  make: "Toyota",
  model: "Camry",
  plate: "ABC123",
  status: "available",
  bodyType: "Sedan",
  partnerId: null,
  currentMiles: 90000,
  registrationExpiresOn: null,
  insuranceExpiresOn: null,
  ...over,
});

function row(expenses: ExpenseDueSource[] = [], stored: Parameters<typeof buildMaintenanceDue>[0]["stored"] = [], car = vehicle()) {
  const built = buildMaintenanceDue({ today: TODAY, vehicles: [car], expenses, stored });
  assert.equal(built.length, 1);
  return built[0];
}
const kind = (built: ReturnType<typeof row>, id: string) => built.items.find((item) => item.kind === id)!;

ok(MAINTENANCE_DUE_ENABLED === false, "flag stays off");
ok(parseIsoDate("2026-02-31") === null && parseIsoDate("2026-10-21 ish") === null, "impossible dates stay unknown");
ok(parseIsoDate("2026-10-21T00:00:00Z") === "2026-10-21", "a timestamp keeps its calendar date");
ok(parseMiles(10.5) === null && parseMiles(-1) === null && parseMiles("08000") === 8000, "miles stay integers");
ok(businessToday(new Date("2026-01-15T04:30:00Z")) === "2026-01-14", "today is the New York calendar date before midnight");
ok(businessToday(new Date("2026-01-15T05:30:00Z")) === "2026-01-15", "today is the New York calendar date after midnight");

ok(badgeFromDate(TODAY, "2026-10-20") === "overdue", "yesterday is Overdue");
ok(badgeFromDate(TODAY, TODAY) === "due_14", "today is Due In 14 Days");
ok(badgeFromDate(TODAY, "2026-11-04") === "due_14", "the 14th day is Due In 14 Days");
ok(badgeFromDate(TODAY, "2026-11-05") === "ok", "the 15th day is OK");
ok(badgeFromDate(TODAY, null) === "unknown" && badgeFromDate(TODAY, "nope") === "unknown", "a missing date is Unknown");

ok(milesOverdue(90000, 90000) === true && milesOverdue(95000, 90000) === false, "reaching the due mileage is Overdue");
ok(serviceBadge({ today: TODAY, dueOn: null, dueMiles: 95000, currentMiles: 90000 }) === "unknown", "miles remaining are not OK and not Due In 14 Days");
ok(serviceBadge({ today: TODAY, dueOn: null, dueMiles: 90000, currentMiles: 90000 }) === "overdue", "miles with no date can still be Overdue");
ok(serviceBadge({ today: TODAY, dueOn: "2026-11-05", dueMiles: 95000, currentMiles: null }) === "unknown", "a far date with an unreadable odometer stays Unknown");
ok(serviceBadge({ today: TODAY, dueOn: "2026-11-05", dueMiles: 80000, currentMiles: 90000 }) === "overdue", "past the due mileage wins over a far date");
ok(serviceBadge({ today: TODAY, dueOn: "2026-11-05", dueMiles: 95000, currentMiles: 90000 }) === "ok", "a far date and mileage still ahead is OK");
ok(serviceBadge({ today: TODAY, dueOn: "2026-10-01", dueMiles: null, currentMiles: 90000 }) === "overdue", "a past date is Overdue");

const blank = row([
  { vehicleId: "v1", category: "maintenance", incurredOn: "2026-09-01" },
  { vehicleId: "v1", category: "oil_change", incurredOn: "2026-09-01" },
]);
ok(kind(blank, "oil_change").lastService === "Unknown" && kind(blank, "oil_change").dueBy === "Unknown" && kind(blank, "oil_change").badgeLabel === "Unknown", "a maintenance expense is not an oil change");
ok(kind(blank, "tires").badge === "unknown" && kind(blank, "insurance").dueBy === "Unknown", "no tire or insurance date stays Unknown");

const tires = row([
  { vehicleId: "v1", category: "tires", incurredOn: "2026-01-01" },
  { vehicleId: "v1", category: "tires", incurredOn: "2026-06-15" },
  { vehicleId: "other", category: "tires", incurredOn: "2026-09-01" },
]);
ok(kind(tires, "tires").lastService === "Jun 15, 2026" && kind(tires, "tires").dueBy === "Unknown" && kind(tires, "tires").badge === "unknown", "the latest tire expense is last service and does not invent a due date");

const papers = row(
  [
    { vehicleId: "v1", category: "registration", incurredOn: "2026-03-01" },
    { vehicleId: "v1", category: "insurance", incurredOn: "2026-04-02" },
  ],
  [],
  vehicle({ registrationExpiresOn: "2026-12-01", insuranceExpiresOn: null, currentMiles: null }),
);
const registration = kind(papers, "registration_inspection");
ok(registration.lastService === "Registration Mar 1, 2026 · Inspection Unknown", "inspection has no last-service column");
ok(registration.dueBy === "Registration Dec 1, 2026 · Inspection Unknown" && registration.badge === "unknown", "a current registration does not make an unknown inspection OK");
ok(kind(papers, "insurance").lastService === "Apr 2, 2026" && kind(papers, "insurance").dueBy === "Unknown" && kind(papers, "insurance").badge === "unknown", "an insurance payment is not an expiry");
ok(papers.currentMiles === "Unknown", "missing odometer is Unknown");

const overdueRegistration = row([], [], vehicle({ registrationExpiresOn: "2026-10-01" }));
ok(kind(overdueRegistration, "registration_inspection").badge === "overdue" && kind(overdueRegistration, "registration_inspection").badgeLabel === "Overdue", "an expired registration is Overdue even when inspection is Unknown");

const both = row(
  [],
  [{
    vehicleId: "v1",
    oilLastOn: null,
    oilLastMiles: null,
    oilDueOn: null,
    oilDueMiles: null,
    tiresLastMiles: null,
    tiresDueOn: null,
    tiresDueMiles: null,
    inspectionDueOn: "2026-10-28",
  }],
  vehicle({ registrationExpiresOn: "2026-12-01" }),
);
ok(kind(both, "registration_inspection").badge === "due_14" && kind(both, "registration_inspection").dueBy.includes("Inspection Oct 28, 2026"), "inspection inside 14 days is Due In 14 Days");

const oil = row(
  [],
  [{
    vehicleId: "v1",
    oilLastOn: "2026-05-01",
    oilLastMiles: 80000,
    oilDueOn: "2026-11-05",
    oilDueMiles: 95000,
    tiresLastMiles: 70000,
    tiresDueOn: null,
    tiresDueMiles: null,
    inspectionDueOn: null,
  }],
);
ok(kind(oil, "oil_change").lastService === "May 1, 2026 · 80,000 mi", "stored oil service is shown as recorded");
ok(kind(oil, "oil_change").dueBy === "Nov 5, 2026 · 95,000 mi" && kind(oil, "oil_change").badge === "ok", "stored oil due date and mileage can be OK");
ok(kind(oil, "tires").lastService === "Recorded 70,000 mi" && kind(oil, "tires").badge === "unknown", "recorded tire mileage without a due date stays Unknown");

const insured = row([], [], vehicle({ insuranceExpiresOn: "2026-11-04" }));
ok(kind(insured, "insurance").badgeLabel === "Due In 14 Days" && kind(insured, "insurance").dueBy === "Nov 4, 2026", "insurance expiry on day 14 is Due In 14 Days");

const fn = readFileSync("src/lib/maintenance-due.functions.ts", "utf8");
const gate = fn.indexOf("if (!MAINTENANCE_DUE_ENABLED) throw new Error(DISABLED);");
const read = fn.indexOf('.from("vehicles")');
ok(gate > 0 && read > gate, "the flag throws before any vehicle read");
ok(!/\.(insert|update|delete|upsert)\(/.test(fn), "the reader has no writes");
const panel = readFileSync("src/components/admin/VehiclesPanel.tsx", "utf8");
ok(panel.includes("MAINTENANCE_DUE_ENABLED && canSeeMaintenanceDue"), "the view is hidden while the flag is off or the viewer is not a manager");
const sql = readFileSync("proposed/maintenance-due-v1.sql", "utf8");
ok(sql.includes("NOT EXECUTED") && !/INSERT INTO/i.test(sql), "proposed SQL is not an install and inserts nothing");
ok(!readFileSync("src/lib/maintenance-due.ts", "utf8").includes("interval_miles"), "no oil or tire interval is assumed");

if (fails) {
  console.log(`\n${fails} failed`);
  process.exit(1);
}
console.log("\nAll maintenance due checks passed");
