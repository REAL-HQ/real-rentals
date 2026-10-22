import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { postVerifiedPaymentWebhook, warnUnmatchedPayment } from "../src/routes/api/public/payments/webhook";
import {
  customerSuffix,
  easternDay,
  easternDayStart,
  formatCents,
  formatUnmatchedWarn,
  invoiceIsLinked,
  unmatchedWindow,
} from "../src/lib/stripe-unmatched";
import {
  DIRECTORY_MAX_PAGES,
  DIRECTORY_PAGE,
  INVOICE_MAX_PAGES,
  INVOICE_PAGE,
  loadUnmatchedStripePayments,
} from "../src/lib/stripe-unmatched.server";

const NOW = new Date("2026-10-21T15:00:00.000Z");
const PAID_AT = Math.floor(Date.parse("2026-10-16T16:00:00.000Z") / 1000);

describe("unmatched stripe links", () => {
  it("matches a subscription on a rental or a customer on a rental or application", () => {
    const invoice = { subscriptionId: "sub_1", customerId: "cus_ABCDEFGH" };
    expect(invoiceIsLinked(invoice, [{ subscriptionId: "sub_1" }], [])).toBe(true);
    expect(invoiceIsLinked(invoice, [{ customerId: "cus_ABCDEFGH" }], [])).toBe(true);
    expect(invoiceIsLinked({ subscriptionId: "sub_missing", customerId: "cus_ABCDEFGH" }, [], [{ customerId: "cus_ABCDEFGH" }])).toBe(true);
    expect(invoiceIsLinked({ subscriptionId: "sub_missing", customerId: "cus_ABCDEFGH" }, [{ subscriptionId: "sub_other" }], [])).toBe(false);
    expect(invoiceIsLinked({ subscriptionId: null, customerId: null }, [], [])).toBe(false);
  });

  it("logs a customer suffix and the amount in cents, without the full customer id", () => {
    const line = formatUnmatchedWarn({
      invoiceId: "in_123",
      subscriptionId: "sub_123",
      customerId: "cus_ABCDEFGH",
      amountCents: 15000,
      status: "paid",
    });
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      event: "stripe_unmatched_payment",
      invoice_id: "in_123",
      payment_intent_id: null,
      subscription_id: "sub_123",
      customer_suffix: "EFGH",
      amount_cents: 15000,
      status: "paid",
    });
    expect(line).not.toContain("cus_ABCDEFGH");
    expect(line).not.toContain("email");
    expect(customerSuffix("cus_ABCDEFGH")).toBe("EFGH");
    expect(formatCents(15000)).toBe("$150.00");
    expect(formatCents(null)).toBe("Unknown");
  });

  it("covers Oct 15-17 inside the Eastern 60-day window and survives the DST edges", () => {
    const window = unmatchedWindow(NOW);
    expect(window).not.toBeNull();
    expect(window!.to).toBe("2026-10-21");
    expect(window!.from <= "2026-10-15").toBe(true);
    expect(PAID_AT).toBeGreaterThanOrEqual(window!.gte);
    expect(PAID_AT).toBeLessThan(window!.lt);
    for (const day of ["2026-03-08", "2026-11-01", "2026-10-21"]) {
      const start = easternDayStart(day);
      expect(start).not.toBeNull();
      expect(easternDay(new Date(start! * 1000))).toBe(day);
    }
  });
});

