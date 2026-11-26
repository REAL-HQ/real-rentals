/**
 * Forfeited Reservation Fee credit policy.
 * Run: bun test scripts/forfeited-fee-credit.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  creditExpired,
  creditExpiresAt,
  keptFeeOffers,
  keptFeeRentalId,
  readForfeitedFeeCreditSettings,
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

  test("the migration file adds expiry and the default policy and is not applied from here", () => {
    const sql = readFileSync(new URL("../supabase/migrations/20261126133000_forfeited_fee_credit.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/expires_at timestamptz/);
    expect(sql).toMatch(/'case_by_case'/);
    expect(sql).toMatch(/'days', 90/);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
  });
});
