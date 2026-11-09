import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  BILLING_PAGE_CAP,
  REASON_AMOUNT,
  REASON_CANCELED,
  REASON_DUE,
  REASON_INCOMPLETE,
  REASON_NO_SUBSCRIPTION,
  REASON_OVERBILLING,
  REASON_PAST_DUE,
  REASON_UNPAID,
  billingHealthToCsv,
  buildBillingHealth,
  type BillingRental,
  type BillingSubscription,
} from "../src/lib/billing-health";
import { runBillingHealth } from "../src/lib/billing-health.server";
import { readBillingSubscriptions, type BillingStripeGateway } from "../src/lib/billing-health-read.server";

function unixOn(ymd: string): number {
  return Math.floor(Date.parse(`${ymd}T12:00:00Z`) / 1000);
}

function rental(over: Partial<BillingRental> = {}): BillingRental {
  return {
    id: "rental-1",
    status: "active",
    weeklyRate: 350,
    nextPaymentDue: "2026-10-21",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    applicationId: "app-1",
    driverName: "Ada Lovelace",
    vehicleLabel: "Unit 7 · 2020 Honda Civic",
    ...over,
  };
}

function sub(over: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    id: "sub_1",
    status: "active",
    customerId: "cus_1",
    customerName: "Ada Lovelace",
    periodEnd: unixOn("2026-10-21"),
    weeklyAmountCents: 35000,
    ...over,
  };
}

it("flags an active rental with no Stripe subscription", () => {
  const rows = buildBillingHealth({
    rentals: [rental({ stripeCustomerId: null, stripeSubscriptionId: null, driverName: 'Lovelace, "Ada"', applicationId: "app-9" })],
    subscriptions: [],
  }).mismatches;
  expect(rows.map((row) => row.reason)).toEqual([REASON_NO_SUBSCRIPTION]);
  expect(rows[0]?.rentalId).toBe("rental-1");
  expect(rows[0]?.applicationId).toBe("app-9");
  const csv = billingHealthToCsv({ mismatches: rows, warnings: [], activeRentals: 1, subscriptions: 0 });
  expect(csv).toContain('"Lovelace, ""Ada"""');
  expect(csv).toContain("/admin?tab=bookings&id=rental-1");
  expect(csv).toContain("/admin?tab=drivers&id=app-9");
  expect(csv).toContain(REASON_NO_SUBSCRIPTION);
});

it("flags past due, unpaid, incomplete, and canceled subscriptions on active rentals", () => {
  const cases = [
    ["past_due", REASON_PAST_DUE],
    ["unpaid", REASON_UNPAID],
    ["incomplete", REASON_INCOMPLETE],
    ["canceled", REASON_CANCELED],
  ] as const;
  const report = buildBillingHealth({
    rentals: cases.map((_, index) => rental({
      id: `rental-${index}`,
      stripeSubscriptionId: `sub_${index}`,
      stripeCustomerId: `cus_${index}`,
      applicationId: `app-${index}`,
    })),
    subscriptions: cases.map(([status], index) => sub({ id: `sub_${index}`, customerId: `cus_${index}`, status })),
  });
  expect(report.mismatches.map((row) => row.reason)).toEqual(cases.map(([, reason]) => reason));
  expect(report.mismatches.every((row) => row.kind === "status" && row.rentalId)).toBe(true);
});

it("flags a subscription amount that differs from the weekly rate", () => {
  const report = buildBillingHealth({
    rentals: [
      rental({ id: "off", weeklyRate: 300 }),
      rental({ id: "match", stripeSubscriptionId: "sub_match", stripeCustomerId: "cus_match" }),
    ],
    subscriptions: [
      sub({ weeklyAmountCents: 35000 }),
      sub({ id: "sub_match", customerId: "cus_match", weeklyAmountCents: 35000 }),
    ],
  });
  expect(report.mismatches.map((row) => [row.rentalId, row.reason])).toEqual([["off", REASON_AMOUNT]]);
});

it("flags a due date more than one day off and keeps a one day gap", () => {
  const report = buildBillingHealth({
    rentals: [
      rental({ id: "two", stripeSubscriptionId: "sub_two", stripeCustomerId: "cus_two", nextPaymentDue: "2026-10-21" }),
      rental({ id: "one", stripeSubscriptionId: "sub_one", stripeCustomerId: "cus_one", nextPaymentDue: "2026-10-21" }),
    ],
    subscriptions: [
      sub({ id: "sub_two", customerId: "cus_two", periodEnd: unixOn("2026-10-23") }),
      sub({ id: "sub_one", customerId: "cus_one", periodEnd: unixOn("2026-10-22") }),
    ],
  });
  expect(report.mismatches.map((row) => [row.rentalId, row.reason])).toEqual([["two", REASON_DUE]]);
});

