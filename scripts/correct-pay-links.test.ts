// Correct-link failed payments + renter reimbursements.
//
// Why: generic Stripe Payment Links (buy.stripe.com) start a NEW subscription
// on every use, which double-billed renters after a failed charge. These tests
// pin the rule that only a failed invoice's own hosted page is ever sent, that
// the new text and subscription matching stay OFF until an Owner turns them
// on, and that a replayed Stripe event never texts or alerts twice.
//
// Run: bun test scripts/correct-pay-links.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

import {
  failedInvoiceLink,
  failedPaymentSmsBody,
  isGenericPaymentLink,
  isHostedInvoiceUrl,
  matchSubscriptionToRental,
  withinTextingHours,
} from "../src/lib/failed-payment-link";
import { reimbursementProblem, parseReimbursementAmount, todayEasternISO } from "../src/lib/renter-reimbursements";
import { AUTOMATIONS, isAutomationOn } from "../src/lib/automation-catalog";
import { postVerifiedPaymentWebhook } from "../src/routes/api/public/payments/webhook";

const INVOICE_URL = "https://invoice.stripe.com/i/acct_1TwBPNGsNNO50lXb/live_YWNjdF8xVHdCUE5Hc05OTzUwbFhiLF9WYjZ3NHU2Z2lMOTlHdmx4eGhRZGs3dWJOY2ZWQzBOLDE4NDc4ODk1NQ0200lMYQQsEZ?s=ap";
const BUY_LINK = "https://buy.stripe.com/aFaaEXds420K6iaeZ583C00";
const APP = "11111111-1111-4111-8111-111111111111";
const RENTAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOON_ET = new Date("2026-11-11T17:43:00Z"); // 12:43 PM EST
const NIGHT_ET = new Date("2026-11-11T04:00:00Z"); // 11:00 PM EST the night before

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let nextId = 1;
  const orPredicate = (expr: string) => {
    const parts = expr.split(",").map((p) => p.trim());
    return (row: Row) => parts.some((p) => {
      const [col, op, ...rest] = p.split(".");
      const val = rest.join(".");
      if (op === "is" && val === "null") return row[col] == null;
      if (op === "neq") return String(row[col] ?? "") !== val;
      if (op === "eq") return String(row[col] ?? "") === val;
      if (op === "lt") return String(row[col] ?? "") < val;
      throw new Error(`fakeDb: unsupported or() clause ${p}`);
    });
  };
  function from(table: string) {
    state[table] ??= [];
    let op: "select" | "insert" | "update" = "select";
    let patch: Row | null = null;
    let inserted: Row | Row[] | null = null;
    let single = false;
    const filters: ((r: Row) => boolean)[] = [];
    const b: any = {
      select() { return b; },
      insert(r: Row) { op = "insert"; inserted = r; return b; },
      upsert(r: Row) { op = "insert"; inserted = r; return b; },
      update(p: Row) { op = "update"; patch = p; return b; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: any) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
      or(expr: string) { filters.push(orPredicate(expr)); return b; },
      gte() { return b; }, lte() { return b; }, gt() { return b; },
      maybeSingle() { single = true; return b; },
      single() { single = true; return b; },
      limit() { return b; },
      order() { return b; },
      then(res: any, rej: any) { return Promise.resolve().then(run).then(res, rej); },
    };
    function run() {
      const match = () => state[table].filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        const incoming = Array.isArray(inserted) ? inserted : [inserted];
        // payments.stripe_invoice_id is unique in the database.
        if (table === "payments" && incoming.some((r) => r?.stripe_invoice_id && state.payments.some((p) => p.stripe_invoice_id === r.stripe_invoice_id))) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const rows = incoming.map((r) => ({ id: `gen-${nextId++}`, ...r }));
        state[table].push(...rows);
        return { data: single ? rows[0] : rows, error: null };
      }
      if (op === "update") {
        const hit = match();
        for (const r of hit) Object.assign(r, patch);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      const hit = match();
      return single ? { data: hit[0] ?? null, error: null } : { data: hit, error: null };
    }
    return b;
  }
  return { from, rpc: async () => ({ data: null, error: null }), _state: state };
}

const switches = (on: string[]) => ({
  key: "automation_controls",
  value: { off: {}, on: Object.fromEntries(on.map((k) => [k, { at: "2026-11-09", by: "test" }])) },
});

