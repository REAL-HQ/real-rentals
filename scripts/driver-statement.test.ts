import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDriverStatement, escapeCsvCell, statementToCsv, type StatementCharge, type StatementInvoice, type StatementRefund } from "../src/lib/driver-statement";
import { driverStatementEnabled } from "../src/lib/driver-statement-flag";
import { readDriverStatement, type StatementStripeGateway } from "../src/lib/driver-statement-read.server";
import { runDriverStatement } from "../src/lib/driver-statement.server";
import type { DriverMatchApplication, DriverMatchRental } from "../src/lib/stripe-driver-match";

const read = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const DAY = Math.floor(Date.parse("2026-10-21T15:00:00.000Z") / 1000);
const ada: DriverMatchApplication = {
  id: "app_ada", fullName: "Ada Driver", email: "ada@example.com", phone: "(555) 111-2222",
  stripeCustomerId: "cus_ada", userId: "user_ada", deletedAt: null, status: "active",
};
const charge = (over: Partial<StatementCharge> = {}): StatementCharge => ({
  id: "ch_1", amountCents: 10000, currency: "usd", created: DAY, description: "Weekly rent", status: "succeeded", succeeded: true,
  customer: { id: "cus_ada", email: "ada@example.com", phone: null }, ...over,
});
const refund = (over: Partial<StatementRefund> = {}): StatementRefund => ({
  id: "re_1", amountCents: 2500, currency: "usd", created: DAY + 86400, description: "Refund · Requested By Customer", status: "succeeded",
  customer: { id: "cus_ada", email: "other@example.com", phone: null }, ...over,
});
const invoice = (over: Partial<StatementInvoice> = {}): StatementInvoice => ({
  id: "in_open", amountCents: 4000, currency: "usd", created: DAY + 172800, description: "Invoice INV-9", status: "open", outstandingCents: 4000,
  customer: { id: "cus_ada", email: null, phone: null }, ...over,
});
const build = (over: Partial<Parameters<typeof buildDriverStatement>[0]> = {}) => buildDriverStatement({
  driverId: "app_ada", applications: [ada], rentals: [], charges: [charge()], refunds: [], invoices: [], ...over,
});

describe("matching", () => {
  it("keeps a row when the Stripe customer id, email, or phone is this driver", () => {
    const byId = build();
    expect(byId?.rows.map((row) => row.id)).toEqual(["ch_1"]);
    const byEmail = build({
      applications: [{ ...ada, stripeCustomerId: null }],
      charges: [charge({ customer: { id: "cus_other", email: "Ada@Example.com", phone: null } })],
    });
    expect(byEmail?.rows).toHaveLength(1);
    const byPhone = build({
      applications: [{ ...ada, stripeCustomerId: null, email: "nope@example.com" }],
      charges: [charge({ customer: { id: "cus_phone", email: "missing@example.com", phone: "+1 555 111 2222" } })],
    });
    expect(byPhone?.rows).toHaveLength(1);
    const byRental = build({
      applications: [{ ...ada, stripeCustomerId: null, email: "nope@example.com", phone: null }],
      rentals: [{ id: "rent_1", applicationId: "app_ada", driverId: null, stripeCustomerId: "cus_rent" } satisfies DriverMatchRental],
      charges: [charge({ customer: { id: "cus_rent", email: null, phone: null } })],
    });
    expect(byRental?.rows).toHaveLength(1);
  });

  it("drops another driver and does not fall through an ambiguous email", () => {
    const other = build({ charges: [charge({ customer: { id: "cus_bea", email: "bea@example.com", phone: null } })] });
    expect(other?.rows).toEqual([]);
    expect(other?.totals).toEqual({ paidCents: 0, refundedCents: 0, outstandingCents: 0 });
    const ambiguous = build({
      applications: [ada, { ...ada, id: "app_bea", email: "ada@example.com", stripeCustomerId: null, userId: "user_bea", phone: null }],
      charges: [charge({ customer: { id: "cus_new", email: "ada@example.com", phone: "+15551112222" } })],
    });
    expect(ambiguous?.rows).toEqual([]);
  });
});

describe("totals", () => {
  it("runs paid, refunded, and outstanding without counting a paid invoice twice", () => {
    const report = build({
      charges: [charge(), charge({ id: "ch_fail", amountCents: 9000, status: "failed", succeeded: false, created: DAY - 10 })],
      refunds: [refund(), refund({ id: "re_pending", amountCents: 100, status: "pending", created: DAY + 10 })],
      invoices: [invoice(), invoice({ id: "in_paid", status: "paid", amountCents: 10000, outstandingCents: null, created: DAY })],
    });
    expect(report?.rows.map((row) => [row.id, row.date, row.runningPaid, row.runningRefunded, row.runningOutstanding])).toEqual([
      ["ch_fail", "2026-10-21", 0, 0, 0],
      ["ch_1", "2026-10-21", 10000, 0, 0],
      ["in_paid", "2026-10-21", 10000, 0, 0],
      ["re_pending", "2026-10-21", 10000, 0, 0],
      ["re_1", "2026-10-22", 10000, 2500, 0],
      ["in_open", "2026-10-23", 10000, 2500, 4000],
    ]);
    expect(report?.totals).toEqual({ paidCents: 10000, refundedCents: 2500, outstandingCents: 4000 });
    expect(report?.rows.find((row) => row.id === "re_1")?.amountCents).toBe(-2500);
  });

  it("withholds totals when a counted amount is not USD and rejects a conflicting duplicate", () => {
    expect(build({ invoices: [invoice({ currency: "eur" })] })?.totals).toBeNull();
    expect(build({ charges: [charge(), charge({ amountCents: 1 })] })).toBeNull();
  });
});

