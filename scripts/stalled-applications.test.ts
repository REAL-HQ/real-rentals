// Stalled applications. No database, no email, no SMS.
// Run: node --import tsx --test scripts/stalled-applications.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  STALLED_APPLICATIONS_ENABLED,
  assertStalledApplicationsEnabled,
  cardOnFile,
  classifyStalled,
  daysSinceEastern,
  documentsOnFile,
  identityIsClear,
  insuranceOnFile,
  licenseOnFile,
  signedAgreement,
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
    documentsOnFile: false,
    identityClear: false,
    agreementSigned: false,
    cardOnFile: false,
    activityAt: ["2026-10-17T16:00:00Z"],
    contactAt: [],
    ...overrides,
  };
}

describe("stalled rules", () => {
  it("lists a New application after 3 Eastern days and names every missing item", () => {
    const stalled = classifyStalled(row(), TODAY);
    assert.ok(stalled);
    assert.deepEqual(stalled.gaps, ["documents", "identity", "agreement", "card_on_file"]);
    assert.equal(stalled.daysStalled, 3);
    assert.equal(stalled.phone, "4045550199");
    assert.equal(stalled.lastContactOn, null);
  });

  it("keeps a Reviewing application that is only missing an agreement and a card", () => {
    const stalled = classifyStalled(
      row({
        status: "reviewing",
        documentsOnFile: true,
        identityClear: true,
        agreementSigned: false,
        cardOnFile: false,
        activityAt: ["2026-10-15T15:00:00Z"],
        contactAt: ["2026-10-15T15:00:00Z"],
      }),
      TODAY,
    );
    assert.ok(stalled);
    assert.deepEqual(stalled.gaps, ["agreement", "card_on_file"]);
    assert.equal(stalled.daysStalled, 5);
    assert.equal(stalled.lastContactOn, "2026-10-15");
  });

  it("still lists a quiet New application when nothing is missing", () => {
    const stalled = classifyStalled(
      row({
        documentsOnFile: true,
        identityClear: true,
        agreementSigned: true,
        cardOnFile: true,
        activityAt: ["2026-10-01T15:00:00Z"],
      }),
      TODAY,
    );
    assert.ok(stalled);
    assert.deepEqual(stalled.gaps, []);
  });

  it("treats license and insurance together as documents", () => {
    assert.equal(licenseOnFile(null, ["license_front"]), true);
    assert.equal(licenseOnFile("https://files/license.jpg", []), true);
    assert.equal(licenseOnFile(null, ["insurance"]), false);
    assert.equal(insuranceOnFile(null, ["insurance"]), true);
    assert.equal(insuranceOnFile("", ["license_back"]), false);
    assert.equal(
      documentsOnFile({ licensePhotoUrl: null, insuranceDocUrl: null, categories: ["license_front", "insurance"] }),
      true,
    );
    assert.equal(
      documentsOnFile({ licensePhotoUrl: "https://files/license.jpg", insuranceDocUrl: null, categories: [] }),
      false,
    );
  });

  it("clears identity only when both checks passed and no review is open", () => {
    assert.equal(identityIsClear("passed", "passed", false), true);
    assert.equal(identityIsClear("Passed", "passed", false), true);
    assert.equal(identityIsClear("passed", "pending", false), false);
    assert.equal(identityIsClear("passed", "passed", true), false);
  });

  it("counts a signed agreement and ignores a voided one", () => {
    assert.equal(signedAgreement([{ status: "signed", signedAt: null, voidedAt: null }]), true);
    assert.equal(signedAgreement([{ status: "sent", signedAt: "2026-10-01T15:00:00Z", voidedAt: null }]), true);
    assert.equal(signedAgreement([{ status: "signed", signedAt: "2026-10-01T15:00:00Z", voidedAt: "2026-10-02T15:00:00Z" }]), false);
    assert.equal(signedAgreement([{ status: "voided", signedAt: "2026-10-01T15:00:00Z", voidedAt: null }]), false);
    assert.equal(signedAgreement([{ status: "sent", signedAt: null, voidedAt: null }]), false);
  });

  it("treats a stored card as on file and ignores an empty value", () => {
    assert.equal(cardOnFile([null, "", "4242"]), true);
    assert.equal(cardOnFile([null, "pm_123", null]), true);
    assert.equal(cardOnFile(["  ", null]), false);
  });

  it("dates the last contact on the Eastern calendar day, including the midnight boundary", () => {
    const beforeMidnight = classifyStalled(row({ contactAt: ["2026-10-18T03:59:59Z"] }), TODAY);
    const atMidnight = classifyStalled(row({ contactAt: ["2026-10-18T04:00:00Z"] }), TODAY);
    assert.equal(beforeMidnight?.lastContactOn, "2026-10-17");
    assert.equal(atMidnight?.lastContactOn, "2026-10-18");
  });

  it("does not stall an update from the last two Eastern days", () => {
    assert.equal(classifyStalled(row({ activityAt: ["2026-10-18T04:30:00Z"] }), TODAY), null);
    const stalled = classifyStalled(row({ activityAt: ["2026-10-18T03:30:00Z"] }), TODAY);
    assert.ok(stalled);
    assert.equal(stalled.daysStalled, 3);
  });

  it("uses midnight Eastern as the day boundary in both EDT and EST", () => {
    const edtToday = new Date("2026-10-21T15:00:00Z");
    assert.equal(daysSinceEastern("2026-10-19T04:00:00Z", edtToday), 2);
    assert.equal(daysSinceEastern("2026-10-19T03:59:59Z", edtToday), 3);
    assert.equal(classifyStalled(row({ activityAt: ["2026-10-19T04:00:00Z"] }), edtToday), null);
    assert.equal(classifyStalled(row({ activityAt: ["2026-10-19T03:59:59Z"] }), edtToday)?.daysStalled, 3);

    const estToday = new Date("2026-01-15T15:00:00Z");
    assert.equal(daysSinceEastern("2026-01-13T05:00:00Z", estToday), 2);
    assert.equal(daysSinceEastern("2026-01-13T04:59:59Z", estToday), 3);
    assert.equal(daysSinceEastern("2026-01-15T04:59:59Z", estToday), 1);
    assert.equal(daysSinceEastern("2026-01-15T05:00:00Z", estToday), 0);
    assert.equal(classifyStalled(row({ activityAt: ["2026-01-13T05:00:00Z"] }), estToday), null);
    assert.equal(classifyStalled(row({ activityAt: ["2026-01-13T04:59:59Z"] }), estToday)?.daysStalled, 3);
    assert.equal(classifyStalled(row({ activityAt: ["2026-01-15T05:00:00Z"] }), estToday), null);
  });

  it("uses the newest activity, including a later document", () => {
    assert.equal(
      classifyStalled(row({ activityAt: ["2026-10-01T15:00:00Z", "2026-10-20T15:00:00Z"] }), TODAY),
      null,
    );
  });

  it("leaves other statuses off the list", () => {
    for (const status of ["partial", "complete", "approved", "active", "declined", "closed", "duplicate", "suspended"]) {
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
  it("is declared once and the server refuses before the role check and before reads", () => {
    assert.equal(STALLED_APPLICATIONS_ENABLED, false);
    assert.throws(() => assertStalledApplicationsEnabled(), /not enabled/);
    const lib = readFileSync(new URL("../src/lib/stalled-applications.ts", import.meta.url), "utf8");
    assert.equal(lib.match(/export const STALLED_APPLICATIONS_ENABLED/g)?.length, 1);
    assert.match(lib, /STALLED_APPLICATIONS_ENABLED: boolean = false/);
    const source = readFileSync(new URL("../src/lib/stalled-applications.functions.ts", import.meta.url), "utf8");
    assert.equal(source.includes("STALLED_APPLICATIONS_ENABLED"), false);
    const handler = source.slice(source.indexOf("async ({ context })"));
    const enabled = handler.indexOf("assertStalledApplicationsEnabled()");
    const manager = handler.indexOf("await requireManager(");
    const query = handler.indexOf("loadApplications(");
    const related = handler.indexOf("loadRelated(");
    assert.ok(enabled >= 0 && enabled < manager && manager < query && query < related);
    assert.match(source, /\.from\("applications"\)/);
    assert.match(source, /\.from\("agreements"\)/);
    assert.match(source, /\.in\("status", \[\.\.\.STALLED_STATUSES\]\)/);
    assert.equal(handler.includes(".insert("), false);
    assert.equal(handler.includes(".update("), false);
    assert.equal(handler.includes(".delete("), false);
    assert.equal(handler.includes(".upsert("), false);
    assert.equal(/resend|twilio|sendSms|sendEmail|setContactStatus/i.test(source), false);
  });
});

describe("applications screen", () => {
  it("extends the existing Stalled filter and does not write from it", () => {
    const panel = readFileSync(new URL("../src/components/admin/DriversPanel.tsx", import.meta.url), "utf8");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    const list = readFileSync(new URL("../src/components/admin/StalledApplications.tsx", import.meta.url), "utf8");
    assert.match(panel, /const stalledOn = STALLED_APPLICATIONS_ENABLED === true && canManageWaitlist/);
    assert.match(panel, /urlFilter === "stalled" && stalledOn/);
    assert.match(panel, /if \(stalledOn\)/);
    assert.match(panel, /data-stalled-filter/);
    assert.match(panel, />\s*Stalled \(/);
    assert.equal(panel.includes("saveStalledContact"), false);
    assert.match(admin, /canManageWaitlist=\{tierAllows\(tier, "manager"\)\}/);
    assert.match(list, /Stalled Applications/);
    assert.match(list, /Last Contact/);
    assert.match(list, /STALLED_GAP_LABEL/);
    assert.match(list, /tel:/);
    assert.equal(list.includes("showMarkContacted"), false);
    assert.equal(list.includes("setContactStatus"), false);
    assert.equal(list.includes("ContactStatusCell"), false);
    assert.equal(/uppercase|lowercase|capitalize/.test(list), false);
  });
});
