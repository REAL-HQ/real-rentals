/**
 * Forfeited Reservation Fee credit policy.
 * Run: bun test scripts/forfeited-fee-credit.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  creditCountdownLabel,
  creditDaysLeft,
  creditExpired,
  creditExpiresAt,
  creditForCancelledRental,
  keptFeeOffers,
  keptFeeRentalId,
  readForfeitedFeeCreditSettings,
  type CancelledRentalCredit,
} from "../src/lib/forfeited-fee-credit";

const RENTAL = "11111111-0000-4000-8000-0000000000aa";
const OTHER = "22222222-0000-4000-8000-0000000000bb";

describe("forfeited fee credit policy", () => {
  test("a missing or broken setting is case by case for 90 days", () => {
    expect(readForfeitedFeeCreditSettings(undefined)).toEqual({ mode: "case_by_case", days: 90 });
    expect(readForfeitedFeeCreditSettings({ mode: "nope", days: 0 })).toEqual({ mode: "case_by_case", days: 90 });
    expect(readForfeitedFeeCreditSettings({ mode: "off", days: 30 })).toEqual({ mode: "off", days: 30 });
    expect(readForfeitedFeeCreditSettings({ mode: "auto", days: 90.4 })).toEqual({ mode: "auto", days: 90 });
  });

  test("expiry is created_at plus the configured days", () => {
    const created = new Date("2026-11-26T15:00:00Z");
    expect(creditExpiresAt(created, 90)).toBe(new Date("2027-02-24T15:00:00Z").toISOString());
    expect(creditExpired("2026-02-01T00:00:00Z", new Date("2026-06-01T00:00:00Z"))).toBe(true);
    expect(creditExpired("2027-02-24T15:00:00Z", new Date("2026-11-26T15:00:00Z"))).toBe(false);
    expect(creditExpired(null, new Date("2026-11-26T15:00:00Z"))).toBe(false);
  });

  test("days left are America/New_York calendar days", () => {
    const now = new Date("2026-11-26T16:00:00Z");
    expect(creditDaysLeft(null, now)).toBeNull();
    expect(creditDaysLeft("", now)).toBeNull();
    expect(creditDaysLeft("not-a-date", now)).toBeNull();
    expect(creditDaysLeft("2027-02-21T16:00:00Z", now)).toBe(87);
    expect(creditDaysLeft("2026-12-03T16:00:00Z", now)).toBe(7);
    expect(creditDaysLeft("2026-11-27T16:00:00Z", now)).toBe(1);
    expect(creditDaysLeft("2026-11-26T22:00:00Z", now)).toBe(0);
    expect(creditDaysLeft("2026-01-01T15:00:00Z", now)).toBeLessThan(0);
    // 11:30 PM ET is still the previous calendar day.
    expect(creditDaysLeft("2026-11-26T16:00:00Z", new Date("2026-11-26T04:30:00Z"))).toBe(1);
    // Spring-forward Sunday still counts as one calendar day.
    expect(creditDaysLeft("2026-03-09T04:00:00Z", new Date("2026-03-08T06:30:00Z"))).toBe(1);
    expect(creditCountdownLabel(null, now)).toBe("No expiry");
    expect(creditCountdownLabel("2027-02-21T16:00:00Z", now)).toBe("87 days left");
    expect(creditCountdownLabel("2026-12-03T16:00:00Z", now)).toBe("7 days left");
    expect(creditCountdownLabel("2026-11-27T16:00:00Z", now)).toBe("1 day left");
    expect(creditCountdownLabel("2026-11-26T22:00:00Z", now)).toBe("Expires today");
  });

  test("a kept fee with no live credit is an offer, including when the policy is off", () => {
    const payments = [
      { id: "pay-1", reason: "reservation_fee", status: "paid", notes: `reservation_fee:ag1 kept:late_pickup:${RENTAL}`, rentalId: null },
      { id: "pay-2", reason: "reservation_fee", status: "paid", notes: "reservation_fee:ag2", rentalId: OTHER },
      { id: "pay-3", reason: "reservation_fee", status: "paid", notes: `kept:late_pickup:${OTHER}`, rentalId: null },
    ];
    expect(keptFeeRentalId(payments[0].notes, null)).toBe(RENTAL);
    expect(keptFeeOffers([RENTAL, OTHER], payments, new Set())).toEqual([
      { rentalId: RENTAL, paymentId: "pay-1" },
      { rentalId: OTHER, paymentId: "pay-3" },
    ]);
    expect(keptFeeOffers([RENTAL], payments, new Set(["pay-1"]))).toEqual([]);
  });

  test("a cancelled row matches its source rental, then a credit with no source rental", () => {
    const now = new Date("2026-11-26T16:00:00Z");
    const fabio = "057edf3f-1111-4000-8000-000000000001";
    const jonathon = "303a7ae5-2222-4000-8000-000000000002";
    const appFabio = "aaaaaaaa-0000-4000-8000-0000000000aa";
    const appJon = "bbbbbbbb-0000-4000-8000-0000000000bb";
    const credit = (over: Partial<CancelledRentalCredit> & Pick<CancelledRentalCredit, "id" | "applicationId" | "status">): CancelledRentalCredit => ({
      sourceRentalId: null,
      amount: 50,
      expiresAt: "2027-02-23T15:00:00Z",
      createdAt: "2026-11-01T15:00:00Z",
      ...over,
    });
    const credits = [
      credit({ id: "fabio", applicationId: appFabio, sourceRentalId: fabio, status: "available", expiresAt: "2027-02-23T15:00:00Z" }),
      credit({ id: "jon", applicationId: appJon, sourceRentalId: jonathon, status: "available", expiresAt: "2027-02-17T15:00:00Z" }),
      credit({ id: "voided", applicationId: appFabio, sourceRentalId: fabio, status: "void", createdAt: "2026-11-20T15:00:00Z" }),
      credit({ id: "loose", applicationId: appFabio, sourceRentalId: null, status: "available", createdAt: "2026-11-02T15:00:00Z" }),
      credit({ id: "applied", applicationId: appJon, sourceRentalId: "cccccccc-0000-4000-8000-0000000000cc", status: "applied" }),
      credit({ id: "other-rental", applicationId: appJon, sourceRentalId: "dddddddd-0000-4000-8000-0000000000dd", status: "available" }),
    ];
    expect(creditForCancelledRental({ id: fabio, applicationId: appFabio }, credits, now)?.id).toBe("fabio");
    expect(creditForCancelledRental({ id: jonathon, applicationId: appJon }, credits, now)?.id).toBe("jon");
    expect(creditForCancelledRental({ id: "eeeeeeee-0000-4000-8000-0000000000ee", applicationId: appFabio }, credits, now)?.id).toBe("loose");
    expect(creditForCancelledRental({ id: "cccccccc-0000-4000-8000-0000000000cc", applicationId: appJon }, credits, now)?.id).toBe("applied");
    expect(creditForCancelledRental({ id: "ffffffff-0000-4000-8000-0000000000ff", applicationId: "99999999-0000-4000-8000-000000000099" }, credits, now)).toBeNull();
    const both = [
      credit({ id: "old-applied", applicationId: appFabio, sourceRentalId: fabio, status: "applied", createdAt: "2026-11-20T15:00:00Z" }),
      credit({ id: "still-open", applicationId: appFabio, sourceRentalId: fabio, status: "available", createdAt: "2026-11-01T15:00:00Z" }),
    ];
    expect(creditForCancelledRental({ id: fabio, applicationId: appFabio }, both, now)?.id).toBe("still-open");
  });

  test("the migration file adds expiry and the default policy and is not applied from here", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261126133000_forfeited_fee_credit.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/expires_at timestamptz/);
    expect(sql).toMatch(/'case_by_case'/);
    expect(sql).toMatch(/'days', 90/);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
  });
});
