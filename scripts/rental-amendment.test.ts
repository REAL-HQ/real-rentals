// Updated agreements for an ACTIVE rental (rate change): parsing, dates,
// refusals, store-then-send order, idempotency, apply-on-signing and the
// proposed SQL (PGlite).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const lib = await import("@/lib/rental-amendment");
const m = await import("@/lib/rental-amendment.server");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[]; rpc?: (name: string, args: any, state: any) => any } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const rpcCalls: any[] = [];
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim = Infinity;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => q, insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: any) => { f.push((r) => String(r[c]) >= String(v)); return q; },
      lte: (c: string, v: any) => { f.push((r) => String(r[c]) <= String(v)); return q; },
      order: () => q, limit: (k: number) => { lim = k; return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      const rows = state[table];
      if (op === "insert") {
        if (payload.idempotency_key && rows.some((r) => r.idempotency_key === payload.idempotency_key)) return { data: null, error: { code: "23505", message: "dup" } };
        if (table === "rental_rate_amendments" && rows.some((r) => r.rental_id === payload.rental_id && r.status === "pending_signature")) return { data: null, error: { code: "23505", message: "one open" } };
        const r = { id: `${table}-${n++}`, ...payload }; rows.push(r); return { data: { id: r.id }, error: null };
      }
      const hit = rows.filter((r) => f.every((x) => x(r))).slice(0, lim);
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: hit, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  }
  async function rpc(name: string, args: any) { rpcCalls.push({ name, args }); return { data: opts.rpc ? opts.rpc(name, args, state) : "applied", error: null }; }
  return { from, rpc, state, rpcCalls };
}

const KEY = "k".repeat(40);
// Mon Nov 16 2026, 10:30 AM ET.
const NOW = new Date("2026-11-16T15:30:00Z");
const R = "9108ea8c-0000-4000-8000-000000000001";
const A = "11111111-1111-4111-8111-111111111111";
const V = "44444444-4444-4444-8444-444444444444";
const PHONE = "+18135550123";
const seed = (x: Row = {}) => ({
  rentals: [{ id: R, application_id: A, status: "active", weekly_rate: 350, next_payment_due: "2026-11-20", vehicle_id: V, stripe_subscription_id: null, ...x }],
  applications: [{ id: A, status: "active", full_name: "Test Renter", email: "t@example.com", phone: PHONE, deleted_at: null, weekly_rent: 350 }],
  agreements: [{ id: "agr-old", application_id: A, status: "signed", signed_at: "2026-10-01T15:00:00Z", voided_at: null }],
  quo_events: [{ id: "qe-1", event_type: "message.received", quo_resource_id: "MSG1", direction: "incoming", from_e164: PHONE, body: "Yes that's fine, $375 works for me", occurred_at: "2026-11-16T14:24:00.000Z" }],
  rental_rate_amendments: [],
});
const consent = (x: Row = {}) => ({ channel: "sms", received_at: "2026-11-16T09:24:00-05:00", quote: "$375 works for me", ...x });
const body = (x: Row = {}) => ({ rental_id: R, mode: "amendment", new_weekly_rate: 375, effective_date: "2026-11-20", reason: "Rate review: renter agreed to $375/week.", renter_consent: consent(), idempotency_key: "amend-R-375", ...x });

async function call(db: any, b: Row, d: Row = {}) {
  const issued: any[] = []; const audits: any[] = [];
  const res = await m.handleFleetAmendAgreement(new Request("https://drivereal.com/api/public/fleet/amend-agreement", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(b),
  }), {
    admin: db, env: { FLEET_API_KEY: KEY }, now: () => d.now ?? NOW, audit: async (e: any) => { audits.push(e); },
    gate: async () => d.gate ?? "send",
    handoff: async () => d.handoff ?? null,
    withinHours: d.withinHours ?? (() => true),
    check: async (_a: any, _id: string, am: any) => d.check ?? { blockers: [], weeklyRate: am.weeklyRate, vehicleLabel: "2021 Ford Fusion" },
    issue: async (_a: any, id: string, o: any) => { if (d.fail) throw new Error("Resend down"); issued.push({ id, o }); return { id: "agr-new", url: "https://drivereal.com/sign/SECRET", delivery: { email: "sent", sms: "sent", delivered: true } }; },
  } as any);
  return { status: res.status, body: await res.json(), issued, audits };
}

