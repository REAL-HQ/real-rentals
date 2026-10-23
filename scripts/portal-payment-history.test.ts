import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PORTAL_PAYMENT_HISTORY_ENABLED,
  asEasternCalendarDate,
  assertPortalPaymentHistoryEnabled,
  easternCalendarDate,
  paymentHistory,
} from "../src/lib/portal-payment-history";

describe("portal payment history", () => {
  it("lists paid, failed, and refunded newest first, with Eastern dates", () => {
    const items = paymentHistory([
      {
        id: "refund",
        status: "refunded",
        amount: "120.00",
        type: "fee",
        reason: "cleaning",
        paid_date: "2026-09-01",
        refunded_at: "2026-10-19T18:00:00Z",
        last_attempt_at: null,
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "fail-evening",
        status: "failed",
        amount: 50,
        type: "rent",
        reason: null,
        paid_date: null,
        refunded_at: null,
        last_attempt_at: "2026-10-21T03:30:00Z",
        created_at: "2026-10-01T00:00:00Z",
      },
      {
        id: "paid",
        status: "paid",
        amount: 350,
        type: "rent",
        reason: null,
        paid_date: "2026-10-21",
        refunded_at: null,
        last_attempt_at: null,
        created_at: "2026-10-15T00:00:00Z",
      },
      {
        id: "open",
        status: "pending",
        amount: 350,
        type: "rent",
        reason: null,
        paid_date: null,
        refunded_at: null,
        last_attempt_at: null,
        created_at: "2026-10-22T00:00:00Z",
      },
    ]);
    assert.deepEqual(
      items.map((item) => item.id),
      ["paid", "fail-evening", "refund"],
    );
    assert.equal(items[0].date, "2026-10-21");
    assert.equal(items[0].status, "paid");
    assert.equal(items[0].purpose, "Rent");
    assert.equal(items[0].amount, 350);
    assert.equal(items[1].date, "2026-10-20");
    assert.equal(items[1].status, "failed");
    assert.equal(items[2].status, "refunded");
    assert.equal(items[2].purpose, "Cleaning");
    assert.equal(items[2].amount, 120);
    assert.equal(items[2].date, "2026-10-19");
  });

  it("keeps a date-only paid day and omits a purpose that was not recorded", () => {
    assert.equal(asEasternCalendarDate("2026-10-21"), "2026-10-21");
    const [item] = paymentHistory([
      {
        id: "bare",
        status: "paid",
        amount: 10,
        type: null,
        reason: null,
        paid_date: "2026-10-21",
        refunded_at: null,
        last_attempt_at: null,
        created_at: null,
      },
    ]);
    assert.equal(item.date, "2026-10-21");
    assert.equal(item.purpose, null);
  });

  it("returns an empty list when there are no past payments", () => {
    assert.deepEqual(paymentHistory([]), []);
    assert.deepEqual(
      paymentHistory([
        {
          id: "late",
          status: "late",
          amount: 10,
          type: "rent",
          reason: "rent",
          paid_date: "2026-10-01",
          refunded_at: null,
          last_attempt_at: null,
          created_at: "2026-10-01T00:00:00Z",
        },
      ]),
      [],
    );
  });

  it("counts the Eastern day of a timestamp, including the evening before UTC midnight", () => {
    assert.equal(easternCalendarDate(new Date("2026-10-21T03:30:00Z")), "2026-10-20");
    assert.equal(easternCalendarDate(new Date("2026-10-21T04:00:00Z")), "2026-10-21");
  });
});

describe("portal payment history flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(PORTAL_PAYMENT_HISTORY_ENABLED, false);
    assert.throws(() => assertPortalPaymentHistoryEnabled(), /not enabled/);
  });

  it("refuses in the server handler before any scope lookup or query", () => {
    const src = readFileSync("src/lib/portal-payment-history.functions.ts", "utf8");
    const handler = src.slice(src.indexOf("handler(async"));
    const assertAt = handler.indexOf("assertPortalPaymentHistoryEnabled");
    const scopeAt = handler.indexOf("requireManager");
    const queryAt = handler.indexOf(".from(");
    assert.ok(assertAt >= 0, "handler asserts the flag");
    assert.ok(scopeAt > assertAt, "flag check precedes the preview role check");
    assert.ok(queryAt > assertAt, "flag check precedes queries");
    assert.match(handler, /context\.supabase/);
    assert.match(handler, /\.from\("payments"\)/);
    assert.match(handler, /\.in\("driver_id", appIds\)/);
    assert.match(handler, /\.in\("status", \["paid", "failed", "refunded"\]\)/);
    assert.doesNotMatch(src, /supabaseAdmin|portalScope|stripe|payRental|\.insert\(|\.update\(|\.delete\(/);
  });

  it("does not call the read while the flag is off", () => {
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    assert.match(portal, /enabled: PORTAL_PAYMENT_HISTORY_ENABLED === true/);
    assert.match(portal, /if \(PORTAL_PAYMENT_HISTORY_ENABLED !== true\) return null/);
  });

  it("renders a read-only list and an empty state", () => {
    const card = readFileSync("src/components/portal/PaymentHistoryCard.tsx", "utf8");
    assert.match(card, /Payment History/);
    assert.match(card, /No payments yet/);
    assert.match(card, /Paid/);
    assert.match(card, /Failed/);
    assert.match(card, /Refunded/);
    assert.doesNotMatch(card, /stripe|payRental|usePortalWrite|type=["']file["']/);
  });
});
