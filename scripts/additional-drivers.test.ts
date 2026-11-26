import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { additionalDriverAgeBlock, additionalDriverFieldError, additionalDriverMayDrive, additionalDriverPriceProblem, prepDriversFromApproved, signingClosesDocument, type AdditionalDriverInput, type AdditionalDriverRow } from "../src/lib/additional-drivers";
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

const validDriver = (): AdditionalDriverInput => ({
  name: "Sam Driver",
  email: "sam@example.com",
  phone: "8135550100",
  dob: "1990-01-01",
  licenseNumber: "D1234567",
  licenseState: "fl",
  licenseExpiration: "2028-01-01",
  licensePhotoPath: null,
  relationship: "Spouse",
  smsConsent: true,
});

describe("staff can add a driver before a rental exists", () => {
  test("the form checks the same fields, including the age gate", () => {
    expect(additionalDriverFieldError(validDriver(), "2026-11-25")).toBeNull();
    expect(additionalDriverFieldError({ ...validDriver(), dob: "2010-01-01" }, "2026-11-25")).toMatch(/at least 23/);
    expect(additionalDriverFieldError({ ...validDriver(), licenseState: "Florida" }, "2026-11-25")).toMatch(/license state/);
    expect(additionalDriverFieldError({ ...validDriver(), email: "nope" }, "2026-11-25")).toMatch(/email/);
  });

  test("addStaffAdditionalDriver keeps the manager check and accepts a null rental on any status", () => {
    const src = readFileSync("src/lib/additional-drivers.functions.ts", "utf8");
    const staff = src.slice(src.indexOf("export const addStaffAdditionalDriver"));
    expect(staff).toContain("await requireManager(context.userId)");
    expect(staff).toContain("rentalId: z.string().uuid().nullable()");
    expect(staff).toContain("applicationId: z.string().uuid().nullable()");
    expect(staff).not.toContain("no longer accepting");
    expect(staff).toContain("if (!data.applicationId && !data.rentalId)");
  });

  test("a new application with no rental is saved with a null rental id", async () => {
    process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
    process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
    const { insertAdditionalDriver } = await import("../src/lib/additional-drivers.server");
    const inserted: Record<string, unknown>[] = [];
    const admin = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "d1", ...row, screening_status: "pending", approved_at: null, insurance_added_at: null, signed_at: null, removed_at: null, stripe_subscription_item_id: null },
                error: null,
              }),
            }),
          };
        },
      }),
    };
    const saved = await insertAdditionalDriver(admin, null, { ...validDriver(), applicationId: "802fb55c-d7e8-45ae-9b40-dc5efa74753f", rentalId: null });
    expect(inserted[0]).toMatchObject({ application_id: "802fb55c-d7e8-45ae-9b40-dc5efa74753f", rental_id: null, screening_status: "pending" });
    expect(saved.rentalId).toBeNull();
    expect(saved.applicationId).toBe("802fb55c-d7e8-45ae-9b40-dc5efa74753f");
  });

  test("the admin section submits through the server function and the vehicle page uses that section", () => {
    const ui = readFileSync("src/components/admin/AdditionalDriversSection.tsx", "utf8");
    expect(ui).toContain("Add Additional Driver");
    expect(ui).toContain("Included In Weekly Rate");
    expect(ui).toContain("disabled");
    expect(ui).toContain("useServerFn(addStaffAdditionalDriver)");
    expect(ui).toContain("licensePhotoPath: null");
    expect(ui).toContain("setNonce((n) => n + 1)");
    expect(ui).not.toContain(".from(\"rental_additional_drivers\").insert");
    const vehicle = readFileSync("src/components/admin/VehicleProfile.tsx", "utf8");
    expect(vehicle).toContain("<AdditionalDriversSection applicationId={p.currentRental.application_id} rentalId={p.currentRental.id} />");
  });
});