describe("helpers", () => {
  test("effective date: never past, default next rent week, max 90 days", () => {
    expect(lib.resolveEffectiveDate("2026-11-15", "2026-11-16", null).ok).toBe(false);
    expect(lib.resolveEffectiveDate("2026-11-16", "2026-11-16", null)).toMatchObject({ ok: true, value: "2026-11-16" });
    expect(lib.resolveEffectiveDate("", "2026-11-16", "2026-11-20")).toMatchObject({ ok: true, value: "2026-11-20", defaulted: true });
    expect(lib.resolveEffectiveDate(null, "2026-11-16", "2026-11-09")).toMatchObject({ ok: true, value: "2026-11-16" });
    expect(lib.resolveEffectiveDate("2027-03-01", "2026-11-16", null).ok).toBe(false);
    expect(lib.resolveEffectiveDate("2026-02-30", "2026-11-16", null).ok).toBe(false);
  });
  test("apply date: effective date, else next rent week after signing, never before signing", () => {
    expect(lib.applyOnDate("2026-11-20", "2026-11-17", "2026-11-20")).toBe("2026-11-20");
    expect(lib.applyOnDate("2026-11-20", "2026-11-22", "2026-11-27")).toBe("2026-11-27");
    expect(lib.applyOnDate("2026-11-20", "2026-11-22", "2026-11-20")).toBe("2026-11-22");
    expect(lib.applyOnDate("2026-11-20", "2026-11-22", null)).toBe("2026-11-22");
  });
  test("consent parsing and bounds", () => {
    expect(lib.parseRenterConsent(consent(), NOW, ["sms", "call"]).ok).toBe(true);
    for (const bad of [{ channel: "email" }, { received_at: "2026-11-16 09:24" }, { received_at: "2026-10-01T09:00:00Z" }, { received_at: "2026-11-18T09:00:00Z" }, { quote: "" }, { channel: "call" }])
      expect(lib.parseRenterConsent(consent(bad), NOW, ["sms", "call"]).ok).toBe(false);
    expect(lib.parseRenterConsent(consent({ channel: "in_person" }), NOW, lib.STAFF_CONSENT_CHANNELS).ok).toBe(true);
    expect([199, 200, 375, 1000, 1001].map(lib.withinRateBounds)).toEqual([false, true, true, true, false]);
  });
  test("notice goes after the layout marker (acknowledgments unchanged) or at the top", () => {
    const notice = lib.amendmentNoticeText({ oldRate: 350, newRate: 375, effectiveDate: "2026-11-20", previousSignedAt: "2026-10-01T15:00:00Z" });
    expect(notice).toContain("from $350 to $375");
    expect(notice).toContain("stays at $350");
    const s = lib.insertAmendmentNotice("%%LAYOUT 1%%\n# RENTAL AGREEMENT\n|i I agree", notice, "%%LAYOUT 1%%");
    expect(s.startsWith("%%LAYOUT 1%%\n!+ **Amendment.** ")).toBe(true);
    expect(s).toContain("|i I agree");
    expect(lib.insertAmendmentNotice("VEHICLE RENTAL AGREEMENT", "N", "%%LAYOUT 1%%")).toBe("AMENDMENT: N\n\nVEHICLE RENTAL AGREEMENT");
  });
});

