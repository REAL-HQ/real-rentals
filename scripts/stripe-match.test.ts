import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visibleTabs, visibleWorkspaceTabs } from "../src/components/admin/nav-config";
import { STRIPE_MATCH_REPORT_ENABLED } from "../src/lib/stripe-match-flag";
import { etDate, matchStripeCustomers, type MatchApplication, type MatchRental, type MatchVehicle, type StripeMatchCustomer } from "../src/lib/stripe-match";
import { readStripeMatchWindow, type ReadOnlyStripeGateway } from "../src/lib/stripe-match-read.server";
import { runStripeMatch } from "../src/lib/stripe-match.server";

const app = (patch: Partial<MatchApplication> & Pick<MatchApplication, "id">): MatchApplication => ({
  fullName: "Ada Lovelace", email: "ada@example.com", phone: "5551112222", stripeCustomerId: null,
  vehicleId: null, userId: null, deletedAt: null, status: "approved", ...patch,
});
const customer = (patch: Partial<StripeMatchCustomer> & Pick<StripeMatchCustomer, "id">): StripeMatchCustomer => ({
  name: "Ada Lovelace", email: "ada@example.com", phone: "+15551112222", status: "active", weeklyAmountCents: 35000, lastPaidAt: null, ...patch,
});
const price = (cents: number, interval = "week") => ({
  has_more: false,
  data: [{ quantity: 1, price: { unit_amount: cents, currency: "usd", recurring: { interval, interval_count: 1 } } }],
});

describe("flag", () => {
  it("is a hard-false constant with no environment read", () => {
    expect(STRIPE_MATCH_REPORT_ENABLED).toBe(false);
    const flag = readFileSync("src/lib/stripe-match-flag.ts", "utf8");
    expect(flag).toContain("export const STRIPE_MATCH_REPORT_ENABLED = false");
    expect(flag).not.toMatch(/process\.env|import\.meta\.env/);
  });

  it("does not read the directory or Stripe when the flag is off", async () => {
    let called = false;
    const touch = async () => { called = true; throw new Error("read"); };
    const result = await runStripeMatch({ userId: "owner-1", roles: ["admin"], enabled: false, loadDirectory: touch, readStripe: touch });
    expect(result).toEqual({ status: "disabled", report: null });
    expect(called).toBe(false);
  });

  it("refuses a coordinator before any read", async () => {
    let called = false;
    const touch = async () => { called = true; throw new Error("read"); };
    await expect(runStripeMatch({
      userId: "coord-1", roles: ["coordinator"], enabled: true, loadDirectory: touch, readStripe: touch,
    })).rejects.toThrow("Forbidden");
    expect(called).toBe(false);
  });

  it("does not call Stripe when the directory is incomplete", async () => {
    let stripe = false;
    const result = await runStripeMatch({
      userId: "mgr-1", roles: ["team"], enabled: true,
      loadDirectory: async () => null,
      readStripe: async () => { stripe = true; return { ok: false, reason: "no" }; },
    });
    expect(result.status).toBe("unavailable");
    expect(stripe).toBe(false);
  });
});

