// Active Renters card: standing counts come from the Bookings > Active rows.
// Run: bun test scripts/overview-active-renters.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { buildActiveRentalRows, type ActiveRentalSource, type PaymentFact } from "../src/lib/active-rentals";
import {
  ACTIVE_RENTER_COPY,
  ACTIVE_RENTER_LIST_CAP,
  OVERVIEW_OPEN_SWAP_STATUSES,
  activeRenterVehicleLine,
  summarizeActiveRenters,
  weeklyRentLabel,
  type ActiveRenterFact,
} from "../src/lib/overview-active-renters";
import { OPEN_SWAP_STATUSES } from "../src/lib/vehicle-swap";

const TODAY = "2026-11-23";

function source(patch: Partial<ActiveRentalSource> & { id: string }): ActiveRentalSource {
  return {
    driverId: `driver-${patch.id}`,
    driverName: patch.id,
    applicationId: `app-${patch.id}`,
    vehicleId: `vehicle-${patch.id}`,
    vehicleLabel: patch.id,
    startDate: "2026-10-01",
    weeklyRate: 300,
    nextPaymentDue: "2026-11-30",
    ...patch,
  };
}

function pay(patch: Partial<PaymentFact> & { rentalId: string; status: string; dueDate: string }): PaymentFact {
  return {
    paidDate: null,
    createdAt: `${patch.dueDate}T12:00:00.000Z`,
    stripeInvoiceId: null,
    stripePaymentIntentId: null,
    type: "rent",
    amount: 300,
    ...patch,
  };
}

describe("active renter standing counts", () => {
  const rentals = [
    source({ id: "covered", nextPaymentDue: "2026-11-16", weeklyRate: 350 }),
    source({ id: "future", nextPaymentDue: "2026-11-30", weeklyRate: 200 }),
    source({ id: "late", nextPaymentDue: "2026-11-09", weeklyRate: 300 }),
    source({ id: "behind", nextPaymentDue: "2026-11-23", weeklyRate: 300 }),
    source({ id: "none", nextPaymentDue: null, weeklyRate: null }),
    source({ id: "fee", nextPaymentDue: "2026-11-23", weeklyRate: 250 }),
    source({ id: "daily", nextPaymentDue: "2026-11-30", weeklyRate: 350 }),
  ];
  const built = buildActiveRentalRows({
    today: TODAY,
    rentals,
    payments: {
      ok: true,
      rows: [
        pay({ rentalId: "covered", status: "paid", dueDate: "2026-11-16", amount: 350, paidDate: "2026-11-16" }),
        pay({ rentalId: "behind", status: "overdue", dueDate: "2026-11-09", amount: 300 }),
        pay({ rentalId: "fee", status: "paid", dueDate: "2026-11-23", amount: 50, type: "reservation" }),
      ],
    },
    issues: { ok: true, rows: [] },
    incidents: { ok: true, rows: [] },
    documentDates: { ok: true, rows: [] },
    dailyPlans: new Map([["daily", { dailyRate: 50, startsOn: "2026-11-21" }]]),
  });

  it("uses rent standing, so a paid week is not still overdue", () => {
    const covered = built.find((row) => row.id === "covered")!;
    expect(covered.nextPaymentDue).toBe("2026-11-23");
    expect(covered.overdueDays).toBe(0);
    const late = built.find((row) => row.id === "late")!;
    expect(late.overdueDays).toBe(14);
    const behind = built.find((row) => row.id === "behind")!;
    expect(behind.overdueDays).toBe(14);
    expect(behind.nextPaymentDue).toBe("2026-11-23");
    const fee = built.find((row) => row.id === "fee")!;
    expect(fee.overdueDays).toBe(0);
    expect(fee.nextPaymentDue).toBe("2026-11-23");
    const daily = built.find((row) => row.id === "daily")!;
    expect(daily.cadence).toBe("daily");
    expect(daily.overdueDays).toBe(2);
  });

  it("counts Current, Due Today, and Overdue without double counting", () => {
    const extras: Record<string, Pick<ActiveRenterFact, "name" | "plate" | "vinLast6" | "autopayOn" | "endDate">> = {
      covered: { name: "Ada Covered", plate: "abc123", vinLast6: "1HGBH41JXMN109186", autopayOn: true, endDate: "2026-11-23" },
      future: { name: "Bea Future", plate: "zz999", vinLast6: "ABCDEF", autopayOn: true, endDate: "2026-11-30" },
      late: { name: "Cal Late", plate: null, vinLast6: "109186", autopayOn: false, endDate: "2026-11-22" },
      behind: { name: "Dee Behind", plate: "T100", vinLast6: null, autopayOn: false, endDate: "2026-12-01" },
      none: { name: "Eve None", plate: null, vinLast6: null, autopayOn: false, endDate: null },
      fee: { name: "Fay Fee", plate: "fee1", vinLast6: "654321", autopayOn: false, endDate: null },
      daily: { name: "Gia Daily", plate: "day1", vinLast6: "111111", autopayOn: false, endDate: "2026-11-20" },
    };
    const summary = summarizeActiveRenters({
      today: TODAY,
      paymentsLoaded: true,
      openSwaps: 1,
      renters: built.map((row) => ({
        id: row.id,
        name: extras[row.id].name,
        plate: extras[row.id].plate,
        vinLast6: extras[row.id].vinLast6,
        weeklyRate: row.weeklyRate,
        autopayOn: extras[row.id].autopayOn,
        endDate: extras[row.id].endDate,
        nextDue: row.nextPaymentDue,
        overdueDays: row.overdueDays,
      })),
    });

    expect(summary.standing).toEqual({ current: 1, dueToday: 2, overdue: 3, noDueDate: 1 });
    expect(summary.standing.current + summary.standing.dueToday + summary.standing.overdue + summary.standing.noDueDate).toBe(7);
    expect(summary.weeklyRent).toBe(1750);
    expect(summary.ratesNotSet).toBe(1);
    expect(summary.ratesKnown).toBe(6);
    expect(weeklyRentLabel(summary.weeklyRent, summary.ratesNotSet, summary.ratesKnown)).toBe("$1,750 · 1 Not Set");
    expect(summary.autopayOn).toBe(2);
    expect(summary.returnsDueSoon).toBe(2);
    expect(summary.overdueReturns).toBe(2);
    expect(summary.openSwaps).toBe(1);
    expect(summary.renters.map((row) => row.id)).toEqual(["late", "behind", "daily", "covered", "fee"]);
    expect(summary.hiddenCount).toBe(2);
    expect(summary.renters).toHaveLength(ACTIVE_RENTER_LIST_CAP);
    expect(summary.renters[0].vehicle).toBe("VIN …109186");
    expect(summary.renters[0].vehicle).not.toContain("RR-");
    const coveredRow = summary.renters.find((row) => row.id === "covered")!;
    expect(coveredRow.vehicle).toBe("ABC123 · VIN …109186");
    expect(coveredRow.vehicle).not.toContain("1HGBH41JXMN");
    expect(coveredRow.standing).toBe("due_today");
    expect(summary.renters.find((row) => row.id === "fee")!.standing).toBe("due_today");
    expect(summary.renters.find((row) => row.id === "future")).toBeUndefined();
  });

  it("does not guess standing when payments did not load", () => {
    const summary = summarizeActiveRenters({
      today: TODAY,
      paymentsLoaded: false,
      openSwaps: null,
      renters: [
        {
          id: "stored-past",
          name: "Pat",
          plate: "P1",
          vinLast6: "ABC123",
          weeklyRate: 100,
          autopayOn: false,
          endDate: "2026-11-29",
          nextDue: "2026-11-01",
          overdueDays: 22,
        },
      ],
    });
    expect(summary.paymentsLoaded).toBe(false);
    expect(summary.standing).toEqual({ current: 0, dueToday: 0, overdue: 0, noDueDate: 0 });
    expect(summary.renters[0].standing).toBe("unavailable");
    expect(summary.renters[0].nextDue).toBe("2026-11-01");
    expect(summary.returnsDueSoon).toBe(1);
    expect(summary.openSwaps).toBeNull();
  });

  it("keeps a zero weekly total when nobody is renting and refuses a non-positive rate", () => {
    const empty = summarizeActiveRenters({ today: TODAY, renters: [], paymentsLoaded: true, openSwaps: 0 });
    expect(empty.totalRenters).toBe(0);
    expect(empty.hiddenCount).toBe(0);
    expect(weeklyRentLabel(empty.weeklyRent, empty.ratesNotSet, empty.ratesKnown)).toBe("$0");
    expect(weeklyRentLabel(0, 2, 0)).toBe("Not Set");
    expect(weeklyRentLabel(100.5, 0, 1)).toBe("$100.50");
  });
});

