import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PORTAL_DOCUMENT_UPDATE_ENABLED,
  PORTAL_DOCUMENT_UPDATE_WINDOW_DAYS,
  addCalendarDays,
  asEasternCalendarDate,
  assertPortalDocumentUpdateEnabled,
  documentsNeedingUpdate,
  easternCalendarDate,
  type ApplicationDocumentFacts,
  type DocumentOnFile,
} from "../src/lib/portal-document-update";

const TODAY = "2026-10-21";

const EMPTY_APPLICATION: ApplicationDocumentFacts = {
  licensePhotoPath: null,
  licenseExpiration: null,
  insuranceDocPath: null,
  insuranceExpiresOn: null,
};

function doc(partial: Partial<DocumentOnFile> & Pick<DocumentOnFile, "category">): DocumentOnFile {
  return {
    expiresAt: null,
    isCurrent: true,
    storagePath: `${partial.category}-file`,
    createdAt: "2026-01-01T00:00:00Z",
    visibleToDriver: true,
    ...partial,
  };
}

function categories(items: { category: string }[]) {
  return items.map((item) => item.category);
}

describe("portal document eligibility", () => {
  it("includes an expired license and leaves a current file dated past the window", () => {
    const items = documentsNeedingUpdate(
      [
        doc({ category: "license_front", expiresAt: "2026-10-20" }),
        doc({ category: "license_back", expiresAt: addCalendarDays(TODAY, 31) }),
        doc({ category: "insurance", expiresAt: addCalendarDays(TODAY, 31) }),
      ],
      EMPTY_APPLICATION,
      TODAY,
    );
    assert.deepEqual(categories(items), ["license_front"]);
    assert.equal(items[0].reason, "expired");
    assert.equal(items[0].expiresOn, "2026-10-20");
    assert.equal(items[0].label, "Driver's License (Front)");
  });

  it("includes insurance due today, on day 30, and not on day 31", () => {
    const due = (days: number) =>
      documentsNeedingUpdate(
        [
          doc({ category: "license_front", expiresAt: addCalendarDays(TODAY, 90) }),
          doc({ category: "license_back", expiresAt: addCalendarDays(TODAY, 90) }),
          doc({ category: "insurance", expiresAt: addCalendarDays(TODAY, days) }),
        ],
        EMPTY_APPLICATION,
        TODAY,
      );
    const today = due(0);
    const day30 = due(PORTAL_DOCUMENT_UPDATE_WINDOW_DAYS);
    const day31 = due(31);
    assert.equal(today.length, 1);
    assert.equal(today[0].category, "insurance");
    assert.equal(today[0].reason, "expiring");
    assert.equal(today[0].expiresOn, TODAY);
    assert.equal(day30.length, 1);
    assert.equal(day30[0].reason, "expiring");
    assert.equal(day30[0].expiresOn, addCalendarDays(TODAY, 30));
    assert.deepEqual(day31, []);
  });

  it("treats a missing insurance card as missing, and an undated current file as on file", () => {
    const missing = documentsNeedingUpdate(
      [
        doc({ category: "license_front", expiresAt: addCalendarDays(TODAY, 90) }),
        doc({ category: "license_back", expiresAt: addCalendarDays(TODAY, 90) }),
      ],
      EMPTY_APPLICATION,
      TODAY,
    );
    assert.deepEqual(categories(missing), ["insurance"]);
    assert.equal(missing[0].reason, "missing");
    assert.equal(missing[0].expiresOn, null);

    const undated = documentsNeedingUpdate(
      [
        doc({ category: "license_front", expiresAt: null }),
        doc({ category: "license_back", expiresAt: addCalendarDays(TODAY, 90) }),
        doc({ category: "insurance", expiresAt: addCalendarDays(TODAY, 90) }),
      ],
      EMPTY_APPLICATION,
      TODAY,
    );
    assert.deepEqual(undated, []);
  });

  it("ignores a superseded file and a file the driver cannot see", () => {
    const items = documentsNeedingUpdate(
      [
        doc({ category: "license_front", expiresAt: "2026-01-01", isCurrent: false }),
        doc({ category: "insurance", expiresAt: "2026-01-01", visibleToDriver: false }),
      ],
      EMPTY_APPLICATION,
      TODAY,
    );
    assert.deepEqual(categories(items), ["license_front", "license_back", "insurance"]);
    assert.ok(items.every((item) => item.reason === "missing"));
  });

  it("uses the apply-flow date while that file is still the one on file", () => {
    const path = "apps/driver/insurance.pdf";
    const soon = documentsNeedingUpdate(
      [],
      {
        ...EMPTY_APPLICATION,
        licensePhotoPath: "apps/driver/license.jpg",
        licenseExpiration: addCalendarDays(TODAY, 90),
        insuranceDocPath: path,
        insuranceExpiresOn: addCalendarDays(TODAY, 10),
      },
      TODAY,
    );
    assert.deepEqual(categories(soon), ["license_back", "insurance"]);
    assert.equal(soon.find((item) => item.category === "insurance")?.reason, "expiring");

    const synced = documentsNeedingUpdate(
      [
        doc({
          category: "insurance",
          expiresAt: null,
          storagePath: path,
        }),
        doc({ category: "license_front", expiresAt: addCalendarDays(TODAY, 90) }),
        doc({ category: "license_back", expiresAt: addCalendarDays(TODAY, 90) }),
      ],
      {
        ...EMPTY_APPLICATION,
        insuranceDocPath: path,
        insuranceExpiresOn: addCalendarDays(TODAY, 10),
      },
      TODAY,
    );
    assert.deepEqual(categories(synced), ["insurance"]);
    assert.equal(synced[0].reason, "expiring");
  });

  it("does not keep the old application date on a replacement that has no expiry", () => {
    const items = documentsNeedingUpdate(
      [
        doc({
          category: "insurance",
          expiresAt: null,
          storagePath: "application-id/insurance-new.pdf",
        }),
        doc({ category: "license_front", expiresAt: addCalendarDays(TODAY, 90) }),
        doc({ category: "license_back", expiresAt: addCalendarDays(TODAY, 90) }),
      ],
      {
        ...EMPTY_APPLICATION,
        insuranceDocPath: "apps/driver/insurance.pdf",
        insuranceExpiresOn: "2026-01-01",
      },
      TODAY,
    );
    assert.deepEqual(items, []);
  });

  it("does not treat a legacy http URL as a file we own", () => {
    const items = documentsNeedingUpdate(
      [],
      {
        ...EMPTY_APPLICATION,
        licensePhotoPath: "https://example.com/license.jpg",
        licenseExpiration: "2020-01-01",
      },
      TODAY,
    );
    assert.ok(items.some((item) => item.category === "license_front" && item.reason === "missing"));
  });

  it("reads a date-only expiry as that calendar day", () => {
    assert.equal(asEasternCalendarDate("2026-10-21"), "2026-10-21");
    const items = documentsNeedingUpdate(
      [
        doc({ category: "license_front", expiresAt: TODAY }),
        doc({ category: "license_back", expiresAt: addCalendarDays(TODAY, 90) }),
        doc({ category: "insurance", expiresAt: addCalendarDays(TODAY, 90) }),
      ],
      EMPTY_APPLICATION,
      TODAY,
    );
    assert.equal(items[0].reason, "expiring");
    assert.notEqual(items[0].reason, "expired");
  });

  it("counts Eastern calendar days, including the evening before UTC midnight", () => {
    assert.equal(easternCalendarDate(new Date("2026-10-21T03:30:00Z")), "2026-10-20");
    assert.equal(easternCalendarDate(new Date("2026-10-21T04:00:00Z")), "2026-10-21");
    assert.equal(asEasternCalendarDate("2026-10-21T03:30:00Z"), "2026-10-20");
  });
});

