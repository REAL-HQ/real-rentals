/**
 * Florida 812.155 Addendum is only needed when the current signed rental
 * agreement does not already include the s. 812.155(6) notice.
 * Fake agreement facts only. No database, no phone numbers.
 * Run: npx vitest run scripts/florida-addendum-need.test.ts
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { V110_SOURCE, V1102_INS_SOURCE } from "../src/lib/agreement-library";
import { V114_SOURCE } from "../src/lib/agreement-v114";
import { V115_SOURCE } from "../src/lib/agreement-v115";
import { V116_SOURCE } from "../src/lib/agreement-v116";
import { V117_SOURCE } from "../src/lib/agreement-v117";
import {
  FL_812155_NOTICE_SINCE,
  agreementFactFromRow,
  displayVersionOf,
  floridaAddendumNeed,
  needs812155Addendum,
  versionIncludes812155Notice,
  type AgreementFact,
} from "../src/lib/florida-addendum-need";

function signed(partial: AgreementFact): AgreementFact {
  return { status: "signed", signedAt: "2026-11-01T16:00:00Z", source: "rental", title: "Vehicle Rental Agreement", ...partial };
}

const v110 = signed({
  templateKey: "no_insurance",
  templateLabel: "Vehicle Rental Agreement — No Insurance Required v1.10 — Owner Approved 2026-11-01",
  templateVersion: 1,
  signedAt: "2026-10-01T16:00:00Z",
});
const v1102 = signed({
  templateKey: "insurance_required",
  templateLabel: "Vehicle Rental Agreement — Insurance Required v1.10.2 — Owner Approved 2026-11-01",
  templateVersion: 1,
  body: "#- Vehicle Rental Agreement (v1.10.2, Insurance Required)",
});
const v115 = signed({
  templateKey: "insurance_included_v115",
  templateLabel: "Vehicle Rental Agreement — Insurance Included v1.15 — Owner Approved 2026-11-19",
  templateVersion: 1,
  body: "#- Vehicle Rental Agreement (v1.15)",
  signedAt: "2026-11-20T16:00:00Z",
});

describe("template source for the s. 812.155(6) notice", () => {
  it("first appears in v1.14 and stays in every later library template", () => {
    expect(V110_SOURCE).not.toContain("812.155(6)");
    expect(V1102_INS_SOURCE).not.toContain("812.155(6)");
    expect(V114_SOURCE).toContain("Section 812.155(6), Florida Statutes");
    expect(V115_SOURCE).toContain("Section 812.155(6), Florida Statutes");
    expect(V116_SOURCE).toContain("Section 812.155(6), Florida Statutes");
    expect(V117_SOURCE).toContain("Section 812.155(6), Florida Statutes");
    expect(FL_812155_NOTICE_SINCE).toBe("1.14");
    expect(versionIncludes812155Notice("1.14")).toBe(true);
    expect(versionIncludes812155Notice("1.15")).toBe(true);
    expect(versionIncludes812155Notice("1.17")).toBe(true);
    expect(versionIncludes812155Notice("1.10")).toBe(false);
    expect(versionIncludes812155Notice("1.10.2")).toBe(false);
    expect(versionIncludes812155Notice(null)).toBe(false);
  });
});

describe("needs812155Addendum", () => {
  it("a signed v1.15 agreement gives no addendum", () => {
    expect(needs812155Addendum([v115])).toBe(false);
    expect(floridaAddendumNeed([v115])).toEqual({ state: "not_needed", reason: "notice_in_agreement", version: "1.15" });
  });

  it("v1.14, v1.16 and v1.17 already include the notice", () => {
    for (const [key, version] of [
      ["insurance_included", "1.14"],
      ["insurance_included_v116", "1.16"],
      ["insurance_included_v117", "1.17"],
    ] as const) {
      const need = floridaAddendumNeed([signed({ templateKey: key, templateVersion: 1, signedAt: "2026-11-25T18:00:00Z" })]);
      expect(need).toEqual({ state: "not_needed", reason: "notice_in_agreement", version });
    }
  });

  it("reads the display version from the library key, not the saved-template integer", () => {
    const row = agreementFactFromRow({
      status: "signed",
      signed_at: "2026-11-25T18:04:00Z",
      source: "rental",
      title: "Vehicle Rental Agreement",
      metadata: {
        template_key: "insurance_included_v117",
        template_label: "Vehicle Rental Agreement — Insurance Included v1.17 — Owner Approved 2026-11-25",
        template_version: 1,
        template_source: "library",
      },
      body: "#- Vehicle Rental Agreement (v1.17)\nAgreement Number | RRA-20261125-ABC123",
    });
    expect(row.templateVersion).toBe(1);
    expect(displayVersionOf(row)).toBe("1.17");
    expect(needs812155Addendum([row])).toBe(false);
  });

  it("v1.10 and v1.10.2 need the addendum", () => {
    expect(floridaAddendumNeed([v110])).toEqual({ state: "needed", reason: "older_agreement", version: "1.10" });
    expect(floridaAddendumNeed([v1102])).toEqual({ state: "needed", reason: "older_agreement", version: "1.10.2" });
    expect(needs812155Addendum([v110])).toBe(true);
    expect(needs812155Addendum({ agreements: [v1102] })).toBe(true);
  });

  it("a paper agreement or no e-sign agreement needs the addendum", () => {
    expect(floridaAddendumNeed([])).toEqual({ state: "needed", reason: "paper_or_missing", version: null });
    expect(needs812155Addendum([])).toBe(true);
    const paperOriginal: AgreementFact = {
      status: "signed",
      source: "paper",
      paperType: "original",
      paperName: "signed-rental.pdf",
      title: "Rental Agreement",
      isCurrent: true,
    };
    expect(floridaAddendumNeed([paperOriginal])).toEqual({ state: "needed", reason: "paper_or_missing", version: null });
  });

  it("an unknown or missing version needs the addendum", () => {
    const integerOnly = signed({ templateVersion: 14, templateKey: null, templateLabel: "Approved v3", body: "Vehicle Rental Agreement" });
    expect(displayVersionOf(integerOnly)).toBeNull();
    expect(floridaAddendumNeed([integerOnly])).toEqual({ state: "needed", reason: "unknown_version", version: null });
    expect(floridaAddendumNeed(null)).toEqual({ state: "needed", reason: "unknown_version", version: null });
    expect(needs812155Addendum({ agreements: null })).toBe(true);
  });

  it("a version printed on the agreement counts when metadata has no family key", () => {
    const fromHeading = signed({ body: "#- Vehicle Rental Agreement (v1.15)\nThe rest of the contract." });
    expect(displayVersionOf(fromHeading)).toBe("1.15");
    expect(needs812155Addendum([fromHeading])).toBe(false);
    const oldHeading = signed({ body: "#- Vehicle Rental Agreement (v1.10.2, Insurance Required)" });
    expect(floridaAddendumNeed([oldHeading]).version).toBe("1.10.2");
    expect(needs812155Addendum([oldHeading])).toBe(true);
    const fromLabel = signed({
      templateLabel: "Vehicle Rental Agreement — Insurance Included v1.16 — Owner Approved 2026-11-21",
    });
    expect(displayVersionOf(fromLabel)).toBe("1.16");
    expect(needs812155Addendum([fromLabel])).toBe(false);
  });

  it("an addendum that is already signed shows signed", () => {
    const addendum = signed({
      title: "Florida 812.155 Addendum",
      source: "addendum",
      signedAt: "2026-11-18T16:00:00Z",
    });
    expect(floridaAddendumNeed([v110, addendum])).toEqual({ state: "signed", reason: "addendum_signed", version: "1.10" });
    expect(needs812155Addendum([v110, addendum])).toBe(false);
    const paperAddendum: AgreementFact = {
      status: "signed",
      source: "paper",
      paperType: "addendum",
      paperName: "Florida 812.155 Addendum.pdf",
      isCurrent: true,
    };
    expect(floridaAddendumNeed([paperAddendum]).state).toBe("signed");
    expect(floridaAddendumNeed([]).state).not.toBe("signed");
  });

  it("a signed addendum does not appear when the current agreement already includes the notice", () => {
    const addendum = signed({ title: "Florida 812.155 Addendum", source: "addendum" });
    expect(floridaAddendumNeed([v115, addendum]).state).toBe("not_needed");
  });

  it("a voided addendum does not count as signed", () => {
    const voided = signed({ title: "Florida 812.155 Addendum", source: "addendum", voidedAt: "2026-11-19T16:00:00Z", status: "voided" });
    expect(floridaAddendumNeed([v110, voided])).toEqual({ state: "needed", reason: "older_agreement", version: "1.10" });
    const historical: AgreementFact = {
      status: "signed",
      source: "paper",
      paperType: "addendum",
      paperName: "Florida 812.155 Addendum.pdf",
      isCurrent: false,
    };
    expect(needs812155Addendum([v1102, historical])).toBe(true);
  });

  it("voided or superseded older agreements do not count when a newer signed one exists", () => {
    const voidedOld = signed({ ...v110, status: "voided", voidedAt: "2026-11-19T12:00:00Z" });
    expect(floridaAddendumNeed([voidedOld, v115]).state).toBe("not_needed");

    const stillOnFile = signed({ ...v110, signedAt: "2026-10-01T16:00:00Z" });
    const newer = signed({ ...v115, signedAt: "2026-11-25T18:00:00Z" });
    expect(floridaAddendumNeed([stillOnFile, newer])).toEqual({
      state: "not_needed",
      reason: "notice_in_agreement",
      version: "1.15",
    });

    const voidedNewer = signed({
      templateKey: "insurance_included_v117",
      signedAt: "2026-11-26T18:00:00Z",
      status: "voided",
      voidedAt: "2026-11-27T18:00:00Z",
    });
    expect(floridaAddendumNeed([v110, voidedNewer])).toEqual({ state: "needed", reason: "older_agreement", version: "1.10" });

    const sentButUnsigned = {
      status: "sent",
      source: "rental",
      templateKey: "insurance_included_v117",
      signedAt: null,
      createdAt: "2026-11-27T18:00:00Z",
      title: "Vehicle Rental Agreement",
    };
    expect(needs812155Addendum([v1102, sentButUnsigned])).toBe(true);
  });

  it("a newer signed vehicle-swap agreement on v1.17 is the current agreement, not this addendum", () => {
    const swap = signed({
      title: "Vehicle Swap Addendum To Rental Agreement",
      templateKey: "insurance_included_v117",
      templateVersion: 1,
      body: "%%LAYOUT 1%%\n#- Vehicle Rental Agreement (v1.17)",
      signedAt: "2026-11-25T18:00:00Z",
    });
    expect(floridaAddendumNeed([v110, swap])).toEqual({ state: "not_needed", reason: "notice_in_agreement", version: "1.17" });
  });
});

describe("the card uses the shared rule", () => {
  it("the staff card asks the server and does not compare versions itself", () => {
    const panel = readFileSync(new URL("../src/components/admin/FloridaAddendumPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain("getFloridaAddendumStatus");
    expect(panel).toContain("status?.outstanding === true");
    expect(panel).toContain("Signed");
    expect(panel).toContain("Needed");
    expect(panel).not.toMatch(/template_key|template_version|compareDisplayVersions/);
    const fn = readFileSync(new URL("../src/lib/florida-addendum.functions.ts", import.meta.url), "utf8");
    expect(fn).toContain("floridaAddendumNeed");
    expect(fn).toContain("needs812155Addendum");
    expect(fn).not.toMatch(/versionIncludes812155Notice|compareDisplayVersions|FL_812155_NOTICE_SINCE/);
    expect(fn).toMatch(/requireStaff\(context\.userId\)/);
    expect(fn).toMatch(/requireTier\(context\.userId, "manager"\)/);
  });
});
