// Staff-offered Reservation Fee credit. Fake data only. No Stripe, no email, no database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { creditExpiresAt, creditStillOpen, reservationFeeCreditDays, DEFAULT_RESERVATION_FEE_CREDIT_DAYS } from "../src/lib/rental-hold";
import { coverReservationFeeWithCredit, expireDueReservationFeeCredits, offerReservationFeeCredit } from "../src/lib/rental-hold.server";
import { reservationFeeEmailLine, reservationFeeSigningStep } from "../src/lib/reservation-fee";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

type Row = Record<string, any>;
function fakeAdmin(seed: Record<string, Row[]>) {
  const db: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 0;
  const from = (table: string) => {
    db[table] ??= [];
    const f: Array<(r: Row) => boolean> = [];
    let mode: "select" | "update" | "insert" = "select";
    let patch: Row | null = null;
    let ins: Row | null = null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (f.push((r) => r[c] === v), q),
      neq: (c: string, v: any) => (f.push((r) => r[c] !== v), q),
      in: (c: string, v: any[]) => (f.push((r) => v.includes(r[c])), q),
      is: (c: string, v: any) => (f.push((r) => (r[c] ?? null) === v), q),
      limit: () => q,
      order: () => q,
      update: (p: Row) => ((mode = "update"), (patch = p), q),
      insert: (r: Row) => ((mode = "insert"), (ins = r), q),
      single: () => run(true),
      maybeSingle: () => run(true),
      then: (res: any, rej: any) => run(false).then(res, rej),
    };
    const run = async (one: boolean) => {
      if (mode === "insert") {
        const row = { id: `new-${++n}`, ...ins };
        db[table].push(row);
        return { data: one ? row : [row], error: null };
      }
      const hit = db[table].filter((r) => f.every((x) => x(r)));
      if (mode === "update") hit.forEach((r) => Object.assign(r, patch));
      return { data: one ? hit[0] ?? null : hit, error: null };
    };
    return q;
  };
  return { admin: { from }, db };
}

const APP = "802fb55c-d7e8-45ae-9b40-dc5efa74753f";
const PAY = "03733dbe-a9c1-4eaf-9f42-2c04e386945a";
const seed = () => ({
  rentals: [] as Row[],
  payments: [{ id: PAY, driver_id: APP, status: "paid", reason: "reservation_fee", amount: "50.00", refunded_amount: "0", notes: "reservation_fee:ag-old", rental_id: null, paid_date: "2026-08-01", created_at: "2026-08-01T15:00:00.000Z", net_collected: 50 }],
  renter_credits: [] as Row[],
  app_settings: [] as Row[],
  applications: [{ id: APP, full_name: "Jordan Hale" }],
  vehicles: [] as Row[],
});

describe("credit rules", () => {
  test("90 days unless a settings value says otherwise", () => {
    expect(DEFAULT_RESERVATION_FEE_CREDIT_DAYS).toBe(90);
    expect(reservationFeeCreditDays(null)).toBe(90);
    expect(reservationFeeCreditDays({ days: 60 })).toBe(60);
    expect(reservationFeeCreditDays({ days: 0 })).toBe(90);
  });
  test("expiry is the payment date plus 90 days", () => {
    const at = creditExpiresAt("2026-08-01", 90);
    expect(Date.parse(at) - Date.parse("2026-08-01T12:00:00.000Z")).toBe(90 * 86_400_000);
  });
  test("a null expiry stays open; a past expiry does not", () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    expect(creditStillOpen({ status: "available", expires_at: null }, now)).toBe(true);
    expect(creditStillOpen({ status: "available", expires_at: "2026-11-01T00:00:00.000Z" }, now)).toBe(false);
    expect(creditStillOpen({ status: "expired", expires_at: "2026-12-01T00:00:00.000Z" }, now)).toBe(false);
  });
});

describe("offer", () => {
  test("a note is required, the fee stays paid, and no settings row is inserted", async () => {
    const { admin, db } = fakeAdmin(seed());
    expect((await offerReservationFeeCredit(admin, { paymentId: PAY, note: "no" })).ok).toBe(false);
    const r = await offerReservationFeeCredit(admin, { paymentId: PAY, note: "Released after the renter could not start" }, { actorId: "staff-1", now: () => new Date("2026-11-25T12:00:00.000Z") });
    expect(r).toMatchObject({ ok: true, amount: 50, days: 90 });
    if (!r.ok) return;
    expect(Date.parse(r.expiresAt) - Date.parse("2026-08-01T12:00:00.000Z")).toBe(90 * 86_400_000);
    expect(db.renter_credits[0]).toMatchObject({ application_id: APP, source_payment_id: PAY, amount: 50, status: "available", expires_at: r.expiresAt, reason: "Released after the renter could not start", created_by: "staff-1" });
    expect(db.payments[0]).toMatchObject({ status: "paid", refunded_amount: "0", net_collected: 50 });
    expect(db.payments[0].notes).toContain("offered_credit");
    expect(db.payments[0].notes).not.toContain("credited_week1");
    expect(db.app_settings).toEqual([]);
    expect((await offerReservationFeeCredit(admin, { paymentId: PAY, note: "Second offer is refused" })).ok).toBe(false);
  });
  test("an open rental keeps the fee with that rental", async () => {
    const s = seed();
    s.rentals.push({ id: "r1", application_id: APP, status: "active" });
    const { admin, db } = fakeAdmin(s);
    const r = await offerReservationFeeCredit(admin, { applicationId: APP, note: "They already have the car" });
    expect(r.ok).toBe(false);
    expect(db.renter_credits).toEqual([]);
    expect(db.payments[0].notes).toBe("reservation_fee:ag-old");
  });
  test("a canceled rental can be offered", async () => {
    const s = seed();
    s.rentals.push({ id: "r1", application_id: APP, status: "cancelled" });
    const { admin } = fakeAdmin(s);
    expect((await offerReservationFeeCredit(admin, { applicationId: APP, note: "Canceled after paying" })).ok).toBe(true);
  });
});

