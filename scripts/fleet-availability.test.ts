/**
 * Fleet Availability grouping and the disabled flag.
 * Run: bun scripts/fleet-availability.test.ts
 */
import { readFileSync } from "node:fs";
import { railEntries, TABS, visibleTabs } from "../src/components/admin/nav-config";
import {
  APPROVED_NOT_RENTING_FILTER,
  FLEET_AVAILABILITY_DISABLED,
  FLEET_AVAILABILITY_ENABLED,
  assertFleetAvailabilityEnabled,
  buildFleetAvailability,
  countApprovedNotRenting,
  docState,
  etCalendarDate,
  paymentDueLabel,
  type FleetGroup,
  type FleetIncidentInput,
  type FleetRentalInput,
  type FleetVehicleInput,
} from "../src/lib/fleet-availability";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const TODAY = "2026-10-21";

function car(over: Partial<FleetVehicleInput> & { id: string }): FleetVehicleInput {
  return {
    unitNumber: over.id,
    year: 2020,
    make: "Toyota",
    model: "Camry",
    plate: "ABC123",
    status: "available",
    archivedAt: null,
    registrationExpiresOn: "2027-01-01",
    insuranceExpiresOn: "2027-06-01",
    ...over,
  };
}

function rental(over: Partial<FleetRentalInput> & { vehicleId: string }): FleetRentalInput {
  return {
    id: `r-${over.vehicleId}`,
    applicationId: `a-${over.vehicleId}`,
    driverName: "Amina Cole",
    nextPaymentDue: "2026-10-28",
    status: "active",
    ...over,
  };
}

function placed(
  vehicles: FleetVehicleInput[],
  rentals: FleetRentalInput[] = [],
  incidents: FleetIncidentInput[] = [],
): Map<string, FleetGroup> {
  const board = buildFleetAvailability({ vehicles, rentals, incidents, todayEt: TODAY });
  ok(board.total === board.groups.reduce((sum, group) => sum + group.rows.length, 0), "every counted car is in one group");
  const seen = new Map<string, FleetGroup>();
  for (const group of board.groups) {
    ok(group.rows.length === board.counts[group.id], `${group.label} count matches its rows`);
    for (const row of group.rows) {
      ok(!seen.has(row.id), `${row.id} is in one group`);
      seen.set(row.id, group.id);
    }
  }
  return seen;
}

ok(FLEET_AVAILABILITY_ENABLED === false, "the flag is off");
let threw = false;
try {
  assertFleetAvailabilityEnabled();
} catch (error) {
  threw = error instanceof Error && error.message === FLEET_AVAILABILITY_DISABLED;
}
ok(threw, "assert refuses while the flag is off");

ok(etCalendarDate(new Date("2026-10-21T12:00:00.000Z")) === "2026-10-21", "noon UTC is still that Eastern day");
ok(etCalendarDate(new Date("2026-10-21T03:30:00.000Z")) === "2026-10-20", "early UTC is the previous Eastern day");
ok(docState("2026-10-21", TODAY) === "current", "today is not expired");
ok(docState("2026-10-20", TODAY) === "expired", "yesterday is expired");
ok(docState("2027-01-01", TODAY) === "current", "a future date is current");
ok(docState(null, TODAY) === "unknown", "a missing date is unknown");
ok(docState("2026-02-31", TODAY) === "unknown", "an impossible date is unknown");
ok(docState("10/21/2026", TODAY) === "unknown", "a non-ISO date is unknown");
ok(paymentDueLabel("2026-10-28") === "Oct 28, 2026", "a real next payment due is formatted");
ok(paymentDueLabel(null) === "Unknown", "a missing next payment due is Unknown");

const ready = placed([car({ id: "ready" })]);
ok(ready.get("ready") === "available_now", "valid docs, no rental, no incident, status available → Available Now");

const todayDocs = placed([
  car({ id: "today-docs", registrationExpiresOn: TODAY, insuranceExpiresOn: TODAY }),
]);
ok(todayDocs.get("today-docs") === "available_now", "dates equal to today still count as not expired");

