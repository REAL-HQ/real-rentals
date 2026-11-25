/**
 * Pickup Not Booked: profile state, Book Pickup through createReservationCore,
 * the slot-picker link after an agreement replacement, and the staff alert
 * dedupe. Fake database. No network, no real renter phone numbers.
 * Run: npx vitest run scripts/pickup-not-booked.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const sent = vi.hoisted(() => ({ email: [] as any[], invite: [] as any[], sms: [] as any[], webhooks: [] as any[] }));
vi.mock("@/lib/audit.server", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/automation-controls.server", () => ({ gateFor: () => "on", loadAutomationControls: async () => ({}) }));
vi.mock("@/lib/email.server", () => ({
  sendPickupBookedEmail: async (a: any) => { sent.invite.push(a); return { ok: true }; },
  sendEmail: async (a: any) => { sent.email.push(a); return { ok: true }; },
}));
vi.mock("@/lib/sms.server", () => ({ sendSms: async (a: any) => { sent.sms.push(a); return { ok: true }; } }));
vi.mock("@/lib/fleet-webhook.server", () => ({
  enqueueFleetEvent: async (_admin: any, row: any) => { sent.webhooks.push(row); return "wh-1"; },
  dispatchFleetWebhooks: async () => ({}),
}));

import { nextStep } from "../src/lib/next-step";
import { NextStepCard } from "../src/components/admin/NextStepCard";
import { isPickupNotBooked, pickupLinkEmail, feePaidNoPickupBody, FEE_PAID_NO_PICKUP_TITLE, PICKUP_LINK_EMAIL_SUBJECT } from "../src/lib/pickup-not-booked";
import { projectPaymentAlert } from "../src/lib/admin-overview";
import { alertFeePaidNoPickup, loadPickupNotBooked, preparePickupLink, sendPickupLink } from "../src/lib/pickup-not-booked.server";
import { createReservationCore } from "../src/lib/reservations.functions";
import { lookupPaymentReceived } from "../src/lib/payment-received.server";
import { TEAM_ALERT_EMAIL } from "../src/lib/team-alerts";
import { DEFAULT_PICKUP_SCHEDULE } from "../src/lib/pickup-schedule";

type Rows = Record<string, any[]>;
function fakeDb(seed: Rows) {
  const state: Rows = JSON.parse(JSON.stringify(seed));
  let n = 0;
  function q(table: string) {
    const f: ((r: any) => boolean)[] = [];
    let lim = Infinity;
    let op: "select" | "update" | "insert" = "select";
    let patch: any = null;
    let inserted: any = null;
    let insErr: any = null;
    const all = () => (state[table] ??= []);
    const run = () => {
      if (op === "insert") return { data: inserted, error: insErr };
      const hit = all().filter((r) => f.every((g) => g(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
      return { data: hit.slice(0, lim), error: null };
    };
    const api: any = {
      select: () => api,
      order: () => api,
      eq: (k: string, v: any) => (f.push((r) => r[k] === v), api),
      neq: (k: string, v: any) => (f.push((r) => r[k] !== v), api),
      is: (k: string, v: any) => (f.push((r) => (r[k] ?? null) === v), api),
      in: (k: string, v: any[]) => (f.push((r) => v.includes(r[k])), api),
      ilike: (k: string, pattern: string) => {
        const needle = String(pattern).replace(/%/g, "").toLowerCase();
        f.push((r) => String(r[k] ?? "").toLowerCase().includes(needle));
        return api;
      },
      limit: (x: number) => ((lim = x), api),
      update: (p: any) => ((op = "update"), (patch = p), api),
      insert: (row: any) => {
        op = "insert";
        const rows = Array.isArray(row) ? row : [row];
        const made = rows.map((r) => ({ id: r.id ?? `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, ...r }));
        all().push(...made);
        inserted = made[0];
        return api;
      },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error ?? null }; },
      single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error ?? null }; },
    };
    return api;
  }
  return { from: q, state };
}

const APP = "11111111-1111-4111-8111-111111111111";
const OLD = "22222222-2222-4222-8222-222222222222";
const NEW = "33333333-3333-4333-8333-333333333333";
const PAY = "44444444-4444-4444-8444-444444444444";
const CAR = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";
const SID = "cs_test_a1B2c3D4e5F6g7H8i9J0";

function world(over: { rentalStatus?: string | null; notes?: string; appStatus?: string; feeStatus?: string } = {}) {
  return {
    app_settings: [{ key: "reservation_fee_auto", value: { enabled: true, amount: 50 } }],
    applications: [{ id: APP, status: over.appStatus ?? "approved", user_id: USER, full_name: "Test Renter", email: "renter@example.com", vehicle_id: CAR, contract_start_date: "2026-11-21", deleted_at: null }],
    agreements: [
      { id: OLD, application_id: APP, status: "voided", signed_at: "2026-11-18T12:00:00Z", voided_at: "2026-11-18T15:00:00Z", rental_id: null, vehicle_id: CAR, metadata: { reservation_fee_checkout: { session_id: SID, payment_id: PAY, url: "https://checkout.stripe.com/c/pay/old" } } },
      { id: NEW, application_id: APP, status: "signed", signed_at: "2026-11-18T16:00:00Z", voided_at: null, rental_id: null, vehicle_id: CAR, metadata: {} },
    ],
    payments: [{ id: PAY, driver_id: APP, reason: "reservation_fee", notes: over.notes ?? `reservation_fee:${NEW}`, status: over.feeStatus ?? "paid", amount: 50, rental_id: null }],
    vehicles: [{ id: CAR, year: 2015, make: "Ford", model: "Fusion", license_plate: "ABC123", vin: "1FAKE6P8TH123456", status: "available", archived_at: null, weekly_rate: 350 }],
    rentals: over.rentalStatus ? [{ id: "77777777-7777-4777-8777-777777777777", application_id: APP, driver_id: USER, vehicle_id: CAR, status: over.rentalStatus, start_date: "2026-11-21" }] : [],
    notifications: [] as any[],
    markets: [],
    staff_terms_confirmations: [],
  };
}

function stripeSession() {
  return {
    id: SID, mode: "payment", payment_status: "paid", amount_total: 5000,
    metadata: { applicationId: APP, agreementId: OLD, paymentIds: PAY, reason: "reservation_fee" },
    payment_intent: { id: "pi_1", created: 1763474400, latest_charge: { created: 1763474460, receipt_url: "https://pay.stripe.com/receipts/payment/abc", payment_method_details: { card: { brand: "visa", last4: "4242" } } } },
  };
}

beforeEach(() => { sent.email.length = 0; sent.invite.length = 0; sent.sms.length = 0; sent.webhooks.length = 0; });

describe("profile state", () => {
  it("shows Pickup Not Booked only when approved, signed, Reservation Fee paid, and no open rental", () => {
    const yes = { applicationStatus: "approved", hasCurrentSignedAgreement: true, reservationFeePaid: true, openRental: false };
    expect(isPickupNotBooked(yes)).toBe(true);
    expect(isPickupNotBooked({ ...yes, applicationStatus: "active" })).toBe(true);
    for (const patch of [
      { applicationStatus: "pending" },
      { hasCurrentSignedAgreement: false },
      { reservationFeePaid: false },
      { openRental: true },
      { deleted: true },
    ]) expect(isPickupNotBooked({ ...yes, ...patch })).toBe(false);
  });

  it("the loader matches that rule, including on hold and an active rental", async () => {
    expect((await loadPickupNotBooked(fakeDb(world()), APP)).show).toBe(true);
    expect((await loadPickupNotBooked(fakeDb(world({ rentalStatus: "reserved" })), APP)).show).toBe(false);
    expect((await loadPickupNotBooked(fakeDb(world({ rentalStatus: "on_hold" })), APP)).openRental).toBe(true);
    expect((await loadPickupNotBooked(fakeDb(world({ rentalStatus: "active" })), APP)).show).toBe(false);
    expect((await loadPickupNotBooked(fakeDb(world({ feeStatus: "refunded" })), APP)).show).toBe(false);
    expect((await loadPickupNotBooked(fakeDb(world({ rentalStatus: "pending_reservation" })), APP)).show).toBe(true);
    const bookedPending = world({ rentalStatus: "pending_reservation" });
    bookedPending.rentals[0].reservation_note = JSON.stringify({ reservation_details: 1, pickup_time: "10:30", pickup_location: "3500 E Hillsborough Ave, Tampa, FL" });
    expect((await loadPickupNotBooked(fakeDb(bookedPending), APP)).show).toBe(false);
    const gap = await loadPickupNotBooked(fakeDb(world()), APP);
    expect(gap).toMatchObject({ vehicleId: CAR, startDate: "2026-11-21", agreementId: NEW, paymentId: PAY, feeNotesMatch: true });
  });

  it("the Next Step card names Pickup Not Booked and offers Book Pickup and Send Pickup Link", () => {
    const readiness = { ready: true, blockers: [], warnings: [], requirements: [{ key: "approved", label: "Approved", met: true, enforcement: "hard" }], insurance: { status: "unverified", exceptionAllowed: false, settingPresent: true, settingReadable: true }, vehicleId: null, suggestedWeeklyRate: null, suggestedDeposit: null, inspectionMileage: null, currentMileage: null } as any;
    const model = nextStep({ step: "activate", entry: "enabled", readiness, loading: false, failed: false, canReserve: true, pickupNotBooked: true });
    expect(model).toMatchObject({ label: "Book Pickup", target: { kind: "book_pickup" }, pickupNotBooked: true, activation: "ready" });
    expect(model.note).toContain("Reservation Fee");
    expect(model.note.toLowerCase()).not.toContain("deposit");
    const html = renderToStaticMarkup(createElement(NextStepCard, { model, readiness, onRun() {}, onActivate() {}, onRetry() {}, onBookPickup() {}, onSendPickupLink() {} }));
    expect(html).toContain('data-testid="pickup-not-booked"');
    expect(html).toContain("Pickup Not Booked");
    expect(html).toContain('data-testid="book-pickup"');
    expect(html).toContain("Book Pickup");
    expect(html).toContain('data-testid="send-pickup-link"');
    expect(html).toContain("Send Pickup Link");
    expect(html).toContain("Reservation Fee");
    expect(html.toLowerCase()).not.toContain("deposit");
    expect(nextStep({ step: "activate", entry: "manager_only", readiness, loading: false, failed: false, pickupNotBooked: true }).pickupNotBooked).toBeUndefined();
    expect(nextStep({ step: "activate", entry: "enabled", readiness, loading: false, failed: false, pickupNotBooked: true, hasReservation: true }).target.kind).not.toBe("book_pickup");
  });
});

describe("Book Pickup", () => {
  it("creates a reserved rental, marks the vehicle reserved, and links the current agreement and the paid Reservation Fee", async () => {
    const db = fakeDb(world());
    const booked = await createReservationCore(db as any, {
      applicationId: APP,
      vehicleId: CAR,
      pickupDate: "2026-11-21",
      pickupTime: "10:30",
      pickupLocation: "3500 E Hillsborough Ave, Tampa, FL",
    });
    const rental = db.state.rentals.find((r) => r.id === booked.id);
    expect(rental).toMatchObject({
      status: "reserved",
      application_id: APP,
      vehicle_id: CAR,
      start_date: "2026-11-21",
      reservation_deposit_status: "applied",
      reservation_deposit_payment_id: PAY,
    });
    expect(db.state.vehicles[0].status).toBe("reserved");
    expect(db.state.agreements.find((a) => a.id === NEW).rental_id).toBe(booked.id);
    expect(db.state.agreements.find((a) => a.id === OLD).rental_id).toBeNull();
    expect(db.state.payments[0].rental_id).toBe(booked.id);
    expect(sent.invite).toHaveLength(1);
    expect(sent.invite[0].subject ?? sent.invite[0].reservation.pickupDate).toBeTruthy();
    expect(sent.sms).toHaveLength(0);
    expect(readFileSync("src/components/admin/DriversPanel.tsx", "utf8")).toContain('intent="book_pickup"');
    expect(readFileSync("src/components/admin/ReserveCarDialog.tsx", "utf8")).toContain("<VehicleCombobox");
    expect(readFileSync("src/lib/reservations.functions.ts", "utf8")).toContain("export async function createReservationCore");
  });
});

describe("pickup link after an agreement replacement", () => {
  it("accepts the current signed agreement the paid fee notes name, and staff can refresh that link without sending", async () => {
    const db = fakeDb(world());
    const stripe = { checkout: { sessions: { retrieve: async () => stripeSession() } } };
    const settings = { ...DEFAULT_PICKUP_SCHEDULE, notify: { ...DEFAULT_PICKUP_SCHEDULE.notify, enabled: false, sms: [] as string[], emails: [] as string[] } };
    const slotDeps = { stripe, settings, now: () => new Date("2026-11-18T14:00:00Z"), listSlots: async () => [{ date: "2026-11-21", time: "10:30", start_at: "2026-11-21T10:30:00-05:00", label: "Sat, Nov 21, 10:30 AM" }] };
    const before: any = await lookupPaymentReceived(db, SID, slotDeps);
    expect(before.ok).toBe(true);
    expect(before.booking.state).toBe("pick");

    const link = await preparePickupLink(db, APP);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    expect(link.url).toBe(`https://drivereal.com/reservation-fee?status=paid&session_id=${SID}`);
    expect(link.refreshed).toBe(true);
    expect(link.agreementId).toBe(NEW);
    expect(db.state.agreements.find((a) => a.id === NEW).metadata.reservation_fee_checkout.session_id).toBe(SID);
    expect(db.state.agreements.find((a) => a.id === NEW).metadata.reservation_fee_checkout.payment_id).toBe(PAY);
    const again = await preparePickupLink(db, APP);
    expect(again.ok && again.refreshed).toBe(false);
    expect(sent.email).toHaveLength(0);
    expect(sent.sms).toHaveLength(0);

    const after: any = await lookupPaymentReceived(db, SID, slotDeps);
    expect(after.ok).toBe(true);

    const untied = fakeDb(world({ notes: `reservation_fee:${OLD}` }));
    expect((await preparePickupLink(untied, APP)).ok).toBe(false);
    const refused: any = await lookupPaymentReceived(untied, SID, slotDeps);
    expect(refused).toEqual({ ok: false, reason: "not_reservation_fee" });
  });

  it("emails the link from team@ only when Send is called, and never texts", async () => {
    const db = fakeDb(world());
    const emails: any[] = [];
    const result = await sendPickupLink(db, APP, { sendEmail: async (a) => { emails.push(a); return { ok: true }; } });
    expect(result).toEqual({ ok: true, to: "renter@example.com" });
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe(PICKUP_LINK_EMAIL_SUBJECT);
    expect(emails[0].track.workflow).toBe("pickup_link");
    expect(emails[0].html).toContain("Reservation Fee");
    expect(emails[0].html).toContain(`session_id=${SID}`);
    expect(emails[0].html.toLowerCase()).not.toContain("deposit");
    expect(JSON.stringify(emails[0])).not.toMatch(/\+1\d{10}/);
    const preview = pickupLinkEmail({ firstName: "Test", url: emails[0].html.includes(SID) ? `https://drivereal.com/reservation-fee?status=paid&session_id=${SID}` : "" });
    expect(preview.subject).toBe("Choose Your Pickup Time");
    expect(sent.sms).toHaveLength(0);
    expect(readFileSync("src/lib/pickup-not-booked.server.ts", "utf8")).not.toMatch(/sms\.server|sendSms/);
  });
});

describe("Fee Paid, No Pickup Booked", () => {
  it("alerts once per lead and skips when a pickup is already booked", async () => {
    const db = fakeDb(world());
    const emails: any[] = [];
    const sendEmail = async (a: any) => { emails.push(a); return { ok: true }; };
    expect(await alertFeePaidNoPickup(db, APP, { sendEmail })).toMatchObject({ status: "notified", email: "sent" });
    expect(db.state.notifications).toHaveLength(1);
    expect(db.state.notifications[0].title).toBe(FEE_PAID_NO_PICKUP_TITLE);
    expect(db.state.notifications[0].body).toBe(feePaidNoPickupBody("Test Renter", APP));
    expect(db.state.notifications[0].body).not.toMatch(/\+1\d{10}/);
    expect(db.state.notifications[0].driver_id).toBeNull();
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe(TEAM_ALERT_EMAIL);
    expect(emails[0].subject).toBe("Fee Paid, No Pickup Booked — Test Renter");
    expect(emails[0].track.workflow).toBe("fee_paid_no_pickup");
    expect(emails[0].html.toLowerCase()).not.toContain("deposit");
    expect(projectPaymentAlert({ id: "n1", title: FEE_PAID_NO_PICKUP_TITLE, body: db.state.notifications[0].body, created_at: "2026-11-18T16:00:00Z" } as any)?.title).toBe(FEE_PAID_NO_PICKUP_TITLE);

    expect(await alertFeePaidNoPickup(db, APP, { sendEmail })).toEqual({ status: "duplicate" });
    expect(db.state.notifications).toHaveLength(1);
    expect(emails).toHaveLength(1);

    const held = fakeDb(world({ rentalStatus: "reserved" }));
    expect(await alertFeePaidNoPickup(held, APP, { sendEmail })).toEqual({ status: "pickup_booked" });
    expect(held.state.notifications).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(readFileSync("src/lib/agreements.functions.ts", "utf8")).toContain("alertFeePaidNoPickup");
  });
});