describe("unmatched stripe reads", () => {
  it("lists an unmatched paid invoice and drops a matched one", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const stripe = {
      invoices: {
        list: async (query: Record<string, unknown>) => {
          seen.push(query);
          return {
            data: [
              { id: "in_cash", status: "paid", amount_paid: 15000, created: PAID_AT, customer: "cus_ABCDEFGH", subscription: "sub_missing" },
              { id: "in_sub", status: "paid", amount_paid: 9000, created: PAID_AT, customer: "cus_OTHER123", subscription: "sub_known" },
              { id: "in_app", status: "paid", amount_paid: 8000, created: PAID_AT, customer: "cus_APP12345", subscription: "sub_none" },
              { id: "in_open", status: "open", amount_paid: 100, created: PAID_AT, customer: "cus_ZZZZZZZZ", subscription: "sub_none" },
            ],
            has_more: false,
          };
        },
      },
    };
    const report = await loadUnmatchedStripePayments(memoryDb({
      rentals: [{ id: "r1", stripe_subscription_id: "sub_known", stripe_customer_id: null }],
      applications: [{ id: "a1", stripe_customer_id: "cus_APP12345" }],
    }), stripe, NOW);
    expect(seen[0]).toMatchObject({ status: "paid", limit: INVOICE_PAGE });
    expect(report.status).toBe("ready");
    if (report.status !== "ready") return;
    expect(report.truncated).toBe(false);
    expect(report.rows.map((row) => row.invoiceId)).toEqual(["in_cash"]);
    expect(report.rows[0]).toMatchObject({ customerSuffix: "EFGH", amountCents: 15000, paidOn: "2026-10-16", subscriptionId: "sub_missing" });
  });

  it("returns unavailable when Stripe throws, which is not the capped state", async () => {
    const report = await loadUnmatchedStripePayments(memoryDb({ rentals: [], applications: [] }), {
      invoices: { list: async () => { throw new Error("network"); } },
    }, NOW);
    expect(report).toEqual({ status: "unavailable", reason: "Stripe Could Not Be Read", rows: [], truncated: false });
  });

  it("caps invoice pages separately from a failed read", async () => {
    expect(INVOICE_MAX_PAGES).toBe(10);
    let page = 0;
    const report = await loadUnmatchedStripePayments(memoryDb({ rentals: [], applications: [] }), {
      invoices: {
        list: async () => {
          page += 1;
          return {
            data: [{ id: `in_${String(page).padStart(2, "0")}`, status: "paid", amount_paid: 100, created: PAID_AT, customer: "cus_ABCDEFGH", subscription: null }],
            has_more: true,
          };
        },
      },
    }, NOW);
    expect(page).toBe(INVOICE_MAX_PAGES);
    expect(report.status).toBe("ready");
    if (report.status !== "ready") return;
    expect(report.truncated).toBe(true);
    expect(report.truncatedBecause).toBe("invoices");
    expect(report.rows).toHaveLength(INVOICE_MAX_PAGES);
  });

  it("withholds rows when the rental directory is capped and fails a broken rental read", async () => {
    expect(DIRECTORY_PAGE).toBe(200);
    const rentals = Array.from({ length: DIRECTORY_PAGE * DIRECTORY_MAX_PAGES + 1 }, (_, index) => ({
      id: `r-${String(index).padStart(5, "0")}`,
      stripe_subscription_id: null,
      stripe_customer_id: null,
    }));
    const capped = await loadUnmatchedStripePayments(memoryDb({
      rentals,
      applications: [],
    }), {
      invoices: { list: async () => ({ data: [{ id: "in_1", status: "paid", amount_paid: 100, created: PAID_AT, customer: "cus_ABCDEFGH" }], has_more: false }) },
    }, NOW);
    expect(capped).toMatchObject({ status: "ready", truncated: true, truncatedBecause: "directory", rows: [] });

    const broken = await loadUnmatchedStripePayments({
      from() {
        const api = {
          select: () => api,
          order: () => api,
          gt: () => api,
          limit: () => Promise.resolve({ data: null, error: { message: "no" }, count: null }),
        };
        return api;
      },
    }, {
      invoices: { list: async () => ({ data: [], has_more: false }) },
    }, NOW);
    expect(broken).toEqual({ status: "unavailable", reason: "The Rental Read Did Not Complete", rows: [], truncated: false });
  });
});