const rented = buildFleetAvailability({
  todayEt: TODAY,
  vehicles: [car({ id: "out", status: "available" })],
  rentals: [rental({ vehicleId: "out" })],
  incidents: [],
});
const rentedRow = rented.groups.find((group) => group.id === "rented")?.rows[0];
ok(rented.counts.rented === 1 && rentedRow?.driver === "Amina Cole", "an active rental is Rented and names the driver");
ok(rentedRow?.nextPaymentDue === "Oct 28, 2026", "Rented shows the rental's next payment due");

const missingPay = buildFleetAvailability({
  todayEt: TODAY,
  vehicles: [car({ id: "nopay" })],
  rentals: [rental({ vehicleId: "nopay", driverName: "  ", nextPaymentDue: null })],
  incidents: [],
});
const missingPayRow = missingPay.groups.find((group) => group.id === "rented")?.rows[0];
ok(missingPayRow?.driver === "Unknown" && missingPayRow?.nextPaymentDue === "Unknown", "a rental with no name and no due date says Unknown");

const statusRented = placed([car({ id: "status-rented", status: "rented" })]);
ok(statusRented.get("status-rented") === "unknown", "status rented without an active rental is not Rented");

const shop = placed(
  [
    car({ id: "maint", status: "maintenance" }),
    car({ id: "claim" }),
    car({ id: "repair" }),
    car({ id: "open-inc" }),
    car({ id: "closed-inc" }),
  ],
  [],
  [
    { vehicleId: "claim", status: "in_claim" },
    { vehicleId: "repair", status: "repairing" },
    { vehicleId: "open-inc", status: "open" },
    { vehicleId: "closed-inc", status: "closed" },
  ],
);
ok(shop.get("maint") === "in_shop", "status maintenance is In Shop");
ok(shop.get("claim") === "in_shop", "an In Claim incident is In Shop");
ok(shop.get("repair") === "in_shop", "a Repairing incident is In Shop");
ok(shop.get("open-inc") === "unknown", "an open incident is not In Shop and not Available Now");
ok(shop.get("closed-inc") === "available_now", "a closed incident does not change a ready car");

const expired = placed([
  car({ id: "reg", registrationExpiresOn: "2026-10-20" }),
  car({ id: "ins", insuranceExpiresOn: "2020-01-01" }),
  car({ id: "sold", status: "sold" }),
  car({ id: "retired", status: "retired" }),
  car({ id: "archived-status", status: "archived" }),
  car({ id: "gone", status: "available", archivedAt: "2026-01-01T00:00:00Z" }),
]);
ok(expired.get("reg") === "not_rentable", "expired registration is Not Rentable");
ok(expired.get("ins") === "not_rentable", "expired insurance is Not Rentable");
ok(expired.get("sold") === "not_rentable", "sold is Not Rentable");
ok(expired.get("retired") === "not_rentable", "retired is Not Rentable");
ok(expired.get("archived-status") === "not_rentable", "status archived is Not Rentable");
ok(!expired.has("gone"), "archived_at removes the car from the board");

const unknownDocs = placed([
  car({ id: "no-ins", insuranceExpiresOn: null }),
  car({ id: "no-reg", registrationExpiresOn: "" }),
  car({ id: "reserved", status: "reserved" }),
  car({ id: "setup", status: "onboarding" }),
  car({ id: "held", status: "hold" }),
]);
ok(unknownDocs.get("no-ins") === "unknown", "missing insurance is Unknown, not Available Now");
ok(unknownDocs.get("no-reg") === "unknown", "missing registration is Unknown, not expired");
ok(unknownDocs.get("reserved") === "unknown", "Reserved stays Unknown instead of Available Now");
ok(unknownDocs.get("setup") === "unknown", "Needs Setup stays Unknown instead of Available Now");
ok(unknownDocs.get("held") === "unknown", "an unrecognized status is Unknown");

const overlap = buildFleetAvailability({
  todayEt: TODAY,
  vehicles: [
    car({ id: "rent-shop", status: "maintenance", registrationExpiresOn: "2020-01-01" }),
  ],
  rentals: [rental({ vehicleId: "rent-shop", driverName: "Noah Blake" })],
  incidents: [{ vehicleId: "rent-shop", status: "repairing" }],
});
const overlapRow = overlap.groups.find((group) => group.id === "rented")?.rows[0];
ok(overlap.counts.rented === 1 && overlap.counts.in_shop === 0, "an active rental stays Rented when the car is also in the shop");
ok(
  overlapRow?.facts.includes("Registration Expired") && overlapRow?.facts.includes("In Shop"),
  "shop and expiry stay visible on the rented row",
);
ok(overlapRow?.driver === "Noah Blake", "the rented row still names the driver");