describe("amend-agreement endpoint", () => {
  test("happy path: stores pending, sends through issueAgreement with the new rate, rental unchanged, link never returned", async () => {
    const db = fakeDb(seed());
    const r = await call(db, body());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, status: "pending_signature", old_weekly_rate: 350, new_weekly_rate: 375, effective_date: "2026-11-20", previous_agreement_id: "agr-old", agreement_id: "agr-new", consent_verified: true });
    expect(JSON.stringify(r.body)).not.toContain("/sign/");
    expect(r.issued).toHaveLength(1);
    expect(r.issued[0].o.createdBy).toBeNull();
    expect(r.issued[0].o.amendment).toMatchObject({ weeklyRate: 375, vehicleId: V, rentalId: R, metadata: { kind: "rate_change", amends_agreement_id: "agr-old", old_weekly_rate: 350, new_weekly_rate: 375 } });
    expect(r.issued[0].o.amendment.notice).toContain("$350 to $375");
    const row = db.state.rental_rate_amendments[0];
    expect(row).toMatchObject({ rental_id: R, status: "pending_signature", source: "fleet", agreement_id: "agr-new", requested_by: "FLEET (automated)" });
    expect(row.renter_consent).toMatchObject({ channel: "sms", verified: true, quo_event_id: "qe-1" });
    // Nothing about the rental or billing changes before signing.
    expect(db.state.rentals[0].weekly_rate).toBe(350);
    expect(db.state.applications[0].weekly_rent).toBe(350);
    expect(db.rpcCalls).toHaveLength(0);
    expect(r.audits.map((a) => a.action)).toEqual(["rental.rate_amendment_sent"]);

    const again = await call(db, body());
    expect(again.body).toMatchObject({ ok: true, duplicate: true, agreement_id: "agr-new" });
    expect(again.issued).toHaveLength(0);
  });

  test("v1.14, no Reservation Fee: carries the signed agreement's choices, forces no fee and no deposit; terms override; bad terms refused", async () => {
    const prevPrep = JSON.stringify({ drivers: { mode: "none", list: [] }, reservation: { mode: "required", amount: 50 }, deposit: { mode: "none", amount: null, reason: "" },
      damageWaiver: "declined", payment: { schedule: "weekly", method: "Card Autopay" }, vehicleOwner: "REAL RENTALS LLC" });
    const sd = seed(); sd.agreements[0].merge_data = { _prep: prevPrep };
    const r = await call(fakeDb(sd), body());
    expect(r.status).toBe(201);
    const am = r.issued[0].o.amendment;
    expect(am.templateKey).toBe("insurance_included_v116");
    expect(am.prep.reservation).toEqual({ mode: "not_required", amount: null });
    expect(am.prep.deposit.mode).toBe("none");
    expect(am.prep).toMatchObject({ damageWaiver: "declined", payment: { schedule: "weekly", method: "Card Autopay" }, vehicleOwner: "REAL RENTALS LLC" });
    expect(am.metadata).toMatchObject({ reservation_fee: "not_applicable", new_deposit: 0, template_key: "insurance_included_v116" });
    expect(r.issued[0].o.prep).toBeUndefined();

    const r2 = await call(fakeDb(seed()), body({ idempotency_key: "k-terms", terms: { damage_waiver: "accepted", payment_schedule: "every_4_weeks", payment_method: "Zelle", vehicle_owner: "REAL RENTALS LLC" } }));
    expect(r2.status).toBe(201);
    expect(r2.issued[0].o.amendment.prep).toMatchObject({ damageWaiver: "accepted", payment: { schedule: "every_4_weeks", method: "Zelle" }, reservation: { mode: "not_required" } });

    for (const bad of [{ damage_waiver: "maybe" }, { payment_method: "Bitcoin" }, { payment_schedule: "monthly" }]) {
      const rb = await call(fakeDb(seed()), body({ idempotency_key: "k-bad", terms: bad }));
      expect(rb.status).toBe(400);
      expect(rb.issued).toHaveLength(0);
    }
  });
  test("refusals store and send nothing", async () => {
    const cases: [Row, Row, number, string][] = [
      [{}, { gate: "off" }, 409, "switch is Off"],
      [{}, { withinHours: () => false }, 409, "8 AM to 9 PM"],
      [{}, { handoff: { id: "h1", reason: "complaint" } }, 423, "handed off"],
      [{ new_weekly_rate: 1200 }, {}, 409, "Staff must send"],
      [{ new_weekly_rate: 150 }, {}, 409, "Staff must send"],
      [{ new_weekly_rate: 350 }, {}, 400, "already"],
      [{ effective_date: "2026-11-10" }, {}, 400, "never retroactive"],
      [{ renter_consent: undefined }, {}, 400, "needs renter_consent"],
      [{ renter_consent: consent({ quote: "sure thing" }) }, {}, 409, "No inbound text"],
      [{ renter_consent: consent({ channel: "in_person" }) }, {}, 400, "channel"],
      [{ reason: "" }, {}, 400, "reason"],
      [{}, { check: { blockers: [{ field: "vehicle_vin", label: "VIN", why: "x" }], weeklyRate: 375, vehicleLabel: null } }, 409, "missing details"],
    ];
    for (const [b, d, status, want] of cases) {
      const db = fakeDb(seed());
      const r = await call(db, body({ idempotency_key: undefined, ...b }), d);
      expect([r.status, r.body.error]).toEqual([status, expect.stringContaining(want)]);
      expect(r.issued).toHaveLength(0);
      expect(db.state.rental_rate_amendments).toHaveLength(0);
      expect(db.state.rentals[0].weekly_rate).toBe(350);
    }
  });
  test("not active, open amendment, unsigned agreement out, table missing", async () => {
    let r = await call(fakeDb(seed({ status: "closed" })), body());
    expect([r.status, r.body.error]).toEqual([409, expect.stringContaining("Only an active rental")]);
    const open = seed();
    (open.rental_rate_amendments as Row[]).push({ id: "am-1", rental_id: R, status: "pending_signature", agreement_id: "agr-x" });
    (open.agreements as Row[]).push({ id: "agr-x", application_id: A, status: "sent", voided_at: null, token_expires_at: "2026-12-01T00:00:00Z" });
    r = await call(fakeDb(open), body());
    expect([r.status, r.body.amendment_id]).toEqual([409, "am-1"]);
    const out = seed();
    (out.agreements as Row[]).push({ id: "agr-y", application_id: A, status: "viewed", voided_at: null });
    r = await call(fakeDb(out), body());
    expect([r.status, r.body.error]).toEqual([409, expect.stringContaining("unsigned agreement")]);
    r = await call(fakeDb(seed(), { missing: ["rental_rate_amendments"] }), body());
    expect(r.status).toBe(503);
    expect(r.issued).toHaveLength(0);
  });
  test("a voided open amendment no longer blocks; decrease needs no consent", async () => {
    const s = seed();
    (s.rental_rate_amendments as Row[]).push({ id: "am-1", rental_id: R, status: "pending_signature", agreement_id: "agr-x" });
    (s.agreements as Row[]).push({ id: "agr-x", application_id: A, status: "voided", voided_at: "2026-11-15T00:00:00Z" });
    const db = fakeDb(s);
    const r = await call(db, body({ new_weekly_rate: 325, renter_consent: undefined }));
    expect(r.status).toBe(201);
    expect(db.state.rental_rate_amendments.find((x) => x.id === "am-1")!.status).toBe("voided");
  });
  test("send failure keeps the record as send_failed; a retry with the same key reuses it", async () => {
    const db = fakeDb(seed());
    const fail = await call(db, body(), { fail: true });
    expect(fail.status).toBe(409);
    expect(fail.audits[0].action).toBe("rental.rate_amendment_send_failed");
    expect(db.state.rental_rate_amendments[0].status).toBe("send_failed");
    const retry = await call(db, body());
    expect(retry.status).toBe(201);
    expect(db.state.rental_rate_amendments).toHaveLength(1);
    expect(db.state.rental_rate_amendments[0]).toMatchObject({ status: "pending_signature", agreement_id: "agr-new" });
  });
  test("status action lists amendments; auth required", async () => {
    const db = fakeDb(seed());
    await call(db, body());
    const r = await call(db, { action: "status", rental_id: R });
    expect(r.status).toBe(200);
    expect(r.body.amendments).toHaveLength(1);
    const res = await m.handleFleetAmendAgreement(new Request("https://x/api/public/fleet/amend-agreement", { method: "POST", body: "{}" }), { admin: fakeDb(seed()), env: { FLEET_API_KEY: KEY } } as any);
    expect(res.status).toBe(401);
  });
});

