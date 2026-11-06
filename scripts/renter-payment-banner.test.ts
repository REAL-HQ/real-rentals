// Renter payment banner. No Stripe, no writes, no email.
// Run: node --import tsx --test scripts/renter-payment-banner.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  RENTER_PAYMENT_BANNER_ENABLED,
  assertRenterPaymentBannerEnabled,
  renterPaymentBanner,
} from "../src/lib/renter-payment-banner";

const TODAY = new Date("2026-10-21T03:00:00Z");
const PHONE = "(888) 833-8280";

function banner(overrides: Partial<Parameters<typeof renterPaymentBanner>[0]> = {}) {
  return renterPaymentBanner(
    {
      hasActiveRental: true,
      weeklyRate: 250,
      nextPaymentDue: "2026-10-28",
      ...overrides,
    },
    TODAY,
    PHONE,
  );
}

describe("due", () => {
  it("says the amount and the Eastern due date", () => {
    const model = banner();
    assert.ok(model);
    assert.equal(model.tone, "due");
    assert.equal(model.text, "Next payment: $250.00 due Oct 28, 2026");
    assert.equal(model.phoneDisplay, null);
  });

  it("treats the Eastern due day itself as due, not past due", () => {
    const model = banner({ nextPaymentDue: "2026-10-20" });
    assert.ok(model);
    assert.equal(model.tone, "due");
    assert.equal(model.text, "Next payment: $250.00 due Oct 20, 2026");
  });

  it("reads a timestamp due instant in Eastern Time", () => {
    const model = banner({ nextPaymentDue: "2026-10-21T03:30:00Z", weeklyRate: 250.5 });
    assert.ok(model);
    assert.equal(model.tone, "due");
    assert.equal(model.text, "Next payment: $250.50 due Oct 20, 2026");
  });
});

describe("past due", () => {
  it("names the due date and the company phone", () => {
    const model = banner({ nextPaymentDue: "2026-10-19" });
    assert.ok(model);
    assert.equal(model.tone, "past_due");
    assert.equal(model.text, "Payment past due since Oct 19, 2026 — call (888) 833-8280");
    assert.equal(model.phoneDisplay, PHONE);
  });

  it("shows nothing when the past-due line has no phone", () => {
    assert.equal(
      renterPaymentBanner(
        { hasActiveRental: true, weeklyRate: 250, nextPaymentDue: "2026-10-19" },
        TODAY,
        "  ",
      ),
      null,
    );
  });
});

describe("missing data", () => {
  it("shows nothing without a rate or a due date", () => {
    assert.equal(banner({ weeklyRate: null }), null);
    assert.equal(banner({ weeklyRate: 0 }), null);
    assert.equal(banner({ weeklyRate: Number.NaN }), null);
    assert.equal(banner({ nextPaymentDue: null }), null);
    assert.equal(banner({ nextPaymentDue: "" }), null);
    assert.equal(banner({ nextPaymentDue: "soon" }), null);
  });
});

describe("non-renters", () => {
  it("shows nothing when there is no active rental", () => {
    assert.equal(banner({ hasActiveRental: false }), null);
    assert.equal(
      banner({ hasActiveRental: false, weeklyRate: 250, nextPaymentDue: "2026-10-01" }),
      null,
    );
  });
});

describe("flag", () => {
  it("is off, and the portal read refuses before it looks up a rental", () => {
    assert.equal(RENTER_PAYMENT_BANNER_ENABLED, false);
    assert.throws(() => assertRenterPaymentBannerEnabled(), /not enabled/);
    const source = readFileSync(new URL("../src/lib/portal.functions.ts", import.meta.url), "utf8");
    const start = source.indexOf("export const getMyPaymentBanner");
    const handler = source.slice(start, source.indexOf("export const getDriverDocuments", start));
    const enabled = handler.indexOf("assertRenterPaymentBannerEnabled()");
    const scope = handler.indexOf("scope(");
    const query = handler.indexOf('.from("rentals")');
    assert.ok(enabled >= 0 && enabled < scope && scope < query);
    assert.equal(handler.includes(".insert("), false);
    assert.equal(handler.includes(".update("), false);
    assert.equal(handler.includes(".delete("), false);
    assert.equal(/stripe|resend|twilio|sendSms|sendEmail/i.test(handler), false);
    assert.match(handler, /weekly_rate,next_payment_due/);
    assert.match(handler, /\.eq\("driver_id", userId\)/);
    assert.match(handler, /\.eq\("status", "active"\)/);

    const portal = readFileSync(new URL("../src/routes/portal.tsx", import.meta.url), "utf8");
    const applicant = readFileSync(new URL("../src/components/portal/ApplicantHome.tsx", import.meta.url), "utf8");
    const view = readFileSync(new URL("../src/components/portal/RenterPaymentBanner.tsx", import.meta.url), "utf8");
    assert.match(portal, /RENTER_PAYMENT_BANNER_ENABLED === true \? <RenterPaymentBannerGate \/> : null/);
    assert.match(portal, /useBusinessPhone\(\)/);
    assert.equal(applicant.includes("RenterPaymentBanner"), false);
    assert.equal(view.includes("Pay Now"), false);
    assert.match(view, /phone\.tel/);
    const applicantReturn = portal.indexOf("return <ApplicantHome />");
    const banner = portal.indexOf("RenterPaymentBannerGate");
    assert.ok(applicantReturn >= 0 && applicantReturn < banner);
  });
});
