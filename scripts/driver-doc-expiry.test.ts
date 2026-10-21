import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DRIVER_DOC_EXPIRY_CARD_ENABLED,
  addCalendarDays,
  assertDriverDocExpiryEnabled,
  buildDocExpiry,
  easternDate,
  expiryState,
} from "../src/lib/driver-doc-expiry";

const lib = readFileSync("src/lib/driver-doc-expiry.ts", "utf8");
const fn = readFileSync("src/lib/driver-doc-expiry.functions.ts", "utf8");
const portal = readFileSync("src/routes/portal.tsx", "utf8");
const card = readFileSync("src/components/portal/DriverDocExpiryCard.tsx", "utf8");

function flagValue(source: string): string | null {
  return source.match(/const DRIVER_DOC_EXPIRY_CARD_ENABLED: boolean = (false|true)/)?.[1] ?? null;
}

const driver = "driver-1";
const other = "driver-2";
/** 2026-10-21 03:30 UTC is still 2026-10-20 in Eastern Time. */
const now = new Date("2026-10-21T03:30:00.000Z");

describe("driver document expiry flag", () => {
  it("is off, and the handler throws before auth or a table read", () => {
    assert.equal(DRIVER_DOC_EXPIRY_CARD_ENABLED, false);
    assert.equal(flagValue(lib), "false");
    assert.equal(flagValue(portal), null);
    assert.match(portal, /import \{ DRIVER_DOC_EXPIRY_CARD_ENABLED \} from "@\/lib\/driver-doc-expiry"/);
    assert.throws(() => assertDriverDocExpiryEnabled(), /Driver document expiry card is not enabled/);

    const handler = fn.slice(fn.indexOf(".handler("));
    const guard = handler.indexOf("assertDriverDocExpiryEnabled()");
    const auth = handler.indexOf("getRequest(");
    const claims = handler.indexOf("auth.getClaims");
    const read = handler.indexOf('.from("');
    assert.ok(guard !== -1 && auth !== -1 && claims !== -1 && read !== -1);
    assert.ok(guard < auth && auth < claims && claims < read);
    assert.match(fn, /\.eq\("user_id", userId\)/);
    assert.match(fn, /select\("user_id,license_expiration,insurance_expires_on"\)/);
    assert.equal(fn.split('.from("').length - 1, 1);
    assert.doesNotMatch(fn, /supabaseAdmin|SUPABASE_SERVICE_ROLE|\.insert\(|\.update\(|\.delete\(|\.or\(`|\.filter\(`|requireSupabaseAuth/);
    assert.doesNotMatch(card, /supabaseAdmin|\.from\(|uppercase/);
    assert.match(card, /min-h-11/);
    assert.match(card, /Upload Or Replace/);
    assert.match(card, /enabled: DRIVER_DOC_EXPIRY_CARD_ENABLED === true/);

    const gate = portal.slice(portal.indexOf("function DocExpiryGate"));
    const check = gate.indexOf("DRIVER_DOC_EXPIRY_CARD_ENABLED !== true");
    const load = gate.indexOf('import("@/components/portal/DriverDocExpiryCard")');
    assert.ok(check !== -1 && load !== -1 && check < load);
    assert.doesNotMatch(portal, /from "@\/components\/portal\/DriverDocExpiryCard"/);
    assert.match(portal, /DRIVER_DOC_EXPIRY_CARD_ENABLED \? \(/);
    assert.match(portal, /onNavigate\("documents"\)/);
  });
});

describe("driver document expiry states", () => {
  it("uses the Eastern calendar and the three states, and leaves a missing date blank", () => {
    assert.equal(easternDate(now), "2026-10-20");
    assert.equal(addCalendarDays("2026-10-20", 30), "2026-11-19");
    assert.equal(expiryState("2026-11-20", "2026-10-20"), "ok");
    assert.equal(expiryState("2026-11-19", "2026-10-20"), "expiring");
    assert.equal(expiryState("2026-10-20", "2026-10-20"), "expiring");
    assert.equal(expiryState("2026-10-19", "2026-10-20"), "expired");
    assert.equal(expiryState(null, "2026-10-20"), "missing");
    assert.equal(expiryState("", "2026-10-20"), "missing");

    const ok = buildDocExpiry(
      [{ user_id: driver, license_expiration: "2027-01-01", insurance_expires_on: "2027-02-01" }],
      driver,
      now,
    );
    assert.equal(ok.items[0]?.stateLabel, "OK");
    assert.equal(ok.items[1]?.stateLabel, "OK");
    assert.equal(ok.items[0]?.displayDate, "Jan 1, 2027");

    const expiring = buildDocExpiry(
      [{ user_id: driver, license_expiration: "2026-11-19", insurance_expires_on: "2026-10-20" }],
      driver,
      now,
    );
    assert.equal(expiring.items[0]?.state, "expiring");
    assert.equal(expiring.items[0]?.stateLabel, "Expiring In 30 Days Or Less");
    assert.equal(expiring.items[1]?.state, "expiring");

    const expired = buildDocExpiry(
      [{ user_id: driver, license_expiration: "2026-10-19", insurance_expires_on: "2020-01-01" }],
      driver,
      now,
    );
    assert.equal(expired.items[0]?.state, "expired");
    assert.equal(expired.items[0]?.stateLabel, "Expired");
    assert.equal(expired.items[1]?.state, "expired");

    const missing = buildDocExpiry(
      [{ user_id: driver, license_expiration: null, insurance_expires_on: null }],
      driver,
      now,
    );
    assert.equal(missing.items[0]?.state, "missing");
    assert.equal(missing.items[0]?.stateLabel, "No Date On File");
    assert.equal(missing.items[0]?.date, null);
    assert.equal(missing.items[0]?.displayDate, null);
    assert.equal(missing.items[1]?.state, "missing");
  });

  it("returns only the signed-in driver's row", () => {
    const card = buildDocExpiry(
      [
        { user_id: other, license_expiration: "2020-01-01", insurance_expires_on: "2020-01-01" },
        { user_id: driver, license_expiration: "2027-06-01", insurance_expires_on: null },
      ],
      driver,
      now,
    );
    assert.equal(card.items[0]?.state, "ok");
    assert.equal(card.items[0]?.date, "2027-06-01");
    assert.equal(card.items[1]?.state, "missing");

    const none = buildDocExpiry(
      [{ user_id: other, license_expiration: "2027-06-01", insurance_expires_on: "2027-06-01" }],
      driver,
      now,
    );
    assert.deepEqual(
      none.items.map((item) => item.state),
      ["missing", "missing"],
    );
  });
});
