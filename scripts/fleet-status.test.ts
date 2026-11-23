// FLEET status reads: journey/next-step rules, balance math, digest queues and
// the endpoint contract. Fake database; network refused; nothing is written.
import { describe, expect, test } from "bun:test";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
import { fakeDb, KEY, req } from "./fleet-fake-db";
const s = await import("@/lib/fleet-status.server");

const NOW = new Date("2026-11-16T15:00:00Z"); // 10 AM ET
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const L3 = "33333333-3333-4333-8333-333333333333";
const R3 = "44444444-4444-4444-8444-444444444444";
const V1 = "55555555-5555-4555-8555-555555555555";
const env = { FLEET_API_KEY: KEY };

const complete = { vehicle_size: "sedan", pickup_date: "2026-11-18", expected_duration: "1-3 months", gig_status: "yes", drive_type: "uber" };
const baseApp = (id: string, extra: Record<string, any> = {}) => ({ id, full_name: `Test ${id.slice(0, 4)}`, email: `${id.slice(0, 4)}@example.com`, phone: null, status: "new", created_at: "2026-11-10T12:00:00Z", deleted_at: null, primary_application_id: null, ...extra });
const docs = (id: string, cats: string[]) => cats.map((c, i) => ({ id: `${id}-d${i}`, driver_id: id, category: c, review_status: "pending", is_current: true, created_at: "2026-11-11T12:00:00Z" }));

describe("computeJourney next step", () => {
  const j = (app: any, more: Partial<Parameters<typeof s.computeJourney>[0]> = {}) =>
    s.computeJourney({ app, docs: [], agreements: [], rentals: [], payments: [], needsStaff: null, botPause: null, now: NOW, ...more });

  test("missing files: renter, with the upload-link API", () => {
    const r = j(baseApp(L1, complete));
    expect(r.next.step).toBe("documents");
    expect(r.next.owner).toBe("renter");
    expect(r.steps.documents.missing).toEqual(["license_front", "gig_profile", "income"]);
  });
  test("complete file: FLEET reviews", () => {
    const r = j(baseApp(L1, complete), { docs: docs(L1, ["license_front", "gig_profile", "income"]) });
    expect(r.next).toMatchObject({ step: "review", owner: "fleet" });
  });
  test("open needs-staff always wins over FLEET work", () => {
    const r = j(baseApp(L1, complete), { docs: docs(L1, ["license_front", "gig_profile", "income"]), needsStaff: { reason: "rating under 4.0", created_at: null } });
    expect(r.next).toMatchObject({ step: "needs_staff", owner: "staff" });
  });
  test("a bot pause beats everything except closed", () => {
    const r = j(baseApp(L1, { ...complete, status: "approved" }), { botPause: { reason: "complaint", since: null } });
    expect(r.next).toMatchObject({ step: "staff_handling", owner: "staff" });
    expect(j(baseApp(L1, { status: "declined" }), { botPause: { reason: "x", since: null } }).next.owner).toBe("none");
  });
  test("approved path: car, agreement, signature, pickup, then staff handover", () => {
    const ap = baseApp(L1, { ...complete, status: "approved" });
    expect(j(ap).next.step).toBe("assign_vehicle");
    const withCar = { ...ap, vehicle_id: V1 };
    expect(j(withCar).next.step).toBe("send_agreement");
    const sent = [{ id: "a1", status: "sent", sent_at: "2026-11-16T09:00:00Z", created_at: "2026-11-16T09:00:00Z", email_status: "sent", sms_status: "sent" }];
    const r = j(withCar, { agreements: sent });
    expect(r.next).toMatchObject({ step: "sign_agreement", owner: "renter" });
    expect(r.next.detail).toContain("6h ago");
    const signed = [{ id: "a1", status: "signed", sent_at: "2026-11-16T09:00:00Z", signed_at: "2026-11-16T10:00:00Z", created_at: "2026-11-16T09:00:00Z" }];
    expect(j(withCar, { agreements: signed }).next.step).toBe("book_pickup");
    const booked = { ...withCar, card_on_file_at: "2026-11-16T10:00:00Z" };
    const note = JSON.stringify({ reservation_details: 1, pickup_time: "09:30", pickup_location: "3500 E Hillsborough Ave, Tampa, FL 33610" });
    const rentals = [{ id: R3, status: "reserved", start_date: "2026-11-18", reservation_note: note, reservation_deposit_required: true, reservation_deposit_status: "pending", created_at: "2026-11-16T10:00:00Z" }];
    expect(j(booked, { agreements: signed, rentals }).next.step).toBe("reservation_fee");
    const paid = [{ ...rentals[0], reservation_deposit_status: "paid" }];
    const done = j(booked, { agreements: signed, rentals: paid });
    expect(done.next).toMatchObject({ step: "pickup", owner: "staff" });
    expect(done.next.detail).toContain("2026-11-18 09:30");
    expect(done.steps.pickup_booked).toMatchObject({ done: true, date: "2026-11-18", time: "09:30", requested_date: "2026-11-18" });
    expect(done.steps.insurance.owner).toBe("staff");
  });
  test("voided agreements are ignored", () => {
    const ap = baseApp(L1, { ...complete, status: "approved", vehicle_id: V1 });
    expect(j(ap, { agreements: [{ id: "a0", status: "voided", voided_at: "2026-11-15T00:00:00Z", sent_at: "x" }] }).next.step).toBe("send_agreement");
  });
});