describe("staff path", () => {
  const staff = (db: any, x: Partial<Parameters<typeof m.proposeRentalAmendment>[1]> = {}) => {
    const issued: any[] = [];
    return m.proposeRentalAmendment(db, {
      rentalId: R, newWeeklyRate: 1200, effectiveDate: "2026-11-20", reason: "Owner-approved premium rate.", consentRaw: { channel: "in_person", received_at: "2026-11-16T09:00:00-05:00", quote: "OK with 1200" },
      source: "staff", requestedBy: "owner@example.com (staff)", requestedByUser: "u1", outOfBoundsAck: false, idempotencyKey: null, ...x,
    }, {
      audit: async () => {}, now: NOW,
      gate: async () => "off", withinHours: () => false, handoff: async () => ({ id: "h", reason: "x" }),
      check: async (_a: any, _i: string, am: any) => ({ blockers: [], weeklyRate: am.weeklyRate, vehicleLabel: null }),
      issue: async (_a: any, id: string, o: any) => { issued.push(o); return { id: "agr-s", url: "u", delivery: { email: "sent", sms: "not_attempted", delivered: true } }; },
    } as any).then((r) => ({ ...r, issued }));
  };
  test("outside $200–$1,000 needs the acknowledgment; switch, hours and handoff do not apply to staff", async () => {
    const no = await staff(fakeDb(seed()));
    expect([no.status, no.body.reason]).toEqual([409, "out_of_bounds"]);
    const db = fakeDb(seed());
    const yes = await staff(db, { outOfBoundsAck: true });
    expect(yes.status).toBe(201);
    expect(db.state.rental_rate_amendments[0]).toMatchObject({ source: "staff", out_of_bounds_ack: true, requested_by_user: "u1" });
    expect(db.state.rental_rate_amendments[0].renter_consent).toMatchObject({ channel: "in_person", verified: false });
  });
});

