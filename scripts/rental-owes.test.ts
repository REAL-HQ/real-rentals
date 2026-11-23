// Bookings owes and the FLEET balance share reportedOwes.
import { describe, expect, test } from "bun:test";
import { reportedOwes } from "../src/lib/rental-owes";
import { autopayBadge } from "../src/lib/bookings-list";
import { rentStanding } from "../src/lib/rent-standing";
import { buildActiveRentalRows, type PaymentFact } from "../src/lib/active-rentals";

const PLAN = { dailyRate: 50, startsOn: "2026-11-16" };
const paid = (due: string) => ({ type: "rent", status: "paid", amount: 50, dueDate: due, paidDate: due });

describe("autopay badge", () => {
  test("on shows the next charge date and weekly rate; off stays off", () => {
    expect(autopayBadge({ autopayActive: true, nextPaymentDue: "2026-11-30", weeklyRate: 350 })).toBe("Autopay On · Next Charge Nov 30, 2026 · $350.00");
    expect(autopayBadge({ autopayActive: false, nextPaymentDue: "2026-11-30", weeklyRate: 350 })).toBe("Autopay Off");
    expect(autopayBadge({ autopayActive: null })).toBe("Autopay Off");
  });
});

describe("reported owes", () => {
  test("a daily plan with two unpaid days is $100 and 1 day, on the board and on FLEET", () => {
    const payments = [paid("2026-11-16"), paid("2026-11-17"), paid("2026-11-18"), paid("2026-11-19")];
    const today = "2026-11-21";
    const standing = rentStanding({ today, nextPaymentDue: "2026-11-16", weeklyRate: 350, payments, dailyPlan: PLAN });
    const reported = reportedOwes({ today, payments, rental: { weekly_rate: 350, next_payment_due: "2026-11-16" }, dailyPlan: PLAN });
    expect(standing.rentOwed).toBe(100);
    expect(standing.overdueDays).toBe(1);
    expect(reported.rent_owed).toBe(standing.rentOwed);
    expect(reported.overdue_days).toBe(standing.overdueDays);
    expect(reported.total_owed).toBe(100);
    expect(reported.overdue_owed).toBe(100);
    const fact = (due: string): PaymentFact => ({
      rentalId: "r1", status: "paid", paidDate: due, dueDate: due, createdAt: due, stripeInvoiceId: null, stripePaymentIntentId: "pi_" + due,
      type: "rent", amount: 50,
    });
    const row = buildActiveRentalRows({
      today,
      rentals: [{ id: "r1", driverId: "d", driverName: "Regina Littles", applicationId: "a", vehicleId: null, vehicleLabel: "Car", startDate: "2026-11-16", weeklyRate: 350, nextPaymentDue: "2026-11-16" }],
      payments: { ok: true, rows: payments.map((p) => fact(p.dueDate)) },
      issues: { ok: true, rows: [] },
      incidents: { ok: true, rows: [] },
      documentDates: { ok: true, rows: [] },
      dailyPlans: new Map([["r1", PLAN]]),
    })[0];
    expect(row.rentOwed).toBe(reported.rent_owed);
    expect(row.overdueDays).toBe(reported.overdue_days);
  });

  test("an open failed week keeps rent plus late fees, and a paid week does not", () => {
    const payments = [
      { type: "rent", status: "failed", amount: 300, lateFees: 150, dueDate: "2026-11-12" },
      { type: "rent", status: "paid", amount: 300, dueDate: "2026-11-05" },
    ];
    const reported = reportedOwes({
      today: "2026-11-16",
      payments,
      rental: { weekly_rate: 300, next_payment_due: null, balance_due_cents: 0 },
      dailyPlan: null,
    });
    expect(reported.rent_owed).toBe(300);
    expect(reported.late_fees_owed).toBe(150);
    expect(reported.total_owed).toBe(450);
    expect(reported.overdue_owed).toBe(450);
    expect(reported.overdue_days).toBe(4);
  });
});