const oneExpired = placed([car({ id: "half", insuranceExpiresOn: null, registrationExpiresOn: "2020-05-01" })]);
ok(oneExpired.get("half") === "not_rentable", "one expired date is Not Rentable even when the other is unknown");

const split = buildFleetAvailability({
  todayEt: TODAY,
  vehicles: [car({ id: "two" })],
  rentals: [
    rental({ id: "r1", vehicleId: "two", driverName: "Ada", nextPaymentDue: "2026-11-01" }),
    rental({ id: "r2", vehicleId: "two", driverName: "Bea", nextPaymentDue: "2026-12-01" }),
  ],
  incidents: [],
});
const splitRow = split.groups.find((group) => group.id === "rented")?.rows[0];
ok(splitRow?.driver === "Unknown" && splitRow?.nextPaymentDue === "Unknown", "two active rentals that disagree are Unknown");

ok(
  countApprovedNotRenting(
    [
      { id: "a", status: "approved", deletedAt: null },
      { id: "b", status: "approved", deletedAt: null },
      { id: "c", status: "approved", deletedAt: "2026-01-01" },
      { id: "d", status: "reviewing", deletedAt: null },
      { id: "e", status: "active", deletedAt: null },
      { id: "a", status: "approved", deletedAt: null },
    ],
    ["b"],
  ) === 1,
  "the waiting count is approved, not deleted, and not already on an active rental",
);

const fn = readFileSync("src/lib/fleet-availability.functions.ts", "utf8");
const handler = fn.slice(fn.indexOf("export const listFleetAvailability"), fn.indexOf("function toVehicle"));
ok(handler.indexOf("requireStaff") !== -1 && handler.indexOf("requireStaff") < handler.indexOf("assertFleetAvailabilityEnabled"), "staff is checked before the flag");
ok(handler.indexOf("assertFleetAvailabilityEnabled") < handler.indexOf(".from("), "the flag is checked before any read");
ok(!/\.(insert|update|delete|upsert)\(/.test(fn), "the server file does not write");
ok(fn.includes("next_payment_due"), "next payment due is the rental column");
ok(!fn.includes("maintenance_records") && !fn.includes("maintenance_schedules"), "shop does not come from the service tables");
ok(fn.includes('select("id, full_name")') || fn.includes("full_name"), "the driver name is the application name");

const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const ui = readFileSync("src/components/admin/FleetAvailability.tsx", "utf8");
ok(!TABS.some((tab) => tab.id === "fleet_availability"), "the tab is not in the always-on nav");
ok(!visibleTabs("owner").some((tab) => tab.id === "fleet_availability"), "an owner does not see the tab while the flag is off");
ok(!visibleTabs("manager").some((tab) => tab.id === "fleet_availability"), "a manager does not see the tab while the flag is off");
ok(!visibleTabs("coordinator").some((tab) => tab.id === "fleet_availability"), "a coordinator does not see the tab while the flag is off");
ok(!railEntries("owner").some((tab) => tab.id === "fleet_availability"), "the owner rail hides the tab while the flag is off");
ok(nav.includes("FLEET_AVAILABILITY_ENABLED && tierAllows(tier, \"coordinator\")"), "the nav adds the tab only for coordinator and above, and only when the flag is on");
ok(admin.includes('urlTab === "fleet_availability"') && admin.includes("!FLEET_AVAILABILITY_ENABLED"), "a direct link falls back while the flag is off");
ok(admin.includes('FLEET_AVAILABILITY_ENABLED && tab === "fleet_availability"'), "the screen is mounted only while the flag is on");
ok(ui.includes("Next Approved Driver Waiting"), "the waiting hint is on the board");
ok(APPROVED_NOT_RENTING_FILTER === "approved-not-renting", "the waiting link uses #79's filter");
ok(ui.includes("APPROVED_NOT_RENTING_FILTER"), "the hint links to that filter");
ok(!/text-transform\s*:/.test(ui) && !ui.includes("uppercase") && !ui.includes("capitalize"), "labels are Title Case in the strings");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall assertions passed");
if (fails) process.exit(1);