describe("CSV escaping", () => {
  it("quotes commas, quotes, and newlines, and neutralizes formulas", () => {
    expect(escapeCsvCell("Weekly rent")).toBe("Weekly rent");
    expect(escapeCsvCell('say "hi", please')).toBe('"say ""hi"", please"');
    expect(escapeCsvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(escapeCsvCell("=1+1")).toBe(`"'=1+1"`);
    expect(escapeCsvCell("+15551112222")).toBe(`"'+15551112222"`);
    const csv = statementToCsv(build({ charges: [charge({ description: 'say "hi", please' })] })!);
    expect(csv).toContain('"say ""hi"", please"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain("Paid,100.00");
  });
});

describe("flag off", () => {
  it("is on only for the exact string true", () => {
    expect(driverStatementEnabled({ DRIVER_STATEMENT_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "TRUE", "1", "yes", " true", "true "]) expect(driverStatementEnabled({ DRIVER_STATEMENT_ENABLED: value })).toBe(false);
  });

  it("returns before drivers and Stripe, and refuses a coordinator", async () => {
    let loads = 0;
    let reads = 0;
    const load = async () => { loads += 1; return { applications: [ada], rentals: [] }; };
    const readStripe = async () => { reads += 1; return { ok: true as const, charges: [], refunds: [], invoices: [] }; };
    expect(await runDriverStatement({ enabled: false, userId: "user", roles: ["admin"], driverId: "app_ada", load, readStripe })).toEqual({ status: "disabled", report: null });
    await expect(runDriverStatement({ enabled: true, userId: null, roles: ["admin"], driverId: "app_ada", load, readStripe })).rejects.toThrow("Forbidden");
    await expect(runDriverStatement({ enabled: true, userId: "user", roles: ["coordinator"], driverId: "app_ada", load, readStripe })).rejects.toThrow("Forbidden");
    expect(loads).toBe(0);
    expect(reads).toBe(0);
    const missing = await runDriverStatement({ enabled: true, userId: "user", roles: ["team"], driverId: "app_missing", load, readStripe });
    expect(missing).toMatchObject({ status: "unavailable" });
    expect(loads).toBe(1);
    expect(reads).toBe(0);
  });

  it("checks the flag before any role or Stripe read", () => {
    const source = read("lib/driver-statement.functions.ts");
    const handler = source.slice(source.indexOf(".handler"));
    const flag = handler.indexOf("driverStatementEnabled()");
    expect(flag).toBeGreaterThan(-1);
    expect(flag).toBeLessThan(handler.indexOf('from("user_roles")'));
    expect(flag).toBeLessThan(handler.indexOf("readLiveDriverStatement"));
    const reader = read("lib/driver-statement-read.server.ts");
    const calls = [...reader.matchAll(/gateway\.(\w+)\.(\w+)/g)].map((match) => `${match[1]}.${match[2]}`);
    const allowed = new Set(["charges.list", "charges.retrieve", "refunds.list", "invoices.list", "customers.retrieve"]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => allowed.has(call))).toBe(true);
    expect(reader).not.toMatch(/\.(create|update|del|delete|capture|confirm|cancel|refund|createPreview|retrieveUpcoming)\s*\(/);
    const panel = read("components/admin/DriverStatement.tsx");
    expect(panel).toContain("Download CSV");
    expect(panel).toContain("text/csv");
    expect(panel).not.toContain("settleDeposit");
  });
});

describe("Stripe reader", () => {
  it("retrieves an unexpanded customer and skips an invoice that is not a subscription", async () => {
    const calls: string[] = [];
    const customer = { id: "cus_ada", email: "ada@example.com", phone: null, livemode: true };
    const gateway: StatementStripeGateway = {
      charges: {
        list: async (params) => {
          calls.push("charges.list");
          expect(params.expand).toEqual(["data.customer"]);
          return { data: [{ id: "ch_1", amount: 10000, amount_captured: 10000, currency: "usd", status: "succeeded", paid: true, captured: true, created: DAY, description: "Weekly rent", customer: "cus_late", livemode: true }], has_more: false };
        },
        retrieve: async (id) => { calls.push(`charges.retrieve:${id}`); return { id, livemode: false }; },
      },
      refunds: { list: async () => ({ data: [{ id: "re_1", amount: 500, currency: "usd", status: "succeeded", reason: "duplicate", created: DAY, charge: { id: "ch_old", customer, livemode: true }, livemode: true }], has_more: false }) },
      invoices: { list: async () => ({ data: [
        { id: "in_one", currency: "usd", status: "paid", created: DAY, amount_paid: 100, customer, livemode: true },
        { id: "in_sub", currency: "usd", status: "open", created: DAY, amount_remaining: 4000, number: "INV-9", customer: "cus_late", parent: { subscription_details: { subscription: "sub_1" } }, livemode: true },
      ], has_more: false }) },
      customers: { retrieve: async (id) => { calls.push(`customers.retrieve:${id}`); return { ...customer, id }; } },
    };
    const result = await readDriverStatement(gateway, { now: () => Date.parse("2026-10-21T15:00:00.000Z") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charges[0]?.customer).toMatchObject({ id: "cus_late", email: "ada@example.com" });
    expect(result.refunds[0]).toMatchObject({ description: "Refund · Duplicate", customer: { email: "ada@example.com" } });
    expect(result.invoices.map((row) => row.id)).toEqual(["in_sub"]);
    expect(calls).toContain("customers.retrieve:cus_late");
    expect(calls.join(" ")).not.toContain("charges.retrieve");
  });
});
