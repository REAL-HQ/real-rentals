/**
 * Payment Received page: the session lookup, the renter pickup booking, every
 * Reserved guard, and that one booking sends each notice once.
 * Fake database, fake Stripe, fake senders. No network, no real data, no
 * texts, emails, webhooks or charges.
 * Run: npx vitest run scripts/payment-received.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const sent = vi.hoisted(() => ({ sms: [] as any[], email: [] as any[], invite: [] as any[], webhooks: [] as any[], audit: [] as any[], keys: new Set<string>() }));
vi.mock("@/lib/audit.server", () => ({ logAudit: async (_a: any, e: any) => { sent.audit.push(e); } }));
vi.mock("@/lib/automation-controls.server", () => ({ gateFor: () => "on", loadAutomationControls: async () => ({}) }));
vi.mock("@/lib/driver-account.server", () => ({ provisionDriverAccount: async () => ({ userId: "33333333-3333-4333-8333-333333333333", inviteUrl: null, conflict: false }) }));
vi.mock("@/lib/email.server", () => ({
  sendPortalInviteEmail: async (a: any) => { sent.invite.push(a); },
  sendEmail: async (a: any) => { sent.email.push(a); return { ok: true }; },
}));
vi.mock("@/lib/sms.server", () => ({ sendSms: async (a: any) => { sent.sms.push(a); return { ok: true }; } }));
vi.mock("@/lib/fleet-webhook.server", () => ({
  enqueueFleetEvent: async (_admin: any, row: any) => { if (sent.keys.has(row.dedupe_key)) return null; sent.keys.add(row.dedupe_key); sent.webhooks.push(row); return `wh-${sent.webhooks.length}`; },
  dispatchFleetWebhooks: async () => ({}),
}));

import { bookRenterPickup, lookupPaymentReceived } from "../src/lib/payment-received.server";
import { isCheckoutSessionId, safeReceiptUrl, vehicleLabel } from "../src/lib/payment-received";
import { DEFAULT_PICKUP_SCHEDULE, PICKUP_SCHEDULE_SETTINGS_KEY } from "../src/lib/pickup-schedule";
import { createReservationCore } from "../src/lib/reservations.functions";
import { holdReservationForFee } from "../src/lib/reservation-fee.server";
import { sweepReservationConfirmations } from "../src/lib/reservation-confirmation.server";
import { readReservationDetails, writeReservationDetails } from "../src/lib/reservations";
import { reservationFeeReturnUrls } from "../src/lib/reservation-fee";
import { PaymentReceivedDetails } from "../src/components/reservation/PaymentReceivedDetails";

type Rows = Record<string, any[]>;
function fakeDb(seed: Rows) {
  const state: Rows = JSON.parse(JSON.stringify(seed));
  let n = 0;
  function q(table: string) {
    const f: ((r: any) => boolean)[] = [];
    let lim = Infinity; let op: "select" | "update" | "insert" = "select"; let patch: any = null; let inserted: any = null; let insErr: any = null;
    const all = () => (state[table] ??= []);
    const run = () => {
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
      gte: (k: string, v: any) => (f.push((r) => r[k] >= v), api),
      limit: (x: number) => ((lim = x), api),
      update: (p: any) => ((op = "update"), (patch = p), api),
      insert: (row: any) => {
        op = "insert";
        const rows = Array.isArray(row) ? row : [row];
        // The unique indexes the real tables have.
        if (table === "reservation_confirmations" && rows.some((r) => all().some((x) => x.rental_id === r.rental_id))) { insErr = { code: "23505", message: "duplicate key" }; return api; }
        if (table === "rentals") {
          for (const r of rows.filter((x) => x.status === "reserved")) {
            const live = all().filter((x) => x.status === "reserved");
            if (live.some((x) => x.vehicle_id === r.vehicle_id)) { insErr = { code: "23505", message: 'duplicate key value violates unique constraint "rentals_one_reserved_per_vehicle"' }; return api; }
            if (live.some((x) => x.driver_id === r.driver_id)) { insErr = { code: "23505", message: 'duplicate key value violates unique constraint "rentals_one_reserved_per_driver"' }; return api; }
          }
        }
        const made = rows.map((r) => ({ id: r.id ?? `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ...r }));
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
const MKT = "77777777-7777-4777-8777-777777777777";
const OTHER_APP = "88888888-8888-4888-8888-888888888888";
const NOW = new Date("2026-11-18T14:00:00Z"); // Wed 9:00 AM ET
const SETTINGS = { ...DEFAULT_PICKUP_SCHEDULE, notify: { ...DEFAULT_PICKUP_SCHEDULE.notify, enabled: true } };

function seed(over: Partial<Record<string, any>> = {}): Rows {
  return {
    app_settings: [
      { key: "reservation_fee_auto", value: { enabled: true, amount: 50 } },
      { key: PICKUP_SCHEDULE_SETTINGS_KEY, value: SETTINGS },
    ],
    applications: [{ id: APP, status: "approved", user_id: null, full_name: "Test Renter", email: "renter@example.com", phone: "+15555550100", vehicle_id: CAR2, weekly_rent: null, contract_start_date: "2026-11-21", market_id: MKT, deleted_at: null, ...(over.app ?? {}) }],
    agreements: [{ id: AG, application_id: APP, status: "signed", signed_at: "2026-11-18T13:00:00Z", voided_at: null, rental_id: null, vehicle_id: CAR, metadata: { reservation_fee_checkout: { session_id: SID } }, ...(over.ag ?? {}) }],
    payments: [{ id: PAY, driver_id: APP, reason: "reservation_fee", notes: `reservation_fee:${AG}`, status: "paid", amount: 50, stripe_receipt_url: null, stripe_paid_at: null, ...(over.pay ?? {}) }],
    vehicles: [
      { id: CAR, year: 2015, make: "Ford", model: "Fusion", color: "silver", weekly_rate: 350, status: "available", archived_at: null, ...(over.car ?? {}) },
      { id: CAR2, year: 2018, make: "Toyota", model: "Camry", color: "black", weekly_rate: 400, status: "available", archived_at: null },
    ],
    markets: [{ id: MKT, name: "Tampa", state: "FL" }],
    staff_terms_confirmations: over.terms === undefined ? [{ application_id: APP, vehicle_id: CAR, weekly_rate: 375, start_date: "2026-11-20", clicked_at: "2026-11-18T12:00:00Z" }] : over.terms,
    rentals: over.rentals ?? [],
  };
}

function session(over: Record<string, any> = {}) {
  return {
    id: SID, mode: "payment", payment_status: "paid", amount_total: 5000,
    metadata: { applicationId: APP, agreementId: AG, paymentIds: PAY, reason: "reservation_fee" },
    payment_intent: { id: "pi_1", created: 1763474400, latest_charge: { id: "ch_1", created: 1763474460, receipt_url: "https://pay.stripe.com/receipts/payment/abc", payment_method_details: { card: { brand: "visa", last4: "4242" } } } },
    ...over,
  };
}
function fakeStripe(s: any = session()) {
  const calls: any[] = [];
  return { calls, checkout: { sessions: { retrieve: async (id: string, opts: any) => { calls.push({ id, opts }); if (s instanceof Error) throw s; return s; } } } };
}
const deps = (stripe: any = fakeStripe(), extra: Record<string, any> = {}) => ({ stripe, settings: SETTINGS, now: () => NOW, ...extra });
const SLOT = "2026-11-19T09:30:00-05:00"; // Thu 9:30 AM ET

beforeEach(() => { sent.sms.length = 0; sent.email.length = 0; sent.invite.length = 0; sent.webhooks.length = 0; sent.audit.length = 0; sent.keys.clear(); });

describe("return URL", () => {
  it("success_url and cancel_url carry Stripe's {CHECKOUT_SESSION_ID} template", () => {
    expect(reservationFeeReturnUrls("https://drivereal.com")).toEqual({ success: "https://drivereal.com/reservation-fee?status=paid&session_id={CHECKOUT_SESSION_ID}", cancel: "https://drivereal.com/reservation-fee?status=canceled&session_id={CHECKOUT_SESSION_ID}" });
  });
  it("session ids and receipt links are validated", () => {
    expect(isCheckoutSessionId(SID)).toBe(true);
    for (const bad of ["", "{CHECKOUT_SESSION_ID}", "cs_test_short", "pi_123456789012345", "cs_live_abc'; drop", null, 5]) expect(isCheckoutSessionId(bad)).toBe(false);
    expect(safeReceiptUrl("https://pay.stripe.com/receipts/x")).toBe("https://pay.stripe.com/receipts/x");
    for (const bad of ["http://pay.stripe.com/x", "javascript:alert(1)", "https://evil.example.com/stripe.com", "https://stripe.com.evil.io/x", 7]) expect(safeReceiptUrl(bad)).toBeNull();
    expect(vehicleLabel({ year: 2015, make: "Ford", model: "Fusion", color: "silver" })).toBe("2015 Ford Fusion (Silver)");
  });
});

describe("lookup", () => {
  it("paid Reservation Fee session → receipt from Stripe, rental from terms, open slots; nothing personal", async () => {
    const db = fakeDb(seed()); const st = fakeStripe();
    const v: any = await lookupPaymentReceived(db, SID, deps(st));
    expect(st.calls[0]).toEqual({ id: SID, opts: { expand: ["payment_intent.latest_charge"] } });
    expect(v.ok).toBe(true);
    expect(v.receipt).toEqual({ amount: 50, paidAt: new Date(1763474460 * 1000).toISOString(), cardBrand: "visa", cardLast4: "4242", receiptUrl: "https://pay.stripe.com/receipts/payment/abc" });
    expect(v.rental).toEqual({ vehicle: { year: 2015, make: "Ford", model: "Fusion", color: "silver" }, weeklyRate: 375, startDate: "2026-11-20", market: "Tampa, FL" });
    expect(v.booking.state).toBe("pick");
    expect(v.booking.location).toBe(SETTINGS.defaultLocation);
    expect(v.booking.slots[0]).toMatchObject({ date: "2026-11-18", time: "11:30" }); // 2 hours' notice: 9:30 and 10:30 are gone
    expect(v.booking.slots.every((s: any) => !["0", "6"].includes(String(new Date(`${s.date}T12:00:00Z`).getUTCDay())))).toBe(true);
    expect(v.booking.slots.at(-1).date <= "2026-12-01").toBe(true); // 14-day window
    const json = JSON.stringify(v);
    for (const secret of ["Test Renter", "renter@example.com", "5555550100", APP, AG, PAY, CAR, "cus_", "pi_1", "ch_1"]) expect(json).not.toContain(secret);
  });

  it("webhook lag: the payments row is still unpaid → Stripe still decides; receipt link falls back to the stored one", async () => {
    const s = session();
    s.payment_intent.latest_charge.receipt_url = undefined as any;
    const db = fakeDb(seed({ pay: { status: "unpaid", stripe_receipt_url: "https://pay.stripe.com/receipts/stored" } }));
    const v: any = await lookupPaymentReceived(db, SID, deps(fakeStripe(s)));
    expect(v.ok).toBe(true);
    expect(v.receipt.receiptUrl).toBe("https://pay.stripe.com/receipts/stored");
  });

  it("refuses: bad id (no Stripe call), unpaid, not a Reservation Fee, mismatched rows, other session, refunded, Stripe down", async () => {
    const st = fakeStripe();
    expect(await lookupPaymentReceived(fakeDb(seed()), "{CHECKOUT_SESSION_ID}", deps(st))).toEqual({ ok: false, reason: "invalid" });
    expect(st.calls).toHaveLength(0);
    const cases: [any, Rows, string][] = [
      [session({ payment_status: "unpaid" }), seed(), "unpaid"],
      [session({ mode: "subscription" }), seed(), "not_reservation_fee"],
      [session({ metadata: { ...session().metadata, reason: "initial_payment" } }), seed(), "not_reservation_fee"],
      [session({ metadata: { ...session().metadata, applicationId: OTHER_APP } }), seed(), "not_reservation_fee"],
      [session(), seed({ pay: { driver_id: OTHER_APP } }), "not_reservation_fee"],
      [session(), seed({ pay: { notes: "reservation_fee:someone-else" } }), "not_reservation_fee"],
      [session(), seed({ pay: { status: "refunded" } }), "not_reservation_fee"],
      [session(), seed({ ag: { status: "sent" } }), "not_reservation_fee"],
      [session(), seed({ ag: { metadata: { reservation_fee_checkout: { session_id: "cs_test_DIFFERENTsession123" } } } }), "not_reservation_fee"],
      [session({ id: "cs_test_zzzzzzzzzzzzzzzzzz" }), seed(), "not_found"],
      [new Error("No such checkout.session"), seed(), "not_found"],
    ];
    for (const [s, rows, reason] of cases) expect(await lookupPaymentReceived(fakeDb(rows), SID, deps(fakeStripe(s)))).toEqual({ ok: false, reason });
    expect(await lookupPaymentReceived(fakeDb(seed()), SID, deps(null))).toEqual({ ok: false, reason: "unavailable" });
  });

  it("the car: signed agreement first, then staff terms, then the applicant; none → no_vehicle", async () => {
    let v: any = await lookupPaymentReceived(fakeDb(seed({ ag: { vehicle_id: null } })), SID, deps());
    expect(v.rental.vehicle.model).toBe("Fusion"); // staff terms
    v = await lookupPaymentReceived(fakeDb(seed({ ag: { vehicle_id: null }, terms: [] })), SID, deps());
    expect(v.rental.vehicle.model).toBe("Camry"); // applicant
    expect(v.rental.weeklyRate).toBe(400);
    expect(v.rental.startDate).toBe("2026-11-21");
    v = await lookupPaymentReceived(fakeDb(seed({ ag: { vehicle_id: null }, terms: [], app: { vehicle_id: null } })), SID, deps());
    expect(v.booking).toEqual({ state: "no_vehicle" });
  });

  it("states: already reserved shows the booked time; car held by someone else, not approved → unavailable; no slots → no_slots", async () => {
    const reserved = { id: "r1", application_id: APP, driver_id: "u1", vehicle_id: CAR, status: "reserved", start_date: "2026-11-20", reservation_note: writeReservationDetails({ pickupTime: "10:30", pickupLocation: "3500 E Hillsborough Ave, Tampa, FL 33610" }) };
    let v: any = await lookupPaymentReceived(fakeDb(seed({ rentals: [reserved] })), SID, deps());
    expect(v.booking).toEqual({ state: "reserved", pickup: { date: "2026-11-20", time: "10:30", label: "Fri 11/20 10:30 AM ET", location: "3500 E Hillsborough Ave, Tampa, FL 33610" } });
    v = await lookupPaymentReceived(fakeDb(seed({ rentals: [{ ...reserved, application_id: OTHER_APP }] })), SID, deps());
    expect(v.booking).toEqual({ state: "unavailable" });
    v = await lookupPaymentReceived(fakeDb(seed({ car: { status: "rented" } })), SID, deps());
    expect(v.booking).toEqual({ state: "unavailable" });
    v = await lookupPaymentReceived(fakeDb(seed({ app: { status: "submitted" } })), SID, deps());
    expect(v.booking).toEqual({ state: "unavailable" });
    v = await lookupPaymentReceived(fakeDb(seed()), SID, deps(fakeStripe(), { listSlots: async () => [] }));
    expect(v.booking).toEqual({ state: "no_slots" });
  });
});

describe("booking through createReservationCore", () => {
  it("books the picked slot once: renter-booked, the agreement's car, the default location, fee applied; each notice once", async () => {
    const db = fakeDb(seed());
    const r: any = await bookRenterPickup(db, { sessionId: SID, startAt: SLOT }, deps());
    expect(r).toEqual({ ok: true, already: false, pickup: { date: "2026-11-19", time: "09:30", label: "Thu 11/19 9:30 AM ET", location: SETTINGS.defaultLocation } });
    const rentals = db.state.rentals.filter((x: any) => x.status === "reserved");
    expect(rentals).toHaveLength(1);
    expect(rentals[0]).toMatchObject({ application_id: APP, vehicle_id: CAR, start_date: "2026-11-19", reservation_deposit_status: "applied", reservation_deposit_payment_id: PAY });
    expect(readReservationDetails(rentals[0].reservation_note)).toEqual({ pickupTime: "09:30", pickupLocation: SETTINGS.defaultLocation, note: null, bookedBy: "renter" });
    expect(db.state.vehicles.find((v: any) => v.id === CAR).status).toBe("reserved");
    // The save's own notices, exactly once each.
    expect(sent.invite).toHaveLength(1);
    expect(sent.webhooks.map((w) => w.event_type)).toEqual(["reservation_confirmed"]);
    expect(sent.sms).toHaveLength(SETTINGS.notify.sms.length);
    expect(sent.email).toHaveLength(1);
    expect(sent.audit.filter((a) => a.action === "reservation.renter_booked")).toHaveLength(1);
    expect(sent.audit.find((a) => a.action === "reservation.renter_booked").metadata).toMatchObject({ booked_by: "renter", source: "renter" });

    // Double tap / refresh / second tab: shows the booking, books and sends nothing more.
    const again: any = await bookRenterPickup(db, { sessionId: SID, startAt: "2026-11-20T10:30:00-05:00" }, deps());
    expect(again).toMatchObject({ ok: true, already: true, pickup: { date: "2026-11-19", time: "09:30" } });
    expect(db.state.rentals.filter((x: any) => x.status === "reserved")).toHaveLength(1);
    expect(sent.invite).toHaveLength(1);
    expect(sent.webhooks).toHaveLength(1);
    expect(sent.sms).toHaveLength(SETTINGS.notify.sms.length);
    expect(sent.email).toHaveLength(1);
    // The cron safety net does not send a second notice either.
    await sweepReservationConfirmations(db, { settings: SETTINGS });
    expect(sent.webhooks).toHaveLength(1);
    expect(sent.sms).toHaveLength(SETTINGS.notify.sms.length);
  });

  it("webhook lag: books with the fee pending, notices wait; the webhook's hold confirms once", async () => {
    const db = fakeDb(seed({ pay: { status: "unpaid" } }));
    const r: any = await bookRenterPickup(db, { sessionId: SID, startAt: SLOT }, deps());
    expect(r.ok).toBe(true);
    const rental = db.state.rentals.find((x: any) => x.status === "reserved");
    expect(rental.reservation_deposit_status).toBe("pending");
    expect(sent.invite).toHaveLength(1);
    expect(sent.webhooks).toHaveLength(0);
    expect(sent.sms).toHaveLength(0);
    db.state.payments[0].status = "paid"; // what the payments webhook does
    await holdReservationForFee(db, APP, { id: PAY, amount: 50 });
    expect(rental.reservation_deposit_status).toBe("applied");
    expect(sent.webhooks).toHaveLength(1);
    expect(sent.sms).toHaveLength(SETTINGS.notify.sms.length);
    await holdReservationForFee(db, APP, { id: PAY, amount: 50 }); // a webhook retry
    expect(sent.webhooks).toHaveLength(1);
    expect(sent.sms).toHaveLength(SETTINGS.notify.sms.length);
  });

  it("slot checks: not a schedule slot → bad_slot; too soon or booked → slot_taken with fresh slots; nothing written", async () => {
    const db = fakeDb(seed());
    let r: any = await bookRenterPickup(db, { sessionId: SID, startAt: "2026-11-19T09:45:00-05:00" }, deps());
    expect(r).toMatchObject({ ok: false, code: "bad_slot" });
    r = await bookRenterPickup(db, { sessionId: SID, startAt: "2026-11-18T09:30:00-05:00" }, deps()); // inside 2 hours
    expect(r).toMatchObject({ ok: false, code: "slot_taken" });
    expect(r.slots.length).toBeGreaterThan(0);
    r = await bookRenterPickup(db, { sessionId: SID, startAt: "2026-11-21T09:30:00-05:00" }, deps()); // Saturday
    expect(r).toMatchObject({ ok: false, code: "bad_slot" });
    expect(db.state.rentals).toHaveLength(0);
    expect(sent.invite).toHaveLength(0);
  });

  it("slot just taken by someone else between page load and tap → slot_taken, that slot is gone from the fresh list", async () => {
    const db = fakeDb(seed());
    const reserve = async (a: any, d: any) => {
      db.state.rentals.push({ id: "other", application_id: OTHER_APP, driver_id: "u-other", vehicle_id: CAR2, status: "reserved", start_date: d.pickupDate, reservation_note: writeReservationDetails({ pickupTime: d.pickupTime, pickupLocation: "x x x" }) });
      return createReservationCore(a, d);
    };
    const r: any = await bookRenterPickup(db, { sessionId: SID, startAt: SLOT }, deps(fakeStripe(), { reserve }));
    expect(r).toMatchObject({ ok: false, code: "slot_taken" });
    expect(r.slots.some((s: any) => s.date === "2026-11-19" && s.time === "09:30")).toBe(false);
    expect(db.state.rentals.filter((x: any) => x.application_id === APP)).toHaveLength(0);
    expect(sent.invite).toHaveLength(0);
    expect(sent.webhooks).toHaveLength(0);
  });

  it("race with our own second tap → returns the booking that won, never a second one", async () => {
    const db = fakeDb(seed());
    const reserve = async (a: any, d: any) => {
      await createReservationCore(a, d); // the other tab wins
      return createReservationCore(a, d); // this one hits the one-per-person guard
    };
    const r: any = await bookRenterPickup(db, { sessionId: SID, startAt: SLOT }, deps(fakeStripe(), { reserve }));
    expect(r).toMatchObject({ ok: true, already: true, pickup: { date: "2026-11-19", time: "09:30" } });
    expect(db.state.rentals.filter((x: any) => x.status === "reserved")).toHaveLength(1);
    expect(sent.invite).toHaveLength(1);
    expect(sent.webhooks).toHaveLength(1);
  });

  it("guards from createReservationCore: car taken by another renter, unapproved, archived car → friendly call-us", async () => {
    // Car reserved between page load and tap.
    let db = fakeDb(seed());
    let r: any = await bookRenterPickup(db, { sessionId: SID, startAt: SLOT }, deps(fakeStripe(), {
      reserve: async (a: any, d: any) => { db.state.rentals.push({ id: "o", application_id: OTHER_APP, driver_id: "u-o", vehicle_id: CAR, status: "reserved", start_date: "2026-11-25", reservation_note: null }); return createReservationCore(a, d); },
    }));
    expect(r).toMatchObject({ ok: false, code: "unavailable" });
    // Applicant moved off Approved between load and tap.
    db = fakeDb(seed());
    r = await bookRenterPickup(db, { sessionId: SID, startAt: SLOT }, deps(fakeStripe(), {
      reserve: async (a: any, d: any) => { db.state.applications[0].status = "denied"; return createReservationCore(a, d); },
    }));
    expect(r).toMatchObject({ ok: false, code: "unavailable" });
    // Already-known states never call reserve.
    let calls = 0;
    const spy = async () => { calls++; return { id: "x", loginEmail: "sent" }; };
    for (const rows of [seed({ app: { status: "submitted" } }), seed({ car: { archived_at: "2026-11-01" } }), seed({ ag: { vehicle_id: null }, terms: [], app: { vehicle_id: null } })]) {
      r = await bookRenterPickup(fakeDb(rows), { sessionId: SID, startAt: SLOT }, deps(fakeStripe(), { reserve: spy }));
      expect(r.ok).toBe(false);
    }
    r = await bookRenterPickup(fakeDb(seed()), { sessionId: SID, startAt: SLOT }, deps(fakeStripe(), { reserve: spy, listSlots: async () => [] }));
    expect(r).toMatchObject({ ok: false, code: "no_slots" });
    expect(calls).toBe(0);
    expect(sent.invite).toHaveLength(0);
  });

  it("an invalid or unpaid session books nothing", async () => {
    let calls = 0;
    const spy = async () => { calls++; return { id: "x", loginEmail: "sent" }; };
    for (const [sid, s] of [["nope", session()], [SID, session({ payment_status: "unpaid" })], [SID, session({ metadata: { reason: "x" } })]] as const) {
      const r: any = await bookRenterPickup(fakeDb(seed()), { sessionId: sid, startAt: SLOT }, deps(fakeStripe(s), { reserve: spy }));
      expect(r).toMatchObject({ ok: false, code: "invalid_session" });
    }
    expect(calls).toBe(0);
  });

  it("staff and FLEET records are unchanged (no booked_by), and the staff input can't set it", () => {
    const staff = writeReservationDetails({ pickupTime: "09:30", pickupLocation: "3500 E Hillsborough Ave" });
    expect(staff).not.toContain("booked_by");
    expect(readReservationDetails(staff).bookedBy).toBeNull();
    const fns = readFileSync("src/lib/reservations.functions.ts", "utf8");
    const input = fns.slice(fns.indexOf("export const CreateReservationInput"), fns.indexOf("export type CreateReservationData"));
    expect(input).not.toContain("bookedBy");
  });

  it("the page code sends nothing itself (no SMS, email, webhook or reminder calls)", () => {
    const src = readFileSync("src/lib/payment-received.server.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const x of ["sendSms", "sendEmail", "sendPortalInviteEmail", "enqueueFleetEvent", "dispatchFleetWebhooks", "maybeConfirmReservation", "renter-reminders", "team-alert"]) expect(src).not.toContain(x);
    expect(src).toContain("createReservationCore");
  });
});

describe("page", () => {
  const view: any = {
    ok: true,
    receipt: { amount: 50, paidAt: "2026-11-18T14:01:00Z", cardBrand: "visa", cardLast4: "4242", receiptUrl: "https://pay.stripe.com/receipts/payment/abc" },
    rental: { vehicle: { year: 2015, make: "Ford", model: "Fusion", color: "silver" }, weeklyRate: 350, startDate: "2026-11-20", market: "Tampa, FL" },
    booking: { state: "pick", location: "3500 E Hillsborough Ave, Tampa, FL 33610", slots: [{ date: "2026-11-19", time: "09:30", start_at: SLOT, end_at: "", label: "" }] },
  };
  it("Title Case headings, Stripe receipt link, Text Us, footer; no portal link, no invented confirmation number, no deposit, no carrier", () => {
    const html = renderToStaticMarkup(createElement(PaymentReceivedDetails, { view }));
    for (const t of ["You&#x27;re Reserved!", "Your Receipt", "Your Rental", "Pick Your Pickup Time", "What Happens Next", "We Confirm Your Insurance", "Reminder Text Before Pickup", "Pickup Day"]) expect(html).toContain(t);
    expect(html).toContain('href="https://pay.stripe.com/receipts/payment/abc"');
    expect(html).toContain('href="sms:+18888338280"');
    expect(html).toContain('href="tel:+18888338280"');
    expect(html).toContain("team@drivereal.com");
    expect(html).toContain("Your pickup is confirmed once your insurance is approved. We&#x27;ll text you if anything changes.");
    expect(html).toContain("fully refundable if your insurance is declined");
    expect(html).toContain("minus the $50");
    expect(html).not.toMatch(/portal/i);
    expect(html).not.toMatch(/RR-\d|Confirmation/);
    expect(html).not.toMatch(/deposit/i);
    expect(html).not.toMatch(/progressive|geico|state farm|allstate|broker|carrier/i);
  });
  it("friendly states", () => {
    const reserved = renderToStaticMarkup(createElement(PaymentReceivedDetails, { view: { ...view, booking: { state: "reserved", pickup: { date: "2026-11-19", time: "09:30", label: "", location: "3500 E Hillsborough Ave" } } } }));
    expect(reserved).toContain("Your Pickup Time");
    expect(reserved).toContain("Thu, Nov 19 at 9:30 AM ET");
    for (const st of ["no_vehicle", "no_slots", "unavailable"]) {
      // Not "Pick Your Pickup Time" when there is nothing to pick.

      const html = renderToStaticMarkup(createElement(PaymentReceivedDetails, { view: { ...view, booking: { state: st } } }));
      expect(html).toContain("We&#x27;ll Call You To Schedule");
      expect(html).not.toContain("Pick Your Pickup Time");
      expect(html).toContain("(888) 833-8280");
    }
  });
});