describe("on signing", () => {
  const signedSeed = (eff: string, x: Row = {}) => {
    const s = seed(x);
    (s.agreements as Row[]).push({ id: "agr-new", application_id: A, status: "signed", signed_at: "2026-11-17T16:00:00Z", metadata: { amendment: { kind: "rate_change" } } });
    (s.rental_rate_amendments as Row[]).push({ id: "am-1", rental_id: R, application_id: A, status: "pending_signature", old_weekly_rate: 350, new_weekly_rate: 375, effective_date: eff, agreement_id: "agr-new", previous_agreement_id: "agr-old", stripe_update_required: false });
    return s;
  };
  test("future effective date: signed and scheduled, nothing applied yet; FLEET gets agreement_amendment_signed", async () => {
    const db = fakeDb(signedSeed("2026-11-20"));
    const sent: any[] = []; const audits: any[] = [];
    const is = await m.onAmendmentSigned(db, "agr-new", { now: new Date("2026-11-17T16:01:00Z"), audit: async (e) => { audits.push(e); }, notifyFleet: async (_a, p) => { sent.push(p); } });
    expect(is).toBe(true);
    expect(db.state.rental_rate_amendments[0]).toMatchObject({ status: "signed", apply_on: "2026-11-20" });
    expect(db.rpcCalls).toHaveLength(0);
    expect(sent[0]).toMatchObject({ event: "agreement_amendment_signed", rate_status: "scheduled", apply_on: "2026-11-20", previous_agreement_id: "agr-old" });
    expect(audits.map((a) => a.action)).toEqual(["rental.rate_amendment_signed"]);
    // The 5-minute sweep applies it on the day.
    db.rpcCalls.length = 0;
    const early = await m.applyDueRentalAmendments(db, { now: new Date("2026-11-19T15:00:00Z"), audit: async () => {} });
    expect(early.applied).toBe(0);
    const due = await m.applyDueRentalAmendments(db, { now: new Date("2026-11-20T15:00:00Z"), audit: async () => {} });
    expect(due.applied).toBe(1);
    expect(db.rpcCalls[0]).toEqual({ name: "apply_rental_rate_amendment", args: { _id: "am-1", _today: "2026-11-20" } });
  });
  test("signed after the effective date: starts with the next rent week, applied when due; Stripe subscription flagged, never called", async () => {
    const db = fakeDb(signedSeed("2026-11-16", { next_payment_due: "2026-11-20", stripe_subscription_id: "sub_123" }));
    const audits: any[] = [];
    await m.onAmendmentSigned(db, "agr-new", { now: new Date("2026-11-20T16:01:00Z"), audit: async (e) => { audits.push(e); }, notifyFleet: async () => {} });
    expect(db.state.rental_rate_amendments[0]).toMatchObject({ status: "signed", apply_on: "2026-11-20", stripe_update_required: true });
    expect(db.rpcCalls).toEqual([{ name: "apply_rental_rate_amendment", args: { _id: "am-1", _today: "2026-11-20" } }]);
    expect(audits.map((a) => a.action)).toEqual(["rental.rate_amendment_signed", "rental.rate_amendment_applied", "rental.rate_amendment_stripe_review"]);
  });
  test("a normal agreement is not an amendment", async () => {
    const db = fakeDb(seed());
    expect(await m.onAmendmentSigned(db, "agr-old", { notifyFleet: async () => {} })).toBe(false);
  });
});

