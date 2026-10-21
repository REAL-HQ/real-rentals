import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PORTAL_PAYMENT_HISTORY_ENABLED,
  asEasternCalendarDate,
  buildPortalPaymentHistory,
  easternCalendarDate,
  formatHistoryCents,
  readOwnPaymentHistory,
  receiptText,
  verifiedPaymentSource,
  verifiedSourceLabel,
  type HistoryRow,
} from "../src/lib/portal-payment-history";

const rules = readFileSync("src/lib/portal-payment-history.ts", "utf8");
const fn = readFileSync("src/lib/portal-payment-history.functions.ts", "utf8");
const panel = readFileSync("src/components/portal/PaymentHistoryCard.tsx", "utf8");
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
    stripe_payment_intent_id: null,
    stripe_invoice_id: null,
    ...over,
  };
}

describe("portal payment history", () => {
  it("stays off and refuses before auth, ownership, and reads", () => {
    assert.equal(PORTAL_PAYMENT_HISTORY_ENABLED, false);
    assert.equal((rules.match(/const PORTAL_PAYMENT_HISTORY_ENABLED/g) ?? []).length, 1);
    assert.match(rules, /export const PORTAL_PAYMENT_HISTORY_ENABLED: boolean = false as boolean/);
    assert.doesNotMatch(rules, /process\.env/);
    for (const source of [fn, panel, portal]) {
      assert.equal((source.match(/const PORTAL_PAYMENT_HISTORY_ENABLED/g) ?? []).length, 0);
    }
    assert.doesNotMatch(portal, /DRIVER_PAYMENT_HISTORY_ENABLED|DriverPaymentHistoryCard|PaymentHistoryGate|PortalPaymentHistory/);
    assert.equal((portal.match(/<PaymentHistoryCard \/>/g) ?? []).length, 1);

    const middleware = fn.match(/\.middleware\(\[([^\]]+)\]/);
    assert.equal(middleware?.[1].replace(/\s/g, ""), "portalPaymentHistoryGate,requireSupabaseAuth");
    const gateBody = fn.slice(fn.indexOf("const portalPaymentHistoryGate"), fn.indexOf("export const getPortalPaymentHistory"));
    assert.match(gateBody, /PORTAL_PAYMENT_HISTORY_ENABLED !== true/);
    assert.doesNotMatch(gateBody, /requireSupabaseAuth|supabaseAdmin|context\.userId/);
    const handler = fn.slice(fn.indexOf(".handler"));
    const thrown = handler.indexOf("PORTAL_PAYMENT_HISTORY_ENABLED !== true");
    const user = handler.indexOf("context.userId");
    const read = handler.indexOf("readOwnPaymentHistory(context.supabase, userId)");
    assert.ok(thrown !== -1 && user !== -1 && read !== -1 && thrown < user && user < read);
    assert.doesNotMatch(fn, /previewDriverId|data\.id|input\.|supabaseAdmin|client\.server|rentals/);
    assert.doesNotMatch(rules, /\.from\("rentals"\)|\.in\("rental_id"/);
    assert.match(rules, /\.eq\("user_id", userId\)/);
    assert.match(rules, /\.in\("driver_id", group\)/);
    assert.match(rules, /HISTORY_CHUNK/);
    assert.match(rules, /HISTORY_READ_CAP \+ 1/);
    assert.doesNotMatch(fn, /sendEmail|sendSms|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.match(portal, /PORTAL_PAYMENT_HISTORY_ENABLED === true && previewId == null \? <PaymentHistoryCard \/>/);
    assert.match(panel, /if \(PORTAL_PAYMENT_HISTORY_ENABLED !== true\) return null/);
    assert.match(panel, /Download Receipt/);
    assert.match(panel, /Unknown/);
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
        row({ id: "card", payment_method: "Card", amount: 250, net_collected: 250, balance_due: 0, status: "paid", created_at: "2026-10-08T00:00:00.000Z", stripe_payment_intent_id: "pi_card" }),
        row({ id: "card-unlinked", payment_method: "ach", amount: 40, net_collected: 40, balance_due: 0, status: "paid", created_at: "2026-10-07T00:00:00.000Z" }),
        row({ id: "zelle", payment_method: "zelle", amount: 100, net_collected: 100, balance_due: 0, status: "refunded", refunded_amount: 40 }),
        row({ id: "open", payment_method: null, amount: 250, net_collected: 0, balance_due: 80, status: "past_due", paid_date: null }),
        row({ id: "unknown", payment_method: "bitcoin", amount: 50, net_collected: 50, balance_due: 0, status: "paid" }),
        row({ id: "deposit", type: "deposit", payment_method: "cash", amount: 500, net_collected: 500, balance_due: 0, status: "paid" }),
        row({ id: "void", payment_method: null, amount: 10, balance_due: 10, status: "void" }),
      ],
    });

    assert.deepEqual(history.charges.map((charge) => charge.id), ["card", "card-unlinked", "cash", "deposit", "open", "unknown", "void", "zelle"]);
    assert.deepEqual(history.payments.map((payment) => payment.id), ["card", "cash", "deposit", "zelle"]);
    assert.deepEqual(history.payments.map((payment) => payment.sourceLabel), ["Card", "Cash", "Cash", "Zelle"]);
    assert.equal(verifiedPaymentSource(row({ id: "bare-card", payment_method: "card" })), null);
    assert.equal(verifiedPaymentSource(row({ id: "invoiced", payment_method: "ach", stripe_invoice_id: "in_1" })), "Card");
    assert.equal(history.balanceDueCents, 8000);
    assert.equal(history.balanceState, "known");
    assert.equal(history.truncated, false);
    const receipt = receiptText(history.payments[1]);
    assert.match(receipt, /Receipt cash/);
    assert.match(receipt, /Source: Cash/);
    assert.match(receipt, /Amount: \$200\.00/);
    assert.doesNotMatch(receipt, /bitcoin|card_last4|pi_|stripe|@/i);

    const capped = buildPortalPaymentHistory({ truncated: true, rows: [row({ id: "open", status: "past_due", balance_due: 80, payment_method: null, paid_date: null })] });
    assert.equal(capped.balanceDueCents, null);
    assert.equal(capped.balanceState, "not_checked");
    const invalid = buildPortalPaymentHistory({
      truncated: false,
      rows: [row({ id: "bad", status: "past_due", balance_due: "80.555", payment_method: null, paid_date: null, amount: "nope" })],
    });
    assert.equal(invalid.balanceState, "unknown");
    assert.equal(invalid.balanceDueCents, null);
    assert.equal(invalid.charges[0].amountCents, null);
    assert.equal(invalid.charges[0].balanceDueCents, null);

    const credit = buildPortalPaymentHistory({
      truncated: false,
      rows: [
        row({ id: "credit", status: "current", amount: "-12.50", balance_due: "-12.50", net_collected: 0, payment_method: null, paid_date: null }),
        row({ id: "open-more", status: "past_due", amount: 80, balance_due: "80.00", net_collected: 0, payment_method: null, paid_date: null }),
      ],
    });
    assert.equal(credit.balanceState, "known");
    assert.equal(credit.charges.find((charge) => charge.id === "credit")?.balanceDueCents, -1250);
    assert.equal(credit.balanceDueCents, 6750);
    const small = buildPortalPaymentHistory({
      truncated: false,
      rows: [row({ id: "small-credit", status: "current", amount: -0.5, balance_due: -0.5, net_collected: 0, payment_method: null, paid_date: null })],
    });
    assert.equal(small.balanceState, "known");
    assert.equal(small.balanceDueCents, -50);
    assert.equal(formatHistoryCents(-50), "-$0.50");
    assert.equal(formatHistoryCents(-150), "-$1.50");
    assert.equal(formatHistoryCents(50), "$0.50");
    assert.equal(formatHistoryCents(small.balanceDueCents), "-$0.50");
    const badCredit = buildPortalPaymentHistory({
      truncated: false,
      rows: [row({ id: "bad-credit", status: "current", amount: "-80.555", balance_due: "-80.555", net_collected: 0, payment_method: null, paid_date: null })],
    });
    assert.equal(badCredit.balanceState, "unknown");
    assert.equal(badCredit.balanceDueCents, null);

    assert.equal(easternCalendarDate(new Date("2026-10-21T03:30:00Z")), "2026-10-20");
    assert.equal(easternCalendarDate(new Date("2026-10-21T04:00:00Z")), "2026-10-21");
    assert.equal(asEasternCalendarDate("2026-10-21"), "2026-10-21");
    assert.equal(asEasternCalendarDate("2026-10-21T03:30:00Z"), "2026-10-20");
  });

  it("returns only the rows RLS would show for this user's applications", async () => {
    const ownApp = "app-own";
    const otherApp = "app-other";
    const fixture = [
      row({ id: "mine", status: "past_due", amount: "80.00", balance_due: "80.00", net_collected: 0, payment_method: null, paid_date: null, driver_id: ownApp } as HistoryRow & { driver_id: string }),
      row({ id: "hidden-on-my-rental", status: "past_due", amount: "500.00", balance_due: "500.00", net_collected: 0, payment_method: null, paid_date: null, driver_id: otherApp, rental_id: "rental-mine" } as HistoryRow & { driver_id: string; rental_id: string }),
      row({ id: "hidden-other", status: "paid", payment_method: "cash", driver_id: otherApp } as HistoryRow & { driver_id: string }),
    ];
    const asked: string[] = [];
    const client = {
      from(table: string) {
        const filters: Array<[string, string, unknown]> = [];
        const query = {
          select() { return query; },
          eq(column: string, value: string) { filters.push(["eq", column, value]); return query; },
          in(column: string, values: readonly string[]) { filters.push(["in", column, values]); return query; },
          order() { return query; },
          limit() {
            asked.push(`${table}:${JSON.stringify(filters)}`);
            if (table === "applications") {
              const user = filters.find((filter) => filter[0] === "eq" && filter[1] === "user_id" && filter[2] === "user-1");
              return Promise.resolve({ data: user ? [{ id: ownApp }] : [], error: null });
            }
            if (table === "payments") {
              const driver = filters.find((filter) => filter[0] === "in" && filter[1] === "driver_id");
              if (!driver) return Promise.resolve({ data: fixture, error: null });
              const ids = driver[2] as string[];
              return Promise.resolve({ data: fixture.filter((payment) => ids.includes((payment as { driver_id?: string }).driver_id ?? "")), error: null });
            }
            return Promise.resolve({ data: [{ id: "rental-mine", driver_id: otherApp }], error: null });
          },
        };
        return query;
      },
    };

    const history = await readOwnPaymentHistory(client, "user-1");
    assert.deepEqual(history.charges.map((charge) => charge.id), ["mine"]);
    assert.equal(history.balanceDueCents, 8000);
    assert.equal(asked.some((call) => call.startsWith("rentals")), false);
    assert.equal(asked.some((call) => call.includes("rental_id")), false);
    assert.match(asked.join("\n"), /applications:\[\[\"eq\",\"user_id\",\"user-1\"\]\]/);
    assert.match(asked.join("\n"), /payments:\[\[\"in\",\"driver_id\",\[\"app-own\"\]\]\]/);
  });
});