function seed(opts: { on?: string[]; sub?: string | null; extraRental?: Row } = {}) {
  return {
    app_settings: opts.on ? [switches(opts.on)] : [],
    rentals: [{
      id: RENTAL, application_id: APP, vehicle_id: "veh-1", status: "active",
      stripe_subscription_id: opts.sub === undefined ? "sub_live" : opts.sub,
      applications: { email: "regina@example.com", phone: "(321) 287-0986", full_name: "Regina Littles" },
      vehicles: { license_plate: "SIVZ88" },
    }, ...(opts.extraRental ? [opts.extraRental] : [])],
    applications: [{ id: APP, email: "regina@example.com", phone: "3212870986", full_name: "Regina Littles" }],
    payments: [],
    notifications: [],
  };
}

const failedInvoice = (over: Row = {}): Row => ({
  id: "in_failed", subscription: "sub_live", customer: "cus_1", status: "open",
  amount_due: 35000, attempt_count: 1, period_start: 1762700000,
  hosted_invoice_url: INVOICE_URL, customer_email: "regina@example.com", customer_phone: "+13212870986", ...over,
});

function spySms() {
  const calls: any[] = [];
  return { calls, send: async (a: any) => { calls.push(a); return { ok: true }; } };
}

describe("which link a renter gets", () => {
  test("only a hosted invoice page counts; a Payment Link never does", () => {
    expect(isHostedInvoiceUrl(INVOICE_URL)).toBe(true);
    expect(isHostedInvoiceUrl(BUY_LINK)).toBe(false);
    expect(isHostedInvoiceUrl("http://invoice.stripe.com/i/a/b")).toBe(false);
    expect(isHostedInvoiceUrl("https://invoice.stripe.com.evil.example/i/a/b")).toBe(false);
    expect(isGenericPaymentLink(BUY_LINK)).toBe(true);
    expect(isGenericPaymentLink(INVOICE_URL)).toBe(false);
  });
  test("no link for an invoice that is not open, or that carries a generic link", () => {
    expect(failedInvoiceLink({ hosted_invoice_url: INVOICE_URL, status: "open" })).toBe(INVOICE_URL);
    for (const status of ["void", "paid", "uncollectible", "draft"]) expect(failedInvoiceLink({ hosted_invoice_url: INVOICE_URL, status })).toBeNull();
    expect(failedInvoiceLink({ hosted_invoice_url: BUY_LINK, status: "open" })).toBeNull();
    expect(failedInvoiceLink(null)).toBeNull();
  });
  test("the text names the amount, carries the invoice link only, and offers STOP", () => {
    const body = failedPaymentSmsBody({ firstName: "Regina Littles", amount: 350, invoiceUrl: INVOICE_URL });
    expect(body).toContain("Hi Regina,");
    expect(body).toContain("$350");
    expect(body).toContain(INVOICE_URL);
    expect(body).not.toContain("buy.stripe.com");
    expect(body).toContain("STOP");
  });
  test("texting hours are 8 AM to 9 PM Eastern", () => {
    expect(withinTextingHours(NOON_ET)).toBe(true);
    expect(withinTextingHours(NIGHT_ET)).toBe(false);
    expect(withinTextingHours(new Date("2026-11-09T13:00:00Z"))).toBe(true); // 8:00 AM EST
    expect(withinTextingHours(new Date("2026-11-10T02:00:00Z"))).toBe(false); // 9:00 PM EST
  });
});

describe("matching a subscription to one renter", () => {
  const rentals = [
    { rentalId: "r1", applicationId: "a1", email: "Regina@Example.com", phone: "321-287-0986", stripeSubscriptionId: null },
    { rentalId: "r2", applicationId: "a2", email: "schrita@example.com", phone: "4075550100", stripeSubscriptionId: "sub_old" },
  ];
  test("links by email (case-insensitive) or phone when the rental has none", () => {
    expect(matchSubscriptionToRental({ email: "regina@example.com" }, "sub_x", rentals)).toEqual({ kind: "link", rentalId: "r1", applicationId: "a1" });
    expect(matchSubscriptionToRental({ phone: "+1 (321) 287-0986" }, "sub_x", rentals)).toEqual({ kind: "link", rentalId: "r1", applicationId: "a1" });
  });
  test("flags a second subscription for a renter who already has one", () => {
    expect(matchSubscriptionToRental({ email: "schrita@example.com" }, "sub_new", rentals)).toEqual({ kind: "duplicate", rentalId: "r2", applicationId: "a2", existingSubscriptionId: "sub_old" });
    expect(matchSubscriptionToRental({ email: "schrita@example.com" }, "sub_old", rentals).kind).toBe("already");
  });
  test("links nothing when no one or more than one renter matches", () => {
    expect(matchSubscriptionToRental({ email: "nobody@example.com" }, "s", rentals).kind).toBe("none");
    expect(matchSubscriptionToRental({}, "s", rentals).kind).toBe("none");
    expect(matchSubscriptionToRental({ email: "regina@example.com", phone: "4075550100" }, "s", rentals).kind).toBe("ambiguous");
  });
});

