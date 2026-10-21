import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DRIVER_PAYMENT_COLUMNS,
  DRIVER_PAYMENT_HISTORY_ENABLED,
  buildPaymentHistory,
  paymentDateLabel,
} from "../src/lib/driver-payment-history";

const lib = readFileSync("src/lib/driver-payment-history.ts", "utf8");
const fn = readFileSync("src/lib/driver-payment-history.functions.ts", "utf8");
const card = readFileSync("src/components/portal/DriverPaymentHistoryCard.tsx", "utf8");
const portal = readFileSync("src/routes/portal.tsx", "utf8");
const policy = readFileSync(
  "supabase/migrations/20260615003005_83c412ea-6b27-454b-86b1-9dedc64622cc.sql",
  "utf8",
);

function flagValue(source: string): string | null {
  const match = source.match(/const DRIVER_PAYMENT_HISTORY_ENABLED: boolean = (false|true)/);
  return match?.[1] ?? null;
}

describe("driver payment history flag", () => {
  it("is a hard false and the portal does not load the card", () => {
    assert.equal(DRIVER_PAYMENT_HISTORY_ENABLED, false);
    assert.equal(flagValue(lib), "false");
    assert.equal(flagValue(portal), "false");

    const handler = fn.slice(fn.indexOf(".handler("));
    const guard = handler.indexOf("assertDriverPaymentHistoryEnabled()");
    const request = handler.indexOf("getRequest(");
    const claims = handler.indexOf("auth.getClaims");
    const read = handler.indexOf('.from("');
    assert.ok(guard !== -1 && guard < request && request < claims && claims < read);

    const gate = portal.indexOf("DRIVER_PAYMENT_HISTORY_ENABLED !== true");
    const load = portal.indexOf('import("@/components/portal/DriverPaymentHistoryCard")');
    assert.ok(gate !== -1 && load > gate);
    assert.doesNotMatch(portal, /from "@\/lib\/driver-payment-history"|from "@\/components\/portal\/DriverPaymentHistoryCard"/);
    assert.match(portal, /<PaymentHistoryGate \/>/);

    for (const source of [lib, fn, card]) {
      assert.doesNotMatch(source, /supabaseAdmin|stripe\.|\.or\(`|\.filter\(`|\.insert\(|\.update\(|\.delete\(/);
    }
    assert.doesNotMatch(DRIVER_PAYMENT_COLUMNS, /stripe|notes|failure_reason/i);
    assert.match(fn, /\.from\("payments"\)/);
    assert.match(fn, /\.select\(DRIVER_PAYMENT_COLUMNS\)/);
    assert.match(fn, /\.eq\("driver_id", appIds\[0\]\)/);
    assert.match(policy, /Drivers can view their own payments/);
    assert.match(policy, /user_id = auth\.uid\(\)/);
    assert.match(card, /min-h-11/);
    assert.doesNotMatch(card, /uppercase|text-transform/);
  });
});

describe("driver payment history rows", () => {
  const own = "app-1";
  const rows = [
    {
      id: "p-paid",
      driver_id: own,
      paid_date: "2026-10-21",
      due_date: "2026-10-21",
      amount: 350,
      balance_due: 0,
      payment_method: "card",
      status: "paid",
    },
    {
      id: "p-due",
      driver_id: own,
      paid_date: null,
      due_date: "2026-10-28",
      amount: 350,
      balance_due: 175,
      payment_method: "ach",
      status: "current",
    },
    {
      id: "p-later",
      driver_id: own,
      due_date: "2026-11-04",
      amount: 350,
      balance_due: 350,
      payment_method: null,
      status: "upcoming",
    },
    {
      id: "p-other",
      driver_id: "app-2",
      paid_date: "2026-10-01",
      amount: 999,
      payment_method: "cash",
      status: "paid",
    },
  ];

  it("shows only this driver's past payments and the soonest amount due", () => {
    const view = buildPaymentHistory(rows, [own]);
    assert.deepEqual(
      view.past.map((item) => item.id),
      ["p-paid"],
    );
    assert.equal(view.past[0]?.dateLabel, "Oct 21, 2026");
    assert.equal(view.past[0]?.amountLabel, "$350.00");
    assert.equal(view.past[0]?.methodLabel, "Card");
    assert.equal(view.past[0]?.statusLabel, "Paid");
    assert.equal(view.upcoming?.id, "p-due");
    assert.equal(view.upcoming?.dateLabel, "Oct 28, 2026");
    assert.equal(view.upcoming?.amountLabel, "$175.00");
    assert.equal(view.upcoming?.methodLabel, "ACH");
    assert.equal(view.upcoming?.statusLabel, "Current");
    assert.doesNotMatch(JSON.stringify(view), /app-2|999|cash/i);
  });

  it("keeps a calendar date and shifts a timestamp into Eastern Time", () => {
    assert.equal(paymentDateLabel("2026-10-21"), "Oct 21, 2026");
    assert.equal(paymentDateLabel("2026-10-21T03:30:00.000Z"), "Oct 20, 2026");
    assert.equal(paymentDateLabel(""), "Not On File");
    const empty = buildPaymentHistory([], [own]);
    assert.equal(empty.upcoming, null);
    assert.deepEqual(empty.past, []);
    const foreignOnly = buildPaymentHistory([rows[3]], [own]);
    assert.equal(foreignOnly.upcoming, null);
    assert.deepEqual(foreignOnly.past, []);
  });
});