describe("apply and expiry", () => {
  test("a credit covers the next reservation fee once, with no second collection and no Stripe", async () => {
    const { chargeReservationFeeAfterSigning } = await import("../src/lib/reservation-fee.server");
    const { admin, db } = fakeAdmin(seed());
    const offered = await offerReservationFeeCredit(admin, { paymentId: PAY, note: "Released after the renter could not start" });
    if (!offered.ok) throw new Error("setup");
    const sessions: any[] = [];
    const credits: any[] = [];
    const stripe = {
      checkout: { sessions: { create: async (a: any) => { sessions.push(a); return { id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }; } } },
      customers: { createBalanceTransaction: async (c: string, a: any) => { credits.push({ c, a }); return { id: "cbtxn_1" }; } },
    };
    db.agreements = [{ id: "ag-new", application_id: APP, status: "signed", body: "Reservation Fee: $50, applied to your first payment", merge_data: { _prep: JSON.stringify({ reservation: { mode: "required", amount: 50 } }) }, vehicle_id: null, metadata: {} }];
    const outcome = await chargeReservationFeeAfterSigning(admin, "ag-new", { settings: { enabled: true, amount: 50 }, stripe, audit: async () => {}, now: () => Date.parse("2026-08-15T00:00:00.000Z") });
    expect(outcome.status).toBe("covered");
    expect(sessions).toEqual([]);
    expect(credits).toEqual([]);
    expect(reservationFeeEmailLine(outcome)).toBeNull();
    expect(reservationFeeSigningStep(outcome)).toEqual({ state: "paid", amount: 50 });
    const fresh = db.payments.find((p) => String(p.notes ?? "").includes("reservation_fee:ag-new"));
    expect(fresh).toMatchObject({ status: "paid", balance_due: 0, net_collected: 0, payment_method: "credit" });
    expect(db.payments.find((p) => p.id === PAY)?.notes).toContain("credited_week1");
    expect(db.renter_credits[0]).toMatchObject({ status: "applied", applied_to_payment_id: fresh?.id });
    const again = await coverReservationFeeWithCredit(admin, { applicationId: APP, paymentId: "other", amount: 50 });
    expect(again.ok).toBe(false);
  });
  test("the automations job marks a past credit expired and leaves the row", async () => {
    const { admin, db } = fakeAdmin(seed());
    db.renter_credits.push({ id: "c1", application_id: APP, source_payment_id: PAY, amount: 50, status: "available", expires_at: "2026-11-01T00:00:00.000Z" });
    db.renter_credits.push({ id: "c2", application_id: APP, source_payment_id: "other", amount: 50, status: "available", expires_at: null });
    const r = await expireDueReservationFeeCredits(admin, new Date("2026-11-25T12:00:00.000Z"));
    expect(r).toEqual({ expired: 1 });
    expect(db.renter_credits.find((c) => c.id === "c1")?.status).toBe("expired");
    expect(db.renter_credits.find((c) => c.id === "c2")?.status).toBe("available");
    expect(db.renter_credits).toHaveLength(2);
    expect((await coverReservationFeeWithCredit(admin, { applicationId: APP, paymentId: "new-fee", amount: 50 }, { now: () => new Date("2026-11-25T12:00:00.000Z") })).ok).toBe(false);
  });
});

describe("nothing renter-facing was added", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  test("no agreement, signed email, or cancel path offers the credit", () => {
    expect(read("src/lib/agreements.functions.ts")).toContain('fee.status === "covered"');
    expect(read("src/lib/email.server.ts")).not.toContain("offered_credit");
    expect(read("src/lib/agreement-v116.ts")).not.toContain("offered_credit");
    expect(read("src/lib/reservations.functions.ts")).not.toContain("offerReservationFeeCredit");
    expect(read("src/routes/api/public/cron/automations.ts")).toContain("expireDueReservationFeeCredits");
    const sql = read("supabase/migrations/20261125200000_renter_credit_expiry.sql");
    expect(sql).toContain("expires_at");
    expect(sql).toContain("'expired'");
    expect(sql).toContain("applied_to_payment_id");
    expect(sql).toContain("Not applied");
  });
});
