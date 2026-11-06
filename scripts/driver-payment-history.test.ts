import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("driver payment history", () => {
  it("is the one portal card, not a second flag", () => {
    assert.equal(existsSync("src/lib/driver-payment-history.ts"), false);
    assert.equal(existsSync("src/lib/driver-payment-history.functions.ts"), false);
    assert.equal(existsSync("src/components/portal/DriverPaymentHistoryCard.tsx"), false);
    assert.equal(existsSync("src/components/portal/PortalPaymentHistory.tsx"), false);
    assert.equal(existsSync("src/lib/portal-payment-history-flag.ts"), false);
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    const rules = readFileSync("src/lib/portal-payment-history.ts", "utf8");
    assert.equal((rules.match(/const PORTAL_PAYMENT_HISTORY_ENABLED/g) ?? []).length, 1);
    assert.doesNotMatch(rules, /DRIVER_PAYMENT_HISTORY_ENABLED/);
    assert.doesNotMatch(portal, /DRIVER_PAYMENT_HISTORY|DriverPaymentHistory|PortalPaymentHistory|PaymentHistoryGate/);
    assert.equal((portal.match(/<PaymentHistoryCard \/>/g) ?? []).length, 1);
  });
});
