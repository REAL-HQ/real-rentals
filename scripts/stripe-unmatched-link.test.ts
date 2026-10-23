import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { paymentRevenue } from "../src/lib/revenue-state";
import { runUnmatchedLink } from "../src/lib/stripe-unmatched-link.server";
import { linkUnmatchedInvoiceInput } from "../src/lib/stripe-unmatched-link.functions";

const requestReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    requestReads.count += 1;
    return new Request("https://example.test/");
  },
}));

const RENTAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAID_AT = Math.floor(Date.parse("2026-10-17T16:00:00Z") / 1000);

beforeEach(() => {
  requestReads.count = 0;
});

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: "in_123",
    status: "paid",
    livemode: true,
    currency: "usd",
    amount_paid: 35000,
    status_transitions: { paid_at: PAID_AT },
    subscription: "sub_1",
    payments: { data: [{ payment: { payment_intent: "pi_123" } }], has_more: false },
    ...over,
  };
}

function memory(state: {
  roles: string[];
  rental?: { id: string; application_id: string | null; vehicle_id: string | null } | null;
  payments?: Array<Record<string, unknown>>;
  insertError?: { code: string; message: string } | null;
}) {
  const inserts: Array<Record<string, unknown>> = [];
  return {
    inserts,
    from(table: string) {
      const filters: Array<{ col: string; val: unknown }> = [];
      let action: "select" | "insert" = "select";
      let payload: Record<string, unknown> | null = null;
      const exec = () => {
        if (table === "user_roles") return { data: state.roles.map((role) => ({ role })), error: null };
        if (table === "rentals") {
          const id = filters.find((filter) => filter.col === "id")?.val;
          const row = state.rental && state.rental.id === id ? state.rental : null;
          return { data: row, error: null };
        }
        if (action === "insert") {
          inserts.push({ ...payload });
          if (state.insertError) return { data: null, error: state.insertError };
          return { data: [{ id: "pay-1" }], error: null };
        }
        const rows = (state.payments ?? []).filter((row) => filters.every((filter) => row[filter.col] === filter.val));
        return { data: rows, error: null };
      };
      const builder: any = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push({ col, val }); return builder; },
        insert(row: Record<string, unknown>) { action = "insert"; payload = row; return builder; },
        maybeSingle() { return Promise.resolve(exec()); },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(exec()).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function stripeFor(row: unknown) {
  return { invoices: { retrieve: vi.fn(async () => row) } };
}

describe("link unmatched invoice", () => {
  it("inserts one rent row from the Stripe paid date and counts it once as Stripe", async () => {
    const db = memory({
      roles: ["team"],
      rental: { id: RENTAL, application_id: "app-1", vehicle_id: "veh-1" },
    });
    const stripe = stripeFor(invoice());
    const result = await runUnmatchedLink({
      enabled: true,
      supabase: db,
      stripe,
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    });
    expect(result).toEqual({ status: "linked", paymentId: "pay-1" });
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith("in_123", { expand: ["payments"] });
    expect(db.inserts).toEqual([{
      rental_id: RENTAL,
      driver_id: "app-1",
      vehicle_id: "veh-1",
      amount: 350,
      balance_due: 0,
      type: "rent",
      reason: "rent",
      status: "paid",
      due_date: "2026-10-17",
      paid_date: "2026-10-17",
      stripe_invoice_id: "in_123",
      stripe_subscription_id: "sub_1",
      stripe_payment_intent_id: "pi_123",
      failure_reason: null,
      notified_status: "paid",
    }]);
    const revenue = paymentRevenue({
      data: [{ net_collected: 350, stripe_payment_intent_id: "pi_123", stripe_invoice_id: "in_123", failure_reason: null }],
      count: 1,
      error: null,
    });
    // Counted once, and as Stripe: the row carries an invoice id and a payment
    // intent, so none of it falls into nonStripe. Asserted key by key because
    // paymentRevenue's shape is owned by revenue-state, not by this feature.
    expect(revenue?.total).toBe(350);
    expect(revenue?.nonStripe).toBe(0);
  });

  it("refuses an invoice id or payment intent that is already recorded, and a unique conflict", async () => {
    const existingInvoice = memory({
      roles: ["admin"],
      rental: { id: RENTAL, application_id: null, vehicle_id: null },
      payments: [{ id: "old", stripe_invoice_id: "in_123" }],
    });
    const byInvoice = await runUnmatchedLink({
      enabled: true,
      supabase: existingInvoice,
      stripe: stripeFor(invoice()),
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    });
    expect(byInvoice).toEqual({ status: "refused", reason: "This invoice is already recorded." });
    expect(existingInvoice.inserts).toEqual([]);

    const existingIntent = memory({
      roles: ["team"],
      rental: { id: RENTAL, application_id: null, vehicle_id: null },
      payments: [{ id: "old", stripe_payment_intent_id: "pi_123" }],
    });
    const byIntent = await runUnmatchedLink({
      enabled: true,
      supabase: existingIntent,
      stripe: stripeFor(invoice()),
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    });
    expect(byIntent).toEqual({ status: "refused", reason: "This invoice is already recorded." });
    expect(existingIntent.inserts).toEqual([]);

    const conflict = memory({
      roles: ["team"],
      rental: { id: RENTAL, application_id: null, vehicle_id: null },
      insertError: { code: "23505", message: "duplicate" },
    });
    const raced = await runUnmatchedLink({
      enabled: true,
      supabase: conflict,
      stripe: stripeFor(invoice()),
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    });
    expect(raced).toEqual({ status: "refused", reason: "This invoice is already recorded." });
  });

  it("refuses an unpaid invoice before inserting", async () => {
    const db = memory({ roles: ["team"], rental: { id: RENTAL, application_id: null, vehicle_id: null } });
    const stripe = stripeFor(invoice({ status: "open", amount_paid: 0 }));
    const result = await runUnmatchedLink({
      enabled: true,
      supabase: db,
      stripe,
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    });
    expect(result).toEqual({ status: "refused", reason: "Stripe says this invoice is not paid." });
    expect(stripe.invoices.retrieve).toHaveBeenCalledOnce();
    expect(db.inserts).toEqual([]);
  });

  it("refuses a missing paid date, a second payment, and an incomplete payment list", async () => {
    const db = memory({ roles: ["team"], rental: { id: RENTAL, application_id: null, vehicle_id: null } });
    const noDate = await runUnmatchedLink({
      enabled: true,
      supabase: db,
      stripe: stripeFor(invoice({ status_transitions: {}, created: PAID_AT })),
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    });
    expect(noDate).toEqual({ status: "refused", reason: "Stripe did not return a paid date." });
    const many = await runUnmatchedLink({
      enabled: true,
      supabase: db,
      stripe: stripeFor(invoice({ payments: { data: [{ payment: { payment_intent: "pi_1" } }, { payment: { payment_intent: "pi_2" } }], has_more: false } })),
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    });
    expect(many).toEqual({ status: "refused", reason: "This invoice has more than one payment, so it was not recorded." });
    const capped = await runUnmatchedLink({
      enabled: true,
      supabase: db,
      stripe: stripeFor(invoice({ payments: { data: [], has_more: true } })),
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    });
    expect(capped).toEqual({ status: "refused", reason: "Stripe did not return every payment on this invoice." });
    expect(db.inserts).toEqual([]);
  });

  it("records an invoice with no payment intent and stores no payment intent", async () => {
    const db = memory({ roles: ["team"], rental: { id: RENTAL, application_id: "app-1", vehicle_id: null } });
    const result = await runUnmatchedLink({
      enabled: true,
      supabase: db,
      stripe: stripeFor(invoice({ payments: { data: [], has_more: false }, subscription: null })),
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    });
    expect(result.status).toBe("linked");
    expect(db.inserts[0].stripe_payment_intent_id).toBeNull();
    expect(db.inserts[0].stripe_subscription_id).toBeNull();
    expect(db.inserts[0].notified_status).toBe("paid");
  });

  it("refuses a coordinator before reading Stripe", async () => {
    const db = memory({ roles: ["coordinator"], rental: { id: RENTAL, application_id: null, vehicle_id: null } });
    const stripe = stripeFor(invoice());
    await expect(runUnmatchedLink({
      enabled: true,
      supabase: db,
      stripe,
      userId: "user-1",
      invoiceId: "in_123",
      rentalId: RENTAL,
    })).rejects.toThrow("Forbidden");
    expect(stripe.invoices.retrieve).not.toHaveBeenCalled();
    expect(db.inserts).toEqual([]);
  });

  it("returns disabled before auth when the flag is off and the request has no authorization header", async () => {
    const { gateUnmatchedLink } = await import("../src/lib/stripe-unmatched-link.functions");
    const { requireSupabaseAuth } = await import("../src/integrations/supabase/auth-middleware");
    process.env.SUPABASE_URL = "http://127.0.0.1:9";
    process.env.SUPABASE_PUBLISHABLE_KEY = "dummy";
    const blocked = await gateUnmatchedLink.options.server({
      next: () => requireSupabaseAuth.options.server({ next: async () => ({ result: "authed" }) }),
    });
    expect(blocked).toEqual({ result: { status: "disabled" } });
    expect(requestReads.count).toBe(0);
    await expect(requireSupabaseAuth.options.server({ next: async () => ({ result: "authed" }) })).rejects.toThrow("No authorization header");
    expect(requestReads.count).toBe(1);
  });

  it("rejects a client-supplied amount or date and keeps the link server off email and Stripe writes", () => {
    expect(() => linkUnmatchedInvoiceInput.parse({ invoiceId: "in_123", rentalId: RENTAL, amount: 350 })).toThrow();
    expect(() => linkUnmatchedInvoiceInput.parse({ invoiceId: "in_123", rentalId: RENTAL, paid_date: "2026-10-17" })).toThrow();
    const server = readFileSync("src/lib/stripe-unmatched-link.server.ts", "utf8");
    expect(server).not.toContain("email.server");
    expect(server).not.toContain("notifications");
    expect(server).not.toMatch(/paymentIntents\.create|invoices\.pay|refunds\.create/);
    expect(server).toContain('notified_status: "paid"');
    expect(server).toContain("failure_reason: null");
    const handler = readFileSync("src/lib/stripe-unmatched-link.functions.ts", "utf8");
    const middleware = handler.slice(handler.indexOf(".middleware(["), handler.indexOf("])"));
    expect(middleware.indexOf("gateUnmatchedLink")).toBeLessThan(middleware.indexOf("requireSupabaseAuth"));
    expect(handler.indexOf("user_roles")).toBeLessThan(handler.indexOf('await import("@/lib/stripe-reader.server")'));
    expect(handler).toContain('createReadOnlyStripe("live")');
    expect(handler).not.toContain("cache: true");
    const flag = readFileSync("src/lib/stripe-unmatched-link-flag.ts", "utf8");
    expect(flag.match(/export const STRIPE_UNMATCHED_LINK_ENABLED = false\b/g)).toHaveLength(1);
    expect(flag).not.toContain("process.env");
    const declarations = walk("src").flatMap((file) => readFileSync(file, "utf8").match(/export const STRIPE_UNMATCHED_LINK_ENABLED\b/g) ?? []);
    expect(declarations).toHaveLength(1);
    const panel = readFileSync("src/components/admin/UnmatchedStripePayments.tsx", "utf8");
    expect(panel).toContain("STRIPE_UNMATCHED_LINK_ENABLED && (");
    expect(panel).toContain("Link to Rental");
    expect(panel).toContain("link({ data: { invoiceId, rentalId } })");
    expect(readFileSync("src/lib/stripe-unmatched.server.ts", "utf8")).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [path] : [];
  });
}
