import { afterEach, describe, expect, it, vi } from "vitest";
import { collectRows } from "../src/lib/payment-collection.server";
import { doubleCollectionMessage } from "../src/lib/double-collection";
import { postVerifiedPaymentWebhook } from "../src/routes/api/public/payments/webhook";
import * as emailServer from "../src/lib/email.server";

const PAID = "11111111-1111-4111-8111-111111111111";
const OPEN = "22222222-2222-4222-8222-222222222222";
const REASON = "Weekly rent charge failed";
const COLLECTED = Math.floor(Date.parse("2026-10-17T16:00:00Z") / 1000);
const MESSAGE = doubleCollectionMessage(7500, "2026-10-17");

const previousResend = process.env.RESEND_API_KEY;
afterEach(() => {
  vi.restoreAllMocks();
  if (previousResend === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousResend;
});

function stubStaffMail() {
  vi.spyOn(emailServer, "getLeadAlertPrefs").mockResolvedValue({
    recipients: ["team@drivereal.com"],
    onNew: true,
    onComplete: true,
  });
  return vi.spyOn(emailServer, "sendEmail").mockResolvedValue({ ok: true });
}

function staffEmails(send: ReturnType<typeof stubStaffMail>) {
  return send.mock.calls.filter((call) => call[0].subject === "Possible Double Collection");
}

function receiptLogs(logged: unknown[][]) {
  return logged.filter((args) => JSON.stringify(args).includes("Payment Received"));
}

describe("paid-row stripe success", () => {
  it("sends one Payment Received notice when Stripe collects a row staff marked paid", async () => {
    stubStaffMail();
    const previousKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const logged: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => { logged.push(args); });
    const db = memoryAdmin({
      rentals: [{ id: "r1", application_id: "a1", applications: { email: "ada@example.com", full_name: "Ada" } }],
      payments: [{
        id: PAID,
        status: "paid",
        paid_date: "2026-10-02",
        failure_reason: REASON,
        rental_id: "r1",
        stripe_invoice_id: "in_pi",
        stripe_payment_intent_id: null,
        notified_status: null,
      }],
    });
    const response = await postVerifiedPaymentWebhook({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", amount: 7500, created: COLLECTED, metadata: { paymentIds: PAID, rentalId: "r1", reason: "rent" } } },
    }, db);
    expect(response.status).toBe(200);
    expect(MESSAGE).toBe("Possible double collection: row marked paid manually, then Stripe collected $75.00 on 2026-10-17; a refund may be owed.");
    expect(db.tables.payments[0]).toMatchObject({
      status: "paid",
      paid_date: "2026-10-02",
      failure_reason: MESSAGE,
      stripe_payment_intent_id: null,
      notified_status: "paid",
    });
    expect(db.notifications.filter((row) => row.title === "Payment Received")).toHaveLength(1);
    expect(receiptLogs(logged)).toHaveLength(1);
    expect(db.updates.some((update) => update.payload.status === "paid" || update.payload.paid_date)).toBe(false);
  });

  it("sends no second Payment Received notice when that payment intent is replayed", async () => {
    stubStaffMail();
    delete process.env.RESEND_API_KEY;
    const logged: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => { logged.push(args); });
    const db = memoryAdmin({
      rentals: [{ id: "r1", application_id: "a1", applications: { email: "ada@example.com", full_name: "Ada" } }],
      payments: [{
        id: PAID,
        status: "paid",
        paid_date: "2026-10-02",
        failure_reason: REASON,
        rental_id: "r1",
        stripe_invoice_id: "in_pi",
        stripe_payment_intent_id: null,
        notified_status: null,
      }],
    });
    const event = {
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", amount: 7500, created: COLLECTED, metadata: { paymentIds: PAID, rentalId: "r1", reason: "rent" } } },
    };
    expect((await postVerifiedPaymentWebhook(event, db)).status).toBe(200);
    expect((await postVerifiedPaymentWebhook(event, db)).status).toBe(200);
    expect(db.notifications.filter((row) => row.title === "Payment Received")).toHaveLength(1);
    expect(receiptLogs(logged)).toHaveLength(1);
    expect(db.tables.payments[0].notified_status).toBe("paid");
    expect(db.tables.payments[0].failure_reason).toBe(MESSAGE);
  });

  it("alerts staff once, with the rental and invoice, and a replay does not alert again", async () => {
    const send = stubStaffMail();
    const db = memoryAdmin({
      rentals: [{ id: "r1", stripe_subscription_id: "sub_1", application_id: "a1", vehicle_id: "v1" }],
      payments: [paidInvoice("in_retry")],
    });
    const event = {
      type: "invoice.paid",
      data: { object: { id: "in_retry", subscription: "sub_1", amount_paid: 7500, created: COLLECTED, payment_intent: null, status_transitions: { paid_at: COLLECTED } } },
    };
    expect((await postVerifiedPaymentWebhook(event, db)).status).toBe(200);
    expect((await postVerifiedPaymentWebhook(event, db)).status).toBe(200);
    expect(db.tables.payments[0]).toMatchObject({
      status: "paid",
      paid_date: "2026-10-01",
      failure_reason: MESSAGE,
      stripe_invoice_id: "in_retry",
      stripe_subscription_id: "sub_1",
      stripe_payment_intent_id: null,
      notified_status: null,
    });
    expect(db.notifications.filter((row) => row.title === "Payment Received")).toEqual([]);
    const staff = db.notifications.filter((row) => row.title === "Possible Double Collection");
    expect(staff).toHaveLength(1);
    expect(staff[0].body).toContain(MESSAGE);
    expect(staff[0].body).toContain("Rental: r1");
    expect(staff[0].body).toContain("Invoice: in_retry");
    expect(staffEmails(send)).toHaveLength(1);
    expect(staffEmails(send)[0][0].to).toEqual(["team@drivereal.com"]);
    expect(staffEmails(send)[0][0].html).toContain(MESSAGE);
    expect(staffEmails(send)[0][0].html).toContain("Rental: r1");
    expect(staffEmails(send)[0][0].html).toContain("Invoice: in_retry");
    expect(staffEmails(send)[0][0].track).toEqual({ workflow: "lead_alert" });
    expect(send.mock.calls.some((call) => String(call[0].subject).startsWith("Payment Received"))).toBe(false);
  });

  it("does not store a hosted-invoice payment intent on the already-paid row", async () => {
    stubStaffMail();
    const db = memoryAdmin({
      rentals: [{ id: "r1", stripe_subscription_id: "sub_1", application_id: "a1", vehicle_id: "v1" }],
      payments: [paidInvoice("in_hosted")],
    });
    const response = await postVerifiedPaymentWebhook({
      type: "invoice.payment_succeeded",
      data: { object: { id: "in_hosted", subscription: "sub_1", amount_paid: 7500, created: COLLECTED, payment_intent: "pi_hosted" } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.tables.payments[0].stripe_payment_intent_id).toBeNull();
    expect(db.tables.payments[0].failure_reason).toBe(MESSAGE);
    expect(db.tables.payments[0].status).toBe("paid");
    expect(db.tables.payments[0].paid_date).toBe("2026-10-01");
    expect(JSON.stringify(db.updates)).not.toContain("pi_hosted");
    expect(db.notifications.filter((row) => row.title === "Payment Received")).toEqual([]);
    expect(db.notifications.filter((row) => row.title === "Possible Double Collection")).toHaveLength(1);
  });

  it("keeps both manual rows and sends one notice when a combined charge was already marked paid", async () => {
    const send = stubStaffMail();
    const db = memoryAdmin({
      payments: [
        { id: PAID, status: "paid", paid_date: "2026-10-02", failure_reason: REASON, rental_id: "r1", stripe_invoice_id: "in_combined", stripe_payment_intent_id: null, notified_status: null },
        { id: OPEN, status: "paid", paid_date: "2026-10-02", failure_reason: REASON, rental_id: "r1", stripe_invoice_id: "in_combined_2", stripe_payment_intent_id: null, notified_status: null },
      ],
    });
    const response = await postVerifiedPaymentWebhook({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_combined", amount: 6000, created: COLLECTED, metadata: { paymentIds: `${PAID},${OPEN}`, rentalId: "r1" } } },
    }, db);
    expect(response.status).toBe(200);
    const combined = doubleCollectionMessage(6000, "2026-10-17");
    for (const row of db.tables.payments) {
      expect(row).toMatchObject({ status: "paid", paid_date: "2026-10-02", failure_reason: combined, stripe_payment_intent_id: null, notified_status: "paid" });
    }
    expect(db.updates.some((update) => update.payload.status === "paid" || update.payload.paid_date)).toBe(false);
    expect(db.notifications.filter((row) => row.title === "Payment Received")).toHaveLength(1);
    expect(db.notifications.filter((row) => row.title === "Possible Double Collection")).toHaveLength(1);
    expect(staffEmails(send)).toHaveLength(1);
    expect(staffEmails(send)[0][0].html).toContain("Invoice: in_combined");
    expect(staffEmails(send)[0][0].html).toContain("Invoice: in_combined_2");
  });

  it("receipts the open combined id and the already-paid id together", async () => {
    stubStaffMail();
    const db = memoryAdmin({
      payments: [
        { id: PAID, status: "paid", paid_date: "2026-10-02", failure_reason: REASON, rental_id: "r1", stripe_invoice_id: "in_paid", stripe_payment_intent_id: null, notified_status: null },
        { id: OPEN, status: "failed", paid_date: null, failure_reason: REASON, stripe_payment_intent_id: null, notified_status: null },
      ],
    });
    const response = await postVerifiedPaymentWebhook({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_mixed", amount: 6000, created: COLLECTED, metadata: { paymentIds: `${PAID},${OPEN}` } } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.tables.payments.find((row) => row.id === PAID)).toMatchObject({ status: "paid", paid_date: "2026-10-02", failure_reason: doubleCollectionMessage(6000, "2026-10-17") });
    expect(db.tables.payments.find((row) => row.id === OPEN)).toMatchObject({ status: "paid", failure_reason: null });
    expect(db.notifications.filter((row) => row.title === "Payment Received")).toHaveLength(1);
    const claim = db.updates.find((update) => update.payload.notified_status === "paid");
    const claimedIds = claim?.filters.find((filter) => filter.op === "in")?.vals as string[];
    expect(claimedIds).toEqual([PAID, OPEN]);
  });

  it("leaves an already-paid row untouched on immediate combined success", async () => {
    const db = memoryAdmin({
      payments: [
        { id: PAID, status: "paid", paid_date: "2026-10-02", failure_reason: REASON, amount: 40, balance_due: 40, attempt_count: 1, stripe_payment_intent_id: null, notified_status: null },
        { id: OPEN, status: "failed", paid_date: null, failure_reason: REASON, amount: 20, balance_due: 20, attempt_count: 1, stripe_payment_intent_id: null, notified_status: null },
      ],
    });
    const result = await collectRows(db, {
      paymentIntents: { create: async () => ({ id: "pi_now", status: "succeeded" }) },
    } as any, db.tables.payments.map((row) => ({ id: row.id, amount: row.amount, balance_due: row.balance_due, attempt_count: row.attempt_count })), {
      customerId: "cus_1",
      paymentMethodId: "pm_1",
      description: "Rent balance payment",
      metadata: { rentalId: "r1", reason: "rent" },
    });
    expect(result).toMatchObject({ ok: true, status: "paid" });
    expect(db.tables.payments.find((row) => row.id === PAID)).toMatchObject({
      status: "paid",
      paid_date: "2026-10-02",
      failure_reason: REASON,
      notified_status: null,
      stripe_payment_intent_id: null,
      balance_due: 40,
    });
    expect(db.tables.payments.find((row) => row.id === OPEN)).toMatchObject({
      status: "paid",
      failure_reason: null,
      balance_due: 0,
      stripe_payment_intent_id: null,
    });
    expect(db.tables.payments.find((row) => row.id === OPEN).notified_status).toBeNull();
    expect(db.notifications).toEqual([]);
  });

  it("sends no notice when a payment intent is replayed after the invoice row omitted that id", async () => {
    const db = memoryAdmin({
      payments: [{ ...paidInvoice("in_hosted"), failure_reason: null }],
    });
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await postVerifiedPaymentWebhook({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_hosted", amount: 7500, created: COLLECTED, metadata: {} } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.notifications).toEqual([]);
    expect(db.tables.payments[0]).toMatchObject({
      status: "paid",
      paid_date: "2026-10-01",
      failure_reason: null,
      stripe_payment_intent_id: null,
    });
    expect(db.updates).toEqual([]);
    warn.mockRestore();
  });
});

function paidInvoice(invoiceId: string) {
  return {
    id: PAID,
    status: "paid",
    paid_date: "2026-10-01",
    failure_reason: REASON,
    stripe_invoice_id: invoiceId,
    stripe_subscription_id: "sub_1",
    rental_id: "r1",
    stripe_payment_intent_id: null,
    notified_status: null,
  };
}

type Filter = { op: string; col?: string; val?: unknown; vals?: unknown[]; expr?: string };

function memoryAdmin(tables: Record<string, Array<Record<string, any>>>) {
  const notifications: Array<Record<string, any>> = [];
  const updates: Array<{ table: string; payload: Record<string, any>; filters: Filter[] }> = [];
  function match(row: Record<string, any>, filters: Filter[]) {
    return filters.every((filter) => {
      if (filter.op === "eq") return row[filter.col!] === filter.val;
      if (filter.op === "in") return filter.vals!.includes(row[filter.col!]);
      if (filter.op === "neq") return row[filter.col!] !== filter.val;
      if (filter.op === "or") {
        const [nullPart, neqPart] = String(filter.expr).split(",");
        const nullColumn = nullPart.split(".")[0];
        const neqColumn = neqPart.split(".neq.")[0];
        const neqValue = neqPart.split(".neq.")[1];
        return row[nullColumn] == null || row[neqColumn] !== neqValue;
      }
      return true;
    });
  }
  return {
    notifications,
    updates,
    tables,
    from(table: string) {
      const filters: Filter[] = [];
      let action: "select" | "update" | "insert" = "select";
      let payload: Record<string, any> | null = null;
      const exec = () => {
        const rows = tables[table] ?? [];
        if (action === "insert") {
          if (table === "notifications") {
            notifications.push({ ...payload });
            return { data: [{ id: "n1" }], error: null };
          }
          if (table === "payments" && payload?.stripe_invoice_id && rows.some((row) => row.stripe_invoice_id === payload?.stripe_invoice_id)) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          rows.push({ id: `new-${rows.length + 1}`, ...payload });
          tables[table] = rows;
          return { data: [{ id: rows[rows.length - 1].id }], error: null };
        }
        const matched = rows.filter((row) => match(row, filters));
        if (action === "update") {
          updates.push({ table, payload: { ...payload }, filters: filters.map((filter) => ({ ...filter })) });
          for (const row of matched) Object.assign(row, payload);
          return { data: matched.map((row) => ({ ...row })), error: null };
        }
        return { data: matched.map((row) => ({ ...row })), error: null };
      };
      const builder: any = {
        select() { return builder; },
        update(next: Record<string, any>) { action = "update"; payload = next; return builder; },
        insert(next: Record<string, any>) { action = "insert"; payload = next; return builder; },
        eq(col: string, val: unknown) { filters.push({ op: "eq", col, val }); return builder; },
        in(col: string, vals: unknown[]) { filters.push({ op: "in", col, vals }); return builder; },
        neq(col: string, val: unknown) { filters.push({ op: "neq", col, val }); return builder; },
        or(expr: string) { filters.push({ op: "or", expr }); return builder; },
        is() { return builder; },
        maybeSingle() {
          const result = exec();
          return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(exec()).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}