describe("unmatched stripe webhook handler", () => {
  it("returns 200 when the rental read fails and does not insert", async () => {
    const db = handlerDb({
      maybeSingle: { rentals: { data: null, error: { message: "db down" } } },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: { id: "in_down", subscription: "sub_1", amount_paid: 15000, customer: "cus_ABCDEFGH" } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.inserts).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns 200 when an unmatched invoice log cannot read the directory", async () => {
    const db = handlerDb({
      limit: { rentals: () => Promise.reject(new Error("db down")) },
    });
    const response = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: { id: "in_nsub", amount_paid: 15000, customer: "cus_ABCDEFGH" } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.inserts).toEqual([]);
  });

  it("returns 200 for a payment intent with the database down and does not warn", async () => {
    const db = handlerDb({
      maybeSingle: { payments: { data: null, error: { message: "db down" } } },
      query: { payments: { data: null, error: { message: "db down" } } },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await postVerifiedPaymentWebhook({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_down", amount: 15000, customer: "cus_ABCDEFGH" } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.inserts).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("logs an unmatched invoice with a customer suffix and still returns 200 when logging throws", async () => {
    const db = handlerDb({
      limit: {
        rentals: { data: [], error: null },
        applications: { data: [], error: null },
      },
    });
    const lines: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const response = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: { id: "in_open", amount_paid: 15000, customer: "cus_ABCDEFGH" } },
    }, db);
    expect(response.status).toBe(200);
    expect(db.inserts).toEqual([]);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.event).toBe("stripe_unmatched_payment");
    expect(parsed.customer_suffix).toBe("EFGH");
    expect(parsed.invoice_id).toBe("in_open");
    expect(parsed.amount_cents).toBe(15000);
    expect(lines[0]).not.toContain("cus_ABCDEFGH");
    warn.mockImplementation(() => {
      throw new Error("log down");
    });
    const again = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: { id: "in_log", amount_paid: 100, customer: "cus_ABCDEFGH" } },
    }, db);
    expect(again.status).toBe(200);
    warn.mockRestore();
  });

  it("still returns 400 when a matched invoice cannot be written", async () => {
    const db = handlerDb({
      maybeSingle: {
        rentals: { data: { id: "r1", application_id: "a1", vehicle_id: "v1" }, error: null },
      },
      insertResult: { data: null, error: { message: "write failed", code: "XX000" } },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await postVerifiedPaymentWebhook({
      type: "invoice.paid",
      data: { object: { id: "in_write", subscription: "sub_known", amount_paid: 9000, customer: "cus_OTHER123" } },
    }, db);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Webhook error");
    error.mockRestore();
  });

  it("keeps a payment-intent log from failing the caller", async () => {
    await expect(warnUnmatchedPayment({
      from() {
        return { select: () => ({ eq: () => ({ limit: () => Promise.reject(new Error("db down")) }) }) };
      },
    }, { id: "pi_1", amount: 100, customer: "cus_ABCDEFGH" }, "paid")).resolves.toBeUndefined();
  });
});

