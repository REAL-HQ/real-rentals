// Stalled applications. No database, no email, no SMS.
// Run: node --import tsx --test scripts/stalled-applications.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  STALLED_APPLICATIONS_ENABLED,
  assertStalledApplicationsEnabled,
  classifyStalled,
  insuranceOnFile,
  licenseOnFile,
  sortStalled,
  type StalledInput,
} from "../src/lib/stalled-applications";

const TODAY = new Date("2026-10-21T03:00:00Z");

function row(overrides: Partial<StalledInput> = {}): StalledInput {
  return {
    id: "app-1",
    fullName: "Avery Lane",
    phone: "4045550199",
    status: "new",
    licenseOnFile: false,
    insuranceOnFile: false,
    backgroundCheckStatus: "pending",
    mvrStatus: "pending",
    activityAt: ["2026-10-17T16:00:00Z"],
    ...overrides,
  };
}

describe("stalled rules", () => {
  it("counts a started applicant with missing license, insurance, and identity after 3 Eastern days", () => {
    const stalled = classifyStalled(row({ status: "partial" }), TODAY);
    assert.ok(stalled);
    assert.deepEqual(stalled.gaps, ["finish_application", "driver_license", "insurance", "identity_review"]);
    assert.equal(stalled.daysStalled, 3);
    assert.equal(stalled.phone, "4045550199");
  });

  it("keeps a submitted applicant who is only missing insurance and an identity review", () => {
    const stalled = classifyStalled(
      row({
        status: "reviewing",
        licenseOnFile: true,
        insuranceOnFile: false,
        backgroundCheckStatus: "passed",
        mvrStatus: "pending",
        activityAt: ["2026-10-15T15:00:00Z"],
      }),
      TODAY,
    );
    assert.ok(stalled);
    assert.deepEqual(stalled.gaps, ["insurance", "identity_review"]);
    assert.equal(stalled.daysStalled, 5);
  });

  it("treats a current license or insurance document as on file", () => {
    assert.equal(licenseOnFile(null, ["license_front"]), true);
    assert.equal(licenseOnFile("https://files/license.jpg", []), true);
    assert.equal(licenseOnFile(null, ["insurance"]), false);
    assert.equal(insuranceOnFile(null, ["insurance"]), true);
    assert.equal(insuranceOnFile("", ["license_back"]), false);
  });

  it("does not stall someone whose file is complete", () => {
    assert.equal(
      classifyStalled(
        row({
          licenseOnFile: true,
          insuranceOnFile: true,
          backgroundCheckStatus: "passed",
          mvrStatus: "passed",
          activityAt: ["2026-10-01T15:00:00Z"],
        }),
        TODAY,
      ),
      null,
    );
  });

  it("does not stall an update from the last two Eastern days", () => {
    assert.equal(classifyStalled(row({ activityAt: ["2026-10-18T04:30:00Z"] }), TODAY), null);
    const stalled = classifyStalled(row({ activityAt: ["2026-10-18T03:30:00Z"] }), TODAY);
    assert.ok(stalled);
    assert.equal(stalled.daysStalled, 3);
  });

  it("uses the newest activity, including a later document", () => {
    assert.equal(
      classifyStalled(row({ activityAt: ["2026-10-01T15:00:00Z", "2026-10-20T15:00:00Z"] }), TODAY),
      null,
    );
  });

  it("leaves decided and renting drivers off the list", () => {
    for (const status of ["approved", "active", "declined", "closed", "duplicate", "suspended"]) {
      assert.equal(classifyStalled(row({ status, activityAt: ["2026-10-01T15:00:00Z"] }), TODAY), null);
    }
  });
});

describe("sorting", () => {
  it("puts the oldest stall first and breaks ties by name", () => {
    const rows = [
      classifyStalled(row({ id: "c", fullName: "Zoe West", activityAt: ["2026-10-17T16:00:00Z"] }), TODAY),
      classifyStalled(row({ id: "a", fullName: "Zoe West", activityAt: ["2026-10-10T16:00:00Z"] }), TODAY),
      classifyStalled(row({ id: "b", fullName: "Amy West", activityAt: ["2026-10-10T16:00:00Z"] }), TODAY),
    ];
    assert.deepEqual(
      sortStalled(rows.flatMap((item) => (item ? [item] : []))).map((item) => item.id),
      ["b", "a", "c"],
    );
  });
});

describe("flag off", () => {
  it("is off and the server refuses before it can read", () => {
    assert.equal(STALLED_APPLICATIONS_ENABLED, false);
    assert.throws(() => assertStalledApplicationsEnabled(), /not enabled/);
    const source = readFileSync(new URL("../src/lib/stalled-applications.functions.ts", import.meta.url), "utf8");
    const handler = source.slice(source.indexOf("async ({ context })"));
    const enabled = handler.indexOf("assertStalledApplicationsEnabled()");
    const manager = handler.indexOf("await requireManager(");
    const query = handler.indexOf("loadApplications(");
    assert.ok(enabled >= 0 && enabled < manager && manager < query);
    assert.match(source, /\.from\("applications"\)/);
    assert.equal(handler.includes(".insert("), false);
    assert.equal(handler.includes(".update("), false);
    assert.equal(handler.includes(".delete("), false);
    assert.equal(/resend|twilio|sendSms|sendEmail/i.test(handler), false);
    assert.match(source, /setContactStatus/);
  });
});

describe("coordinators", () => {
  it("hides the filter unless the caller can manage the waitlist", () => {
    const panel = readFileSync(new URL("../src/components/admin/DriversPanel.tsx", import.meta.url), "utf8");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    assert.match(panel, /const stalledOn = STALLED_APPLICATIONS_ENABLED === true && canManageWaitlist/);
    assert.match(panel, /urlFilter === "stalled" && stalledOn/);
    assert.match(panel, /if \(stalledOn\)/);
    assert.match(panel, /data-stalled-filter/);
    assert.match(admin, /canManageWaitlist=\{tierAllows\(tier, "manager"\)\}/);
    const cell = readFileSync(new URL("../src/components/admin/ContactStatusCell.tsx", import.meta.url), "utf8");
    const list = readFileSync(new URL("../src/components/admin/StalledApplications.tsx", import.meta.url), "utf8");
    assert.match(list, /showMarkContacted/);
    assert.match(list, /tel:/);
    assert.match(cell, /status: "contacted"/);
    assert.match(cell, /setContactStatus/);
  });
});
