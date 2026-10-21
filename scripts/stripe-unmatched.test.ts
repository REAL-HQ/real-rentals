import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

describe("unmatched stripe source", () => {
  it("warns from the webhook without writing, and gates the screen before auth", () => {
    const webhook = readFileSync("src/routes/api/public/payments/webhook.ts", "utf8");
    const invoiceFn = webhook.slice(webhook.indexOf("async function upsertPaymentFromInvoice"), webhook.indexOf("async function handleChargeRefunded"));
    expect(invoiceFn).toContain("await warnUnmatchedInvoice(admin, invoice, status, null)");
    expect(invoiceFn).toContain("await warnUnmatchedInvoice(admin, invoice, status, subscriptionId)");
    expect(invoiceFn.indexOf("await warnUnmatchedInvoice")).toBeLessThan(invoiceFn.indexOf(".insert("));
    expect(webhook).toContain("console.warn(formatUnmatchedWarn(");
    expect(webhook).toContain("await warnUnmatchedPayment(admin, pi, status)");
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
    expect(reader).toContain('new Set(["list", "retrieve"])');
    expect(reader).toContain("Stripe reader refuses");
    const panel = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
    expect(panel).toContain("STRIPE_UNMATCHED_PAYMENTS_ENABLED ? <UnmatchedStripePayments /> : null");
    const server = readFileSync("src/lib/stripe-unmatched.server.ts", "utf8");
    expect(server).toContain("invoiceIsLinked");
    expect(server).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
  });
});

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
