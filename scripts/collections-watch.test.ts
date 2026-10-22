import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { railEntries, visibleWorkspaceTabs } from "../src/components/admin/nav-config";
import { buildCollectionsWatch, daysOverdueEt, UPCOMING_INVOICE_NOTE, watchWindows, type WatchCustomer, type WatchSubscription } from "../src/lib/collections-watch";
import { collectionsWatchEnabled } from "../src/lib/collections-watch-flag";
import { readCollectionsWatch, type ReadOnlyStripeGateway } from "../src/lib/collections-watch-read.server";
import { runCollectionsWatch } from "../src/lib/collections-watch.server";
import { matchDriver, type DriverMatchApplication, type DriverMatchRental } from "../src/lib/stripe-driver-match";

const NOW = new Date("2026-10-21T15:00:00.000Z");
const OCT18 = Math.floor(Date.parse("2026-10-18T04:00:00.000Z") / 1000);
const read = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

const app = (over: Partial<DriverMatchApplication> = {}): DriverMatchApplication => ({
  id: "app_ada", fullName: "Ada Driver", email: "ada@example.com", phone: "(555) 111-2222",
  stripeCustomerId: "cus_ada", userId: "user_ada", deletedAt: null, status: "active", ...over,
});

describe("list and retrieve guard", () => {
  it("calls only list and retrieve, and never an upcoming-invoice preview", () => {
    const source = read("lib/collections-watch-read.server.ts");
    const calls = [...source.matchAll(/gateway\.(\w+)\.(\w+)/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(calls.length).toBeGreaterThan(0);
    const allowed = new Set(["subscriptions.list", "charges.list", "charges.retrieve", "invoices.list", "invoices.retrieve", "customers.retrieve"]);
    expect(calls.every((call) => allowed.has(call))).toBe(true);
    expect(source).not.toMatch(/\.(create|update|del|delete|capture|confirm|cancel|refund|createPreview|retrieveUpcoming)\s*\(/);
    expect(source).not.toContain("createPreview");
    expect(source).not.toContain("retrieveUpcoming");
    const panel = read("components/admin/CollectionsWatchPanel.tsx");
    expect(panel).not.toContain("<button");
    expect(panel).not.toContain("mailto:");
    expect(panel).toContain("tel:");
  });

  it("checks the flag before any role or driver read", () => {
    const source = read("lib/collections-watch.functions.ts");
    const flag = source.indexOf("collectionsWatchEnabled()");
    const roles = source.indexOf('from("user_roles")');
    expect(flag).toBeGreaterThan(-1);
    expect(roles).toBeGreaterThan(flag);
  });
});

describe("Eastern overdue math", () => {
  it("counts Eastern calendar days and clamps the future to zero", () => {
    expect(daysOverdueEt(OCT18, NOW)).toBe(3);
    expect(daysOverdueEt(Math.floor(Date.parse("2026-10-21T03:30:00.000Z") / 1000), NOW)).toBe(1);
    expect(daysOverdueEt(Math.floor(Date.parse("2026-10-21T04:00:00.000Z") / 1000), NOW)).toBe(0);
    expect(daysOverdueEt(Math.floor(Date.parse("2026-10-22T04:00:00.000Z") / 1000), NOW)).toBe(0);
    expect(daysOverdueEt(0, NOW)).toBeNull();
    expect(daysOverdueEt(1.5, NOW)).toBeNull();
  });

  it("anchors Eastern midnights across standard time, daylight time, and the fall change", () => {
    const windows = watchWindows(NOW);
    expect(windows).toEqual({
      failedGte: Math.floor(Date.parse("2026-09-21T04:00:00.000Z") / 1000),
      dueGte: Math.floor(Date.parse("2026-10-21T04:00:00.000Z") / 1000),
      dueLt: Math.floor(Date.parse("2026-10-28T04:00:00.000Z") / 1000),
    });
    expect(watchWindows(new Date("2026-01-15T12:00:00.000Z"))?.dueGte).toBe(Math.floor(Date.parse("2026-01-15T05:00:00.000Z") / 1000));
    expect(watchWindows(new Date("2026-07-15T12:00:00.000Z"))?.dueGte).toBe(Math.floor(Date.parse("2026-07-15T04:00:00.000Z") / 1000));
    expect(watchWindows(new Date("2026-11-01T03:30:00.000Z"))?.dueGte).toBe(Math.floor(Date.parse("2026-10-31T04:00:00.000Z") / 1000));
  });
});

describe("driver matching", () => {
  const customer = { id: "cus_ada", email: "Ada@Example.com", phone: "+1 555 111 2222" };

  it("prefers the Stripe customer id over a conflicting email", () => {
    const found = matchDriver({
      applications: [app({ email: "other@example.com" }), app({ id: "app_other", stripeCustomerId: null, email: "ada@example.com", phone: null })],
      rentals: [],
      customer,
    });
    expect(found).toMatchObject({ driverId: "app_ada", phone: "(555) 111-2222", confidence: "high", reason: "Stripe Customer Id" });
  });

  it("matches email without case, then phone, and shows the application phone", () => {
    const byEmail = matchDriver({ applications: [app({ stripeCustomerId: null })], rentals: [], customer });
    expect(byEmail).toMatchObject({ driverId: "app_ada", confidence: "medium", reason: "Exact Email", phone: "(555) 111-2222" });
    const byPhone = matchDriver({ applications: [app({ stripeCustomerId: null, email: "nope@example.com" })], rentals: [], customer: { ...customer, email: "missing@example.com" } });
    expect(byPhone).toMatchObject({ driverId: "app_ada", confidence: "low", reason: "Phone", phone: "(555) 111-2222" });
  });

  it("does not fall through an ambiguous tier, and ignores blanks, deletes, and duplicates", () => {
    const ambiguous = matchDriver({
      applications: [app({ id: "a", stripeCustomerId: null, email: "ada@example.com" }), app({ id: "b", stripeCustomerId: null, email: "ada@example.com", phone: "(555) 999-0000" })],
      rentals: [],
      customer: { ...customer, id: "cus_other" },
    });
    expect(ambiguous).toEqual({ driverId: null, driverName: null, phone: null, confidence: null, reason: "More Than One Email" });
    const blank = matchDriver({ applications: [app({ stripeCustomerId: null, email: "   " })], rentals: [], customer: { id: "cus_x", email: " ", phone: null } });
    expect(blank.reason).toBe("No Match");
    const deleted = matchDriver({
      applications: [app({ deletedAt: "2026-01-01", status: "active" }), app({ id: "live", stripeCustomerId: null, status: "duplicate" })],
      rentals: [],
      customer,
    });
    expect(deleted.reason).toBe("No Match");
  });

  it("follows a rental customer id through the application or the driver's user id", () => {
    const byApplication = matchDriver({
      applications: [app({ stripeCustomerId: null })],
      rentals: [{ id: "rent_1", applicationId: "app_ada", driverId: null, stripeCustomerId: "cus_ada" }],
      customer: { id: "cus_ada", email: null, phone: null },
    });
    expect(byApplication.driverId).toBe("app_ada");
    const byUser = matchDriver({
      applications: [app({ stripeCustomerId: null })],
      rentals: [{ id: "rent_1", applicationId: null, driverId: "user_ada", stripeCustomerId: "cus_ada" } satisfies DriverMatchRental],
      customer: { id: "cus_ada", email: null, phone: null },
    });
    expect(byUser.confidence).toBe("high");
    const twoRentals = matchDriver({
      applications: [app({ id: "a", userId: "user_a" }), app({ id: "b", userId: "user_b", email: "b@example.com" })],
      rentals: [
        { id: "r1", applicationId: "a", driverId: null, stripeCustomerId: "cus_ada" },
        { id: "r2", applicationId: "b", driverId: null, stripeCustomerId: "cus_ada" },
      ],
      customer: { id: "cus_ada", email: "b@example.com", phone: null },
    });
    expect(twoRentals).toMatchObject({ driverId: null, phone: null, reason: "More Than One Stripe Customer Id" });
  });
});

describe("flag off", () => {
  it("is on only for the exact string true", () => {
    expect(collectionsWatchEnabled({ COLLECTIONS_WATCH_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "TRUE", "1", "yes", " true", "true "]) {
      expect(collectionsWatchEnabled({ COLLECTIONS_WATCH_ENABLED: value })).toBe(false);
    }
  });

  it("returns before drivers and Stripe, and refuses a coordinator", async () => {
    let loads = 0;
    let reads = 0;
    const load = async () => { loads += 1; return { applications: [], rentals: [] }; };
    const readStripe = async () => { reads += 1; return { ok: true as const, subscriptions: [], failedCharges: [], openInvoices: [] }; };
    const off = await runCollectionsWatch({ enabled: false, userId: "user", roles: ["admin"], load, readStripe });
    expect(off).toEqual({ status: "disabled", report: null });
    await expect(runCollectionsWatch({ enabled: true, userId: null, roles: ["admin"], load, readStripe })).rejects.toThrow("Forbidden");
    await expect(runCollectionsWatch({ enabled: true, userId: "user", roles: ["coordinator"], load, readStripe })).rejects.toThrow("Forbidden");
    expect(loads).toBe(0);
    expect(reads).toBe(0);
    const missing = await runCollectionsWatch({ enabled: true, userId: "user", roles: ["team"], load: async () => { loads += 1; return null; }, readStripe });
    expect(missing.status).toBe("unavailable");
    expect(loads).toBe(1);
    expect(reads).toBe(0);
  });

  it("stays off the rail and out of a coordinator Payments workspace", () => {
    expect(visibleWorkspaceTabs("payments", "manager").map((tab) => tab.id)).toContain("collections_watch");
    expect(visibleWorkspaceTabs("payments", "owner").map((tab) => tab.id)).toContain("collections_watch");
    expect(visibleWorkspaceTabs("payments", "coordinator")).toEqual([]);
    expect(railEntries("owner").map((entry) => entry.label)).not.toContain("Collections Watch");
  });
});

describe("watch report", () => {
  const ada: WatchCustomer = { id: "cus_ada", name: "Ada Stripe", email: "ada@example.com", phone: "+15551112222" };
  const bounds = watchWindows(NOW)!;

  it("keeps past due separate from the next 7 days and skips a duplicate period end", () => {
    const pastDue: WatchSubscription = {
      id: "sub_late", status: "past_due", customer: ada, periodEnd: bounds.dueGte, priceCents: 100, amountRemainingCents: 5000,
      currency: "usd", dueAt: OCT18, failureReason: "Card declined", failureAt: bounds.dueGte,
    };
    const covered: WatchSubscription = {
      id: "sub_open", status: "active", customer: ada, periodEnd: bounds.dueGte + 3600, priceCents: 35000, amountRemainingCents: null,
      currency: "usd", dueAt: null, failureReason: null, failureAt: null,
    };
    const renewing: WatchSubscription = {
      id: "sub_renew", status: "active", customer: { ...ada, id: "cus_new", email: null, phone: null }, periodEnd: bounds.dueLt - 1, priceCents: null,
      amountRemainingCents: null, currency: "eur", dueAt: null, failureReason: null, failureAt: null,
    };
    const report = buildCollectionsWatch({
      now: NOW,
      applications: [app()],
      rentals: [],
      subscriptions: [pastDue, covered, renewing],
      failedCharges: [{ id: "ch_old", customer: ada, amountCents: 5000, currency: "eur", created: bounds.failedGte - 1, failureReason: "Old" }, { id: "ch_new", customer: ada, amountCents: 5000, currency: "usd", created: bounds.failedGte, failureReason: null }],
      openInvoices: [{ id: "in_open", customer: ada, subscriptionId: "sub_open", amountRemainingCents: 35000, currency: "usd", dueAt: bounds.dueGte }, { id: "in_later", customer: ada, subscriptionId: null, amountRemainingCents: 100, currency: "usd", dueAt: bounds.dueLt }],
    });
    expect(report?.overdue).toEqual([expect.objectContaining({ id: "sub_late", amountDueCents: 5000, daysOverdue: 3, failureReason: "Card declined", match: expect.objectContaining({ phone: "(555) 111-2222" }) })]);
    expect(report?.failedCharges.map((row) => row.id)).toEqual(["ch_new"]);
    expect(report?.failedCharges[0].amountCents).toBe(5000);
    expect(report?.dueSoon.map((row) => [row.id, row.source, row.amountCents])).toEqual([["in_open", "Open Invoice", 35000], ["sub_renew", "Period End", null]]);
    expect(report?.upcomingInvoiceNote).toBe(UPCOMING_INVOICE_NOTE);
    expect(report?.overdue[0].match.driverId).toBe("app_ada");
  });

  it("leaves a non-USD balance blank and a missing due date uncounted", () => {
    const report = buildCollectionsWatch({
      now: NOW, applications: [], rentals: [], failedCharges: [], openInvoices: [],
      subscriptions: [{ id: "sub_eur", status: "unpaid", customer: ada, periodEnd: null, priceCents: null, amountRemainingCents: 900, currency: "eur", dueAt: null, failureReason: null, failureAt: null }],
    });
    expect(report?.overdue[0]).toMatchObject({ amountDueCents: null, daysOverdue: null, failureReason: null });
  });
});

describe("Stripe reader", () => {
  const bounds = watchWindows(NOW)!;
  const window = { ...bounds, now: Math.floor(NOW.getTime() / 1000) };
  const customer = { id: "cus_ada", name: "Ada Stripe", email: "ada@example.com", phone: "+15551112222", livemode: true };
  const items = { has_more: false, data: [{ current_period_end: bounds.dueGte + 3600, quantity: 1, price: { unit_amount: 35000, currency: "usd" } }] };

  function fake(extra: { livemode?: boolean; stall?: boolean } = {}) {
    const calls: string[] = [];
    const live = extra.livemode ?? true;
    const gateway: ReadOnlyStripeGateway = {
      subscriptions: { list: async (params) => {
        calls.push(`subscriptions.list:${params.status}`);
        if (params.status === "past_due") return { data: [{ id: "sub_late", status: "past_due", customer: "cus_late", latest_invoice: "in_late", items, livemode: live }], has_more: false };
        if (params.status === "active") return { data: [{ id: "sub_renew", status: "active", customer: customer, latest_invoice: { id: "in_draft", currency: "usd", livemode: true }, items, livemode: true }], has_more: false };
        return { data: [], has_more: false };
      } },
      charges: {
        list: async (params) => {
          calls.push("charges.list");
          expect(params.created).toEqual({ gte: window.failedGte, lt: window.now });
          const row = { id: "ch_fail", amount: 5000, currency: "usd", status: "failed", created: window.failedGte + 10, customer: "cus_late", failure_code: "card_declined", outcome: { seller_message: "The bank declined this.", reason: "generic_decline" }, livemode: true };
          if (!extra.stall) return { data: [row], has_more: false };
          if (!params.starting_after) return { data: [row], has_more: true };
          return { data: [row], has_more: true };
        },
        retrieve: async (id) => { calls.push(`charges.retrieve:${id}`); return { id, amount: 5000, currency: "usd", status: "failed", created: OCT18, customer: "cus_ada", failure_message: "Insufficient funds", livemode: true }; },
      },
      invoices: {
        list: async (params) => {
          calls.push("invoices.list");
          expect(params.due_date).toEqual({ gte: window.dueGte, lt: window.dueLt });
          return { data: [{ id: "in_open", customer: "cus_ada", amount_remaining: 35000, currency: "usd", due_date: window.dueGte, created: window.dueGte, parent: { subscription_details: { subscription: "sub_renew" } }, livemode: true }], has_more: false };
        },
        retrieve: async (id) => { calls.push(`invoices.retrieve:${id}`); return { id, customer: "cus_late", amount_remaining: 5000, currency: "usd", due_date: OCT18, created: OCT18, charge: "ch_old", livemode: true }; },
      },
      customers: { retrieve: async (id) => { calls.push(`customers.retrieve:${id}`); return { ...customer, id }; } },
    };
    return { gateway, calls };
  }

  it("retrieves an unexpanded customer and keeps the latest failure reason", async () => {
    const { gateway, calls } = fake();
    const result = await readCollectionsWatch(gateway, window, { now: () => NOW.getTime() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.failedCharges).toEqual([expect.objectContaining({ id: "ch_fail", customer: expect.objectContaining({ id: "cus_late", email: "ada@example.com" }), failureReason: "card_declined" })]);
    expect(result.subscriptions.find((sub) => sub.id === "sub_late")).toMatchObject({ amountRemainingCents: 5000, dueAt: OCT18, failureReason: "card_declined" });
    expect(result.openInvoices[0]).toMatchObject({ id: "in_open", subscriptionId: "sub_renew", dueAt: window.dueGte });
    expect(result.subscriptions.find((sub) => sub.id === "sub_renew")?.periodEnd).toBe(bounds.dueGte + 3600);
    expect(calls).toContain("customers.retrieve:cus_late");
    expect(calls).toContain("invoices.retrieve:in_late");
    expect(calls.join(" ")).not.toContain("create");
  });

  it("fails closed on a test-mode row and on a cursor that does not advance", async () => {
    const testMode = await readCollectionsWatch(fake({ livemode: false }).gateway, window, { now: () => NOW.getTime() });
    expect(testMode).toEqual({ ok: false, reason: "Stripe evidence was incomplete or timed out" });
    const stalled = await readCollectionsWatch(fake({ stall: true }).gateway, window, { now: () => NOW.getTime() });
    expect(stalled.ok).toBe(false);
  });
});
