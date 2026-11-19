import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { applyCreditToRental, convertFeeToCredit, putRentalOnHold, resumeRentalFromHold, voidCredit } from "../src/lib/rental-hold.server";
import { appliedNoteFor, canApplyCreditTo, checkHoldReason, creditableAmount, creditNoteFor } from "../src/lib/rental-hold";

/** Minimal in-memory Supabase-style fake: select/update/insert with eq, neq, is, in filters. */
function fakeAdmin(seed: Record<string, any[]>) {
  const db: Record<string, any[]> = JSON.parse(JSON.stringify(seed));
  let n = 0;
  const from = (table: string) => {
    db[table] ??= [];
    const f: Array<(r: any) => boolean> = [];
    let mode: "select" | "update" | "insert" = "select";
    let patch: any = null;
    let ins: any = null;
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (f.push((r) => r[c] === v), q),
      neq: (c: string, v: any) => (f.push((r) => r[c] !== v), q),
      is: (c: string, v: any) => (f.push((r) => (r[c] ?? null) === v), q),
      in: (c: string, v: any[]) => (f.push((r) => v.includes(r[c])), q),
      limit: () => q,
      update: (p: any) => ((mode = "update"), (patch = p), q),
      insert: (r: any) => ((mode = "insert"), (ins = r), q),
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

const RENTAL = "303a7ae5-fc01-47b8-911b-8c0eb8ead209";
const APP = "802fb55c-d7e8-45ae-9b40-dc5efa74753f";
const PAY = "03733dbe-a9c1-4eaf-9f42-2c04e386945a";
const note = `reservation_fee:d1266373 kept:late_pickup:${RENTAL}`;
const seed = () => ({
  rentals: [
    { id: RENTAL, status: "reserved", vehicle_id: "veh1", application_id: APP, reservation_note: JSON.stringify({ reservation_details: 1, pickup_time: "12:00", pickup_location: "3500 E Hillsborough Ave, Tampa, FL 33610", note: null }) },
    { id: "r2", status: "reserved", vehicle_id: "veh2", application_id: APP, reservation_note: null },
  ],
  payments: [{ id: PAY, driver_id: APP, status: "paid", reason: "reservation_fee", amount: "50.00", refunded_amount: "0", notes: note, rental_id: null }],
  vehicles: [{ id: "veh1", status: "reserved" }],
  renter_credits: [],
});

describe("pure rules", () => {
  test("hold reason needs 5+ characters", () => {
    expect(checkHoldReason("no").ok).toBe(false);
    expect(checkHoldReason("  Waiting on proof of payment ")).toEqual({ ok: true, reason: "Waiting on proof of payment" });
  });
  test("credit note keeps the rest of the note", () => {
    expect(creditNoteFor(note, RENTAL)).toBe(`reservation_fee:d1266373 credit:next_rental:${RENTAL}`);
    expect(creditNoteFor("reservation_fee:x", RENTAL)).toBe(`reservation_fee:x credit:next_rental:${RENTAL}`);
    expect(appliedNoteFor(creditNoteFor(note, RENTAL), "r2")).toBe("reservation_fee:d1266373 credit_applied:r2");
  });
  test("only a paid, un-refunded Reservation Fee is creditable", () => {
    expect(creditableAmount({ id: "p", status: "paid", reason: "reservation_fee", amount: 50, refunded_amount: 0 })).toEqual({ ok: true, amount: 50 });
    expect(creditableAmount({ id: "p", status: "paid", reason: "reservation_fee", amount: 50, refunded_amount: 50 }).ok).toBe(false);
    expect(creditableAmount({ id: "p", status: "pending", reason: "reservation_fee", amount: 50 }).ok).toBe(false);
    expect(creditableAmount({ id: "p", status: "paid", reason: "rent", amount: 50 }).ok).toBe(false);
    expect(creditableAmount({ id: "p", status: "paid", reason: "reservation_fee", amount: 50, notes: "credited_week1:x" }).ok).toBe(false);
  });
  test("a credit applies only to the same renter's Reserved or On Hold rental", () => {
    const c = { application_id: APP, status: "available" };
    expect(canApplyCreditTo({ status: "reserved", application_id: APP }, c).ok).toBe(true);
    expect(canApplyCreditTo({ status: "on_hold", application_id: APP }, c).ok).toBe(true);
    expect(canApplyCreditTo({ status: "cancelled", application_id: APP }, c).ok).toBe(false);
    expect(canApplyCreditTo({ status: "reserved", application_id: "other" }, c).ok).toBe(false);
    expect(canApplyCreditTo({ status: "reserved", application_id: APP }, { ...c, status: "applied" }).ok).toBe(false);
  });
});

describe("hold and resume", () => {
  test("hold keeps the vehicle held and records the reason", async () => {
    const { admin, db } = fakeAdmin(seed());
    expect(await putRentalOnHold(admin, { rentalId: RENTAL, reason: "Waiting on proof of payment" }, { actorId: "u1" })).toEqual({ ok: true });
    const r = db.rentals[0];
    expect(r.status).toBe("on_hold");
    expect(r.hold_reason).toBe("Waiting on proof of payment");
    expect(db.vehicles[0].status).toBe("reserved");
  });
  test("hold needs a reason and a Reserved rental", async () => {
    const { admin } = fakeAdmin(seed());
    expect((await putRentalOnHold(admin, { rentalId: RENTAL, reason: "" })).ok).toBe(false);
    await putRentalOnHold(admin, { rentalId: RENTAL, reason: "Waiting on proof" });
    expect((await putRentalOnHold(admin, { rentalId: RENTAL, reason: "Waiting again" })).ok).toBe(false);
  });
  test("resume sets Reserved with the new pickup date and keeps the time", async () => {
    const { admin, db } = fakeAdmin(seed());
    await putRentalOnHold(admin, { rentalId: RENTAL, reason: "Waiting on proof" });
    const r = await resumeRentalFromHold(admin, { rentalId: RENTAL, pickupDate: "2026-11-21" }, { today: () => "2026-11-19" });
    expect(r).toEqual({ ok: true, pickupDate: "2026-11-21" });
    expect(db.rentals[0]).toMatchObject({ status: "reserved", start_date: "2026-11-21", hold_reason: null });
    expect(JSON.parse(db.rentals[0].reservation_note).pickup_time).toBe("12:00");
  });
  test("resume refuses a past date, a bad date, or a rental not On Hold", async () => {
    const { admin } = fakeAdmin(seed());
    expect((await resumeRentalFromHold(admin, { rentalId: RENTAL, pickupDate: "2026-11-21" }, { today: () => "2026-11-19" })).ok).toBe(false);
    await putRentalOnHold(admin, { rentalId: RENTAL, reason: "Waiting on proof" });
    expect((await resumeRentalFromHold(admin, { rentalId: RENTAL, pickupDate: "2026-11-01" }, { today: () => "2026-11-19" })).ok).toBe(false);
    expect((await resumeRentalFromHold(admin, { rentalId: RENTAL, pickupDate: "nope" })).ok).toBe(false);
  });
});

describe("credits", () => {
  test("convert makes an available credit, changes only the note, and never refunds", async () => {
    const { admin, db } = fakeAdmin(seed());
    const r = await convertFeeToCredit(admin, { paymentId: PAY }, { actorId: "u1" });
    expect(r).toMatchObject({ ok: true, amount: 50 });
    expect(db.renter_credits[0]).toMatchObject({ application_id: APP, source_payment_id: PAY, amount: 50, status: "available", created_by: "u1" });
    expect(db.payments[0].notes).toBe(`reservation_fee:d1266373 credit:next_rental:${RENTAL}`);
    expect(db.payments[0].status).toBe("paid");
    expect(db.payments[0].refunded_amount).toBe("0");
    expect((await convertFeeToCredit(admin, { paymentId: PAY })).ok).toBe(false); // no second credit
  });
  test("apply attaches the fee to the new rental, counts toward week 1, and uses the credit once", async () => {
    const { admin, db } = fakeAdmin(seed());
    const c = await convertFeeToCredit(admin, { paymentId: PAY });
    if (!c.ok) throw new Error("setup");
    const a = await applyCreditToRental(admin, { creditId: c.creditId, rentalId: "r2" });
    expect(a).toEqual({ ok: true, amount: 50 });
    expect(db.renter_credits[0]).toMatchObject({ status: "applied", applied_to_rental_id: "r2" });
    expect(db.rentals[1]).toMatchObject({ reservation_deposit_status: "applied", reservation_deposit_payment_id: PAY, reservation_deposit_amount: 50, reservation_deposit_required: true });
    expect(db.payments[0].notes).toContain("credit_applied:r2");
    expect(db.payments[0].notes).not.toMatch(/kept:|credited_week1/); // so paidReservationFee finds it at activation
    expect((await applyCreditToRental(admin, { creditId: c.creditId, rentalId: "r2" })).ok).toBe(false);
  });
  test("apply refuses another renter's rental", async () => {
    const s = seed();
    s.rentals[1].application_id = "someone-else";
    const { admin } = fakeAdmin(s);
    const c = await convertFeeToCredit(admin, { paymentId: PAY });
    if (!c.ok) throw new Error("setup");
    expect((await applyCreditToRental(admin, { creditId: c.creditId, rentalId: "r2" })).ok).toBe(false);
  });
  test("void works only on an available credit", async () => {
    const { admin, db } = fakeAdmin(seed());
    const c = await convertFeeToCredit(admin, { paymentId: PAY });
    if (!c.ok) throw new Error("setup");
    expect((await voidCredit(admin, { creditId: c.creditId, reason: "Entered in error" })).ok).toBe(true);
    expect(db.renter_credits[0].status).toBe("void");
    expect((await voidCredit(admin, { creditId: c.creditId, reason: "Entered in error" })).ok).toBe(false);
  });
});

describe("crons skip On Hold and the vehicle stays held", () => {
  const src = (p: string) => readFileSync(new URL(`../src/lib/${p}`, import.meta.url), "utf8");
  test("late-pickup release, reminders and fleet pickup work only on status = reserved", () => {
    expect(src("late-pickup.server.ts")).toMatch(/\.eq\("status", "reserved"\)\s*\n?\s*\.eq\("start_date", today\)/);
    expect(src("renter-reminders.server.ts")).toMatch(/\.eq\("status", "reserved"\)/);
    expect(src("late-pickup.server.ts")).not.toMatch(/on_hold"\)\s*\.eq\("start_date"/);
  });
  test("every vehicle-busy check counts on_hold", () => {
    for (const f of ["fleet-assign.server.ts", "payment-received.server.ts", "late-pickup.server.ts", "booking-links.server.ts", "reservations.functions.ts", "reservation-switch.server.ts"]) {
      expect(src(f)).toContain("on_hold");
    }
  });
  test("the migration adds the status columns, the credit ledger and staff-only RLS", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261119190000_on_hold_and_renter_credits.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/renter_credits/);
    expect(sql).toMatch(/'available','applied','void'/);
    expect(sql).toMatch(/private\.is_staff\(\)/);
    expect(sql).toMatch(/rentals_one_on_hold_per_vehicle_idx/);
    expect(sql.toLowerCase()).not.toContain("deposit_status");
  });
});