it("flags an active Stripe subscription with no active rental", () => {
  const report = buildBillingHealth({
    rentals: [rental()],
    subscriptions: [sub(), sub({ id: "sub_extra", customerId: "cus_extra", customerName: null })],
    driverLinks: [{ customerId: "cus_extra", applicationId: "app-extra", driverName: "Grace Hopper" }],
  });
  expect(report.mismatches).toEqual([
    expect.objectContaining({
      kind: "overbilling",
      reason: REASON_OVERBILLING,
      rentalId: null,
      applicationId: "app-extra",
      driverName: "Grace Hopper",
      subscriptionId: "sub_extra",
    }),
  ]);
  expect(billingHealthToCsv(report)).toContain("/admin?tab=drivers&id=app-extra");
});

it("returns disabled before any read when the flag is off", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const readStripe = vi.fn(async () => {
    throw new Error("stripe");
  });
  await expect(runBillingHealth({ enabled: false, userId: "owner", tier: "owner", load, readStripe })).resolves.toEqual({
    status: "disabled",
    report: null,
  });
  expect(load).not.toHaveBeenCalled();
  expect(readStripe).not.toHaveBeenCalled();
});

it("refuses a non-owner before any read", async () => {
  const load = vi.fn(async () => {
    throw new Error("load");
  });
  const readStripe = vi.fn(async () => {
    throw new Error("stripe");
  });
  await expect(runBillingHealth({ enabled: true, userId: "manager", tier: "manager", load, readStripe })).rejects.toThrow("Forbidden");
  await expect(runBillingHealth({ enabled: true, userId: null, tier: "owner", load, readStripe })).rejects.toThrow("Forbidden");
  expect(load).not.toHaveBeenCalled();
  expect(readStripe).not.toHaveBeenCalled();
});

it("shows the page cap warning and does not read rentals", async () => {
  let listCalls = 0;
  let retrieveCalls = 0;
  const gateway: BillingStripeGateway = {
    subscriptions: {
      list: async () => {
        listCalls += 1;
        return {
          has_more: true,
          data: [{ id: `sub_${listCalls}`, status: "active", livemode: true, customer: "cus_1", items: { has_more: false, data: [] } }],
        };
      },
    },
    customers: {
      retrieve: async () => {
        retrieveCalls += 1;
        return { id: "cus_1", livemode: true };
      },
    },
  };
  const load = vi.fn(async () => ({ ok: true as const, directory: { rentals: [], driverLinks: [] } }));
  const result = await runBillingHealth({
    enabled: true,
    userId: "owner",
    tier: "owner",
    load,
    readStripe: () => readBillingSubscriptions(gateway),
  });
  expect(listCalls).toBe(100);
  expect(retrieveCalls).toBe(0);
  expect(load).not.toHaveBeenCalled();
  expect(result).toEqual({
    status: "ready",
    report: { mismatches: [], warnings: [BILLING_PAGE_CAP], activeRentals: null, subscriptions: null },
  });
});

it("keeps Billing Health out of the dark nav and behind the owner check", () => {
  const flag = readFileSync("src/lib/billing-health-flag.ts", "utf8");
  const fn = readFileSync("src/lib/billing-health.functions.ts", "utf8");
  const read = readFileSync("src/lib/billing-health-read.server.ts", "utf8");
  const server = readFileSync("src/lib/billing-health.server.ts", "utf8");
  const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
  const admin = readFileSync("src/routes/admin.tsx", "utf8");
  const tabs = nav.slice(nav.indexOf("export const TABS"), nav.indexOf("export const LEGACY_TABS"));
  const disabled = fn.indexOf('if (!BILLING_HEALTH_ENABLED) return { status: "disabled", report: null };');
  const owner = fn.indexOf("await requireOwner(context.userId)");
  const stripe = fn.indexOf("readLiveBillingHealth()");
  const table = fn.indexOf("loadBillingDirectory(");
  expect(flag).toContain("export const BILLING_HEALTH_ENABLED = false");
  expect(disabled).toBeGreaterThan(-1);
  expect(owner).toBeGreaterThan(disabled);
  expect(stripe).toBeGreaterThan(owner);
  expect(table).toBeGreaterThan(owner);
  expect(read).toContain('createReadOnlyStripe("live", { cache: true })');
  expect(read).toContain('status: "all"');
  expect(read).toContain("STRIPE_READER_MAX_PAGES");
  expect(read).not.toContain("createStripeClient");
  expect(server).toContain(RENTAL_SELECT);
  expect(`${fn}\n${read}\n${server}`).not.toMatch(/\.(create|update|del|cancel|capture|confirm|refund)\(/);
  expect(tabs).not.toContain("billing_health");
  expect(nav).toContain('BILLING_HEALTH_ENABLED && tierAllows(tier, "owner")');
  expect(admin).toContain('urlTab === "billing_health"');
  expect(admin).toContain('if (!BILLING_HEALTH_ENABLED || (tier && !tierAllows(tier, "owner"))) return "overview"');
  expect(admin).toContain('BILLING_HEALTH_ENABLED && tab === "billing_health"');
});

const RENTAL_SELECT = "id,status,weekly_rate,next_payment_due,stripe_customer_id,stripe_subscription_id,driver_id,application_id,vehicle_id";
