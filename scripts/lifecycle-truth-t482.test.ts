import { describe, expect, it } from "bun:test";
import { driverLifecycle, reservationStageDone } from "../src/lib/driver-lifecycle";
import { missingRequiredCategories } from "../src/lib/activation-readiness";
import { reservationFeeStatusForApplication } from "../src/lib/reservation-fee-refund.server";

const doc = (category: string, extra: object = {}) => ({ id: category, category, is_current: true, review_status: "verified", ...extra }) as any;

describe("Reserved step counts an applied Reservation Fee", () => {
  it("applied (credited to week 1) is as paid as paid", () => {
    expect(reservationStageDone({ feeStatus: "applied", hasReservation: true, feeRequired: true })).toBe(true);
    expect(reservationStageDone({ feeStatus: "applied", hasReservation: false })).toBe(true);
  });
  it("pending, refunded and unknown statuses stay not reserved", () => {
    for (const s of ["pending", "unpaid", "refunded", "refunded:no_vehicle", "failed"]) expect(reservationStageDone({ feeStatus: s, hasReservation: true, feeRequired: true })).toBe(false);
  });
});

describe("Documents step uses the Documents card definition", () => {
  it("license front + gig profile + trip history (income) is complete", () => {
    expect(missingRequiredCategories([doc("license_front"), doc("gig_profile"), doc("trip_history"), doc("agreement")])).toEqual([]);
  });
  it("rejected or non-current files do not count", () => {
    expect(missingRequiredCategories([doc("license_front"), doc("gig_profile"), doc("income", { review_status: "rejected" })])).toEqual(["income"]);
    expect(missingRequiredCategories([doc("license_front"), doc("gig_profile"), doc("income", { is_current: false })])).toEqual(["income"]);
  });
});

describe("Jonathon's record", () => {
  it("approved + agreement + applied fee: Documents, Screening, Reserved done; Insurance current", () => {
    const l = driverLifecycle({ contacted: true, screening: false, approved: true, inspection: false, agreement: true, rentalActive: false, documentsReceived: true, reserved: reservationStageDone({ feeStatus: "applied", hasReservation: true, feeRequired: true }) });
    const st = (k: string) => l.stages.find((s) => s.key === k)?.state;
    expect(["documents", "screening", "approved", "agreement", "reserved"].map(st)).toEqual(["done", "done", "done", "done", "done"]);
    expect(l.current.key).toBe("insurance");
    expect(l.open).toHaveLength(0);
  });
});

describe("Fee lookup", () => {
  const fake = (tables: Record<string, any[]>) => ({
    from: (t: string) => {
      const q: any = { data: tables[t] ?? [] };
      for (const m of ["select", "eq", "or", "limit"]) q[m] = () => q;
      q.then = (res: any) => res({ data: q.data });
      return q;
    },
  }) as any;
  it("no fee and no rental means no status", async () => {
    expect((await reservationFeeStatusForApplication(fake({ payments: [], rentals: [] }), "a1")).status).toBeNull();
  });
  it("returns paid when the direct lookup has a paid fee", async () => {
    const r = await reservationFeeStatusForApplication(fake({ payments: [{ id: "p1", status: "paid", notes: "reservation_fee:r1" }] }), "a1");
    expect(r).toEqual({ status: "paid", reason: null, paymentId: "p1" });
  });
});