describe("new automations are off until an Owner turns them on", () => {
  test("both are catalogued default-off", () => {
    for (const key of ["payment_failed_text", "stripe_subscription_link"]) {
      const def = AUTOMATIONS.find((a) => a.key === key);
      expect(def?.defaultOn).toBe(false);
      expect(isAutomationOn({ off: {} }, key)).toBe(false);
      expect(isAutomationOn({ off: {}, on: { [key]: { at: "x", by: null } } }, key)).toBe(true);
    }
  });
});

describe("webhook: invoice.payment_failed", () => {
  const event = (inv: Row) => ({ type: "invoice.payment_failed", data: { object: inv } });

  test("with the text switch off (default), nothing is texted", async () => {
    const db = fakeDb(seed());
    const sms = spySms();
    const res = await postVerifiedPaymentWebhook(event(failedInvoice()), db, "live", { sendSms: sms.send, now: NOON_ET });
    expect(res.status).toBe(200);
    expect(sms.calls.length).toBe(0);
    expect(db._state.payments[0]).toMatchObject({ status: "failed", stripe_invoice_id: "in_failed" });
  });

  test("with it on: one text with the invoice's own link, transactional, opt-out still enforced by sendSms; a replay texts nothing", async () => {
    const db = fakeDb(seed({ on: ["payment_failed_text"] }));
    const sms = spySms();
    await postVerifiedPaymentWebhook(event(failedInvoice()), db, "live", { sendSms: sms.send, now: NOON_ET });
    expect(sms.calls.length).toBe(1);
    expect(sms.calls[0]).toMatchObject({ to: "(321) 287-0986", kind: "payment_failed", applicationId: APP, rentalId: RENTAL, requireConsent: false });
    expect(sms.calls[0].body).toContain(INVOICE_URL);
    await postVerifiedPaymentWebhook(event(failedInvoice()), db, "live", { sendSms: sms.send, now: NOON_ET });
    expect(sms.calls.length).toBe(1);
    // A same-day Stripe retry is not a second text (one past-due text per day).
    await postVerifiedPaymentWebhook(event(failedInvoice({ attempt_count: 2 })), db, "live", { sendSms: sms.send, now: NOON_ET });
    expect(sms.calls.length).toBe(1);
    // The next day's retry is a new failure: one more text, still the invoice's own link.
    const nextDay = new Date(NOON_ET.getTime() + 24 * 3600 * 1000);
    await postVerifiedPaymentWebhook(event(failedInvoice({ attempt_count: 3 })), db, "live", { sendSms: sms.send, now: nextDay });
    expect(sms.calls.length).toBe(2);
    expect(sms.calls[1].body).toContain(INVOICE_URL);
  });

  test("never texts a generic link, and holds texts overnight", async () => {
    const db = fakeDb(seed({ on: ["payment_failed_text"] }));
    const sms = spySms();
    await postVerifiedPaymentWebhook(event(failedInvoice({ hosted_invoice_url: BUY_LINK })), db, "live", { sendSms: sms.send, now: NOON_ET });
    const db2 = fakeDb(seed({ on: ["payment_failed_text"] }));
    await postVerifiedPaymentWebhook(event(failedInvoice()), db2, "live", { sendSms: sms.send, now: NIGHT_ET });
    expect(sms.calls.length).toBe(0);
  });
});

describe("webhook: subscription matching", () => {
  test("off (default): an unlinked subscription stays unlinked", async () => {
    const db = fakeDb(seed({ sub: null }));
    await postVerifiedPaymentWebhook({ type: "invoice.payment_failed", data: { object: failedInvoice({ subscription: "sub_new" }) } }, db, "live", { now: NOON_ET });
    expect(db._state.rentals[0].stripe_subscription_id).toBeNull();
    expect(db._state.payments.length).toBe(0);
  });

  test("on: links the one matching renter and records the week", async () => {
    const db = fakeDb(seed({ sub: null, on: ["stripe_subscription_link"] }));
    await postVerifiedPaymentWebhook({ type: "invoice.payment_failed", data: { object: failedInvoice({ subscription: "sub_new" }) } }, db, "live", { now: NOON_ET });
    expect(db._state.rentals[0]).toMatchObject({ stripe_subscription_id: "sub_new", stripe_customer_id: "cus_1", autopay_active: true });
    expect(db._state.payments[0]).toMatchObject({ stripe_invoice_id: "in_failed", rental_id: RENTAL, status: "failed" });
  });

  test("on: a second subscription for a linked renter alerts staff once and changes nothing", async () => {
    const db = fakeDb(seed({ sub: "sub_live", on: ["stripe_subscription_link"] }));
    const alerts: any[] = [];
    const ev = { type: "invoice.paid", data: { object: failedInvoice({ id: "in_dup", subscription: "sub_dup", status: "paid", amount_paid: 35000 }) } };
    await postVerifiedPaymentWebhook(ev, db, "live", { alert: async (a) => { alerts.push(a); } });
    await postVerifiedPaymentWebhook(ev, db, "live", { alert: async (a) => { alerts.push(a); } });
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toMatchObject({ existingSubscriptionId: "sub_live", newSubscriptionId: "sub_dup", rentalId: RENTAL });
    expect(db._state.rentals[0].stripe_subscription_id).toBe("sub_live");
    expect(db._state.notifications.filter((n: Row) => n.title === "Possible Duplicate Subscription").length).toBe(1);
    expect(db._state.payments.length).toBe(0);
  });
});

