// Projected revenue + team collections plan.
// Run: bun test scripts/projected-revenue-collections-plan.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildProjectedRevenueSummary,
  collectedRentCents,
  monthRange,
  projectedRentCents,
  weekRange,
} from "../src/lib/projected-revenue";
import {
  buildCollectionsPlan,
  collectionsPlanKind,
  COLLECTIONS_PLAN_METHOD_AUTOPAY,
  COLLECTIONS_PLAN_METHOD_UNSPECIFIED,
  resolveExpectedMethod,
} from "../src/lib/collections-plan";
import { runProjectedRevenueSummary } from "../src/lib/projected-revenue.server";
import type { PeriodRental } from "../src/lib/projected-revenue";

const TODAY = "2026-11-05"; // Thursday

function rental(over: Partial<PeriodRental> = {}): PeriodRental {
  return {
    id: "r1",
    vehicleId: "v1",
    status: "active",
    weeklyRate: 300,
    nextPaymentDue: "2026-11-05",
    endDate: null,
    ...over,
  };
}

describe("projected revenue windows", () => {
  it("uses ET Mon–Sun week and calendar month", () => {
    expect(weekRange(TODAY)).toEqual({ from: "2026-11-02", through: "2026-11-08" });
    expect(monthRange(TODAY)).toEqual({ from: "2026-11-01", through: "2026-11-30" });
  });

  it("projects weekly_rate on due date and every 7 days; excludes deposits from collected", () => {
    const rentals = [
      rental(),
      rental({ id: "r2", vehicleId: "v2", weeklyRate: 200, nextPaymentDue: "2026-11-03" }),
      rental({ id: "r3", vehicleId: "v3", weeklyRate: 100, nextPaymentDue: null }),
    ];
    const week = weekRange(TODAY)!;
    const month = monthRange(TODAY)!;
    const weekProj = projectedRentCents(rentals, week.from, week.through);
    expect(weekProj.excludedMissingDue).toBe(1);
    // r1 due 11/05 → 300; r2 due 11/03 → 200; both in this week once.
    expect(weekProj.cents).toBe(50000);

    const monthProj = projectedRentCents(rentals, month.from, month.through);
    // Nov has due 11/05 + 11/12 + 11/19 + 11/26 for r1 (4×300) and
    // 11/03 + 11/10 + 11/17 + 11/24 for r2 (4×200) = 1200+800 = 2000.
    expect(monthProj.cents).toBe(200000);

    const collected = collectedRentCents(
      [
        { paidDate: "2026-11-05", netCollected: 300, type: "rent" },
        { paidDate: "2026-11-05", netCollected: 500, type: "deposit" },
        { paidDate: "2026-11-05", netCollected: 50, type: "late_fee" },
        { paidDate: "2026-10-30", netCollected: 300, type: "rent" },
      ],
      week.from,
      week.through,
    );
    expect(collected).toBe(30000);

    const summary = buildProjectedRevenueSummary({ today: TODAY, rentals, collected: [
      { paidDate: "2026-11-05", netCollected: 300, type: "rent" },
    ]});
    expect(summary?.week.projectedCents).toBe(50000);
    expect(summary?.week.collectedCents).toBe(30000);
    expect(summary?.month.label).toBe("This Month");
    expect(summary?.month.projectedCents).toBe(200000);
    expect(summary?.month.collectedCents).toBe(30000);
  });

  // Monday 23 Nov 2026: the week just started, and next_payment_due has already
  // moved past weeks that were paid earlier in November.
  const NOV23 = "2026-11-23";

  it("counts the whole week and the whole month, including weeks already paid", () => {
    expect(weekRange(NOV23)).toEqual({ from: "2026-11-23", through: "2026-11-29" });
    expect(monthRange(NOV23)).toEqual({ from: "2026-11-01", through: "2026-11-30" });

    // Cadence anchored on 30 Nov: 2, 9, 16, 23, 30 Nov. Paying through 23 Nov
    // advanced next_payment_due to 30 Nov. The old forward-only walk saw only
    // 30 Nov in the month ($100) and nothing in this week.
    const rentals = [
      rental({
        weeklyRate: 100,
        startDate: "2026-10-01",
        nextPaymentDue: "2026-11-30",
      }),
    ];
    const collected = [
      { paidDate: "2026-11-02", netCollected: 100, type: "rent" },
      { paidDate: "2026-11-09", netCollected: 100, type: "rent" },
      { paidDate: "2026-11-16", netCollected: 100, type: "rent" },
      { paidDate: "2026-11-23", netCollected: 100, type: "rent" },
      { paidDate: "2026-11-23", netCollected: 50, type: "fee" },
      { paidDate: "2026-11-23", netCollected: 50, type: "reservation" },
      { paidDate: "2026-11-23", netCollected: 25, type: "late_fee" },
      { paidDate: "2026-11-23", netCollected: 500, type: "deposit" },
    ];
    const summary = buildProjectedRevenueSummary({ today: NOV23, rentals, collected });

    // This week is one charge ($100 projected) and the rent paid on Monday ($100).
    expect(summary?.week.projectedCents).toBe(10000);
    expect(summary?.week.collectedCents).toBe(10000);
    // This month is all five charge dates ($500), not the single date still ahead.
    expect(summary?.month.projectedCents).toBe(50000);
    expect(summary?.month.collectedCents).toBe(40000);
    // Same field order on both rows: projected, then collected.
    expect(summary?.week.projectedCents).toBeGreaterThan(0);
    expect(Object.keys(summary!.week)).toEqual(Object.keys(summary!.month));
  });

  it("does not charge weeks before the rental started or after it ends", () => {
    const week = weekRange(NOV23)!;
    const month = monthRange(NOV23)!;
    const startedLate = projectedRentCents(
      [rental({ weeklyRate: 200, startDate: "2026-11-18", nextPaymentDue: "2026-11-25" })],
      month.from,
      month.through,
    );
    // 18 Nov and 25 Nov. 11 Nov is before the start.
    expect(startedLate.cents).toBe(40000);
    // A start the day after a cadence date does not pull that earlier week in.
    expect(projectedRentCents(
      [rental({ weeklyRate: 200, startDate: "2026-11-19", nextPaymentDue: "2026-11-25" })],
      month.from,
      month.through,
    ).cents).toBe(20000);
    expect(projectedRentCents(
      [rental({ weeklyRate: 200, startDate: "2026-11-18", nextPaymentDue: "2026-11-25" })],
      week.from,
      week.through,
    ).cents).toBe(20000);

    const ended = projectedRentCents(
      [rental({ weeklyRate: 200, startDate: "2026-10-01", nextPaymentDue: "2026-11-27", endDate: "2026-11-20" })],
      month.from,
      month.through,
    );
    // Cadence 6, 13, 20, 27 Nov. 27 Nov is after the end.
    expect(ended.cents).toBe(60000);
    expect(projectedRentCents(
      [rental({ weeklyRate: 200, startDate: "2026-10-01", nextPaymentDue: "2026-11-27", endDate: "2026-11-20" })],
      week.from,
      week.through,
    ).cents).toBe(0);
  });

  it("does not invent weeks before next_payment_due when the start date is missing", () => {
    const month = monthRange(NOV23)!;
    const projected = projectedRentCents(
      [rental({ weeklyRate: 100, nextPaymentDue: "2026-11-30" })],
      month.from,
      month.through,
    );
    expect(projected.cents).toBe(10000);
  });

  it("refuses non-managers before load", async () => {
    const load = async () => {
      throw new Error("should not load");
    };
    await expect(
      runProjectedRevenueSummary({ userId: "u", tier: "coordinator", today: TODAY, load }),
    ).resolves.toEqual({ status: "forbidden", summary: null });
  });
});

