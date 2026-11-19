// One rent standing for every payment display (Nov 19 2026): Schrita paid and
// still showed "3 Days"; Regina pays $50/day; Reservation Fees filtered as Fee.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { rentStanding, isRentRowCovered, readDailyPlans, activeDailyPlan, dailyRateLabel, type StandingPayment } from "../src/lib/rent-standing.ts";
import { paymentCategory, paymentCategoryLabel, PAYMENT_CATEGORIES, RESERVATION_ROW_TYPE } from "../src/lib/payment-category.ts";
import { buildActiveRentalRows, type PaymentFact } from "../src/lib/active-rentals.ts";
import { derivePaymentStatus } from "../src/lib/driver-payment-status.ts";

const p = (o: Partial<StandingPayment>): StandingPayment => ({ type: "rent", status: "paid", amount: 350, dueDate: null, ...o });

// Production rows as read Nov 19 2026 11:05 AM ET (amounts, dates, statuses only).
const SCHRITA_NOW = [
  p({ dueDate: "2026-11-02", paidDate: "2026-11-02" }),
  p({ dueDate: "2026-11-09", paidDate: "2026-11-09" }),
  p({ status: "overdue", dueDate: "2026-11-16", stripeInvoiceId: "in_1UcTbK" }),
  p({ type: "fee", dueDate: "2026-11-18", paidDate: "2026-11-18" }),
];
const SCHRITA_FIXED = SCHRITA_NOW.map((r) => (r.type === "fee" ? { ...r, type: "rent", dueDate: "2026-11-16" } : r));
const REGINA_NOW = [
  p({ dueDate: "2026-11-09", paidDate: "2026-11-14" }),
  p({ status: "overdue", dueDate: "2026-11-16" }),
  p({ type: "fee", amount: 50, dueDate: "2026-11-16" }),
  p({ type: "fee", amount: 50, dueDate: "2026-11-17" }),
  p({ type: "fee", amount: 50, dueDate: "2026-11-18" }),
];
const REGINA_FIXED = REGINA_NOW.map((r) => (r.type === "fee" ? { ...r, type: "rent" } : r));
const PLAN = { dailyRate: 50, startsOn: "2026-11-16" };

describe("weekly rent", () => {
  test("Schrita today: the $350 typed Fee settles nothing, so she reads 3 days (the bug, from data)", () => {
    const s = rentStanding({ today: "2026-11-19", nextPaymentDue: "2026-11-16", weeklyRate: 350, payments: SCHRITA_NOW });
    expect(s.overdueDays).toBe(3);
  });
  test("Schrita after the data fix (or the new webhook): Current, next due Nov 23, nothing owed", () => {
    const s = rentStanding({ today: "2026-11-19", nextPaymentDue: "2026-11-16", weeklyRate: 350, payments: SCHRITA_FIXED });
    expect(s.overdueDays).toBe(0);
    expect(s.nextDue).toBe("2026-11-23");
    expect(s.rentOwed).toBe(0);
    expect(s.coveredRows.length).toBe(1);
  });
  test("a rent payment dated in the same week (due+2) also covers it", () => {
    const rows = SCHRITA_NOW.map((r) => (r.type === "fee" ? { ...r, type: "rent" } : r));
    expect(isRentRowCovered(rows[2], rows)).toBe(true);
  });
  test("a partial payment does not cover the week and the rest stays owed", () => {
    const rows = [p({ status: "failed", dueDate: "2026-11-16" }), p({ amount: 100, dueDate: "2026-11-17" })];
    const s = rentStanding({ today: "2026-11-19", nextPaymentDue: "2026-11-16", weeklyRate: 350, payments: rows });
    expect(s.overdueDays).toBe(3);
    expect(s.rentOwed).toBe(250);
  });
  test("an older unpaid week still counts after next_payment_due moved on (Damon)", () => {
    const rows = [p({ status: "failed", dueDate: "2026-11-05" }), p({ dueDate: "2026-11-12" })];
    const s = rentStanding({ today: "2026-11-19", nextPaymentDue: "2026-11-19", weeklyRate: 350, payments: rows });
    expect(s.overdueDays).toBe(14);
  });
  test("due today and unpaid is Current but owes the week (James)", () => {
    const s = rentStanding({ today: "2026-11-19", nextPaymentDue: "2026-11-19", weeklyRate: 375, payments: [p({ amount: 375, dueDate: "2026-11-12" })] });
    expect(s.overdueDays).toBe(0);
    expect(s.rentOwed).toBe(375);
  });
  test("tolls and Reservation Fees never pay rent", () => {
    const rows = [p({ status: "overdue", dueDate: "2026-11-16" }), p({ type: "toll", dueDate: "2026-11-17" }), p({ type: "fee", reason: "reservation_fee", dueDate: "2026-11-17" })];
    expect(rentStanding({ today: "2026-11-19", nextPaymentDue: "2026-11-16", weeklyRate: 350, payments: rows }).overdueDays).toBe(3);
  });
});

