import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PORTAL_PAYMENT_HISTORY_ENABLED } from "../src/lib/portal-payment-history-flag";
import {
  buildPortalPaymentHistory,
  receiptText,
  verifiedSourceLabel,
  type HistoryRow,
} from "../src/lib/portal-payment-history";

const flag = readFileSync("src/lib/portal-payment-history-flag.ts", "utf8");
const rules = readFileSync("src/lib/portal-payment-history.ts", "utf8");
const fn = readFileSync("src/lib/portal-payment-history.functions.ts", "utf8");
const panel = readFileSync("src/components/portal/PortalPaymentHistory.tsx", "utf8");
const portal = readFileSync("src/routes/portal.tsx", "utf8");

function row(over: Partial<HistoryRow> & { id: string }): HistoryRow {
  return {
    type: "rent",
    status: "paid",
    amount: 250,
    balance_due: 0,
    net_collected: 250,
    refunded_amount: 0,
    due_date: "2026-10-01",
    paid_date: "2026-10-01",
    created_at: "2026-10-01T12:00:00.000Z",
    payment_method: "cash",
    ...over,
  };
}

describe("portal payment history", () => {
  it("stays off and refuses before auth, ownership, and reads", () => {
    assert.equal(PORTAL_PAYMENT_HISTORY_ENABLED, false);
    assert.equal((flag.match(/const PORTAL_PAYMENT_HISTORY_ENABLED/g) ?? []).length, 1);
    assert.match(flag, /export const PORTAL_PAYMENT_HISTORY_ENABLED: boolean = false as boolean/);
    assert.doesNotMatch(flag, /process\.env/);
    for (const source of [rules, fn, panel, portal]) {
      assert.equal((source.match(/const PORTAL_PAYMENT_HISTORY_ENABLED/g) ?? []).length, 0);
    }

    const middleware = fn.match(/\.middleware\(\[([^\]]+)\]/);
    assert.equal(middleware?.[1].replace(/\s/g, ""), "portalPaymentHistoryGate,requireSupabaseAuth");
    const gateBody = fn.slice(fn.indexOf("const portalPaymentHistoryGate"), fn.indexOf("export const getPortalPaymentHistory"));
    assert.match(gateBody, /PORTAL_PAYMENT_HISTORY_ENABLED !== true/);
    assert.doesNotMatch(gateBody, /requireSupabaseAuth|supabaseAdmin|context\.userId/);
    const handler = fn.slice(fn.indexOf(".handler"));
    const thrown = handler.indexOf("PORTAL_PAYMENT_HISTORY_ENABLED !== true");
    const user = handler.indexOf("context.userId");
    const read = handler.indexOf('import("@/integrations/supabase/client.server")');
    assert.ok(thrown !== -1 && user !== -1 && read !== -1 && thrown < user && user < read);
    assert.doesNotMatch(fn, /previewDriverId|data\.id|input\./);
    assert.match(fn, /ownedIds\(supabaseAdmin, "applications", "user_id", userId\)/);
    assert.match(fn, /ownedIds\(supabaseAdmin, "rentals", "driver_id", userId\)/);
    assert.match(fn, /\.eq\(column, userId\)/);
    assert.match(fn, /HISTORY_CHUNK/);
    assert.match(fn, /HISTORY_READ_CAP \+ 1/);
    assert.doesNotMatch(fn, /sendEmail|sendSms|stripe|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.match(portal, /PORTAL_PAYMENT_HISTORY_ENABLED === true \? <PortalPaymentHistory \/>/);
    assert.match(panel, /if \(PORTAL_PAYMENT_HISTORY_ENABLED !== true\) return null/);
    assert.match(panel, /Download Receipt/);
    assert.doesNotMatch(panel, /reason\.message|previewDriverId|text-transform|uppercase/);
    assert.doesNotMatch(portal, /from ["']@\/lib\/portal-payment-history\.functions["']/);
  });

  it("lists every charge, verified payments from each known source, and the open balance", () => {
    for (const method of ["card", "stripe", "ach", "cash", "zelle", "venmo", "cash_app", "bank", "check", "money_order", "other"]) {
      assert.ok(verifiedSourceLabel(method));
    }
    assert.equal(verifiedSourceLabel("mystery"), null);
    assert.equal(verifiedSourceLabel(null), null);

    const history = buildPortalPaymentHistory({
      truncated: false,
      rows: [
        row({ id: "cash", payment_method: "cash", amount: 200, net_collected: 200, balance_due: 0, status: "paid" }),
        row({ id: "card", payment_method: "Card", amount: 250, net_collected: 250, balance_due: 0, status: "paid", created_at: "2026-10-08T00:00:00.000Z" }),
        row({ id: "zelle", payment_method: "zelle", amount: 100, net_collected: 100, balance_due: 0, status: "refunded", refunded_amount: 40 }),
        row({ id: "open", payment_method: null, amount: 250, net_collected: 0, balance_due: 80, status: "past_due", paid_date: null }),
        row({ id: "unknown", payment_method: "bitcoin", amount: 50, net_collected: 50, balance_due: 0, status: "paid" }),
        row({ id: "deposit", type: "deposit", payment_method: "cash", amount: 500, net_collected: 500, balance_due: 0, status: "paid" }),
        row({ id: "void", payment_method: null, amount: 10, balance_due: 10, status: "void" }),
      ],
    });

    assert.deepEqual(history.charges.map((charge) => charge.id), ["card", "cash", "deposit", "open", "unknown", "void", "zelle"]);
    assert.deepEqual(history.payments.map((payment) => payment.id), ["card", "cash", "deposit", "zelle"]);
    assert.deepEqual(history.payments.map((payment) => payment.sourceLabel), ["Card", "Cash", "Cash", "Zelle"]);
    assert.equal(history.balanceDue, 80);
    assert.equal(history.truncated, false);
    const receipt = receiptText(history.payments[1]);
    assert.match(receipt, /Receipt cash/);
    assert.match(receipt, /Source: Cash/);
    assert.doesNotMatch(receipt, /bitcoin|card_last4|stripe|@/i);

    const capped = buildPortalPaymentHistory({ truncated: true, rows: [row({ id: "open", status: "past_due", balance_due: 80, payment_method: null, paid_date: null })] });
    assert.equal(capped.balanceDue, null);
    assert.equal(capped.truncated, true);
  });
});
