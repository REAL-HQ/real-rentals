import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CARD_LINK_EXPIRED_COPY,
  CARD_LINK_EXPIRED_TITLE,
  cardOnFileScreen,
  probeFromSessionResult,
} from "../src/lib/card-page";

const LINK = { error: CARD_LINK_EXPIRED_COPY };

describe("card page expired state", () => {
  it("shows Link Expired for a bad card token and does not open checkout", () => {
    const pending = cardOnFileScreen({
      isReturn: false,
      token: "card.bogus-token-value-ok",
      sessionState: "no",
      probe: { status: "pending" },
    });
    assert.equal(pending.kind, "wait");

    const screen = cardOnFileScreen({
      isReturn: false,
      token: "card.bogus-token-value-ok",
      sessionState: "no",
      probe: probeFromSessionResult(LINK),
    });
    assert.equal(screen.kind, "expired");
    if (screen.kind !== "expired") return;
    assert.equal(screen.title, CARD_LINK_EXPIRED_TITLE);
    assert.equal(screen.title, "Link Expired");
    assert.equal(screen.copy, CARD_LINK_EXPIRED_COPY);
    assert.equal("clientSecret" in screen, false);
  });

  it("shows the same Link Expired state for an expired card token", () => {
    const screen = cardOnFileScreen({
      isReturn: false,
      token: "card.expired-token-value-ok",
      sessionState: "no",
      probe: probeFromSessionResult(LINK),
    });
    assert.equal(screen.kind, "expired");
    if (screen.kind !== "expired") return;
    assert.equal(screen.title, "Link Expired");
    assert.equal(screen.copy, CARD_LINK_EXPIRED_COPY);
    assert.equal("clientSecret" in screen, false);
  });

  it("shows the same Link Expired state for a signed-in user who is not authorized", () => {
    const pending = cardOnFileScreen({
      isReturn: false,
      token: null,
      sessionState: "yes",
      probe: { status: "pending" },
    });
    assert.equal(pending.kind, "wait");

    const screen = cardOnFileScreen({
      isReturn: false,
      token: null,
      sessionState: "yes",
      probe: probeFromSessionResult(LINK),
    });
    assert.equal(screen.kind, "expired");
    if (screen.kind !== "expired") return;
    assert.equal(screen.title, "Link Expired");
    assert.equal(screen.copy, CARD_LINK_EXPIRED_COPY);
    assert.equal("clientSecret" in screen, false);
  });

  it("loads Stripe.js only after the server has accepted the link", () => {
    const route = readFileSync("src/routes/card.$applicationId.tsx", "utf8");
    const expiredAt = route.indexOf("screen.kind === 'expired'");
    const formAt = route.indexOf("screen.kind === 'form'");
    const stripeAt = route.indexOf("getStripe()");
    const headingAt = route.indexOf("Save Your Card on File");
    assert.ok(expiredAt > 0 && formAt > expiredAt && stripeAt > formAt && headingAt > formAt);
    assert.equal(route.split("getStripe()").length, 2);
    assert.equal(route.split("Save Your Card on File").length, 2);
    assert.match(route, /\{screen\.title\}/);
    assert.match(route, /\{screen\.copy\}/);
    assert.ok(route.indexOf("<EmbeddedCheckoutProvider") > formAt);

    const ready = cardOnFileScreen({
      isReturn: false,
      token: "card.good-token-value-okxx",
      sessionState: "no",
      probe: probeFromSessionResult({ clientSecret: "cs_test_secret" }),
    });
    assert.deepEqual(ready, { kind: "form", clientSecret: "cs_test_secret" });
  });
});