describe("balance", () => {
  test("owed: balance_due wins, settled rows owe nothing", () => {
    expect(s.owed({ status: "failed", amount: 300, late_fees: 50 })).toBe(350);
    expect(s.owed({ status: "failed", amount: 300, late_fees: 50, balance_due: 120 })).toBe(120);
    expect(s.owed({ status: "paid", amount: 300 })).toBe(0);
    expect(s.owed({ status: "void", amount: 300 })).toBe(0);
  });
  test("overdue uses the Eastern date and adds the return balance", () => {
    const b = s.summarizeBalance(
      [
        { id: "p1", status: "failed", amount: 300, late_fees: 100, due_date: "2026-11-12" },
        { id: "p2", status: "pending", amount: 300, late_fees: 0, due_date: "2026-11-19" },
        { id: "p3", status: "paid", amount: 300, due_date: "2026-11-05" },
      ],
      { balance_due_cents: 2500 },
      NOW,
    );
    expect(b.total_owed).toBe(725);
    expect(b.overdue_owed).toBe(400);
    expect(b.late_fees_owed).toBe(100);
    expect(b.oldest_overdue_due_date).toBe("2026-11-12");
    expect(b.open_rows.map((r) => r.payment_id)).toEqual(["p1", "p2"]);
  });
});

function seed() {
  return fakeDb({
    applications: [
      baseApp(L1, { ...complete, status: "new" }),
      baseApp(L2, { ...complete, status: "approved", vehicle_id: V1, insurance_status: "pending" }),
      baseApp(L3, { ...complete, status: "active", vehicle_id: V1 }),
    ],
    documents: docs(L1, ["license_front"]),
    agreements: [{ id: "ag2", application_id: L2, status: "sent", sent_at: "2026-11-15T15:00:00Z", created_at: "2026-11-15T15:00:00Z", voided_at: null, email_status: "sent", sms_status: "not_attempted" }],
    rentals: [{ id: "r-res", application_id: L2, status: "reserved", start_date: "2026-11-17", reservation_note: JSON.stringify({ reservation_details: 1, pickup_time: "10:30" }), created_at: "2026-11-16T00:00:00Z" }, { id: R3, application_id: L3, status: "active", start_date: "2026-11-01", end_date: "2027-02-01", autopay_active: false, payment_status: "past_due", weekly_rate: 300, created_at: "2026-11-01T00:00:00Z" }],
    payments: [
      { id: "p1", driver_id: L3, rental_id: R3, type: "rent", status: "failed", amount: 300, late_fees: 150, due_date: "2026-11-12", last_attempt_at: "2026-11-12T13:00:00Z" },
      { id: "p0", driver_id: L3, rental_id: R3, type: "rent", status: "paid", amount: 300, due_date: "2026-11-05" },
    ],
    fleet_review_decisions: [{ id: "d1", application_id: L1, decision: "needs_staff", reason: "rating under 4.0", resolved_at: null, created_at: "2026-11-16T05:00:00Z" }],
    fleet_webhook_deliveries: [{ id: "w1", event_type: "lead_created", status: "delivered", created_at: "2026-11-16T10:00:00Z" }],
    quo_events: [],
    outbound_messages: [],
    driver_screenings: [],
    app_settings: [], // the review list reads the RentID switch (fleet-rentid.server.ts)
  });
}

describe("shared owes", () => {
  test("a daily plan with no open rows owes the same $100 and 1 day the Bookings board owes", async () => {
    const db = fakeDb({
      applications: [baseApp(L3, { ...complete, status: "active", vehicle_id: V1 })],
      documents: [],
      agreements: [],
      rentals: [{ id: R3, application_id: L3, status: "active", start_date: "2026-11-16", weekly_rate: 350, next_payment_due: "2026-11-16", autopay_active: false, created_at: "2026-11-16T00:00:00Z" }],
      payments: ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"].map((due, i) => ({
        id: `paid-${i}`, driver_id: L3, rental_id: R3, type: "rent", status: "paid", amount: 50, due_date: due, paid_date: due,
      })),
      app_settings: [{ key: "daily_rent_plans", value: { [R3]: { dailyRate: 50, startsOn: "2026-11-16" } } }],
      fleet_review_decisions: [],
      quo_events: [],
      outbound_messages: [],
    });
    const now = new Date("2026-11-21T16:00:00Z"); // 11 AM ET
    const res = await s.handleFleetStatus(req({ action: "balance", rental_id: R3 }), { admin: db, env, now: () => now });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.balance.rent_owed).toBe(100);
    expect(body.balance.overdue_days).toBe(1);
    expect(body.balance.total_owed).toBe(100);
    expect(body.balance.cadence).toBe("daily");
  });
});