describe("daily rent plan", () => {
  test("Regina after retyping: 3 days paid, owes today's $50, Current, no late fee", () => {
    const s = rentStanding({ today: "2026-11-19", nextPaymentDue: "2026-11-16", weeklyRate: 350, payments: REGINA_FIXED, dailyPlan: PLAN });
    expect(s.cadence).toBe("daily");
    expect(s.overdueDays).toBe(0);
    expect(s.rentOwed).toBe(50);
    expect(s.nextDue).toBe("2026-11-19");
    expect(s.daily?.paidThrough).toBe("2026-11-18");
    expect(s.supersededRows.length).toBe(1);
    expect(s.lateFeesApply).toBe(false);
  });
  test("Regina tomorrow without paying today: 1 day overdue, owes $100", () => {
    const s = rentStanding({ today: "2026-11-20", nextPaymentDue: "2026-11-16", weeklyRate: 350, payments: REGINA_FIXED, dailyPlan: PLAN });
    expect(s.overdueDays).toBe(1);
    expect(s.rentOwed).toBe(100);
  });
  test("Regina's $50 rows still typed Fee pay no rent (why the data fix retypes them)", () => {
    const s = rentStanding({ today: "2026-11-19", nextPaymentDue: "2026-11-16", weeklyRate: 350, payments: REGINA_NOW, dailyPlan: PLAN });
    expect(s.rentOwed).toBe(200);
    expect(s.overdueDays).toBe(3);
  });
  test("a plan that has not started or has ended is ignored", () => {
    expect(activeDailyPlan({ ...PLAN, startsOn: "2026-11-20" }, "2026-11-19")).toBe(null);
    expect(activeDailyPlan({ ...PLAN, endsOn: "2026-11-18" }, "2026-11-19")).toBe(null);
  });
  test("app_settings shape is validated", () => {
    const m = readDailyPlans({ a: { dailyRate: 50, startsOn: "2026-11-16" }, b: { dailyRate: 0, startsOn: "2026-11-16" }, c: { dailyRate: 50 } });
    expect([...m.keys()]).toEqual(["a"]);
    expect(readDailyPlans(null).size).toBe(0);
    expect(dailyRateLabel(50)).toBe("$50/Day");
  });
});

describe("payment type (category)", () => {
  test("Reservation Fee rows read as Reservation before and after the type migration", () => {
    expect(paymentCategory({ type: "fee", reason: "reservation_fee" })).toBe("reservation");
    expect(paymentCategory({ type: "fee", notes: "reservation_fee:d1266373" })).toBe("reservation");
    expect(paymentCategory({ type: "reservation" })).toBe("reservation");
    expect(paymentCategoryLabel({ type: "fee", reason: "reservation_fee" })).toBe("Reservation");
  });
  test("other types keep their own label; a plain fee stays Fee", () => {
    expect(paymentCategoryLabel({ type: "rent" })).toBe("Rent");
    expect(paymentCategoryLabel({ type: "late_fee" })).toBe("Late Fee");
    expect(paymentCategoryLabel({ type: "fee", reason: "Stripe payment" })).toBe("Fee");
    expect(paymentCategory({ type: "toll", reason: "reservation_fee" })).toBe("toll");
  });
  test("the filter offers Reservation, Rent and Fee; writers store 'reservation' now that the migration is applied", () => {
    for (const t of ["reservation", "rent", "fee", "deposit", "late_fee", "toll", "damage", "other"]) expect(PAYMENT_CATEGORIES).toContain(t as any);
    expect(RESERVATION_ROW_TYPE).toBe("reservation");
    const mig = readFileSync("proposed/payments-type-reservation-v1.sql", "utf8");
    expect(mig).toMatch(/'reservation'/);
    expect(mig).toMatch(/APPLIED on production Nov 19 2026/);
  });
});