describe("matching", () => {
  const vehicle: MatchVehicle = { id: "veh-1", year: 2022, make: "Toyota", model: "Camry", licensePlate: "ABC123" };
  const other: MatchVehicle = { id: "veh-2", year: 2021, make: "Honda", model: "Civic", licensePlate: "ZZZ999" };

  it("prefers a unique Stripe customer id over a conflicting email", () => {
    const report = matchStripeCustomers({
      applications: [app({ id: "app-1", stripeCustomerId: "cus_1", email: "other@example.com", vehicleId: "veh-1" })],
      rentals: [], vehicles: [vehicle],
      customers: [customer({ id: "cus_1", email: "ada@example.com" })],
    });
    expect(report.unmatched).toEqual([]);
    expect(report.matched[0]).toMatchObject({ confidence: "high", reason: "Stripe Customer Id", driverId: "app-1", rentalExists: false, vehicleLabel: "2022 Toyota Camry · ABC123" });
  });

  it("matches exact email, ignoring case, and then phone", () => {
    const byEmail = matchStripeCustomers({
      applications: [app({ id: "app-1", email: "Ada@Example.com", phone: "5550000000" })],
      rentals: [], vehicles: [], customers: [customer({ id: "cus_1", email: "ada@example.com", phone: "+15551112222" })],
    });
    expect(byEmail.matched[0]).toMatchObject({ confidence: "medium", reason: "Exact Email", driverId: "app-1" });
    const byPhone = matchStripeCustomers({
      applications: [app({ id: "app-1", email: "other@example.com", phone: "(555) 111-2222" })],
      rentals: [], vehicles: [], customers: [customer({ id: "cus_1", email: "ada@example.com", phone: "+1 555 111 2222" })],
    });
    expect(byPhone.matched[0]).toMatchObject({ confidence: "low", reason: "Phone", driverId: "app-1" });
  });

  it("leaves an ambiguous tier unmatched and does not fall through", () => {
    const report = matchStripeCustomers({
      applications: [
        app({ id: "app-1", email: "ada@example.com", phone: "5551112222" }),
        app({ id: "app-2", fullName: "Other", email: "ada@example.com", phone: "5559998888" }),
      ],
      rentals: [], vehicles: [], customers: [customer({ id: "cus_1" })],
    });
    expect(report.matched).toEqual([]);
    expect(report.unmatched[0]).toMatchObject({ reason: "More Than One Email", driverId: null, rentalExists: false });
  });

  it("uses a rental customer id and the rental vehicle, and ignores deleted or duplicate rows", () => {
    const rental: MatchRental = { id: "rent-1", applicationId: "app-1", driverId: "user-1", vehicleId: "veh-2", stripeCustomerId: "cus_1" };
    const report = matchStripeCustomers({
      applications: [
        app({ id: "app-1", email: "other@example.com", userId: "user-1", vehicleId: "veh-1" }),
        app({ id: "gone", stripeCustomerId: "cus_1", deletedAt: "2026-01-01", email: "ada@example.com" }),
        app({ id: "dup", stripeCustomerId: "cus_1", status: "duplicate", email: "ada@example.com" }),
      ],
      rentals: [rental], vehicles: [vehicle, other], customers: [customer({ id: "cus_1" })],
    });
    expect(report.matched[0]).toMatchObject({ driverId: "app-1", confidence: "high", rentalExists: true, vehicleId: "veh-2", vehicleLabel: "2021 Honda Civic · ZZZ999" });
  });

  it("dates the last succeeded charge in Eastern Time and skips a blank email", () => {
    const paid = Math.floor(Date.parse("2026-01-15T04:30:00.000Z") / 1000);
    expect(etDate(paid)).toBe("2026-01-14");
    const report = matchStripeCustomers({
      applications: [app({ id: "app-1", email: "  " })],
      rentals: [], vehicles: [], customers: [customer({ id: "cus_1", email: " ", phone: "nope", lastPaidAt: paid })],
    });
    expect(report.unmatched[0]).toMatchObject({ reason: "No Match", lastPaidDate: "2026-01-14" });
  });

  it("shows the match report to managers and owners only", () => {
    expect(visibleTabs("coordinator").some((tab) => tab.id === "stripe_match")).toBe(false);
    expect(visibleTabs("manager").some((tab) => tab.id === "stripe_match")).toBe(true);
    expect(visibleWorkspaceTabs("payments", "manager").map((tab) => tab.id)).toContain("stripe_match");
    expect(visibleWorkspaceTabs("payments", "coordinator")).toEqual([]);
  });
});

