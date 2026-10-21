import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NEXT_STEPS_CARD_ENABLED,
  PICKUP_LINE,
  buildNextSteps,
  credentialStep,
  etCalendarDate,
  paymentFromRows,
  pickNextStepsApplication,
} from "../src/lib/next-steps";
import { secureLinkBody, secureLinkHeading, thankYouView } from "../src/lib/secure-link-copy";

const LATE = new Date("2026-10-21T03:30:00.000Z");
const AFTERNOON = new Date("2026-10-21T16:00:00.000Z");

function view(over: Partial<Parameters<typeof buildNextSteps>[0]> = {}) {
  return buildNextSteps({
    status: "approved",
    hasActiveRental: false,
    licenseOnFile: true,
    licenseDates: ["2027-01-01"],
    insuranceOnFile: true,
    insuranceDates: ["2027-01-01"],
    agreements: [{ status: "signed", signedAt: "2026-10-01T00:00:00.000Z" }],
    payment: { cardOnFile: true, subscription: false },
    now: AFTERNOON,
    ...over,
  });
}

describe("next steps dates", () => {
  it("keeps a date-only licence on that calendar day", () => {
    assert.equal(etCalendarDate(LATE), "2026-10-20");
    const today = etCalendarDate(LATE);
    assert.equal(credentialStep(true, ["2026-10-20"], today), "done");
    assert.equal(credentialStep(true, ["2026-10-21"], today), "done");
    assert.equal(credentialStep(true, ["2026-10-19"], today), "needed");
    assert.equal(credentialStep(true, [null], today), "unknown");
    assert.equal(credentialStep(false, [null], today), "needed");
    assert.equal(credentialStep(false, ["2027-01-01"], today), "needed");
  });
});

describe("approved and not renting", () => {
  it("shows the four steps only for an approved driver with no active rental", () => {
    const shown = view();
    assert.equal(shown.show, true);
    assert.deepEqual(
      shown.steps.map((s) => s.state),
      ["done", "done", "done", "done"],
    );
    assert.equal(shown.pickupLine, PICKUP_LINE);
    assert.equal(view({ status: "active" }).show, false);
    assert.equal(view({ status: "reviewing" }).show, false);
    assert.equal(view({ hasActiveRental: true }).show, false);
    assert.equal(JSON.stringify(shown).includes("4242"), false);
  });

  it("reads agreement and payment evidence that is already stored", () => {
    assert.equal(view({ agreements: [] }).steps[2].state, "needed");
    assert.equal(view({ agreements: [{ status: "voided", signedAt: null }] }).steps[2].state, "needed");
    assert.equal(view({ agreements: [{ status: "sent", signedAt: null }] }).steps[2].state, "needed");
    assert.equal(view({ agreements: null }).steps[2].state, "unknown");
    assert.equal(view({ payment: { cardOnFile: false, subscription: false } }).steps[3].state, "needed");
    assert.equal(view({ payment: { cardOnFile: false, subscription: true } }).steps[3].state, "done");
    assert.equal(view({ payment: null }).steps[3].state, "unknown");

    const bare = paymentFromRows(
      { card_last4: null, stripe_payment_method_id: null, card_on_file_at: null },
      [{ stripe_subscription_id: null, autopay_active: false, card_last4: null }],
    );
    assert.deepEqual(bare, { cardOnFile: false, subscription: false });
    assert.equal(
      paymentFromRows({ card_last4: "4242" }, []).cardOnFile,
      true,
    );
    assert.equal(
      paymentFromRows({}, [{ stripe_subscription_id: "sub_123", autopay_active: false }]).subscription,
      true,
    );
  });

  it("uses the newest application that has not been deleted", () => {
    const picked = pickNextStepsApplication([
      { id: "old", status: "approved", deletedAt: null, createdAt: "2026-09-01" },
      { id: "new", status: "declined", deletedAt: null, createdAt: "2026-10-01" },
      { id: "gone", status: "approved", deletedAt: "2026-10-02", createdAt: "2026-10-20" },
    ]);
    assert.equal(picked?.id, "new");
  });
});

describe("the card stays off and on the signed-in driver", () => {
  it("is disabled, and the read does not run or call Stripe", () => {
    assert.equal(NEXT_STEPS_CARD_ENABLED, false);
    const fn = readFileSync(new URL("../src/lib/next-steps.functions.ts", import.meta.url), "utf8");
    const portal = readFileSync(new URL("../src/routes/portal.tsx", import.meta.url), "utf8");
    const gate = fn.indexOf("NEXT_STEPS_CARD_ENABLED");
    const query = fn.indexOf('.from("');
    assert.ok(gate !== -1 && query !== -1 && gate < query);
    assert.equal(/stripe\.|sendEmail\(|sendSms\(/.test(fn), false);
    assert.match(fn, /portalScope/);
    assert.match(fn, /\.eq\("user_id", userId\)/);
    assert.match(fn, /\.eq\("driver_id", userId\)/);
    assert.equal(fn.includes("storage_path"), false);
    assert.equal(fn.includes("license_number"), false);
    assert.match(portal, /NEXT_STEPS_CARD_ENABLED && !rental && data\.applicationStatus === "approved"/);
  });
});

describe("thank-you with no token", () => {
  it("uses neutral wording when there is no token, and the expired wording for a bad one", () => {
    assert.equal(thankYouView(undefined), "wait");
    assert.equal(thankYouView(null), "missing");
    assert.equal(thankYouView(""), "expired");
    assert.equal(thankYouView("abc"), "wizard");
    const missing = secureLinkBody("missing");
    assert.equal(secureLinkHeading("missing"), "Get A Secure Link To Your Application");
    assert.match(missing, /Enter your email/);
    assert.equal(/expired|already used/i.test(missing), false);
    assert.match(secureLinkBody("expired"), /expired or was already used/);
    const page = readFileSync(new URL("../src/routes/thank-you.tsx", import.meta.url), "utf8");
    assert.match(page, /thankYouView/);
    assert.equal(page.includes('Navigate to="/apply"'), false);
  });
});