describe("collections plan", () => {
  it("never assumes Zelle; prefers autopay/Stripe then last method", () => {
    expect(resolveExpectedMethod({})).toBe(COLLECTIONS_PLAN_METHOD_UNSPECIFIED);
    expect(resolveExpectedMethod({ lastPaymentMethod: "zelle" })).toBe("Zelle");
    expect(resolveExpectedMethod({ autopayActive: true, lastPaymentMethod: "zelle" })).toBe(
      COLLECTIONS_PLAN_METHOD_AUTOPAY,
    );
    expect(resolveExpectedMethod({ stripePaymentMethodId: "pm_1" })).toBe(COLLECTIONS_PLAN_METHOD_AUTOPAY);
  });

  it("reconciles rental schedule with unpaid rows without doubles", () => {
    const plan = buildCollectionsPlan({
      today: TODAY,
      tomorrow: "2026-11-06",
      rentals: [
        {
          id: "rental-a",
          applicationId: "app-a",
          status: "active",
          nextPaymentDue: TODAY,
          weeklyRate: 300,
          autopayActive: true,
          stripeSubscriptionId: "sub_1",
          stripePaymentMethodId: null,
          driverName: "Damon",
          vehicleLabel: "Unit 1 · Civic",
          plate: "ABC123",
        },
        {
          id: "rental-b",
          applicationId: "app-b",
          status: "active",
          nextPaymentDue: "2026-11-06",
          weeklyRate: 250,
          autopayActive: false,
          stripeSubscriptionId: null,
          stripePaymentMethodId: null,
          driverName: "Regina",
          vehicleLabel: "Unit 2 · Camry",
          plate: null,
        },
      ],
      unpaidPayments: [
        // Same rental+day as rental-a — must not double.
        {
          id: "pay-a",
          rentalId: "rental-a",
          driverId: "app-a",
          dueDate: TODAY,
          amount: 300,
          balanceDue: 300,
          status: "pending",
          paymentMethod: null,
          type: "rent",
          driverName: "Damon",
          vehicleLabel: null,
          plate: null,
        },
        // Payment-only row (no matching rental schedule).
        {
          id: "pay-c",
          rentalId: null,
          driverId: "app-c",
          dueDate: TODAY,
          amount: 175,
          balanceDue: 175,
          status: "upcoming",
          paymentMethod: "Cash App",
          type: "rent",
          driverName: "Schrita",
          vehicleLabel: "Unit 9",
          plate: "ZZZ9",
        },
      ],
      lastMethodByDriverId: { "app-b": "venmo" },
    });
    expect(plan.dueToday.map((r) => r.renterName).sort()).toEqual(["Damon", "Schrita"]);
    expect(plan.dueToday.find((r) => r.renterName === "Damon")?.method).toBe(COLLECTIONS_PLAN_METHOD_AUTOPAY);
    expect(plan.dueToday.find((r) => r.renterName === "Schrita")?.method).toBe("Cash App");
    expect(plan.dueTomorrow).toHaveLength(1);
    expect(plan.dueTomorrow[0]?.method).toBe("Venmo");
    expect(collectionsPlanKind(TODAY)).toBe("collections_plan:2026-11-05");
  });
});