describe("no Reservation Fee, no deposit, no re-billing on an amendment", () => {
  test("the Reservation Fee automation and the first-payment Stripe link skip an amended agreement", async () => {
    const fee = await import("@/lib/reservation-fee.server");
    const ip = await import("@/lib/initial-payment.server");
    const ag = { id: "agr-new", application_id: A, status: "signed", body: "Reservation Fee: $50.00", merge_data: { weekly_rate: "$375", deposit_amount: "$500", balance_due: "$425" }, metadata: { amendment: { kind: "rate_change" } }, vehicle_id: V, signed_at: "2026-11-17T16:00:00Z" };
    const db = fakeDb({ agreements: [ag], payments: [], applications: [] });
    const out = await fee.chargeReservationFeeAfterSigning(db, "agr-new", { settings: { enabled: true, amount: 50 } } as any);
    expect(out.status).toBe("no_fee_on_agreement");
    expect(db.state.payments).toHaveLength(0);
    expect(await ip.createInitialPaymentLink(db, "agr-new", null)).toBeNull();
    expect(db.state.payments).toHaveLength(0);
  });
  test("signing an amendment sends no fee or payment link (emails skip both)", () => {
    const src = readFileSync("src/lib/agreements.functions.ts", "utf8");
    const branch = src.slice(src.indexOf("if (amendment) {\n    const portal"), src.indexOf("return portal;"));
    expect(branch).not.toMatch(/chargeReservationFeeAfterSigning|createInitialPaymentLink|reservationFeePay|payment:/);
    expect(src).toContain("An updated agreement for an active rental cannot carry a Reservation Fee");
  });
  test("the notice says paid weeks are not billed again and there is no fee or new deposit", () => {
    const t = lib.amendmentNoticeText({ oldRate: 350, newRate: 375, effectiveDate: "2026-11-20", previousSignedAt: null });
    expect(t).toContain("including weeks already paid, stays at $350 and is not billed again");
    expect(t).toContain("no Reservation Fee and no new deposit");
    expect(lib.AMENDMENT_NO_FEE_LINE).toMatch(/Not applicable/);
    expect(lib.AMENDMENT_NO_DEPOSIT_LINE).toMatch(/^\$0 /);
  });
  test("the amendment path never writes payments", () => {
    const srv = readFileSync("src/lib/rental-amendment.server.ts", "utf8");
    expect(srv).not.toMatch(/from\("payments"\)/);
  });
});