describe("portal document update flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(PORTAL_DOCUMENT_UPDATE_ENABLED, false);
    assert.throws(() => assertPortalDocumentUpdateEnabled(), /not enabled/);
  });

  it("refuses in the server handler before any role lookup or query", () => {
    const src = readFileSync("src/lib/portal-document-update.functions.ts", "utf8");
    const handler = src.slice(src.indexOf("handler(async"));
    const assertAt = handler.indexOf("assertPortalDocumentUpdateEnabled");
    const scopeAt = handler.indexOf("portalScope");
    const queryAt = handler.indexOf(".from(");
    assert.ok(assertAt >= 0, "handler asserts the flag");
    assert.ok(scopeAt > assertAt, "flag check precedes portal scope");
    assert.ok(queryAt > assertAt, "flag check precedes queries");
    assert.doesNotMatch(handler, /deleteDocument|setDocumentReview|updateDocumentMeta|resend|twilio/i);
  });

  it("does not mount the card or call the read while the flag is off", () => {
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    assert.match(portal, /enabled: PORTAL_DOCUMENT_UPDATE_ENABLED === true/);
    assert.match(portal, /if \(PORTAL_DOCUMENT_UPDATE_ENABLED !== true\) return null/);
  });
});

describe("portal document upload reuses the vault path", () => {
  it("uses FileUploader, the signed driver-docs upload, and confirm — and does not delete", () => {
    const card = readFileSync("src/components/portal/DocumentUpdateCard.tsx", "utf8");
    assert.match(card, /FileUploader/);
    assert.match(card, /createDocumentUploadUrl/);
    assert.match(card, /confirmDocumentUpload/);
    assert.match(card, /signed\.bucket/);
    assert.match(card, /uploadToSignedUrl/);
    assert.doesNotMatch(card, /type=["']file["']/);
    assert.doesNotMatch(card, /deleteDocument|updateDocumentMeta|setDocumentReview|\.insert\(|\.delete\(/);
    assert.doesNotMatch(card, /resend|twilio|sendSms|sendEmail/i);
    assert.doesNotMatch(card, /review_status/);
  });

  it("confirm still supersedes the previous current row instead of deleting it", () => {
    const src = readFileSync("src/lib/documents.functions.ts", "utf8");
    const start = src.indexOf("export const confirmDocumentUpload");
    const end = src.indexOf("export const updateDocumentMeta");
    const confirm = src.slice(start, end);
    assert.match(confirm, /is_current: true/);
    assert.match(confirm, /is_current: false/);
    assert.match(confirm, /superseded_by/);
    assert.match(confirm, /expires_at: data\.expiresAt \|\| null/);
    assert.match(confirm, /storage_bucket: DOC_BUCKET/);
    assert.doesNotMatch(confirm, /\.delete\(|\.remove\(/);
  });
});
