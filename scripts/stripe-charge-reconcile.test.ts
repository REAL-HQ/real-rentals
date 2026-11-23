// Nightly charge reconciliation: gaps, idempotent alerts, no phone numbers.
import { describe, expect, test } from "bun:test";
import { chargeGapAlert, chargeGaps, succeededChargeRef } from "../src/lib/stripe-charge-reconcile";
import { runStripeChargeReconciliation } from "../src/lib/stripe-charge-reconcile.server";
import { readTeamAlertSettings } from "../src/lib/team-alerts";

const charge = (id: string, over: Record<string, unknown> = {}) => ({
  id, status: "succeeded", paid: true, amount: 5000, amount_captured: 5000, amount_refunded: 0,
  currency: "usd", payment_intent: `pi_${id}`, invoice: null, ...over,
});

function fakeDb(payments: Record<string, unknown>[] = []) {
  const state: Record<string, any[]> = { payments, unmatched_stripe_payments: [] };
  function from(table: string) {
    state[table] ??= [];
    let op = "select";
    let payload: any = null;
    const filters: Array<(r: any) => boolean> = [];
    const q: any = {
      select: () => q,
      insert: (r: any) => { op = "insert"; payload = r; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      limit: () => q,
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const hit = () => state[table].filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const row = payload;
        if (row.stripe_payment_intent_id && state[table].some((r) => r.stripe_payment_intent_id === row.stripe_payment_intent_id)) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        state[table].push({ id: `row-${state[table].length + 1}`, ...row });
        return { data: null, error: null };
      }
      return { data: hit(), error: null };
    }
    return q;
  }
  return { from, state };
}

describe("charge gaps", () => {
  test("a succeeded charge with no payments row is a gap; a recorded intent is not", () => {
    const open = succeededChargeRef(charge("ch_open"))!;
    const recorded = succeededChargeRef(charge("ch_done", { payment_intent: "pi_done" }))!;
    const refunded = succeededChargeRef(charge("ch_back", { amount_refunded: 5000 }));
    const zero = succeededChargeRef(charge("ch_zero", { amount: 0, amount_captured: 0 }));
    expect(refunded).toBeNull();
    expect(zero).toBeNull();
    const gaps = chargeGaps([open, recorded], [{ stripeChargeId: null, stripePaymentIntentId: "pi_done", stripeInvoiceId: null }]);
    expect(gaps.map((g) => g.chargeId)).toEqual(["ch_open"]);
    const copy = chargeGapAlert(open);
    expect(copy.title).toBe("Stripe Payment Not On File");
    expect(copy.lines.join(" ")).not.toMatch(/\d{3}[-.\s]?\d{3}/);
    expect(copy.dedupeKey).toBe("ch_open");
  });

  test("the job is idle while the team alert is off, and alerts each gap once", async () => {
    const db = fakeDb();
    const stripe = { charges: { list: async () => ({ data: [charge("ch_a"), charge("ch_b", { payment_intent: "pi_b" })], has_more: false }) } };
    const off = await runStripeChargeReconciliation(db, { stripe, settings: readTeamAlertSettings(null) });
    expect(off).toMatchObject({ checked: 0, gaps: 0 });
    const sent: string[] = [];
    const settings = readTeamAlertSettings({ stripe_payment_gap: { enabled: true } });
    const on = await runStripeChargeReconciliation(db, {
      stripe,
      settings,
      sendAlert: async (alert) => { sent.push(alert.dedupeKey); return { status: "sent" }; },
    });
    expect(on.gaps).toBe(2);
    expect(sent).toEqual(["ch_a", "ch_b"]);
    expect(db.state.unmatched_stripe_payments).toHaveLength(2);
    expect(db.state.payments).toHaveLength(0);
    const again = await runStripeChargeReconciliation(db, {
      stripe,
      settings,
      sendAlert: async () => ({ status: "sent" }),
    });
    expect(again.gaps).toBe(2);
    expect(db.state.unmatched_stripe_payments).toHaveLength(2);
    db.state.payments.push({ stripe_payment_intent_id: "pi_b", stripe_charge_id: "ch_b", stripe_invoice_id: null });
    const left = await runStripeChargeReconciliation(db, {
      stripe,
      settings,
      sendAlert: async (alert) => { sent.push(alert.dedupeKey); return { status: "sent" }; },
    });
    expect(left.gaps).toBe(1);
    expect(left.alerts.map((a) => a.chargeId)).toEqual(["ch_a"]);
  });
});