describe("wiring", () => {
  test("route, catalog switch (Off by default), signing hooks, no Stripe calls", () => {
    expect(readFileSync("src/routes/api/public/fleet/amend-agreement.ts", "utf8")).toContain('createFileRoute("/api/public/fleet/amend-agreement")');
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain("/api/public/fleet/amend-agreement");
    const cat = readFileSync("src/lib/automation-catalog.ts", "utf8");
    expect(cat).toMatch(/key: "rental_agreement_amendments"[\s\S]{0,900}defaultOn: false/);
    const esign = readFileSync("src/lib/esign.server.ts", "utf8");
    expect(esign.indexOf("onAmendmentSigned")).toBeGreaterThan(0);
    expect(esign).toContain("if (!isAmendment) await notifyFleetAgreementSigned(admin, args.id);");
    expect(esign).toMatch(/const isAmendment = Boolean\(\(ag as any\)\?\.metadata\?\.amendment\);/);
    expect(esign.indexOf("await onAmendmentSigned(admin, args.id)")).toBeLessThan(esign.indexOf("maybeConfirmReservation"));
    const ag = readFileSync("src/lib/agreements.functions.ts", "utf8");
    const signed = ag.slice(ag.indexOf("async function sendSignedEmails"));
    expect(signed.indexOf("if (amendment)")).toBeLessThan(signed.indexOf("chargeReservationFeeAfterSigning"));
    const srv = readFileSync("src/lib/rental-amendment.server.ts", "utf8");
    expect(srv).not.toMatch(/stripe\.(subscriptions|customers|invoices)|createStripeClient/);
    expect(readFileSync("src/components/admin/BookingActions.tsx", "utf8")).toContain("Send Updated Agreement");
    expect(readFileSync("src/lib/fleet-agreement.server.ts", "utf8")).toContain("/api/public/fleet/amend-agreement");
  });
});

