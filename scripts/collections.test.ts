// Collections tab, repo proration, Payments summary cards and the red Unpaid badge.
// Pure-logic and source-contract tests; the SQL behaviour is covered by collections-postgres.test.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import {
  COLLECTION_REASONS,
  COLLECTION_REASON_LABEL,
  COLLECTION_STATUSES,
  COLLECTION_STATUS_LABEL,
  collectionAttachmentPath,
  collectionBalance,
  collectionsTotal,
  daysLateAtRepo,
  isOpenCollectionStatus,
  prorateRepoWeek,
  prorationMath,
} from "../src/lib/collections";
import { buildPaymentsSummary, countsAsOwed, isOverdueRow, isRecentFailure, rowOwed, OVERDUE_STATUSES, OWED_STATUSES } from "../src/lib/payments-summary";
import { canTake, requiredTier, targetStatus, STATUS_MENU_OPTIONS } from "../src/lib/payment-status-rules";
import { UNPAID_RENT_STATUSES } from "../src/lib/rent-standing";
import { isOverduePayment } from "../src/lib/overview-today";
import { COLLECTIONS_WATCH_STATUSES } from "../src/lib/collections-watch";
import { toneFor } from "../src/components/admin/ui";
import { UNPAID_STATUSES } from "../src/lib/payment-reminders";

const read = (p: string) => readFileSync(p, "utf8");

describe("Collections labels", () => {
  test("every reason and status has a Title Case label", () => {
    expect(COLLECTION_REASONS.map((r) => COLLECTION_REASON_LABEL[r])).toEqual([
      "Unpaid Rent", "Late Fees", "Key Replacement", "Damage", "Tolls & Tickets", "Towing/Repo", "Cleaning", "Other",
    ]);
    expect(COLLECTION_STATUSES.map((s) => COLLECTION_STATUS_LABEL[s])).toEqual([
      "Open", "Payment Plan", "Sent To Collections", "Paid", "Settled", "Written Off",
    ]);
  });
  test("only Open, Payment Plan and Sent To Collections still owe", () => {
    expect(COLLECTION_STATUSES.filter(isOpenCollectionStatus)).toEqual(["open", "payment_plan", "sent_to_collections"]);
    const items = [
      { amount: 150, amount_paid: 0, status: "open" },
      { amount: 100, amount_paid: 40, status: "payment_plan" },
      { amount: 150, amount_paid: 0, status: "written_off" },
      { amount: 90, amount_paid: 0, status: "settled" },
    ];
    expect(collectionBalance(items[1])).toBe(60);
    expect(collectionsTotal(items)).toBe(210);
  });
  test("attachments live under collections/<itemId>/", () => {
    const p = collectionAttachmentPath("6f1f8f7e-1111-4222-8333-944445555666", "Key Receipt (1).PDF", 1700000000000);
    expect(p.startsWith("collections/6f1f8f7e-1111-4222-8333-944445555666/")).toBe(true);
    expect(p).not.toContain(" ");
  });
});

describe("Repo proration", () => {
  test("Heather: week of Nov 17, repo Nov 19 = 3 days = $150 of $350", () => {
    const p = prorateRepoWeek({ weeklyRate: 350, originalAmount: 350, weekStart: "2026-11-17", repoDate: "2026-11-19" });
    expect(p).toMatchObject({ days: 3, dailyRate: 50, amount: 150, originalAmount: 350, prorated: true });
    expect(daysLateAtRepo("2026-11-17", "2026-11-19")).toBe(2);
  });
  test("alternative repo Nov 18 = 2 days = $100, 1 day late", () => {
    expect(prorateRepoWeek({ weeklyRate: 350, originalAmount: 350, weekStart: "2026-11-17", repoDate: "2026-11-18" }).amount).toBe(100);
    expect(daysLateAtRepo("2026-11-17", "2026-11-18")).toBe(1);
  });
  test("repo before the week starts owes nothing; on day 7 or later owes the full week", () => {
    expect(prorateRepoWeek({ weeklyRate: 350, originalAmount: 350, weekStart: "2026-11-17", repoDate: "2026-11-16" }).amount).toBe(0);
    const full = prorateRepoWeek({ weeklyRate: 350, originalAmount: 350, weekStart: "2026-11-17", repoDate: "2026-11-25" });
    expect(full).toMatchObject({ days: 7, amount: 350, prorated: false });
  });
  test("never more than the original row (partly paid week)", () => {
    expect(prorateRepoWeek({ weeklyRate: 350, originalAmount: 120, weekStart: "2026-11-17", repoDate: "2026-11-19" }).amount).toBe(120);
  });
  test("the item shows rate, days, prorated amount and what it replaces", () => {
    expect(prorationMath({ weekly_rate: "350", days: 3, prorated_amount: "150", original_amount: "350" })).toBe(
      "$350.00/week ÷ 7 × 3 days = $150.00 (replaces $350.00)",
    );
    expect(prorationMath(null)).toBeNull();
  });
});