describe("unmatched stripe source", () => {
  it("warns from the webhook without writing, and gates the screen before auth", () => {
    const webhook = readFileSync("src/routes/api/public/payments/webhook.ts", "utf8");
    const invoiceFn = webhook.slice(webhook.indexOf("async function upsertPaymentFromInvoice"), webhook.indexOf("async function handleChargeRefunded"));
    const intentFn = webhook.slice(webhook.indexOf("async function upsertPaymentFromPaymentIntent"), webhook.indexOf("async function upsertPaymentFromInvoice"));
    expect(invoiceFn).toContain("await warnUnmatchedInvoice(admin, invoice, status, null)");
    expect(invoiceFn).toContain("await warnUnmatchedInvoice(admin, invoice, status, subscriptionId)");
    expect(invoiceFn.indexOf("await warnUnmatchedInvoice")).toBeLessThan(invoiceFn.indexOf(".insert("));
    expect(invoiceFn).not.toContain("if (rentalResult.error) throw");
    expect(webhook).toContain("console.warn(formatUnmatchedWarn(");
    expect(intentFn).not.toContain("warnUnmatchedPayment");
    expect(webhook).toContain("async function warnUnmatchedInvoice");
    expect(webhook).toContain("export async function warnUnmatchedPayment");
    const invoiceWarn = webhook.slice(webhook.indexOf("async function warnUnmatchedInvoice"), webhook.indexOf("export async function warnUnmatchedPayment"));
    const paymentWarn = webhook.slice(webhook.indexOf("export async function warnUnmatchedPayment"), webhook.indexOf("async function upsertPaymentFromPaymentIntent"));
    expect(invoiceWarn).toContain("try {");
    expect(invoiceWarn).toContain("} catch {");
    expect(paymentWarn).toContain("try {");
    expect(paymentWarn).toContain("} catch {");
    const flag = readFileSync("src/lib/stripe-unmatched-flag.ts", "utf8");
    expect(flag.match(/export const STRIPE_UNMATCHED_PAYMENTS_ENABLED = false\b/g)).toHaveLength(1);
    expect(flag).not.toContain("process.env");
    const declarations = walk("src").flatMap((file) => readFileSync(file, "utf8").match(/export const STRIPE_UNMATCHED_PAYMENTS_ENABLED\b/g) ?? []);
    expect(declarations).toHaveLength(1);
    const handler = readFileSync("src/lib/stripe-unmatched.functions.ts", "utf8");
    const gate = handler.indexOf("if (!STRIPE_UNMATCHED_PAYMENTS_ENABLED)");
    const middleware = handler.slice(handler.indexOf(".middleware(["), handler.indexOf("])"));
    expect(middleware.indexOf("gateUnmatchedPayments")).toBeLessThan(middleware.indexOf("requireSupabaseAuth"));
    expect(handler.indexOf("user_roles")).toBeGreaterThan(gate);
    expect(handler.indexOf('await import("./stripe-unmatched.server")')).toBeGreaterThan(handler.indexOf("user_roles"));
    expect(handler.indexOf('await import("./stripe-reader.server")')).toBeGreaterThan(handler.indexOf("user_roles"));
    expect(handler).toContain('createReadOnlyStripe("live", { cache: true })');
    const reader = readFileSync("src/lib/stripe-reader.server.ts", "utf8");
    expect(reader).toContain('const READ_METHODS = ["list", "retrieve"] as const');
    expect(reader).toContain("Object.freeze(facade)");
    const panel = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
    expect(panel).toContain("STRIPE_UNMATCHED_PAYMENTS_ENABLED ? <UnmatchedStripePayments /> : null");
    const server = readFileSync("src/lib/stripe-unmatched.server.ts", "utf8");
    expect(server).toContain("invoiceIsLinked");
    expect(server).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
  });
});

function handlerDb(script: {
  maybeSingle?: Record<string, { data: unknown; error: { message?: string; code?: string } | null }>;
  limit?: Record<string, { data: unknown; error: { message?: string; code?: string } | null } | (() => Promise<unknown>)>;
  query?: Record<string, { data: unknown; error: { message?: string; code?: string } | null }>;
  insertResult?: { data: unknown; error: { message?: string; code?: string } | null };
}) {
  const inserts: unknown[] = [];
  const calls: string[] = [];
  return {
    inserts,
    calls,
    from(table: string) {
      const builder: any = {
        select() { return builder; },
        eq() { return builder; },
        in() { return builder; },
        neq() { return builder; },
        or() { return builder; },
        is() { return builder; },
        limit() {
          const spec = script.limit?.[table] ?? { data: [], error: null };
          return typeof spec === "function" ? spec() : Promise.resolve(spec);
        },
        maybeSingle() {
          calls.push(`maybe:${table}`);
          return Promise.resolve(script.maybeSingle?.[table] ?? { data: null, error: null });
        },
        insert(row: unknown) {
          calls.push(`insert:${table}`);
          inserts.push({ table, row });
          const pending = Promise.resolve(script.insertResult ?? { data: [{ id: "new" }], error: null });
          return { select: () => pending, then: pending.then.bind(pending) };
        },
        update() {
          const pending = Promise.resolve({ data: [], error: null });
          const chain: any = {
            eq: () => chain,
            in: () => chain,
            neq: () => chain,
            or: () => chain,
            select: () => pending,
          };
          return chain;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(script.query?.[table] ?? { data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function memoryDb(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      let cursor: string | null = null;
      const api = {
        select(_columns: string, options?: { count?: string }) {
          if (options?.count !== "exact") throw new Error("count");
          return api;
        },
        order(column: string) {
          if (column !== "id") throw new Error("order");
          return api;
        },
        gt(_column: string, value: string) {
          cursor = value;
          return api;
        },
        limit(n: number) {
          let rows = (tables[table] ?? []).slice().sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
          const count = rows.length;
          if (cursor) rows = rows.filter((row) => String(row.id) > cursor!);
          return Promise.resolve({ data: rows.slice(0, n), error: null, count });
        },
      };
      return api;
    },
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
  });
}