describe("endpoint", () => {
  test("auth: no key 401, unconfigured 503, GET 405", async () => {
    const db = seed();
    expect((await s.handleFleetStatus(req({ action: "digest" }, null), { admin: db, env, now: () => NOW })).status).toBe(401);
    expect((await s.handleFleetStatus(req({ action: "digest" }), { admin: db, env: {}, now: () => NOW })).status).toBe(503);
    expect((await s.handleFleetStatus(req(null, KEY, "GET"), { admin: db, env, now: () => NOW })).status).toBe(405);
  });
  test("digest: queues, past due, staff actions; no phone numbers", async () => {
    const db = seed();
    const before = JSON.stringify(db.state);
    const res = await s.handleFleetStatus(req({ action: "digest" }), { admin: db, env, now: () => NOW });
    expect(res.status).toBe(200);
    const { digest } = (await res.json()) as any;
    expect(digest.stages).toEqual({ new: 1, approved: 1, active: 1 });
    expect(digest.queues.needs_staff.count).toBe(1);
    expect(digest.queues.agreements_unsigned.agreements[0]).toMatchObject({ agreement_id: "ag2", hours_since_sent: 24 });
    expect(digest.rentals.past_due.rentals[0]).toMatchObject({ rental_id: R3, overdue_owed: 450, late_fees_owed: 150 });
    expect(digest.rentals.failed_payments_7d).toBe(1);
    expect(digest.queues.pickups_next_2_days.pickups).toEqual([{ lead_id: L2, name: "Test 2222", date: "2026-11-17", time: "10:30", rental_id: "r-res" }]);
    expect(digest.staff_actions.map((a: any) => a.kind)).toContain("insurance_verification");
    expect(JSON.stringify(digest)).not.toMatch(/"phone"/);
    expect(digest.staff_coverage).toMatchObject({ on_duty: { staffKey: "dolmar" }, reach_via: "field_rep_sms", may_call_applicant: true });
    const after = JSON.parse(JSON.stringify(db.state));
    delete after.staff_schedules;
    delete after.staff_schedule_exceptions;
    expect(after).toEqual(JSON.parse(before)); // read-only, aside from lazily seeing the coverage tables
  });
  test("lead: journey + next step", async () => {
    const res = await s.handleFleetStatus(req({ action: "lead", lead_id: L2 }), { admin: seed(), env, now: () => NOW });
    const { lead } = (await res.json()) as any;
    expect(lead.next).toMatchObject({ step: "sign_agreement", owner: "renter" });
    expect(lead.agreement).toMatchObject({ agreement_id: "ag2", sms_status: "not_attempted" });
    expect(lead.admin_url).toContain(L2);
  });
  test("lead: needs staff shown; bad id 400; unknown 404", async () => {
    const db = seed();
    const r1 = (await (await s.handleFleetStatus(req({ action: "lead", lead_id: L1 }), { admin: db, env, now: () => NOW })).json()) as any;
    expect(r1.lead.next.owner).toBe("staff");
    expect((await s.handleFleetStatus(req({ action: "lead", lead_id: "nope" }), { admin: db, env, now: () => NOW })).status).toBe(400);
    expect((await s.handleFleetStatus(req({ action: "lead", lead_id: "99999999-9999-4999-8999-999999999999" }), { admin: db, env, now: () => NOW })).status).toBe(404);
  });
  test("balance by lead or rental", async () => {
    const db = seed();
    const a = (await (await s.handleFleetStatus(req({ action: "balance", lead_id: L3 }), { admin: db, env, now: () => NOW })).json()) as any;
    expect(a.balance).toMatchObject({ rental_id: R3, total_owed: 450, overdue_owed: 450, autopay: false });
    const b = (await (await s.handleFleetStatus(req({ action: "balance", rental_id: R3 }), { admin: db, env, now: () => NOW })).json()) as any;
    expect(b.balance.total_owed).toBe(450);
    expect((await s.handleFleetStatus(req({ action: "balance" }), { admin: db, env, now: () => NOW })).status).toBe(400);
  });
  test("unknown action 400", async () => {
    expect((await s.handleFleetStatus(req({ action: "write" }), { admin: seed(), env, now: () => NOW })).status).toBe(400);
  });
});
