// Refundable $50 Reservation Fee (Dolmar, t406u). Network refused; fake DB and Stripe.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;

const policy = await import("@/lib/reservation-fee-refund");
const server = await import("@/lib/reservation-fee-refund.server");
const cat = await import("@/lib/automation-catalog");
const next = await import("@/lib/driver-next-step-requirements");

type Row = Record<string, any>;
let seq = 0;
function fakeDb(seed: Record<string, Row[]> = {}, opts: { missing?: string[]; rpcError?: { code: string; message: string } | null } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const rpcs: any[] = [];
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q,
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      limit: () => q, order: () => q,
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert") {
        if (table === "reservation_fee_refunds" && rows.some((r) => r.payment_id === payload.payment_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const row = { id: `${table}-${++seq}`, ...payload };
        rows.push(row);
        return { data: single ? row : [row], error: null };
      }
      const m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { for (const r of m) Object.assign(r, payload); return { data: m.map((r) => ({ ...r })), error: null }; }
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  async function rpc(name: string, args: any) {
    rpcs.push({ name, args });
    if (opts.rpcError) return { data: null, error: opts.rpcError };
    // Mimic apply_payment_refund for the payment ids.
    if (name === "apply_payment_refund") {
      const ids: string[] = args._payment_ids ?? [];
      for (const id of ids) {
        const row = (state.payments ?? []).find((p) => p.id === id);
        if (row) {
          row.status = "refunded";
          row.refunded_amount = args._cumulative;
          row.refunded_at = new Date().toISOString();
          row.net_collected = 0;
          row.balance_due = 0;
        }
      }
      (state.payment_refunds ??= []).push({ stripe_refund_id: args._refunds?.[0]?.id, payment_ids: ids, amount: args._cumulative });
    }
    return { data: {}, error: null };
  }
  return { from, rpc, state, rpcs };
}

const paidFee = (o: Record<string, unknown> = {}) => ({
  id: "pay1",
  driver_id: "app1",
  rental_id: "res1",
  amount: 50,
  status: "paid",
  reason: "reservation_fee",
  notes: "reservation_fee:ag1",
  refunded_amount: 0,
  stripe_payment_intent_id: "pi_res_1",
  ...o,
});
const seed = (o: { fee?: Record<string, unknown>; reserved?: boolean; already?: boolean } = {}) => ({
  payments: [paidFee(o.fee)],
  applications: [{ id: "app1", full_name: "Test Renter", email: "t@example.com", stripe_customer_id: "cus_1", renter_policy_status: null }],
  rentals: o.reserved === false ? [] : [{ id: "res1", application_id: "app1", status: "reserved", reservation_deposit_status: "applied", stripe_customer_id: "cus_1" }],
  reservation_fee_refunds: o.already
    ? [{ id: "ref1", payment_id: "pay1", application_id: "app1", rental_id: "res1", amount: 50, reason: "insurance_declined", stripe_refund_id: "re_existing", source: "staff" }]
    : [],
  audit_log: [] as Row[],
  fleet_webhook_deliveries: [] as Row[],
});
function stripe(mode: "ok" | "fail" = "ok") {
  const refunds: any[] = [];
  const credits: any[] = [];
  return {
    refunds: {
      create: async (a: any, o: any) => {
        refunds.push({ a, o });
        if (mode === "fail") throw new Error("stripe down");
        return { id: "re_1", charge: "ch_1", payment_intent: a.payment_intent, amount: a.amount, status: "succeeded" };
      },
    },
    customers: { createBalanceTransaction: async (c: string, a: any, o: any) => { credits.push({ c, a, o }); return { id: "cbtxn_rev" }; } },
    calls: refunds,
    credits,
  };
}
const actor = { userId: "user-manager", email: "manager@test", role: "manager" };
const enq: any[] = [];
const deps = (s: ReturnType<typeof stripe> = stripe()) => ({
  stripe: s,
  audit: async () => {},
  enqueue: async (_a: any, row: any) => { enq.push(row); return "wh-1"; },
});

describe("refund reason policy", () => {
  test("only the six refundable reasons are accepted", () => {
    expect(policy.isReservationFeeRefundReason("insurance_declined")).toBe(true);
    expect(policy.isReservationFeeRefundReason("change_of_mind")).toBe(false);
    expect(policy.isReservationFeeRefundReason("no_show")).toBe(false);
    expect(policy.parseReservationFeeRefundReason("failed_inspection")).toBe("failed_inspection");
    expect(policy.reservationFeeRefundedDetail("insurance_declined")).toBe("Refunded - Insurance Declined");
    expect(policy.reservationFeeRefundedDetail(null)).toBe("Refunded");
    expect(policy.refundReasonFromNotes("reservation_fee:ag1 refunded:no_vehicle")).toBe("no_vehicle");
  });

  test("Next Step shows Refunded - reason without treating it as paid", () => {
    const row = next.driverNextStepRequirements([], "refunded:insurance_declined").find((r) => r.key === "reservation_paid");
    expect(row?.met).not.toBe(true);
    expect(row?.detail).toBe("Refunded - Insurance Declined");
    expect(next.driverNextStepRequirements([], "refunded").find((r) => r.key === "reservation_paid")?.detail).toBe("Refunded");
  });

  test("the Automations switch is catalogued and default Off", () => {
    const def = cat.AUTOMATIONS.find((a) => a.key === policy.AUTO_REFUND_RESERVATION_ON_INSURANCE_DECLINE_KEY);
    expect(def?.title).toBe("Auto-Refund Reservation On Insurance Decline");
    expect(def?.defaultOn).toBe(false);
    expect(cat.isAutomationOn({ off: {} }, policy.AUTO_REFUND_RESERVATION_ON_INSURANCE_DECLINE_KEY)).toBe(false);
    expect(cat.isAutomationOn({ off: {}, on: { [policy.AUTO_REFUND_RESERVATION_ON_INSURANCE_DECLINE_KEY]: { at: "t", by: "o" } } }, policy.AUTO_REFUND_RESERVATION_ON_INSURANCE_DECLINE_KEY)).toBe(true);
  });
});

describe("refundReservationFee", () => {
  test("blocks when no refundable reason is chosen and shows the policy", async () => {
    const db = fakeDb(seed());
    const r = await server.refundReservationFee(db, { paymentId: "pay1", reason: "no_show", source: "staff", actor }, deps());
    expect(r.status).toBe("blocked");
    if (r.status !== "blocked") throw new Error("expected block");
    expect(r.code).toBe("no_reason");
    expect(r.error).toMatch(/Choose a refundable reason/);
    expect(r.error).toMatch(/Do not refund for a no-show/);
    expect(db.state.payments[0].status).toBe("paid");
    expect(stripe().calls.length).toBe(0);
  });

  test("refunds through Stripe once, records the audit row, marks the reservation, and enqueues FLEET", async () => {
    enq.length = 0;
    const db = fakeDb(seed());
    const s = stripe();
    const r = await server.refundReservationFee(db, { paymentId: "pay1", reason: "insurance_declined", note: "Could not set up the policy.", source: "staff", actor }, deps(s));
    expect(r).toMatchObject({ status: "refunded", paymentId: "pay1", amount: 50, reason: "insurance_declined", stripeRefundId: "re_1" });
    expect(s.calls[0].a).toMatchObject({ payment_intent: "pi_res_1", amount: 5000 });
    expect(s.calls[0].o).toMatchObject({ idempotencyKey: "reservation-fee-refund:pay1" });
    expect(db.state.payments[0].status).toBe("refunded");
    expect(String(db.state.payments[0].notes)).toMatch(/refunded:insurance_declined/);
    expect(db.state.rentals[0].reservation_deposit_status).toBe("refunded");
    expect(db.state.reservation_fee_refunds[0]).toMatchObject({
      payment_id: "pay1", reason: "insurance_declined", stripe_refund_id: "re_1", source: "staff", refunded_by_email: "manager@test",
    });
    expect(enq[0]).toMatchObject({
      event_type: "reservation_refunded",
      dedupe_key: "reservation_refunded:pay1",
      application_id: "app1",
      payload: { event: "reservation_refunded", lead_id: "app1", application_id: "app1", amount: 50, reason: "insurance_declined", stripe_refund_id: "re_1" },
    });
    expect(JSON.stringify(enq[0])).not.toMatch(/1555555|phone/);
  });

  test("a second call is idempotent and does not create another Stripe refund", async () => {
    const db = fakeDb(seed({ already: true }));
    db.state.payments[0].status = "refunded";
    db.state.payments[0].refunded_amount = 50;
    db.state.payments[0].notes = "reservation_fee:ag1 refunded:insurance_declined";
    const s = stripe();
    const r = await server.refundReservationFee(db, { applicationId: "app1", reason: "no_vehicle", source: "fleet", actor }, deps(s));
    expect(r).toMatchObject({ status: "already", paymentId: "pay1", stripeRefundId: "re_existing", reason: "insurance_declined" });
    expect(s.calls.length).toBe(0);
    expect(db.state.reservation_fee_refunds.length).toBe(1);
  });

  test("refuses a fee kept for a missed pickup", async () => {
    const db = fakeDb(seed({ fee: { notes: "reservation_fee:ag1 kept:late_pickup:rent1" } }));
    const s = stripe();
    const r = await server.refundReservationFee(db, { paymentId: "pay1", reason: "insurance_declined", source: "staff", actor }, deps(s));
    expect(r).toMatchObject({ status: "blocked", code: "kept" });
    expect(s.calls.length).toBe(0);
    expect(db.state.payments[0].status).toBe("paid");
  });

  test("refuses a non-Stripe (manual) Reservation Fee", async () => {
    const db = fakeDb(seed({ fee: { stripe_payment_intent_id: null, payment_method: "zelle" } }));
    const r = await server.refundReservationFee(db, { paymentId: "pay1", reason: "duplicate_or_mistaken_charge", source: "staff", actor }, deps());
    expect(r).toMatchObject({ status: "blocked", code: "no_stripe" });
  });

  test("reverses a week-1 credit before refunding", async () => {
    const db = fakeDb(seed({ fee: { notes: "reservation_fee:ag1 credited_week1:rent1" } }));
    const s = stripe();
    const r = await server.refundReservationFee(db, { paymentId: "pay1", reason: "terms_changed", source: "staff", actor }, deps(s));
    expect(r.status).toBe("refunded");
    expect(s.credits[0].c).toBe("cus_1");
    expect(s.credits[0].a.amount).toBe(5000);
    expect(s.credits[0].o.idempotencyKey).toBe("reservation-fee-credit-reversal:pay1");
    expect(s.calls.length).toBe(1);
  });
});

describe("auto-refund on insurance decline", () => {
  test("does nothing while the switch is Off", async () => {
    const db = fakeDb(seed());
    const s = stripe();
    const r = await server.maybeAutoRefundReservationOnInsuranceDecline(
      db,
      { applicationId: "app1", actor },
      { ...deps(s), settingsGate: async () => "off" },
    );
    expect(r).toMatchObject({ status: "skipped", code: "switched_off" });
    expect(s.calls.length).toBe(0);
    expect(db.state.payments[0].status).toBe("paid");
  });

  test("fails closed when switches cannot be read", async () => {
    const db = fakeDb(seed());
    const s = stripe();
    const r = await server.maybeAutoRefundReservationOnInsuranceDecline(
      db,
      { applicationId: "app1", actor },
      { ...deps(s), settingsGate: async () => "held" },
    );
    expect(r).toMatchObject({ status: "skipped", code: "controls_unreadable" });
    expect(s.calls.length).toBe(0);
  });

  test("refunds with insurance_declined when the switch is On", async () => {
    enq.length = 0;
    const db = fakeDb(seed());
    const s = stripe();
    const r = await server.maybeAutoRefundReservationOnInsuranceDecline(
      db,
      { applicationId: "app1", note: "Declined.", actor },
      { ...deps(s), settingsGate: async () => "send" },
    );
    expect(r).toMatchObject({ status: "refunded", reason: "insurance_declined", stripeRefundId: "re_1" });
    expect(db.state.reservation_fee_refunds[0].source).toBe("auto_insurance_decline");
  });

  test("marking the Renter Policy declined records the status and respects the switch", async () => {
    const db = fakeDb(seed());
    const s = stripe();
    const r = await server.markRenterPolicyDeclined(
      db,
      { applicationId: "app1", note: "Could not bind.", actor },
      { ...deps(s), settingsGate: async () => "off" },
    );
    expect(r.ok).toBe(true);
    expect(db.state.applications[0].renter_policy_status).toBe("declined");
    expect(r.refund).toMatchObject({ status: "skipped", code: "switched_off" });
    expect(s.calls.length).toBe(0);
  });
});

describe("FLEET refund-reservation endpoint", () => {
  const env = { FLEET_API_KEY: "k".repeat(32) };
  async function req(body: unknown, s = stripe()) {
    const db = fakeDb(seed());
    const res = await server.handleFleetRefundReservation(
      new Request("https://drivereal.com/api/public/fleet/refund-reservation", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.FLEET_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { admin: db, env, stripe: s, audit: async () => {}, enqueue: async (_a: any, row: any) => { enq.push(row); return "wh-1"; } },
    );
    return { res, json: await res.json(), db, s };
  }

  test("refuses a reason that is not refundable and shows the policy", async () => {
    const { res, json, s } = await req({ lead_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", reason: "change_of_mind" });
    expect(res.status).toBe(400);
    expect(json.reason).toBe("no_reason");
    expect(json.error).toMatch(/reason must be one of/);
    expect(s.calls.length).toBe(0);
  });

  test("refunds by lead UUID, then returns already", async () => {
    const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const PAY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const db = fakeDb({
      payments: [paidFee({ id: PAY, driver_id: APP })],
      applications: [{ id: APP, stripe_customer_id: "cus_1" }],
      rentals: [{ id: "res1", application_id: APP, status: "reserved", reservation_deposit_status: "applied" }],
      reservation_fee_refunds: [],
    });
    const s = stripe();
    const d = { admin: db, env, stripe: s, audit: async () => {}, enqueue: async () => "wh-1" };
    const post = (body: unknown) =>
      server.handleFleetRefundReservation(
        new Request("https://drivereal.com/api/public/fleet/refund-reservation", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.FLEET_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        d,
      );
    const a = await post({ lead_id: APP, reason: "failed_inspection", note: "Cannot swap." });
    const ja = await a.json();
    expect(a.status).toBe(201);
    expect(ja).toMatchObject({ ok: true, already: false, reason: "failed_inspection", stripe_refund_id: "re_1", payment_id: PAY, lead_id: APP });
    const b = await post({ lead_id: APP, reason: "failed_inspection" });
    const jb = await b.json();
    expect(b.status).toBe(200);
    expect(jb.already).toBe(true);
    expect(s.calls.length).toBe(1);
  });

  test("unauthorized without the key", async () => {
    const res = await server.handleFleetRefundReservation(
      new Request("https://drivereal.com/api/public/fleet/refund-reservation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", reason: "no_vehicle" }),
      }),
      { admin: fakeDb(), env },
    );
    expect(res.status).toBe(401);
  });
});

describe("agreement wording and docs", () => {
  test("v1.14 and the builder state the refund policy in plain language and never name a carrier", () => {
    const v114 = readFileSync("src/lib/agreement-v114.ts", "utf8");
    expect(v114).toMatch(/We refund it in full if: \(a\) we cannot set up the Renter Policy for you/);
    expect(v114).toMatch(/It is not refunded if you do not show for your scheduled pickup, change your mind, miss pickup without notice, or provided information that was false or did not match/);
    expect(v114).not.toMatch(/Non-refundable once we set up the Renter Policy/);
    expect(v114.toLowerCase()).not.toMatch(/progressive|geico|state farm|allstate|broker/);
    const builder = readFileSync("src/lib/agreement-builder.ts", "utf8");
    expect(builder).toMatch(/We refund it in full if: \(a\) we cannot set up the Renter Policy for you/);
    expect(builder).not.toMatch(/fully refunded if you cancel \[\[reservation_cancel_hours\]\] hours or more/);
  });

  test("the webhook event, Fleet route, switch and proposed migration are wired", () => {
    const wh = readFileSync("src/lib/fleet-webhook.server.ts", "utf8");
    expect(wh).toContain('"reservation_refunded"');
    expect(readFileSync("src/routes/api/public/fleet/refund-reservation.ts", "utf8")).toContain("handleFleetRefundReservation");
    const sql = readFileSync("proposed/reservation-fee-refunds-v1.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.reservation_fee_refunds");
    expect(sql).toContain("'reservation_refunded'");
    expect(sql).toContain("renter_policy_status");
    expect(sql).toMatch(/Rollback/);
    expect(readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8")).toContain("Refund Reservation");
    expect(readFileSync("src/components/admin/NextStepCard.tsx", "utf8")).not.toContain("Refund Reservation");
    expect(readFileSync("src/components/admin/TermsConfirmedControl.tsx", "utf8")).not.toContain("refundReservation");
  });
});
