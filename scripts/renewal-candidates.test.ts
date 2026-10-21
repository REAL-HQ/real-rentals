import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { railEntries, resolveAdminTab, TABS, visibleTabs } from "../src/components/admin/nav-config";
import { RENEWAL_CANDIDATES_ENABLED } from "../src/lib/renewal-candidates-flag";
import { buildRenewalsDue, hasGoodPaymentHistory, isPaidLate, type RenewalRental } from "../src/lib/renewals-due";

const flag = readFileSync("src/lib/renewal-candidates-flag.ts", "utf8");
const board = readFileSync("src/lib/renewals-due.ts", "utf8");
const fn = readFileSync("src/lib/renewals-due.functions.ts", "utf8");
const panel = readFileSync("src/components/admin/RenewalsDue.tsx", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");

function rental(over: Partial<RenewalRental> & { id: string }): RenewalRental {
  return {
    status: "active",
    driver_id: null,
    application_id: "app-1",
    vehicle_id: "veh-1",
    weekly_rate: 250,
    end_date: null,
    next_payment_due: null,
    ...over,
  };
}

describe("renewal history on Renewal Due", () => {
  it("keeps the switch false and does not add a second screen", () => {
    assert.equal(RENEWAL_CANDIDATES_ENABLED, false);
    assert.equal((flag.match(/const RENEWAL_CANDIDATES_ENABLED/g) ?? []).length, 1);
    assert.match(flag, /export const RENEWAL_CANDIDATES_ENABLED: boolean = false as boolean/);
    assert.doesNotMatch(flag, /process\.env/);
    for (const source of [board, fn, panel, nav, admin]) {
      assert.equal((source.match(/const RENEWAL_CANDIDATES_ENABLED/g) ?? []).length, 0);
    }
    assert.equal(existsSync("src/components/admin/RenewalCandidates.tsx"), false);
    assert.equal(existsSync("src/lib/renewal-candidates.ts"), false);
    assert.equal(existsSync("src/lib/renewal-candidates.server.ts"), false);
    assert.equal(existsSync("src/lib/renewal-candidates.functions.ts"), false);
    assert.equal(TABS.some((tab) => tab.id === "renewal_candidates"), false);
    for (const tier of ["coordinator", "manager", "owner"] as const) {
      assert.equal(visibleTabs(tier).some((tab) => tab.id === "renewal_candidates"), false);
      assert.equal(railEntries(tier).some((tab) => tab.id === "renewal_candidates"), false);
    }
    assert.equal(resolveAdminTab({ urlTab: "renewal_candidates", tier: "manager", navTabs: [] }), "overview");
    assert.doesNotMatch(admin, /renewal_candidates|RenewalCandidates/);
    assert.doesNotMatch(nav, /renewal_candidates|Renewal Candidates/);
    assert.doesNotMatch(panel, /reason\.message|reason instanceof Error/);
    assert.match(panel, /Could Not Load Renewal Due/);
    const controls = panel.indexOf("Good Payment History");
    const days = panel.indexOf("14 Days");
    const column = panel.indexOf("Paid Charges");
    const gate = panel.indexOf("RENEWAL_CANDIDATES_ENABLED === true");
    assert.ok(gate !== -1 && controls > gate && days > gate && column > gate);
    assert.match(fn, /RENEWAL_CANDIDATES_ENABLED === true/);
    assert.match(fn, /PAYMENT_HISTORY_COLUMNS/);
    assert.match(fn, /paymentsTruncated/);
    assert.doesNotMatch(fn, /Renewal candidates could not be listed/);
    assert.doesNotMatch(fn, /sendEmail|sendSms|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("treats unknown, current, and paid-late rent charges as not clean, and ignores deposits", () => {
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent" }, { status: "waived", type: "rent" }]), true);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent" }, { status: "pending", type: "rent" }]), true);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent" }, { status: "upcoming", type: "rent" }]), true);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent" }, { status: "refunded", type: "rent" }]), true);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent" }, { status: "void", type: "rent" }]), true);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent" }, { status: "current", type: "rent" }]), false);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent" }, { status: "mystery", type: "rent" }]), false);
    assert.equal(hasGoodPaymentHistory([{ status: "upcoming", type: "rent" }]), false);
    assert.equal(hasGoodPaymentHistory([{ status: "refunded", type: "rent" }]), false);
    assert.equal(hasGoodPaymentHistory([]), false);
    assert.equal(hasGoodPaymentHistory([{ status: "failed", type: "deposit" }, { status: "paid", type: "rent" }]), true);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "deposit" }]), false);
    for (const status of ["failed", "late", "overdue", "past_due", "unpaid", "collections", "current"]) {
      assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent" }, { status, type: "rent" }]), false);
    }
    const late = { status: "paid", type: "rent", late_fees: 25, due_date: "2026-10-01", paid_date: "2026-10-01" };
    assert.equal(isPaidLate(late), true);
    assert.equal(hasGoodPaymentHistory([late]), false);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent", paid_date: "2026-10-02", due_date: "2026-10-01" }]), false);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent", attempt_count: 2 }]), false);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent", failure_reason: "card declined" }]), false);
    assert.equal(hasGoodPaymentHistory([{ status: "paid", type: "rent", attempt_count: 1, late_fees: 0 }]), true);
  });

  it("adds the 14-day window, the filter, and paid charges only when history is enabled", () => {
    const today = "2026-10-21";
    const shared = {
      today,
      applications: [{ id: "app-1", full_name: "Ada Lopez" }],
      vehicles: [{ id: "veh-1", year: 2020, make: "Toyota", model: "Camry", unit_number: "12", license_plate: null }],
      payments: [
        { id: "p1", rental_id: "soon", status: "paid", type: "rent", created_at: "2026-10-01T00:00:00.000Z", late_fees: 0, attempt_count: 1 },
        { id: "p2", rental_id: "soon", status: "void", type: "rent", created_at: "2026-09-01T00:00:00.000Z" },
        { id: "p3", rental_id: "late", status: "paid", type: "rent", created_at: "2026-10-02T00:00:00.000Z" },
        { id: "p4", rental_id: "late", status: "current", type: "rent", created_at: "2026-10-03T00:00:00.000Z" },
        { id: "p5", rental_id: "edge", status: "paid", type: "rent", created_at: "2026-10-01T00:00:00.000Z" },
        { id: "dep", rental_id: "soon", status: "failed", type: "deposit", created_at: "2026-10-04T00:00:00.000Z" },
      ],
    };
    const rentals = [
      rental({ id: "soon", end_date: "2026-10-23", next_payment_due: "2026-11-01" }),
      rental({ id: "edge", end_date: "2026-11-04", next_payment_due: "2026-11-20" }),
      rental({ id: "late", end_date: "2026-10-25", next_payment_due: "2026-11-01" }),
    ];
    const closed = buildRenewalsDue({ ...shared, rentals, historyEnabled: false, windowDays: 14, goodHistoryOnly: true });
    assert.deepEqual(closed.rows.map((row) => row.rentalId), ["soon", "late"]);
    assert.equal(closed.through, "2026-10-28");
    assert.equal(closed.rows[0].paidCharges, null);
    assert.equal(closed.rows[0].goodPaymentHistory, null);

    const open = buildRenewalsDue({ ...shared, rentals, historyEnabled: true, windowDays: 14 });
    assert.deepEqual(open.rows.map((row) => row.rentalId), ["soon", "late", "edge"]);
    assert.equal(open.through, "2026-11-04");
    assert.equal(open.rows[0].paidCharges, 1);
    assert.equal(open.rows[0].goodPaymentHistory, true);
    assert.equal(open.rows[1].goodPaymentHistory, false);

    const filtered = buildRenewalsDue({ ...shared, rentals, historyEnabled: true, windowDays: 14, goodHistoryOnly: true });
    assert.deepEqual(filtered.rows.map((row) => row.rentalId), ["soon", "edge"]);

    const capped = buildRenewalsDue({
      ...shared,
      rentals: [rental({ id: "soon", end_date: "2026-10-23" })],
      historyEnabled: true,
      paymentsTruncated: true,
      goodHistoryOnly: true,
    });
    assert.deepEqual(capped.rows.map((row) => row.rentalId), []);
    assert.equal(capped.paymentsTruncated, true);
  });
});