describe("active renter card copy", () => {
  it("uses Title Case and never a unit number, a phone, or the word deposit", () => {
    for (const value of Object.values(ACTIVE_RENTER_COPY)) {
      for (const word of value.split(/\s+/)) {
        const core = word.replace(/[….:,]+$/u, "");
        expect(/^[A-Z0-9]/.test(core), value).toBe(true);
      }
    }
    expect(activeRenterVehicleLine("t 100", "mn109186")).toBe("T 100 · VIN …109186");
    expect(OVERVIEW_OPEN_SWAP_STATUSES).toEqual([...OPEN_SWAP_STATUSES]);

    const lib = readFileSync("src/lib/overview-active-renters.ts", "utf8");
    const fn = readFileSync("src/lib/overview-active-renters.functions.ts", "utf8");
    const view = readFileSync("src/components/admin/ActiveRentersDetails.tsx", "utf8");
    const panel = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
    for (const src of [lib, fn, view]) {
      expect(src.toLowerCase()).not.toContain("phone");
      expect(src.toLowerCase()).not.toContain("deposit");
      expect(src).not.toContain("unit_number");
      expect(src).not.toContain("card_last4");
    }
    expect(fn).toContain("buildActiveRentalRows");
    expect(fn).toContain('select("id,full_name")');
    expect(fn).toContain('select("id,license_plate,vin")');
    expect(fn).toContain("tierAllows");
    expect(fn).toContain("rental_vehicle_swaps");
    expect(panel).toContain("<ActiveRentersDetails");
    expect(panel).toContain("ACTIVE_RENTER_COPY.hint");
    expect(panel).toContain('search={{ tab: "drivers", filter: "active" }}');
    expect(panel).not.toContain("With an active rental");
    expect(panel).not.toContain("No active rentals");
  });
});