describe("Collections is not Overdue, not Outstanding, not unpaid rent", () => {
  test("status sets", () => {
    expect(OVERDUE_STATUSES.has("collections")).toBe(false);
    expect(OWED_STATUSES.has("collections")).toBe(false);
    expect((COLLECTIONS_WATCH_STATUSES as readonly string[]).includes("collections")).toBe(false);
    expect(UNPAID_RENT_STATUSES.has("collections")).toBe(false);
    expect(isOverduePayment({ status: "collections", type: "rent", due_date: "2026-11-17" }, "2026-11-22")).toBe(false);
    expect(isOverduePayment({ status: "overdue", type: "rent", due_date: "2026-11-17" }, "2026-11-22")).toBe(true);
  });
  test("late fees, reminders and the failed-invoice webhook skip Collections rows", () => {
    const lateFees = read("src/lib/late-fees.server.ts");
    const accrues = /\.in\("status", (\[[^\]]+\])\)/.exec(lateFees)?.[1] ?? "";
    expect(accrues).toContain("overdue");
    expect(accrues).not.toContain("collections");
    expect((UNPAID_STATUSES as readonly string[]).includes("collections")).toBe(false);
    expect(read("src/routes/api/public/payments/webhook.ts")).toMatch(/\.neq\(["']status["'], ?["']collections["']\)/);
  });
  test("the migration excludes Collections from automatic messages by status, and the portal can still pay it", () => {
    const sql = read("supabase/migrations/20261122143000_collections.sql");
    expect(sql).toContain("payments_keep_in_collections");
    expect(sql).toContain("apply_payment_to_collections");
  });
});

describe("Payments status rules: Collections rows", () => {
  test("only Mark Paid is offered from Collections; nothing moves a row into it by hand", () => {
    expect(requiredTier("set_open_status", "collections")).toBeNull();
    expect(requiredTier("void", "collections")).toBeNull();
    expect(requiredTier("waive", "collections")).toBeNull();
    expect(canTake("manager", "mark_paid", "collections")).toBe(true);
    expect(canTake("coordinator", "mark_paid", "collections")).toBe(false);
    expect(targetStatus("set_open_status", "overdue", "collections")).toBeNull();
    expect((STATUS_MENU_OPTIONS as readonly string[]).includes("collections")).toBe(false);
  });
});

describe("Payments summary cards", () => {
  const now = new Date("2026-11-22T15:00:00Z"); // Sunday Nov 22, 10 AM ET
  const payments = [
    { id: "a", driver_id: "d1", rental_id: "r1", type: "rent", status: "overdue", amount: 350, balance_due: 450, due_date: "2026-11-17" },
    { id: "b", driver_id: "d2", rental_id: "r2", type: "rent", status: "failed", amount: 300, balance_due: null, due_date: "2026-11-20", failure_reason: "card_declined", last_attempt_at: "2026-11-21T14:00:00Z" },
    { id: "c", driver_id: "d3", rental_id: "r3", type: "rent", status: "collections", amount: 350, balance_due: 350, due_date: "2026-11-10" },
    { id: "d", driver_id: "d1", rental_id: "r1", type: "rent", status: "overdue", amount: 350, balance_due: 350, due_date: "2026-11-19" },
    { id: "e", driver_id: "d4", rental_id: "r4", type: "rent", status: "paid", amount: 400, net_collected: 400, paid_date: "2026-11-18", due_date: "2026-11-18" },
    { id: "f", driver_id: "d5", rental_id: "r5", type: "rent", status: "failed", amount: 200, due_date: "2026-11-01", last_attempt_at: "2026-11-10T12:00:00Z" },
    { id: "g", driver_id: "d4", rental_id: null, type: "deposit", status: "paid", amount: 99, paid_date: "2026-11-19" },
  ];
  const covered = new Set(["d"]);
  const rentals = [
    { id: "r4", status: "active", next_payment_due: "2026-11-25", weekly_rate: 400, autopay_active: true, stripe_subscription_id: "sub_x" },
    { id: "r6", status: "active", next_payment_due: "2026-11-23", weekly_rate: 325, autopay_active: false, stripe_subscription_id: null },
    { id: "r7", status: "active", next_payment_due: "2026-12-10", weekly_rate: 500, autopay_active: true, stripe_subscription_id: "sub_y" },
    { id: "r8", status: "closed", next_payment_due: "2026-11-24", weekly_rate: 300 },
  ];
  const items = [
    { application_id: "d3", amount: 150, amount_paid: 0, status: "open" },
    { application_id: "d3", amount: 100, amount_paid: 0, status: "open" },
    { application_id: "d9", amount: 500, amount_paid: 0, status: "written_off" },
  ];
  const s = buildPaymentsSummary({ payments, coveredIds: covered, rentals, collectionItems: items, now });

  test("Overdue Now matches the Overdue filter rows with the Outstanding owed rule, without Collections or covered rows", () => {
    const rows = payments.filter((p) => isOverdueRow(p) && !covered.has(p.id) && rowOwed(p) > 0);
    expect(s.overdue.total).toBe(rows.reduce((t, p) => t + rowOwed(p), 0));
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b", "f"]);
    expect(s.overdue.renters).toBe(3);
    expect(s.overdue.oldestDaysLate).toBe(21);
  });
  test("Overdue Now never exceeds Outstanding (same owed rule)", () => {
    const outstanding = payments.filter((p) => countsAsOwed(p, covered)).reduce((t, p) => t + rowOwed(p), 0);
    expect(s.overdue.total).toBeLessThanOrEqual(outstanding);
    expect(payments.filter((p) => countsAsOwed(p, covered)).some((p) => p.status === "collections")).toBe(false);
  });
  test("Due This Week splits autopay and link/manual over the next 7 days", () => {
    expect(s.dueThisWeek).toEqual({ total: 725, autopay: 400, manual: 325, count: 2 });
  });
  test("Collected This Week counts paid rent since Monday, not the Reservation Fee", () => {
    expect(s.collectedThisWeek.weekStart).toBe("2026-11-16");
    expect(s.collectedThisWeek.collected).toBe(400);
    expect(s.collectedThisWeek.expected).toBeGreaterThanOrEqual(400);
  });
  test("In Collections counts only open lines", () => {
    expect(s.inCollections).toEqual({ total: 250, renters: 1 });
    expect(buildPaymentsSummary({ payments, coveredIds: covered, collectionItems: null, now }).inCollections).toBeNull();
  });
  test("Failed Payments only within the last 3 days", () => {
    expect(s.failedRecent).toEqual({ count: 1, total: 300 });
    expect(isRecentFailure(payments[5], now)).toBe(false);
  });
  test("the panel renders the cards from the same rows and wires the clicks", () => {
    const src = read("src/components/admin/PaymentsPanel.tsx");
    expect(src).toContain("buildPaymentsSummary(");
    expect(src).toContain('setStatusFilter("overdue")');
    expect(src).toContain("setStatusFilter(FAILED_RECENT_FILTER)");
    expect(src).toContain('setPaymentsSection("collections")');
    const cards = read("src/components/admin/PaymentSummaryCards.tsx");
    for (const label of ["Overdue Now", "Due This Week", "Collected This Week", "In Collections", "Failed Payments"]) expect(cards).toContain(label);
    expect(cards).toContain("failedRecent.count > 0 ?");
  });
});

describe("Unpaid badge is red like Overdue", () => {
  test("toneFor", () => {
    expect(toneFor("unpaid")).toBe("red");
    expect(toneFor("Unpaid")).toBe("red");
    expect(toneFor("overdue")).toBe("red");
    expect(toneFor("collections")).toBe("red");
    expect(toneFor("paid")).toBe("green");
  });
  test("renter portal payment history badge", () => {
    expect(read("src/routes/portal.tsx")).toMatch(/unpaid/);
  });
});

describe("Collections UI contracts", () => {
  test("vehicle shows thumbnail + plate + VIN6, never the unit number", () => {
    const src = read("src/components/admin/CollectionsPanel.tsx");
    expect(src).toContain("LinkedVehicleCell");
    expect(src).not.toMatch(/unit_number|unitNumber/);
  });
  test("profile card links each line to Payments > Collections, Managers and Owners only", () => {
    const card = read("src/components/admin/CollectionsCard.tsx");
    expect(card).toContain('filter: "collections-tab"');
    const drivers = read("src/components/admin/DriversPanel.tsx");
    expect(drivers.match(/<CollectionsCard applicationId=\{driver\.id\} canSee=\{isOwner \|\| isManager\} \/>/g)?.length).toBe(2);
  });
  test("server functions require a Manager", () => {
    const fns = read("src/lib/collections.functions.ts");
    expect(fns).toContain("requireManager");
    expect(fns.match(/= createServerFn\(/g)?.length).toBe(fns.match(/await manager\(context\.userId\)/g)?.length);
  });
  test("Heather backfill is proposed only", () => {
    expect(existsSync("proposed/collections/01-heather-bell-collections.sql")).toBe(true);
    expect(existsSync("supabase/migrations/20261122143000_collections.sql")).toBe(true);
    const files = require("node:fs").readdirSync("supabase/migrations") as string[];
    expect(files.some((f) => /heather/i.test(f))).toBe(false);
  });
});