describe("reader", () => {
  const sub = (id: string, customer: object | string, status: "active" | "past_due" = "active", items = price(35000)) =>
    ({ id, status, livemode: true, customer, items });
  const gateway = (pages: { active?: object[]; pastDue?: object[]; charges?: object[]; customer?: object }): ReadOnlyStripeGateway => ({
    subscriptions: { list: async (params) => ({ data: (params.status === "active" ? pages.active : pages.pastDue) ?? [], has_more: false }) },
    charges: { list: async () => ({ data: pages.charges ?? [], has_more: false }) },
    customers: { retrieve: async () => pages.customer ?? { id: "missing", livemode: true } },
  });

  it("lists subscriptions and retrieves an unexpanded customer", async () => {
    let retrieved = "";
    const result = await readStripeMatchWindow({
      ...gateway({
        active: [sub("sub_1", "cus_1")],
        charges: [{ id: "ch_1", customer: "cus_1", created: Math.floor(Date.parse("2026-01-15T04:30:00.000Z") / 1000), paid: true, captured: true, status: "succeeded", livemode: true }],
        customer: { id: "cus_1", name: "Ada Lovelace", email: "Ada@Example.com", phone: "+15551112222", livemode: true },
      }),
      customers: { retrieve: async (id) => { retrieved = id; return { id, name: "Ada Lovelace", email: "Ada@Example.com", phone: "+15551112222", livemode: true }; } },
    }, { now: () => Date.parse("2026-02-01T00:00:00.000Z") });
    expect(retrieved).toBe("cus_1");
    expect(result.ok && result.customers[0]).toMatchObject({ id: "cus_1", name: "Ada Lovelace", email: "Ada@Example.com", weeklyAmountCents: 35000, status: "active" });
  });

  it("keeps past due over active and sums weekly prices, and blanks a non-weekly price", async () => {
    const summed = await readStripeMatchWindow(gateway({
      active: [sub("sub_1", { id: "cus_1", name: "Ada", email: "ada@example.com", livemode: true })],
      pastDue: [sub("sub_2", { id: "cus_1", name: "Ada", email: "ada@example.com", livemode: true }, "past_due", price(10000))],
    }));
    expect(summed.ok && summed.customers[0]).toMatchObject({ status: "past_due", weeklyAmountCents: 45000 });
    const monthly = await readStripeMatchWindow(gateway({
      active: [sub("sub_1", { id: "cus_1", name: "Ada", email: "ada@example.com", livemode: true }, "active", price(35000, "month"))],
    }));
    expect(monthly.ok && monthly.customers[0]?.weeklyAmountCents).toBeNull();
  });

  it("discards a partial page, a timeout, and a test-mode row", async () => {
    const partial = await readStripeMatchWindow({
      subscriptions: { list: async (params) => params.starting_after
        ? { data: [sub("sub_1", "cus_1")], has_more: true }
        : { data: [sub("sub_1", "cus_1")], has_more: true } },
      charges: { list: async () => ({ data: [], has_more: false }) },
      customers: { retrieve: async () => { throw new Error("should not retrieve"); } },
    });
    expect(partial.ok).toBe(false);
    const timed = await readStripeMatchWindow(gateway({ active: [sub("sub_1", "cus_1")] }), { timeoutMs: 0, now: () => 1_000 });
    expect(timed.ok).toBe(false);
    const testMode = await readStripeMatchWindow(gateway({ active: [{ ...sub("sub_1", "cus_1"), livemode: false }] }));
    expect(testMode.ok).toBe(false);
  });

  it("only references list and retrieve", () => {
    const source = readFileSync("src/lib/stripe-match-read.server.ts", "utf8");
    const refs = [...source.matchAll(/gateway\.(\w+)\.(\w+)/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(new Set(refs)).toEqual(new Set(["subscriptions.list", "charges.list", "customers.retrieve"]));
    const forbidden = ["create", "update", "del", "delete", "capture", "confirm", "cancel", "refund"];
    for (const file of ["src/lib/stripe-match-read.server.ts", "src/lib/stripe-match.functions.ts", "src/lib/stripe-match.server.ts"]) {
      const text = readFileSync(file, "utf8");
      for (const verb of forbidden) expect(text).not.toMatch(new RegExp(`\\.${verb}\\(`));
    }
    const runner = readFileSync("src/lib/stripe-match.server.ts", "utf8");
    const body = runner.slice(runner.indexOf("export async function runStripeMatch"));
    const enabledAt = body.indexOf("if (!input.enabled)");
    expect(enabledAt).toBeGreaterThan(-1);
    expect(enabledAt).toBeLessThan(body.indexOf("input.userId"));
    expect(enabledAt).toBeLessThan(body.indexOf("loadDirectory("));
    expect(body.indexOf("loadDirectory(")).toBeLessThan(body.indexOf("readStripe("));
    const handler = readFileSync("src/lib/stripe-match.functions.ts", "utf8");
    const handlerBody = handler.slice(handler.indexOf(".handler"));
    const flagAt = handlerBody.indexOf("if (!STRIPE_MATCH_REPORT_ENABLED)");
    expect(flagAt).toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(handlerBody.indexOf('from("user_roles")'));
    expect(flagAt).toBeLessThan(handlerBody.indexOf("readLiveStripeMatch("));
    expect(handler).toContain("readLiveStripeMatch");
    expect(handler).not.toContain("process.env");
    expect(handler).not.toContain("createStripeClient");
  });
});
