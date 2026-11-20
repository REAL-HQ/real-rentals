/**
 * Payment Not Completed page: the unpaid-session lookup, live availability,
 * published photos, checkout restart (no duplicate charges), and page copy.
 * Fake database, fake Stripe. No network, no real data, no texts, emails,
 * webhooks or charges.
 * Run: npx vitest run scripts/payment-not-completed.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { lookupPaymentNotCompleted, restartReservationFeeCheckout } from "../src/lib/payment-not-completed.server";
import {
  availableCarsLine,
  countOpenSlotsThisWeek,
  currentWeekMonFri,
  EMPTY_PNC_VIEW,
  linkExpiryLabel,
  openSlotsThisWeekLine,
  publicPhotoUrls,
  reserveLabel,
  stickyReserveVisible,
} from "../src/lib/payment-not-completed";
import { reservationFeeReturnUrls } from "../src/lib/reservation-fee";
import { DEFAULT_PICKUP_SCHEDULE, PICKUP_SCHEDULE_SETTINGS_KEY } from "../src/lib/pickup-schedule";
import { PaymentNotCompletedPage } from "../src/components/reservation/PaymentNotCompletedPage";

function pageText(html: string) {
  return html.replace(/&#x27;/g, "'").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

type Rows = Record<string, any[]>;
function fakeDb(seed: Rows) {
  const state: Rows = JSON.parse(JSON.stringify(seed));
  let n = 0;
  function q(table: string) {
    const f: ((r: any) => boolean)[] = [];
    let lim = Infinity; let op: "select" | "update" | "insert" = "select"; let patch: any = null; let inserted: any = null; let insErr: any = null;
    const all = () => (state[table] ??= []);
    const run = () => {
      if (table === "license_dmv_checks" && !("license_dmv_checks" in seed)) return { data: null, error: { code: "42P01", message: `relation "license_dmv_checks" does not exist` } };
      if (op === "insert") return { data: inserted, error: insErr };
      const hit = all().filter((r) => f.every((g) => g(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
      return { data: hit.slice(0, lim), error: null };
    };
    const api: any = {
      select: () => api, order: () => api,
      eq: (k: string, v: any) => (f.push((r) => r[k] === v), api),
      neq: (k: string, v: any) => (f.push((r) => r[k] !== v), api),
      is: (k: string, v: any) => (f.push((r) => (r[k] ?? null) === v), api),
      in: (k: string, v: any[]) => (f.push((r) => v.includes(r[k])), api),
      limit: (x: number) => ((lim = x), api),
      update: (p: any) => ((op = "update"), (patch = p), api),
      insert: (row: any) => {
        op = "insert";
        const rows = Array.isArray(row) ? row : [row];
        const made = rows.map((r) => ({ id: r.id ?? `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, attempt_count: 0, ...r }));
        all().push(...made); inserted = made[0]; return api;
      },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error ?? null }; },
      single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error ?? null }; },
    };
    return api;
  }
  return { from: q, state };
}

const SID = "cs_test_a1B2c3D4e5F6g7H8i9J0";
const APP = "11111111-1111-4111-8111-111111111111";
const AG = "22222222-2222-4222-8222-222222222222";
const PAY = "44444444-4444-4444-8444-444444444444";
const CAR = "55555555-5555-4555-8555-555555555555";
const CAR2 = "66666666-6666-4666-8666-666666666666";
const CAR3 = "99999999-9999-4999-8999-999999999999";
const MKT = "77777777-7777-4777-8777-777777777777";
const OTHER_MKT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-11-18T14:00:00Z"); // Wed 9:00 AM ET
const SETTINGS = { ...DEFAULT_PICKUP_SCHEDULE };
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_open";

function seed(over: Partial<Record<string, any>> = {}): Rows {
  return {
    app_settings: [
      { key: "reservation_fee_auto", value: { enabled: true, amount: 50 } },
      { key: PICKUP_SCHEDULE_SETTINGS_KEY, value: SETTINGS },
    ],
    applications: [{ id: APP, status: "approved", vehicle_id: CAR, market_id: MKT, deleted_at: null, full_name: "Test Renter", email: "renter@example.com", stripe_customer_id: "cus_1", ...(over.app ?? {}) }],
    agreements: [{ id: AG, application_id: APP, status: "signed", vehicle_id: CAR, body: "… Reservation Fee: $50, applied to your first payment …", merge_data: { _prep: JSON.stringify({ reservation: { mode: "required", amount: 50 } }) }, metadata: { reservation_fee_checkout: { session_id: SID, payment_id: PAY, url: CHECKOUT_URL, created_at: "2026-11-17T20:00:00Z" } }, ...(over.ag ?? {}) }],
    payments: [{ id: PAY, driver_id: APP, reason: "reservation_fee", notes: `reservation_fee:${AG}`, status: "unpaid", amount: 50, ...(over.pay ?? {}) }],
    vehicles: [
      { id: CAR, year: 2015, make: "Ford", model: "Fusion", color: "silver", body_type: "sedan", photos: ["https://cdn.example.com/fusion-1.jpg", "/cars/fusion-2.jpg"], weekly_rate: 350, status: "available", archived_at: null, market_id: MKT, ...(over.car ?? {}) },
      { id: CAR2, year: 2018, make: "Toyota", model: "Camry", color: "black", body_type: "sedan", photos: [], weekly_rate: 400, status: "available", archived_at: null, market_id: MKT },
      { id: CAR3, year: 2019, make: "Honda", model: "Odyssey", color: "white", body_type: "van", photos: [], weekly_rate: 400, status: "available", archived_at: null, market_id: OTHER_MKT },
    ],
    markets: [{ id: MKT, name: "Tampa", state: "FL" }, { id: OTHER_MKT, name: "Orlando", state: "FL" }],
    staff_terms_confirmations: over.terms === undefined ? [{ application_id: APP, vehicle_id: CAR, weekly_rate: 375, start_date: "2026-11-20", clicked_at: "2026-11-18T12:00:00Z" }] : over.terms,
    rentals: over.rentals ?? [],
  };
}

function session(over: Record<string, any> = {}) {
  return {
    id: SID, mode: "payment", payment_status: "unpaid", status: "open",
    url: CHECKOUT_URL, expires_at: Math.floor(NOW.getTime() / 1000) + 12 * 3600,
    metadata: { applicationId: APP, agreementId: AG, paymentIds: PAY, reason: "reservation_fee" },
    ...over,
  };
}
function fakeStripe(s: any = session(), created: any[] = []) {
  const calls: any[] = [];
  return {
    calls, created,
    checkout: {
      sessions: {
        retrieve: async (id: string) => { calls.push({ type: "retrieve", id }); if (s instanceof Error) throw s; return s; },
        create: async (a: any, o: any) => {
          created.push({ a, o });
          return { id: `cs_test_new${created.length}xxxxxxxxxxxx`, url: `https://checkout.stripe.com/c/pay/cs_new_${created.length}` };
        },
      },
    },
  };
}

const slotsThisWeek = [
  { date: "2026-11-18", time: "10:30" },
  { date: "2026-11-18", time: "11:30" },
  { date: "2026-11-19", time: "09:30" },
  { date: "2026-11-20", time: "09:30" },
  { date: "2026-11-21", time: "09:30" }, // Saturday — outside Mon–Fri
  { date: "2026-11-23", time: "09:30" }, // next Monday
];
const deps = (stripe: any = fakeStripe(), extra: Record<string, any> = {}) => ({
  stripe, settings: SETTINGS, now: () => NOW, listSlots: async () => extra.slots ?? slotsThisWeek, audit: async () => {}, ...extra,
});

describe("helpers", () => {
  it("cancel_url carries Stripe's {CHECKOUT_SESSION_ID} template", () => {
    expect(reservationFeeReturnUrls("https://drivereal.com")).toEqual({
      success: "https://drivereal.com/reservation-fee?status=paid&session_id={CHECKOUT_SESSION_ID}",
      cancel: "https://drivereal.com/reservation-fee?status=canceled&session_id={CHECKOUT_SESSION_ID}",
    });
  });
  it("week bounds and this-week slot count are Eastern Monday–Friday", () => {
    expect(currentWeekMonFri(NOW)).toEqual({ monday: "2026-11-16", friday: "2026-11-20" });
    expect(countOpenSlotsThisWeek(slotsThisWeek, NOW)).toBe(4);
    expect(openSlotsThisWeekLine(4)).toBe("4 Open Pickup Slots This Week");
    expect(openSlotsThisWeekLine(0)).toBe("No Open Pickup Slots This Week");
    expect(availableCarsLine(5, "Tampa")).toBe("Only 5 Cars Available In Tampa");
    expect(availableCarsLine(1, "Tampa")).toBe("Only 1 Car Available In Tampa");
    expect(availableCarsLine(0, "Tampa")).toBe("No Cars Available In Tampa");
  });
  it("expiry label uses remaining time when known, otherwise the 23-hour policy", () => {
    expect(linkExpiryLabel(null, NOW)).toBe("Your Link Is Good For 23 Hours");
    expect(linkExpiryLabel(new Date(NOW.getTime() + 23 * 3600_000).toISOString(), NOW)).toBe("Your Link Is Good For 23 Hours");
    expect(linkExpiryLabel(new Date(NOW.getTime() + 4 * 3600_000 + 12 * 60_000).toISOString(), NOW)).toBe("Your Link Is Good For 4 Hours 12 Minutes");
    expect(linkExpiryLabel(new Date(NOW.getTime() + 45 * 60_000).toISOString(), NOW)).toBe("Your Link Is Good For 45 Minutes");
    expect(linkExpiryLabel(new Date(NOW.getTime() - 1000).toISOString(), NOW)).toBe("Your Link Is Good For 23 Hours");
  });
  it("published photo URLs only; reserve label uses the fee amount", () => {
    expect(publicPhotoUrls(["https://cdn.example.com/a.jpg", "/cars/b.jpg", "bucket/path.jpg", "", null])).toEqual([
      "https://cdn.example.com/a.jpg",
      "/cars/b.jpg",
      "/api/public/vehicle-photos/bucket/path.jpg",
    ]);
    expect(reserveLabel(50)).toBe("Reserve My Car For $50");
  });
});

describe("sticky reserve bar", () => {
  it("shows only after the hero CTA is off-screen and hides again when the bottom CTA is in view", () => {
    expect(stickyReserveVisible(true, false)).toBe(false);
    expect(stickyReserveVisible(false, false)).toBe(true);
    expect(stickyReserveVisible(false, true)).toBe(false);
    expect(stickyReserveVisible(true, true)).toBe(false);
  });
});

describe("lookup", () => {

  it("unpaid Reservation Fee session → car, published photos, city count, this-week slots, live checkout; nothing personal", async () => {
    const db = fakeDb(seed());
    const st = fakeStripe();
    const v: any = await lookupPaymentNotCompleted(db, SID, deps(st));
    expect(v.ok).toBe(true);
    expect(v.alreadyPaid).toBe(false);
    expect(v.processing).toBe(false);
    expect(v.amount).toBe(50);
    expect(v.vehicle).toEqual({
      label: "2015 Ford Fusion (Silver)",
      photos: ["https://cdn.example.com/fusion-1.jpg", "/cars/fusion-2.jpg"],
      bodyType: "sedan",
    });
    expect(v.city).toBe("Tampa");
    expect(v.availableCars).toBe(2); // Fusion + Camry in Tampa; Odyssey is Orlando
    expect(v.openSlotsThisWeek).toBe(4);
    expect(v.checkoutUrl).toBe(CHECKOUT_URL);
    expect(v.linkExpiresAt).toBe(new Date((Math.floor(NOW.getTime() / 1000) + 12 * 3600) * 1000).toISOString());
    const blob = JSON.stringify(v);
    expect(blob).not.toMatch(/Test Renter|renter@example|5555550100|\+1/);
    expect(blob).not.toMatch(/11111111-1111-4111-8111-111111111111|44444444/);
  });

  it("paid Stripe session → alreadyPaid with this session id (no second charge path)", async () => {
    const db = fakeDb(seed({ pay: { status: "paid" } }));
    const v: any = await lookupPaymentNotCompleted(db, SID, deps(fakeStripe(session({ payment_status: "paid" }))));
    expect(v).toEqual({ ok: true, alreadyPaid: true, sessionId: SID });
  });

  it("our row already paid, this session unpaid → alreadyPaid without this session id", async () => {
    const db = fakeDb(seed({ pay: { status: "paid" } }));
    const v: any = await lookupPaymentNotCompleted(db, SID, deps(fakeStripe(session({ payment_status: "unpaid", status: "expired" }))));
    expect(v).toEqual({ ok: true, alreadyPaid: true, sessionId: null });
  });

  it("hides the car count when the market cannot be resolved, and hides slots when the list fails", async () => {
    const db = fakeDb(seed({ app: { market_id: null }, car: { market_id: null } }));
    const v: any = await lookupPaymentNotCompleted(db, SID, deps(fakeStripe(), { listSlots: async () => { throw new Error("slots down"); } }));
    expect(v.ok).toBe(true);
    expect(v.alreadyPaid).toBe(false);
    expect(v.city).toBeNull();
    expect(v.availableCars).toBeNull();
    expect(v.openSlotsThisWeek).toBeNull();
    expect(v.vehicle.label).toBe("2015 Ford Fusion (Silver)");
  });

  it("hides the gallery photos when the car has none published; name still shows", async () => {
    const db = fakeDb(seed({ car: { photos: [] } }));
    const v: any = await lookupPaymentNotCompleted(db, SID, deps());
    expect(v.vehicle).toEqual({ label: "2015 Ford Fusion (Silver)", photos: [], bodyType: "sedan" });
  });

  it("expired or canceled Stripe session keeps the car but clears checkoutUrl", async () => {
    const db = fakeDb(seed());
    const v: any = await lookupPaymentNotCompleted(db, SID, deps(fakeStripe(session({ status: "expired", url: CHECKOUT_URL, expires_at: Math.floor(NOW.getTime() / 1000) - 60 }))));
    expect(v.ok).toBe(true);
    expect(v.checkoutUrl).toBeNull();
    expect(v.vehicle.label).toContain("Fusion");
  });

  it("refuses a session that is not our Reservation Fee", async () => {
    const db = fakeDb(seed());
    expect(await lookupPaymentNotCompleted(db, "nope", deps())).toEqual({ ok: false, reason: "invalid" });
    expect(await lookupPaymentNotCompleted(db, SID, deps(fakeStripe(session({ mode: "setup" }))))).toEqual({ ok: false, reason: "not_reservation_fee" });
    expect(await lookupPaymentNotCompleted(db, SID, deps(fakeStripe(session({ metadata: { reason: "rent" } }))))).toEqual({ ok: false, reason: "not_reservation_fee" });
    const missing = fakeStripe(new Error("no such session"));
    expect(await lookupPaymentNotCompleted(db, SID, deps(missing))).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("restart checkout", () => {
  it("reuses the still-open Checkout and does not create a session or payment", async () => {
    const db = fakeDb(seed());
    const st = fakeStripe();
    const r = await restartReservationFeeCheckout(db, SID, deps(st));
    expect(r).toEqual({ ok: true, alreadyPaid: false, url: CHECKOUT_URL });
    expect(st.created).toHaveLength(0);
    expect(db.state.payments).toHaveLength(1);
  });

  it("mints a new Checkout on the same unpaid row when the session has expired", async () => {
    const db = fakeDb(seed());
    const st = fakeStripe(session({ status: "expired", expires_at: Math.floor(NOW.getTime() / 1000) - 10, url: CHECKOUT_URL }));
    const r = await restartReservationFeeCheckout(db, SID, deps(st));
    expect(r).toEqual({ ok: true, alreadyPaid: false, url: "https://checkout.stripe.com/c/pay/cs_new_1" });
    expect(st.created).toHaveLength(1);
    expect(st.created[0].a.success_url).toMatch(/status=paid&session_id=\{CHECKOUT_SESSION_ID\}$/);
    expect(st.created[0].a.cancel_url).toMatch(/status=canceled&session_id=\{CHECKOUT_SESSION_ID\}$/);
    expect(db.state.payments).toHaveLength(1);
    expect(db.state.payments[0].id).toBe(PAY);
  });

  it("already-paid fee never starts a new Checkout", async () => {
    const db = fakeDb(seed({ pay: { status: "paid" } }));
    const st = fakeStripe(session({ payment_status: "paid" }));
    const r = await restartReservationFeeCheckout(db, SID, deps(st));
    expect(r).toEqual({ ok: true, alreadyPaid: true, sessionId: SID });
    expect(st.created).toHaveLength(0);
  });
});

describe("page copy", () => {
  it("renders the approved mockup copy, live numbers, and no forbidden wording", () => {
    const html = pageText(renderToStaticMarkup(createElement(PaymentNotCompletedPage, {
      view: {
        ok: true, alreadyPaid: false, processing: false, amount: 50,
        vehicle: { label: "2015 Ford Fusion (Silver)", photos: ["https://cdn.example.com/fusion-1.jpg"], bodyType: "sedan" },
        city: "Tampa", availableCars: 5, openSlotsThisWeek: 12,
        linkExpiresAt: new Date(NOW.getTime() + 4 * 3600_000).toISOString(),
        checkoutUrl: CHECKOUT_URL,
      },
      now: NOW,
    })));
    expect(html).toContain("Your Car Isn't Reserved Yet");
    expect(html).toContain("Insurance Included At");
    expect(html).toContain("$0 Extra");
    expect(html).toContain("We pay your full first month of insurance upfront");
    expect(html).toContain("100% Applied To Your First Week's Rent");
    expect(html).toContain("Your Link Is Good For 4 Hours");
    expect(html).toContain("Only 5 Cars Available In Tampa");
    expect(html).toContain("12 Open Pickup Slots This Week");
    expect(html).toContain("2015 Ford Fusion (Silver)");
    expect(html).toContain("Reserve My Car For $50");
    expect((html.match(/Reserve My Car For \$50/g) ?? []).length).toBe(3);
    expect(html).toMatch(/<a class="pnc-btn pnc-btn-primary pnc-btn-lg" href="https:\/\/checkout\.stripe\.com[^"]*">Reserve My Car For \$50<\/a>/);
    expect(html).toContain(CHECKOUT_URL);
    expect(html).toContain("What If Something Goes Wrong?");
    expect(html).toContain("Refundable If We Can't Get You On The Road");
    expect(html).not.toMatch(/not refundable if you change your mind/i);
    expect(html).not.toMatch(/don't show up for pickup/i);
    expect(html).toContain("See Terms");
    expect(html).toContain("faq-something-goes-wrong");
    expect(html).toContain("(888) 833-8280");
    expect(html).toContain("team@drivereal.com");
    expect(html).toContain("3500 E Hillsborough Ave");
    expect(html).not.toMatch(/declined/i);
    expect(html).not.toMatch(/deposit/i);
    expect(html).not.toMatch(/text a real person/i);
    expect(html).not.toMatch(/testimonial|reviewer|★★★/i);
    // The only refund mention is the one FAQ headline.
    expect((html.match(/[Rr]efund/g) ?? []).length).toBe(1);
    expect(html.split("faq-something-goes-wrong")[0]).not.toMatch(/[Rr]efund/);
  });

  it("hides unresolved counts and has no Reserve link without a checkout or restart handler", () => {
    const html = pageText(renderToStaticMarkup(createElement(PaymentNotCompletedPage, { view: EMPTY_PNC_VIEW, now: NOW })));
    expect(html).toContain("Your Car Isn't Reserved Yet");
    expect(html).not.toContain("Cars Available");
    expect(html).not.toContain("Open Pickup Slot");
    expect(html).not.toContain('id="car-heading"');
    expect(html).not.toContain("This is the car you signed for");
    expect(html).toContain('data-count="1"');
    expect(html).toContain("Pay Reservation Fee button in your Agreement Signed email");
    expect(html).not.toContain("checkout.stripe.com");
    expect(html).not.toMatch(/href="https:\/\/checkout/);
    expect(html).toContain('data-testid="pnc-sticky"');
    expect(html).toMatch(/data-testid="pnc-sticky"[^>]*hidden/);
    expect(html).not.toContain("pnc-sticky-visible");
    expect(html).not.toContain("pnc-has-sticky");
  });

  it("shows the car block when a photo exists, and marks three urgency cards when counts are live", () => {
    const html = pageText(renderToStaticMarkup(createElement(PaymentNotCompletedPage, {
      view: {
        ok: true, alreadyPaid: false, processing: false, amount: 50,
        vehicle: { label: "2015 Ford Fusion (Silver)", photos: ["https://cdn.example.com/fusion-1.jpg"], bodyType: "sedan" },
        city: "Tampa", availableCars: 5, openSlotsThisWeek: 12,
        linkExpiresAt: null, checkoutUrl: null,
      },
      now: NOW,
    })));
    expect(html).toContain('id="car-heading"');
    expect(html).toContain("2015 Ford Fusion (Silver)");
    expect(html).toContain('data-count="3"');
  });


  it("Reserve button labels stay white even when the CTA is a checkout link, and loading text is visible", () => {
    const css = readFileSync("src/components/reservation/PaymentNotCompletedPage.css", "utf8");
    expect(css).toMatch(/\.pnc a:not\(\.pnc-btn\)/);
    expect(css).not.toMatch(/(^|\n)\.pnc a \{/);
    expect(css).toMatch(/\.pnc a\.pnc-btn-primary(?::[a-z]+)*(,\s*\n?\.pnc a\.pnc-btn-primary(?::[a-z]+)*)*\s*,?[^;{]*\{[^}]*color:\s*#fff/s);
    expect(css).toMatch(/\.pnc-sticky\.pnc-sticky-visible\s*\{\s*display:\s*block/);
    expect(css).toMatch(/\.pnc\.pnc-has-sticky\s*\{\s*padding-bottom:/);
    expect(css).toMatch(/\.pnc-urgency-inner\[data-count="1"\]/);
    expect(css).not.toMatch(/@media \(max-width: 719px\)[^{]*\{[^}]*\.pnc-sticky \{[^}]*display:\s*block/s);
    const loading = pageText(renderToStaticMarkup(createElement(PaymentNotCompletedPage, {
      view: { ...EMPTY_PNC_VIEW, amount: 50 },
      onReserve: async () => {},
      reserving: true,
      now: NOW,
    })));
    expect(loading).toContain("Opening Checkout");
    expect((loading.match(/Opening Checkout/g) ?? []).length).toBe(3);
    expect(loading).not.toContain("Reserve My Car For $50");
  });

  it("source files never mention an insurance decline refund, a deposit, or a renter phone", () => {
    const files = [
      "src/components/reservation/PaymentNotCompletedPage.tsx",
      "src/components/reservation/PaymentNotCompletedLive.tsx",
      "src/lib/payment-not-completed.ts",
      "src/lib/payment-not-completed.server.ts",
      "src/lib/payment-not-completed.functions.ts",
      "src/routes/reservation-fee.tsx",
    ];
    const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(all).not.toMatch(/declined/i);
    expect(all).not.toMatch(/deposit/i);
    expect(all).not.toMatch(/\+1[2-9]\d{9}/);
    expect(all).not.toMatch(/text a real person/i);
    expect(all).not.toMatch(/not refundable if you change your mind/i);
    expect(all).not.toMatch(/don't show up for pickup/i);
  });
});