describe("renter reimbursements", () => {
  const base = { applicationId: APP, paidOn: "2026-10-17", amount: "50", method: "zelle", reason: "lost_revenue" };
  test("a complete entry passes", () => expect(reimbursementProblem(base)).toBeNull());
  test("each missing piece is named in Title Case", () => {
    expect(reimbursementProblem({ ...base, applicationId: "" })).toBe("Choose The Renter");
    expect(reimbursementProblem({ ...base, paidOn: "2026-02-30" })).toBe("Enter The Date Paid");
    expect(reimbursementProblem({ ...base, amount: "0" })).toBe("Enter An Amount Above $0");
    expect(reimbursementProblem({ ...base, method: "bitcoin" })).toBe("Choose How It Was Paid");
    expect(reimbursementProblem({ ...base, reason: "x" })).toBe("Choose A Reason");
  });
  test("amounts are cents-exact", () => {
    expect(parseReimbursementAmount("$1,050.5")).toBe(1050.5);
    expect(parseReimbursementAmount("50.123")).toBeNull();
    expect(parseReimbursementAmount("-5")).toBeNull();
  });
  test("today is the Eastern day", () => {
    expect(todayEasternISO(new Date("2026-11-10T03:30:00Z"))).toBe("2026-11-09");
  });
  test("the migration is Manager-only, gives anon nothing, and sends nothing", () => {
    const sql = readFileSync("supabase/migrations/20261109190000_renter_reimbursements.sql", "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/USING \(private\.is_manager\(\)\) WITH CHECK \(private\.is_manager\(\)\)/);
    expect(sql).toContain("REVOKE ALL ON public.renter_reimbursements FROM anon");
    expect(sql).not.toMatch(/notifications|net\.http|pg_net/i);
    expect(sql).toContain("source_expense_id uuid UNIQUE");
  });
  test("the prepared catalog step moves only the three reimbursements and keeps the Uber expense", () => {
    const sql = readFileSync("proposed/renter-reimbursements-catalog-2026-11-09.sql", "utf8");
    for (const id of ["1ca2f652-d50e-4734-b5ef-a171cd24d97f", "c27530ff-88c4-43c4-923d-81ecfc3dbb0b", "6a22b6e0-4527-4267-91aa-1b5458e19446"]) expect(sql).toContain(id);
    const deleteStmt = sql.slice(sql.indexOf("DELETE FROM"), sql.indexOf("-- Read back"));
    expect(deleteStmt).not.toContain("df388dd5");
    expect(sql).toContain("ON CONFLICT (source_expense_id) DO NOTHING");
  });
});
describe("webhook: the failed week's due date", () => {
  test("is the ET date Stripe created the invoice (not the previous period's start)", async () => {
    const db = fakeDb(seed({ on: ["payment_failed_text"] }));
    // Damon-style renewal: period_start is the previous week (10/31), created 11/05 5:41 PM ET.
    const inv = failedInvoice({ period_start: Math.floor(Date.UTC(2026, 9, 31, 12, 5) / 1000), created: Math.floor(Date.UTC(2026, 10, 5, 22, 41) / 1000) });
    await postVerifiedPaymentWebhook({ type: "invoice.payment_failed", data: { object: inv } }, db, "live", { sendSms: spySms().send, now: NOON_ET });
    expect(db._state.payments[0].due_date).toBe("2026-11-05");
  });
  test("an invoice created late evening ET keeps its ET date", async () => {
    const db = fakeDb(seed({ on: ["payment_failed_text"] }));
    const inv = failedInvoice({ created: Math.floor(Date.UTC(2026, 10, 10, 3, 30) / 1000) }); // 10:30 PM ET on 11/9
    await postVerifiedPaymentWebhook({ type: "invoice.payment_failed", data: { object: inv } }, db, "live", { sendSms: spySms().send, now: NOON_ET });
    expect(db._state.payments[0].due_date).toBe("2026-11-09");
  });
});
