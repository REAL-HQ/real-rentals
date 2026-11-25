import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { additionalDriverAgeBlock, additionalDriverMayDrive, additionalDriverPriceProblem, prepDriversFromApproved, signingClosesDocument, type AdditionalDriverRow } from "../src/lib/additional-drivers";
import { ADDITIONAL_DRIVER_FAQ_ANSWER, ADDITIONAL_DRIVER_INSURANCE_LINE, ADDITIONAL_DRIVER_SHARE_LINE } from "../src/lib/additional-driver-copy";
import { V114_TERM_DEFAULTS } from "../src/lib/agreement-v114";
import { V115_TERM_DEFAULTS } from "../src/lib/agreement-v115";
import { V116_TERM_DEFAULTS } from "../src/lib/agreement-v116";

const row = (patch: Partial<AdditionalDriverRow>): AdditionalDriverRow => ({
  id: "d1",
  applicationId: "a1",
  rentalId: null,
  name: "Sam Driver",
  email: "sam@example.com",
  phone: "8135550100",
  dob: "1990-01-01",
  licenseNumber: "D1234567",
  licenseState: "FL",
  licenseExpiration: "2028-01-01",
  licensePhotoPath: null,
  relationship: "Spouse",
  smsConsent: true,
  status: "approved",
  approvedAt: "2026-11-25T00:00:00Z",
  insuranceAddedAt: null,
  signedAt: null,
  removedAt: null,
  stripeSubscriptionItemId: null,
  ...patch,
});

describe("additional drivers follow the renter order", () => {
  test("23 is the age gate", () => {
    expect(additionalDriverAgeBlock("2003-01-01", "2026-11-25")).toBeNull();
    expect(additionalDriverAgeBlock("2003-12-01", "2026-11-25")).toMatch(/at least 23/);
  });

  test("driving waits for signature, reservation fee, then the endorsement", () => {
    const base = { status: "approved" as const, signedAt: null, insuranceAddedAt: null, removedAt: null, reservationFeeSettled: false };
    expect(additionalDriverMayDrive(base)).toBe(false);
    expect(additionalDriverMayDrive({ ...base, signedAt: "2026-11-25T00:00:00Z" })).toBe(false);
    expect(additionalDriverMayDrive({ ...base, signedAt: "2026-11-25T00:00:00Z", reservationFeeSettled: true })).toBe(false);
    expect(additionalDriverMayDrive({ ...base, signedAt: "2026-11-25T00:00:00Z", reservationFeeSettled: true, insuranceAddedAt: "2026-11-25T00:00:00Z" })).toBe(true);
    expect(additionalDriverMayDrive({ ...base, signedAt: "2026-11-25T00:00:00Z", reservationFeeSettled: true, insuranceAddedAt: "2026-11-25T00:00:00Z", removedAt: "2026-11-25T00:00:00Z" })).toBe(false);
  });

  test("the document closes only when every other signer has signed", () => {
    expect(signingClosesDocument([], null)).toBe(true);
    expect(signingClosesDocument([{ id: "a", status: "sent" }], "a")).toBe(true);
    expect(signingClosesDocument([{ id: "a", status: "sent" }, { id: "b", status: "sent" }], "a")).toBe(false);
    expect(signingClosesDocument([{ id: "a", status: "signed" }, { id: "b", status: "sent" }], "b")).toBe(true);
  });

  test("authorized drivers stay unverified until staff check the license", () => {
    const listed = prepDriversFromApproved([row({}), row({ status: "pending", id: "d2" })]);
    expect(listed).toHaveLength(1);
    expect(listed[0].verified).toBe(false);
    expect(listed[0].name).toBe("Sam Driver");
  });

  test("billing refuses a missing or wrong Stripe price and charges nothing", () => {
    expect(additionalDriverPriceProblem(null)).toMatch(/Nothing was charged/);
    expect(additionalDriverPriceProblem({ price_id: "price_123", amount_cents: 5000 })).toMatch(/\$100/);
    expect(additionalDriverPriceProblem({ price_id: "price_123", amount_cents: 10000 })).toBeNull();
  });

  test("only the current default agreement prints $100 per week", () => {
    expect(V116_TERM_DEFAULTS.fee_additional_driver).toBe("$100 per week, per driver");
    expect(V114_TERM_DEFAULTS.fee_additional_driver).toBe("$50 per week, per driver, + any added Renter Policy premium");
    expect(V115_TERM_DEFAULTS.fee_additional_driver).toBe(V114_TERM_DEFAULTS.fee_additional_driver);
  });

  test("public copy keeps the process order and the terms page stays as written", () => {
    expect(ADDITIONAL_DRIVER_FAQ_ANSWER).toMatch(/After you sign and pay the reservation fee/);
    expect(ADDITIONAL_DRIVER_FAQ_ANSWER).toMatch(/\$100 per week per driver/);
    expect(ADDITIONAL_DRIVER_FAQ_ANSWER).toMatch(/at least 23/);
    expect(ADDITIONAL_DRIVER_SHARE_LINE).toBe("Need to share the car? Add an approved driver for $100/week. Insurance is included for both of you.");
    expect(ADDITIONAL_DRIVER_INSURANCE_LINE).toBe("Insurance is included, with the policy in your name. Approved additional drivers are covered too.");
    const terms = readFileSync("src/routes/terms.tsx", "utf8");
    expect(terms).toContain("After you sign your rental contract, REAL RENTALS handles your insurance quote");
    const faq = readFileSync("src/routes/faq.tsx", "utf8");
    expect(faq).toContain("ADDITIONAL_DRIVER_FAQ_QUESTION");
  });
});
