/**
 * Additional Driver fees in Amount Due Each Payment and Balance Due At Pickup.
 * Run: bun test scripts/agreement-driver-fees.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BILLING_MERGE_KEY,
  EMPTY_PREP,
  PrepSchema,
  includedDriverCount,
  paymentRows,
  prepareBaseRent,
  storedWeeklyAmount,
  weeklyFeeOnAgreement,
  weeklyRateFromAgreementOrVehicle,
  type AgreementPrep,
} from "../src/lib/agreement-prep";

const FEE = 100;
const WAIVER = 35;

function prep(drivers: number, patch: Partial<AgreementPrep> = {}): AgreementPrep {
  const list = Array.from({ length: drivers }, (_, i) => ({
    name: `Extra Driver${i + 1}`,
    licenseNumber: "D1234567",
    licenseState: "FL",
    licenseExpiration: "2028-01-01",
    verified: true,
  }));
  return PrepSchema.parse({
    ...EMPTY_PREP,
    damageWaiver: "declined",
    payment: { schedule: "weekly", method: "Card Autopay" },
    drivers: drivers === 0 ? { mode: "none", list: [] } : { mode: "listed", list },
    ...patch,
  });
}

function rows(drivers: number, patch: Partial<AgreementPrep> = {}, catalog: number | null = 350, weekly = 350) {
  return paymentRows(prep(drivers, patch), {
    weeklyRate: weekly,
    waiverFee: WAIVER,
    additionalDriverWeeklyFee: FEE,
    catalogWeeklyRate: catalog,
  });
}

describe("Amount Due Each Payment includes approved Additional Drivers", () => {
  test("0 drivers, Damage Waiver declined, no Reservation Fee", () => {
    const r = rows(0);
    expect(r.payment_amount).toBe("$350.00 weekly");
    expect(r.balance_due).toBe("$350.00");
    expect(r.billing).toMatchObject({ weeklyAmount: 350, driverCount: 0, driverFeesIncluded: 0, source: "none" });
  });

  test("0 drivers, Damage Waiver declined, Reservation Fee credited", () => {
    const r = rows(0, { reservation: { mode: "required", amount: 50 } });
    expect(r.payment_amount).toBe("$350.00 weekly");
    expect(r.balance_due).toBe("$300.00");
    expect(r.billing?.weeklyAmount).toBe(350);
  });

  test("0 drivers, Damage Waiver accepted, Reservation Fee credited", () => {
    const r = rows(0, { damageWaiver: "accepted", reservation: { mode: "required", amount: 50 } });
    expect(r.payment_amount).toBe("$385.00 weekly ($350.00 rent + $35.00 Damage Waiver)");
    expect(r.balance_due).toBe("$335.00");
    expect(r.billing?.weeklyAmount).toBe(385);
  });

  test("1 driver at $100, Damage Waiver declined, Reservation Fee credited", () => {
    const r = rows(1, { reservation: { mode: "required", amount: 50 } });
    expect(r.payment_amount).toBe("$450.00 weekly ($350.00 rent + $100.00 Additional Driver)");
    expect(r.balance_due).toBe("$400.00");
    expect(r.billing).toMatchObject({ weeklyAmount: 450, driverFeeEach: 100, driverCount: 1, driverFeesIncluded: 100, source: "added" });
  });

  test("1 driver, Damage Waiver accepted, Reservation Fee credited", () => {
    const r = rows(1, { damageWaiver: "accepted", reservation: { mode: "required", amount: 50 } });
    expect(r.payment_amount).toBe("$485.00 weekly ($350.00 rent + $100.00 Additional Driver + $35.00 Damage Waiver)");
    expect(r.balance_due).toBe("$435.00");
    expect(r.billing?.weeklyAmount).toBe(485);
  });

  test("2 drivers, Damage Waiver declined, Reservation Fee credited", () => {
    const r = rows(2, { reservation: { mode: "required", amount: 50 } });
    expect(r.payment_amount).toBe("$550.00 weekly ($350.00 rent + $200.00 Additional Drivers)");
    expect(r.balance_due).toBe("$500.00");
    expect(r.billing).toMatchObject({ weeklyAmount: 550, driverCount: 2, driverFeesIncluded: 200, source: "added" });
  });

  test("2 drivers, Damage Waiver accepted, Reservation Fee credited", () => {
    const r = rows(2, { damageWaiver: "accepted", reservation: { mode: "required", amount: 50 } });
    expect(r.payment_amount).toBe("$585.00 weekly ($350.00 rent + $200.00 Additional Drivers + $35.00 Damage Waiver)");
    expect(r.balance_due).toBe("$535.00");
    expect(r.billing?.weeklyAmount).toBe(585);
  });

  test("a blank driver row is not a fee", () => {
    const named = prep(1);
    const withBlank = PrepSchema.parse({
      ...named,
      drivers: { mode: "listed", list: [...named.drivers.list, { name: "", licenseNumber: "", licenseState: "", licenseExpiration: "", verified: false }] },
    });
    const r = paymentRows(withBlank, { weeklyRate: 350, waiverFee: WAIVER, additionalDriverWeeklyFee: FEE, catalogWeeklyRate: 350 });
    expect(r.billing?.driverCount).toBe(1);
    expect(r.balance_due).toBe("$450.00");
  });

  test("a missing Additional Driver fee does not print a total that drops it", () => {
    const r = paymentRows(prep(1), { weeklyRate: 350, waiverFee: WAIVER, additionalDriverWeeklyFee: null, catalogWeeklyRate: 350 });
    expect(r.payment_amount).toBe("");
    expect(r.balance_due).toBe("");
    expect(r.blockers[0]?.label).toBe("Additional Driver Weekly Fee");
  });
});

describe("a Weekly Rate that already includes the driver fee is not increased", () => {
  test("typed $450 with the vehicle at $350 and 1 driver stays $450, and pickup is $400 after the Reservation Fee", () => {
    const r = rows(1, { reservation: { mode: "required", amount: 50 } }, 350, 450);
    expect(r.payment_amount).toBe("$450.00 weekly ($350.00 rent + $100.00 Additional Driver)");
    expect(r.balance_due).toBe("$400.00");
    expect(r.payment_amount).not.toContain("550");
    expect(r.billing).toMatchObject({ weeklyAmount: 450, source: "already_in_rate", driverFeesIncluded: 100 });
    expect(r.driverFeeNote).toMatch(/not added again/);
    expect(r.driverFeeNote).not.toMatch(/deposit/i);
  });

  test("the same workaround with the Damage Waiver accepted adds only the waiver", () => {
    const r = rows(1, { damageWaiver: "accepted", reservation: { mode: "required", amount: 50 } }, 350, 450);
    expect(r.payment_amount).toBe("$485.00 weekly ($350.00 rent + $100.00 Additional Driver + $35.00 Damage Waiver)");
    expect(r.balance_due).toBe("$435.00");
    expect(r.billing?.weeklyAmount).toBe(485);
  });
});

describe("stored agreements are read as stored", () => {
  const live = {
    weekly_rate: "$450.00",
    payment_amount: "$450.00 weekly",
    _prep: JSON.stringify({ drivers: { mode: "listed", list: [{ name: "Extra Driver" }] } }),
  };

  test("a sent agreement at $450 stays $450 when it is read for billing", () => {
    expect(storedWeeklyAmount(live)).toBe(450);
    expect(storedWeeklyAmount(live)).not.toBe(550);
  });

  test("an Every 4 Weeks payment is brought back to a weekly amount", () => {
    expect(storedWeeklyAmount({ payment_amount: "$1,800.00 every 4 weeks ($1,400.00 rent + $400.00 Additional Driver)" })).toBe(450);
  });

  test("the billing snapshot wins over the printed weekly rate", () => {
    const merge = {
      weekly_rate: "$350.00",
      payment_amount: "$450.00 weekly ($350.00 rent + $100.00 Additional Driver)",
      [BILLING_MERGE_KEY]: JSON.stringify({ weeklyAmount: 450, driverFeeEach: 100, driverCount: 1, driverFeesIncluded: 100, source: "added" }),
    };
    expect(storedWeeklyAmount(merge)).toBe(450);
  });

  test("the agreement amount is used for the rental, and the vehicle rate only when there is no agreement", () => {
    expect(weeklyRateFromAgreementOrVehicle(450, 250)).toBe(450);
    expect(weeklyRateFromAgreementOrVehicle(null, 250)).toBe(250);
    expect(weeklyRateFromAgreementOrVehicle(null, null)).toBeNull();
  });

  test("the $450 workaround counts as already included; a $350 agreement does not", () => {
    expect(includedDriverCount({ merge: live, rentalWeekly: 350, vehicleWeekly: 350, approvedCount: 1, feeEach: 100 })).toBe(1);
    expect(includedDriverCount({
      merge: { weekly_rate: "$350.00", payment_amount: "$350.00 weekly" },
      rentalWeekly: 350,
      vehicleWeekly: 350,
      approvedCount: 1,
      feeEach: 100,
    })).toBe(0);
  });

  test("a snapshot that included one driver does not cover a second driver added later", () => {
    const merge = {
      [BILLING_MERGE_KEY]: JSON.stringify({ weeklyAmount: 450, driverFeeEach: 100, driverCount: 1, driverFeesIncluded: 100, source: "added" }),
    };
    expect(includedDriverCount({ merge, rentalWeekly: 450, vehicleWeekly: 350, approvedCount: 2, feeEach: 100 })).toBe(1);
  });

  test("a void and re-prepare starts from base rent, so the Damage Waiver is not added twice", () => {
    const first = rows(0, { damageWaiver: "accepted", damageWaiverFee: 25 });
    expect(first.payment_amount).toBe("$375.00 weekly ($350.00 rent + $25.00 Damage Waiver)");
    expect(first.billing?.baseRent).toBe(350);
    expect(first.billing?.weeklyAmount).toBe(375);
    const again = prepareBaseRent({
      entered: 375,
      vehicleWeekly: 350,
      vehicleChanged: false,
      previous: { weeklyAmount: 375, baseRent: 350, vehicleWeekly: 350 },
    });
    expect(again).toBe(350);
    const second = paymentRows(prep(0, { damageWaiver: "accepted", damageWaiverFee: 25 }), {
      weeklyRate: again,
      waiverFee: 25,
      additionalDriverWeeklyFee: FEE,
      catalogWeeklyRate: 350,
    });
    expect(second.billing?.weeklyAmount).toBe(375);
    expect(second.payment_amount).not.toContain("400");
  });

  test("a different car does not add the driver fee on top of the old total", () => {
    const start = prepareBaseRent({
      entered: 450,
      vehicleWeekly: 400,
      vehicleChanged: true,
      previous: { weeklyAmount: 450, baseRent: 350, vehicleWeekly: 350 },
    });
    expect(start).toBe(400);
    const next = paymentRows(prep(1), {
      weeklyRate: start,
      waiverFee: WAIVER,
      additionalDriverWeeklyFee: FEE,
      catalogWeeklyRate: 400,
    });
    expect(next.billing?.weeklyAmount).toBe(500);
    expect(next.payment_amount).toBe("$500.00 weekly ($400.00 rent + $100.00 Additional Driver)");
    expect(next.payment_amount).not.toContain("550");
  });

  test("the $450 typed Weekly Rent stays $450 on the next prepare", () => {
    const start = prepareBaseRent({
      entered: 450,
      vehicleWeekly: 350,
      vehicleChanged: false,
      previous: { weeklyAmount: 450, baseRent: 450, vehicleWeekly: 350 },
    });
    expect(start).toBe(450);
    const next = paymentRows(prep(1), {
      weeklyRate: start,
      waiverFee: WAIVER,
      additionalDriverWeeklyFee: FEE,
      catalogWeeklyRate: 350,
    });
    expect(next.billing?.weeklyAmount).toBe(450);
    expect(next.billing?.baseRent).toBe(450);
  });

  test("staff can set an Additional Driver fee to $0 and edit the Damage Waiver", () => {
    const free = paymentRows(prep(1, { drivers: { mode: "listed", list: [{ ...prep(1).drivers.list[0], weeklyFee: 0 }] } }), {
      weeklyRate: 350,
      waiverFee: WAIVER,
      additionalDriverWeeklyFee: FEE,
      catalogWeeklyRate: 350,
    });
    expect(free.payment_amount).toBe("$350.00 weekly");
    expect(free.billing?.drivers?.[0].weeklyFee).toBe(0);
    expect(free.billing?.laterDriverFee).toBe(0);
    expect(free.billing?.weeklyAmount).toBe(350);
    const waiver = rows(0, { damageWaiver: "accepted", damageWaiverFee: 10 });
    expect(waiver.payment_amount).toBe("$360.00 weekly ($350.00 rent + $10.00 Damage Waiver)");
    expect(waiver.billing?.waiverWeekly).toBe(10);
    expect(waiver.billing?.priceNote).toBeUndefined();
  });

  test("a Price Change Note is stored and is not part of the printed amount", () => {
    const noted = rows(0, { damageWaiver: "accepted", damageWaiverFee: 10, priceNote: "Promo week for this renter" });
    expect(noted.billing?.priceNote).toBe("Promo week for this renter");
    expect(noted.payment_amount).not.toContain("Promo");
    expect(noted.payment_amount).not.toMatch(/deposit/i);
  });

  test("a later driver is billed at the edited fee, including $0", () => {
    const merge = {
      [BILLING_MERGE_KEY]: JSON.stringify({
        weeklyAmount: 350,
        baseRent: 350,
        driverFeeEach: 0,
        driverCount: 1,
        driverFeesIncluded: 0,
        source: "none",
        drivers: [{ name: "Extra Driver1", weeklyFee: 0 }],
        laterDriverFee: 0,
      }),
    };
    expect(weeklyFeeOnAgreement(merge, "Extra Driver1")).toBe(0);
    expect(weeklyFeeOnAgreement(merge, "Someone New")).toBe(0);
    expect(weeklyFeeOnAgreement({ weekly_rate: "$350.00" }, "Someone New")).toBeNull();
  });

  test("resend does not recompute totals, and a new send does not rewrite agreement rows", () => {
    const src = readFileSync("src/lib/agreements.functions.ts", "utf8");
    const resend = src.slice(src.indexOf("export const resendAgreement"), src.indexOf("export const ", src.indexOf("export const resendAgreement") + 20));
    expect(resend).not.toContain("paymentRows");
    expect(resend).not.toContain("merge_data:");
    const recorder = readFileSync("src/lib/agreement-weekly.server.ts", "utf8");
    expect(recorder).toContain("opts.amendment) return");
    expect(recorder).not.toContain('from("agreements").update');
    const autopay = readFileSync("src/lib/rental-payments.functions.ts", "utf8");
    expect(autopay).toContain("unit_amount: Math.round(Number(rental.weekly_rate) * 100)");
    expect(autopay).not.toContain("ADDITIONAL_DRIVER_WEEKLY_CENTS");
  });
});