describe("proposed migration (PGlite)", () => {
  const SQL = readFileSync("proposed/rental-rate-amendments-v1.sql", "utf8");
  test("pending until signed, applies once on the day, conflict if the rental changed; consent required for increases; re-runnable", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA private;
      CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE public.applications (id uuid primary key default gen_random_uuid(), weekly_rent numeric);
      CREATE TABLE public.rentals (id uuid primary key default gen_random_uuid(), application_id uuid, status text, weekly_rate numeric, next_payment_due date, updated_at timestamptz);
      CREATE TABLE public.payments (id uuid primary key default gen_random_uuid(), rental_id uuid, due_date date, status text, type text, amount numeric);
      CREATE TABLE public.agreements (id uuid primary key default gen_random_uuid());
      CREATE TABLE public.fleet_webhook_deliveries (id uuid primary key default gen_random_uuid(), event_type text);`);
    await pg.exec(SQL);
    const app = (await pg.query<any>(`INSERT INTO applications (weekly_rent) VALUES (350) RETURNING id`)).rows[0].id;
    // Week 1 (due Nov 13) paid at $350; the next week is due Nov 13 until it is.
    const rental = (await pg.query<any>(`INSERT INTO rentals (application_id, status, weekly_rate, next_payment_due) VALUES ($1, 'active', 350, '2026-11-13') RETURNING id`, [app])).rows[0].id;
    const ins = (rate: number, consent: string | null, status = "pending_signature") => pg.query<any>(
      `INSERT INTO rental_rate_amendments (rental_id, application_id, old_weekly_rate, new_weekly_rate, effective_date, reason, renter_consent, status, source, requested_by)
       VALUES ($1, $2, 350, $3, '2026-11-20', 'Rate review', $4::jsonb, $5, 'fleet', 'FLEET (automated)') RETURNING id`, [rental, app, rate, consent, status]);
    await expect(ins(375, null)).rejects.toThrow();
    await expect(ins(350, '{"channel":"sms"}')).rejects.toThrow();
    const id = (await ins(375, '{"channel":"sms"}')).rows[0].id;
    await expect(ins(380, '{"channel":"sms"}')).rejects.toThrow(); // one open per rental
    const apply = async (day: string) => (await pg.query<any>(`SELECT public.apply_rental_rate_amendment($1, $2::date) AS r`, [id, day])).rows[0].r;
    expect(await apply("2026-11-20")).toBe("not_signed");
    await pg.query(`UPDATE rental_rate_amendments SET status = 'signed', signed_at = now(), apply_on = '2026-11-20' WHERE id = $1`, [id]);
    expect(await apply("2026-11-19")).toBe("not_due");
    expect((await pg.query<any>(`SELECT weekly_rate FROM rentals`)).rows[0].weekly_rate).toBe("350");
    // Renter behind: the week due Nov 13 (before the change) is still open, so it stays $350.
    expect(await apply("2026-11-20")).toBe("waiting_prior_weeks");
    // They pay it; next due moves to Nov 20. A part-payment toward Nov 20 also holds the change.
    await pg.query(`INSERT INTO payments (rental_id, due_date, status, type, amount) VALUES ($1, '2026-11-13', 'paid', 'rent', 350), ($1, '2026-11-20', 'paid', 'rent', 100)`, [rental]);
    await pg.query(`UPDATE rentals SET next_payment_due = '2026-11-20'`);
    expect(await apply("2026-11-20")).toBe("week_in_progress");
    expect((await pg.query<any>(`SELECT weekly_rate FROM rentals`)).rows[0].weekly_rate).toBe("350");
    await pg.query(`DELETE FROM payments WHERE due_date = '2026-11-20'`);
    expect(await apply("2026-11-20")).toBe("applied");
    // Paid weeks are never touched.
    expect((await pg.query<any>(`SELECT count(*)::int AS n, sum(amount)::text AS s FROM payments`)).rows[0]).toEqual({ n: 1, s: "350" });
    expect((await pg.query<any>(`SELECT weekly_rate FROM rentals`)).rows[0].weekly_rate).toBe("375.00");
    expect((await pg.query<any>(`SELECT weekly_rent FROM applications`)).rows[0].weekly_rent).toBe("375.00");
    expect(await apply("2026-11-21")).toBe("already_applied");
    // A second signed change whose old rate no longer matches is a conflict.
    const id2 = (await ins(400, '{"channel":"sms"}', "signed")).rows[0].id;
    await pg.query(`UPDATE rental_rate_amendments SET signed_at = now(), apply_on = '2026-11-20' WHERE id = $1`, [id2]);
    expect((await pg.query<any>(`SELECT public.apply_rental_rate_amendment($1, '2026-11-20') AS r`, [id2])).rows[0].r).toBe("conflict");
    expect((await pg.query<any>(`SELECT weekly_rate FROM rentals`)).rows[0].weekly_rate).toBe("375.00");
    await pg.query(`INSERT INTO fleet_webhook_deliveries (event_type) VALUES ('agreement_amendment_signed')`);
    await expect(pg.query(`INSERT INTO fleet_webhook_deliveries (event_type) VALUES ('nope')`)).rejects.toThrow();
    await pg.exec(SQL);
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
  });
});