describe("wiring", () => {
  const cron = readFileSync("src/routes/api/public/cron/ops-reminders.ts", "utf8");
  const email = readFileSync("src/lib/email.server.ts", "utf8");
  const panel = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
  const overview = readFileSync("src/lib/admin-overview.ts", "utf8");

  it("cron sends team collections plan with dedupe", () => {
    expect(cron).toContain("sendTeamCollectionsPlanEmail");
    expect(cron).toContain("collectionsPlanKind");
    expect(cron).toContain("teamDigestAlreadySent");
    expect(cron).toContain("Not specified");
  });

  it("email helper is a staff collections_plan workflow", () => {
    expect(email).toContain("sendTeamCollectionsPlanEmail");
    expect(email).toContain('"collections_plan"');
    expect(email).toContain("Collections Plan — Due Today / Due Tomorrow");
  });

  it("Overview Revenue card shows This Week / This Month projected then collected", () => {
    const details = panel.slice(panel.indexOf('label="Revenue Details"'));
    expect(panel).toContain("getProjectedRevenueSummary");
    expect(details).toContain("This Week");
    expect(details).toContain("This Month");
    expect(details.indexOf("Projected")).toBeGreaterThan(-1);
    expect(details.indexOf("Projected")).toBeLessThan(details.indexOf("Collected"));
    expect(details.indexOf("row.projectedCents")).toBeLessThan(details.indexOf("row.collectedCents"));
    expect(details).not.toContain("Revenue: Projected / Collected");
  });

  it("projected revenue loader reads the rental start date", () => {
    const server = readFileSync("src/lib/projected-revenue.server.ts", "utf8");
    expect(server).toContain("start_date");
  });

  it("admin bell accepts Collections Plan title", () => {
    expect(overview).toContain('"Collections Plan"');
  });
});
