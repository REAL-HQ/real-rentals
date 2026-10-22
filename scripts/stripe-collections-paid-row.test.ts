import { describe, expect, it, vi } from "vitest";
import { collectRows } from "../src/lib/payment-collection.server";
import { postVerifiedPaymentWebhook } from "../src/routes/api/public/payments/webhook";

const PAID = "11111111-1111-4111-8111-111111111111";
const OPEN = "22222222-2222-4222-8222-222222222222";
const REASON = "Weekly rent charge failed";

describe("paid-row stripe success", () => {
  it("clears only the failure reason on an invoice retry and does not notify", async () => {
    const db = memoryAdmin({
      rentals: [{ id: "r1", stripe_subscription_id: "sub_1", application_id: "a1", vehicle_id: "v1" }],
      payments: [paidInvoice("in_retry")],
    });
    const response = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: { id: "in_retry", subscription: "sub_1", amount_paid: 7500, payment_intent: null } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.tables.payments[0]).toMatchObject({
      status: "paid",
      paid_date: "2026-10-01",
      failure_reason: null,
      stripe_invoice_id: "in_retry",
      stripe_subscription_id: "sub_1",
      stripe_payment_intent_id: null,
    });
    expect(db.notifications).toEqual([]);
    const clear = db.updates.find((update) => update.payload.failure_reason === null && update.payload.status == null);
    expect(clear?.payload).toEqual({
      failure_reason: null,
      stripe_invoice_id: "in_retry",
      stripe_subscription_id: "sub_1",
    });
  });

  it("does not store a hosted-invoice payment intent on the already-paid row", async () => {
    const db = memoryAdmin({
      rentals: [{ id: "r1", stripe_subscription_id: "sub_1", application_id: "a1", vehicle_id: "v1" }],
      payments: [paidInvoice("in_hosted")],
    });
    const response = await postVerifiedPaymentWebhook({
      type: "invoice.payment_succeeded",
      data: { object: { id: "in_hosted", subscription: "sub_1", amount_paid: 7500, payment_intent: "pi_hosted" } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.tables.payments[0].stripe_payment_intent_id).toBeNull();
    expect(db.tables.payments[0].failure_reason).toBeNull();
    expect(db.tables.payments[0].status).toBe("paid");
    expect(db.tables.payments[0].paid_date).toBe("2026-10-01");
    expect(JSON.stringify(db.updates)).not.toContain("pi_hosted");
    expect(db.notifications).toEqual([]);
  });

  it("clears a combined charge that was already marked paid and sends no notice", async () => {
    const db = memoryAdmin({
      payments: [
        { id: PAID, status: "paid", paid_date: "2026-10-02", failure_reason: REASON, stripe_invoice_id: "in_combined", stripe_payment_intent_id: null, notified_status: null },
        { id: OPEN, status: "paid", paid_date: "2026-10-02", failure_reason: REASON, stripe_invoice_id: "in_combined_2", stripe_payment_intent_id: null, notified_status: null },
      ],
    });
    const response = await postVerifiedPaymentWebhook({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_combined", amount: 6000, metadata: { paymentIds: `${PAID},${OPEN}` } } },
    }, db);
    expect(response.status).toBe(200);
    for (const row of db.tables.payments) {
      expect(row).toMatchObject({ status: "paid", paid_date: "2026-10-02", failure_reason: null, stripe_payment_intent_id: null });
    }
    const clear = db.updates.find((update) => update.payload.failure_reason === null);
    expect(clear?.payload).toEqual({ failure_reason: null });
    expect(db.updates.some((update) => update.payload.status === "paid" || update.payload.paid_date)).toBe(false);
    expect(db.notifications).toEqual([]);
  });

  it("still receipts an unpaid combined id and leaves the already-paid id quiet", async () => {
    const db = memoryAdmin({
      payments: [
        { id: PAID, status: "paid", paid_date: "2026-10-02", failure_reason: REASON, stripe_payment_intent_id: null, notified_status: null },
        { id: OPEN, status: "failed", paid_date: null, failure_reason: REASON, stripe_payment_intent_id: null, notified_status: null },
      ],
    });
    const response = await postVerifiedPaymentWebhook({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_mixed", amount: 6000, metadata: { paymentIds: `${PAID},${OPEN}` } } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.tables.payments.find((row) => row.id === PAID)).toMatchObject({ status: "paid", paid_date: "2026-10-02", failure_reason: null });
    expect(db.tables.payments.find((row) => row.id === OPEN)).toMatchObject({ status: "paid", failure_reason: null });
    expect(db.notifications).toHaveLength(1);
    expect(db.notifications[0].title).toBe("Payment Received");
    const claim = db.updates.find((update) => update.payload.notified_status === "paid");
    const claimedIds = claim?.filters.find((filter) => filter.op === "in")?.vals as string[];
    expect(claimedIds).toEqual([OPEN]);
  });

  it("clears an already-paid row on immediate combined success without rewriting it", async () => {
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
      failure_reason: null,
      notified_status: "paid",
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
  });

  it("sends no notice when a payment intent is replayed after the invoice row omitted that id", async () => {
    const db = memoryAdmin({
      payments: [{ ...paidInvoice("in_hosted"), failure_reason: null }],
    });
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await postVerifiedPaymentWebhook({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_hosted", amount: 7500, metadata: {} } },
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
