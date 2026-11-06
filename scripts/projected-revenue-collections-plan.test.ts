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
import type { ForecastRental } from "../src/lib/revenue-forecast";

const TODAY = "2026-11-05"; // Thursday

function rental(over: Partial<ForecastRental> = {}): ForecastRental {
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

  it("Overview Revenue card shows This Week / This Month projected vs collected", () => {
    expect(panel).toContain("getProjectedRevenueSummary");
    expect(panel).toContain("This Week");
    expect(panel).toContain("This Month");
    expect(panel).toContain("Projected / Collected");
    // Dense 2-col layout so the KPI row is not stretched by a tall Revenue card.
    expect(panel).toContain("grid grid-cols-2 gap-x-3");
    expect(panel).toContain("items-start");
  });

  it("admin bell accepts Collections Plan title", () => {
    expect(overview).toContain('"Collections Plan"');
  });
});