describe("every display reads the same rule", () => {
  const fact = (o: Partial<PaymentFact>): PaymentFact => ({ rentalId: "r1", status: "paid", paidDate: null, dueDate: null, createdAt: "2026-11-01", stripeInvoiceId: null, stripePaymentIntentId: null, type: "rent", amount: 350, ...o });
  const board = (payments: PaymentFact[], plans?: Map<string, any>) => buildActiveRentalRows({
    today: "2026-11-19",
    rentals: [{ id: "r1", driverId: "d1", driverName: "X", applicationId: "a1", vehicleId: null, vehicleLabel: "Car", startDate: "2026-11-02", weeklyRate: 350, nextPaymentDue: "2026-11-16" }],
    payments: { ok: true, rows: payments }, issues: { ok: true, rows: [] }, incidents: { ok: true, rows: [] }, documentDates: { ok: true, rows: [] }, dailyPlans: plans,
  })[0];
  test("Bookings > Active: Schrita's paid week reads Current with next due Nov 23", () => {
    const row = board([
      fact({ dueDate: "2026-11-09", createdAt: "2026-11-09" }),
      fact({ status: "overdue", dueDate: "2026-11-16", createdAt: "2026-11-18T14:00", stripeInvoiceId: "in_x" }),
      fact({ dueDate: "2026-11-16", paidDate: "2026-11-18", createdAt: "2026-11-19T02:00", stripePaymentIntentId: "pi_x" }),
    ]);
    expect(row.overdueDays).toBe(0);
    expect(row.nextPaymentDue).toBe("2026-11-23");
    expect(row.lastPaymentStatus).toBe("paid");
    expect(row.rentOwed).toBe(0);
  });
  test("Bookings > Active: the Due cell describes rent, not the latest toll", () => {
    const row = board([fact({ status: "overdue", dueDate: "2026-11-16", createdAt: "2026-11-16" }), fact({ type: "toll", status: "paid", createdAt: "2026-11-18", amount: 5 })]);
    expect(row.lastPaymentStatus).toBe("overdue");
    expect(row.overdueDays).toBe(3);
  });
  test("Bookings > Active: a daily plan shows the rate and what is owed today", () => {
    const row = board([
      fact({ status: "overdue", dueDate: "2026-11-16" }),
      fact({ amount: 50, dueDate: "2026-11-16" }), fact({ amount: 50, dueDate: "2026-11-17" }), fact({ amount: 50, dueDate: "2026-11-18" }),
    ], new Map([["r1", PLAN]]));
    expect(row.cadence).toBe("daily");
    expect(row.dailyRate).toBe(50);
    expect(row.overdueDays).toBe(0);
    expect(row.rentOwed).toBe(50);
  });
  test("Drivers Payment column: a week paid on another row is Current, not Overdue", () => {
    const rows = [
      { rental_id: "r1", type: "rent", amount: 350, balance_due: 400, net_collected: null, refunded_amount: null, status: "overdue", due_date: "2026-11-16" },
      { rental_id: "r1", type: "rent", amount: 350, balance_due: 0, net_collected: null, refunded_amount: null, status: "paid", due_date: "2026-11-16" },
    ];
    expect(derivePaymentStatus([{ id: "r1", status: "active", deposit_amount: null, deposit_held: null, deposit_status: null, deposit_refund_amount: null }], rows, new Date("2026-11-19T16:00:00Z"))).toBe("current");
  });
  test("the Late amount only shows beside an overdue badge", () => {
    const src = readFileSync("src/components/admin/ActiveRentalsPanel.tsx", "utf8");
    expect(src).toMatch(/lateDue = \(fee\?\.lateFee \?\? 0\) > 0 && !fee\?\.waived && \(row\.overdueDays \?\? 0\) > 0/);
  });
  test("Payments: Type column and filter use the shared category; Outstanding skips weeks paid on another row", () => {
    const src = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
    expect(src).toMatch(/paymentCategoryLabel\(p\)/);
    expect(src).toMatch(/payments-type-filter-/);
    expect(src).toMatch(/OWED\.has\(p\.status as string\) && !coveredIds\.has\(p\.id\)/);
  });
  test("the rent reminders skip daily-plan renters and quote no late fee for them", () => {
    expect(readFileSync("src/lib/rent-reminders.server.ts", "utf8")).toMatch(/bump\(run, "daily_plan"\)/);
    expect(readFileSync("src/lib/rent-reminders.functions.ts", "utf8")).toMatch(/if \(s\.dailyPlan\)/);
  });
});
