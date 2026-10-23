import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentExpiryTone } from "../src/lib/document-expiry";
import { quickReviewDocumentLink, vaultSignedUrlState } from "../src/lib/vault-signed-url";
import {
  APPLICATION_QUICK_REVIEW_ENABLED,
  assertApplicationQuickReviewEnabled,
  applicationQuickReview,
  isPendingReviewStatus,
  type QuickReviewAgreement,
  type QuickReviewDocumentRow,
  type QuickReviewIdentityRow,
} from "../src/lib/application-quick-review";

const NOW = Date.parse("2026-10-21T00:00:00Z");
const DAY = 86400000;

const base = {
  status: "reviewing" as string | null,
  deletedAt: null as string | null,
  email: "ada@example.com",
  phone: "5550101234",
  address: "1 Main St",
  city: "Atlanta",
  state: "GA",
  zip: "30301",
  dob: "1990-04-02",
  licenseNumber: "D123",
  licenseState: "GA",
  licenseExpiration: "2028-01-15",
  yearsLicensed: 6,
  platforms: ["Uber"],
  weeklyHours: 40,
  weeklyRent: null as number | null,
  driveType: "full_time",
  expectedDuration: "3_months",
  cardLast4: null as string | null,
  licensePhotoUrl: null as string | null,
  insuranceDocUrl: null as string | null,
  profileScreenshotUrl: null as string | null,
  interviewCompletedAt: "2026-10-01T00:00:00Z",
  insuranceVerified: true,
  mvrAuthorized: true,
  documents: [] as QuickReviewDocumentRow[],
  agreements: [] as QuickReviewAgreement[],
  identity: [] as QuickReviewIdentityRow[] | null,
  now: NOW,
};

function doc(partial: Partial<QuickReviewDocumentRow> & Pick<QuickReviewDocumentRow, "id" | "category">): QuickReviewDocumentRow {
  return {
    label: null,
    fileName: "file.jpg",
    mimeType: "image/jpeg",
    expiresAt: null,
    isCurrent: true,
    reviewStatus: "uploaded",
    createdAt: "2026-10-01T00:00:00Z",
    ...partial,
  };
}

describe("document expiry tone", () => {
  it("matches the vault: expired before today, soon under 30 days, quiet at 30", () => {
    assert.equal(documentExpiryTone(null, NOW), null);
    assert.equal(documentExpiryTone(new Date(NOW - DAY).toISOString(), NOW), "expired");
    assert.equal(documentExpiryTone(new Date(NOW + 29 * DAY).toISOString(), NOW), "soon");
    assert.equal(documentExpiryTone(new Date(NOW + 30 * DAY).toISOString(), NOW), null);
  });
});

describe("application quick review", () => {
  it("shows only an application still awaiting an approval decision", () => {
    for (const status of ["partial", "new", "complete", "reviewing"]) {
      assert.equal(isPendingReviewStatus(status), true);
      assert.equal(applicationQuickReview({ ...base, status }).show, true);
    }
    for (const status of ["approved", "active", "declined", "closed", "suspended", "duplicate"]) {
      assert.equal(applicationQuickReview({ ...base, status }).show, false);
      assert.deepEqual(applicationQuickReview({ ...base, status }).missing, []);
    }
    assert.equal(applicationQuickReview({ ...base, deletedAt: "2026-10-01T00:00:00Z" }).show, false);
  });

  it("uses existing field labels and omits a weekly rate that was not recorded", () => {
    const review = applicationQuickReview(base);
    assert.equal(review.fields.find((field) => field.label === "Phone")?.value, "555-010-1234");
    assert.equal(review.fields.find((field) => field.label === "Email")?.value, "ada@example.com");
    assert.equal(review.fields.find((field) => field.label === "DOB")?.value, "Apr 2, 1990");
    assert.equal(review.fields.find((field) => field.label === "License #")?.value, "D123");
    assert.equal(review.fields.find((field) => field.label === "Drive Type")?.value, "Full-Time");
    assert.equal(review.fields.find((field) => field.label === "Expected Duration")?.value, "3 months");
    assert.equal(review.fields.some((field) => field.label === "Weekly Rate"), false);
    assert.equal(review.fields.some((field) => field.value.includes("350")), false);

    const priced = applicationQuickReview({ ...base, weeklyRent: 350, cardLast4: "4242" });
    assert.equal(priced.fields.find((field) => field.label === "Weekly Rate")?.value, "$350");
    assert.equal(priced.fields.find((field) => field.label === "Card On File")?.value, "····4242");
    assert.equal(priced.missing.some((item) => item.id === "card"), false);
  });

  it("lists missing required documents, an expired one, and a rejected one with the existing words", () => {
    const review = applicationQuickReview({
      ...base,
      documents: [
        doc({ id: "lic", category: "license_front", expiresAt: new Date(NOW - DAY).toISOString() }),
        doc({ id: "ins", category: "insurance", reviewStatus: "rejected" }),
      ],
    });
    assert.deepEqual(
      review.documents.map((item) => [item.label, item.expiryLabel]),
      [
        ["Driver's license (front)", "Expired"],
        ["Insurance card", null],
      ],
    );
    assert.deepEqual(
      review.missing.filter((item) => ["license_front", "license_back", "insurance", "gig_profile"].includes(item.id)).map((item) => [item.label, item.detail]),
      [
        ["Driver's license (front)", "Expired"],
        ["Driver's license (back)", "Not Received"],
        ["Insurance card", "Needs Replacement"],
        ["Gig profile screenshot", "Not Received"],
      ],
    );
  });

  it("treats an application file and a document 30 days out as received", () => {
    const missing = applicationQuickReview({
      ...base,
      licensePhotoUrl: "apps/license.jpg",
      insuranceDocUrl: "apps/insurance.pdf",
      profileScreenshotUrl: "apps/gig.png",
      cardLast4: "4242",
      documents: [doc({ id: "back", category: "license_back", expiresAt: new Date(NOW + 30 * DAY).toISOString() })],
    }).missing;
    assert.deepEqual(missing, []);
  });

  it("hides the recording category and does not link an application file path", () => {
    const review = applicationQuickReview({
      ...base,
      documents: [doc({ id: "rec", category: "verification_recording", fileName: "call.mp3", mimeType: "audio/mpeg" })],
    });
    assert.equal(review.documents.some((item) => item.id === "rec"), false);
    assert.equal(JSON.stringify(review).includes("apps/"), false);
  });

  it("shows identity only when the review rows were readable", () => {
    const unread = applicationQuickReview({ ...base, identity: null, cardLast4: "4242" });
    assert.equal(unread.identity, null);
    assert.equal(unread.missing.some((item) => item.id === "identity"), false);

    const open = applicationQuickReview({
      ...base,
      cardLast4: "4242",
      identity: [{
        status: "open",
        resolution: null,
        createdAt: "2026-10-02T15:00:00Z",
        submittedFullName: "Ada Lovelace",
        submittedEmail: "other@example.com",
        submittedPhone: "5550109999",
      }],
    });
    assert.equal(open.identity?.label, "Identity Review Needed");
    assert.match(open.identity?.detail ?? "", /Same phone submitted with a different email/);
    assert.match(open.identity?.submitted ?? "", /Ada Lovelace/);
    assert.equal(open.missing.some((item) => item.label === "Identity Review Needed"), true);

    const resolved = applicationQuickReview({
      ...base,
      cardLast4: "4242",
      identity: [{
        status: "resolved",
        resolution: "same_person",
        createdAt: "2026-10-02T15:00:00Z",
        submittedFullName: null,
        submittedEmail: null,
        submittedPhone: null,
      }],
    });
    assert.equal(resolved.identity?.label, "Identity Review Resolved");
    assert.equal(resolved.identity?.detail, "Same Person");
    assert.equal(resolved.missing.some((item) => item.id === "identity"), false);
  });

  it("reports esign with the agreement card's sentences", () => {
    assert.equal(applicationQuickReview({ ...base }).esign?.label, "Rental Agreement");
    assert.equal(applicationQuickReview({ ...base }).esign?.detail, "No agreement sent yet.");
    const signed = applicationQuickReview({
      ...base,
      agreements: [{ status: "signed", signedAt: "2026-10-11T15:00:00Z", sentAt: "2026-10-10T15:00:00Z", createdAt: "2026-10-10T15:00:00Z", signerName: null }],
    });
    assert.match(signed.esign?.detail ?? "", /^Signed by renter/);
  });

  it("names the pre-approval checks that are not done", () => {
    const missing = applicationQuickReview({
      ...base,
      interviewCompletedAt: null,
      insuranceVerified: false,
      mvrAuthorized: false,
      licensePhotoUrl: "apps/license.jpg",
      insuranceDocUrl: "apps/insurance.pdf",
      profileScreenshotUrl: "apps/gig.png",
      documents: [doc({ id: "back", category: "license_back", expiresAt: new Date(NOW + 90 * DAY).toISOString() })],
    }).missing.map((item) => item.label);
    assert.deepEqual(missing, ["Interview Complete", "Insurance Verified", "MVR Authorized", "Card On File"]);
  });
});

function signedUrl(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url");
  return `https://example.supabase.co/storage/v1/object/sign/driver-docs/a.jpg?token=hdr.${payload}.sig`;
}

describe("vault signed url", () => {
  it("treats a token exp in the past as expired and a future exp as usable", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    assert.equal(vaultSignedUrlState(signedUrl(Math.floor(now / 1000) - 5), now), "expired");
    assert.equal(vaultSignedUrlState(signedUrl(Math.floor(now / 1000) + 60), now), "usable");
    assert.equal(vaultSignedUrlState("https://example.supabase.co/object/sign/a.jpg?token=opaque", now), "unknown");
    assert.equal(vaultSignedUrlState(null, now), "unknown");
  });

  it("refreshes an expired link once, then asks Documents instead of opening it", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const expired = signedUrl(Math.floor(now / 1000) - 5);
    const live = signedUrl(Math.floor(now / 1000) + 60);
    assert.equal(quickReviewDocumentLink({ url: live, refreshState: "idle", now }).href, live);
    assert.equal(quickReviewDocumentLink({ url: expired, refreshState: "idle", now }).shouldRefresh, true);
    assert.equal(quickReviewDocumentLink({ url: expired, refreshState: "idle", now }).showExpired, false);
    const after = quickReviewDocumentLink({ url: expired, refreshState: "done", now });
    assert.equal(after.href, null);
    assert.equal(after.showExpired, true);
    assert.equal(after.shouldRefresh, false);
    assert.equal(quickReviewDocumentLink({ url: null, refreshState: "done", now }).showExpired, false);
  });
});

describe("application quick review flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(APPLICATION_QUICK_REVIEW_ENABLED, false);
    assert.throws(() => assertApplicationQuickReviewEnabled(), /not enabled/);
  });

  it("refuses in the server handler before the role check and before any query", () => {
    const src = readFileSync("src/lib/application-quick-review.functions.ts", "utf8");
    const handler = src.slice(src.indexOf("handler(async"));
    const assertAt = handler.indexOf("assertApplicationQuickReviewEnabled");
    const roleAt = handler.indexOf("requireManager");
    const queryAt = handler.indexOf(".from(");
    assert.ok(assertAt >= 0 && roleAt > assertAt && queryAt > roleAt);
    assert.match(handler, /context\.supabase/);
    assert.match(handler, /identityQ\.error/);
    assert.doesNotMatch(src, /supabaseAdmin|createSignedUrl|getPublicUrl|stripe|resend|twilio|storage_path|\.insert\(|\.update\(|\.delete\(/);
  });

  it("does not mount the panel while the flag is off", () => {
    const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    assert.match(panel, /APPLICATION_QUICK_REVIEW_ENABLED && isManager && isPendingReviewStatus\(driver\.status\) \? \([\s\S]*<ApplicationQuickReview[\s>]/);
    assert.doesNotMatch(panel.slice(panel.indexOf("function approveAndSend"), panel.indexOf("function approveAndSend") + 800), /ApplicationQuickReview|getApplicationQuickReview/);
  });

  it("links documents only through the vault url the drawer already loaded", () => {
    const card = readFileSync("src/components/admin/ApplicationQuickReview.tsx", "utf8");
    assert.match(card, /Application Quick Review/);
    assert.match(card, /Still Needed/);
    assert.match(card, /documents\.find\(\(item\) => item\.id === doc\.id\)\?\.url/);
    assert.match(card, /Link expired, open in Documents/);
    assert.match(card, /onRefreshDocuments/);
    assert.doesNotMatch(card, /createSignedUrl|getPublicUrl|license_photo_url|stripe|approveApplication|supabaseAdmin/);
    const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    assert.match(panel, /onRefreshDocuments=\{refreshVault\}/);
    assert.match(panel, /onOpenDocuments=\{\(\) => setTab\("documents"\)\}/);
  });

  it("reads document expiry through the vault helper", () => {
    const vault = readFileSync("src/components/admin/DocumentVault.tsx", "utf8");
    assert.match(vault, /documentExpiryTone\(d\.expires_at\)/);
    assert.doesNotMatch(vault, /86400000/);
    const review = readFileSync("src/lib/application-quick-review.ts", "utf8");
    assert.match(review, /documentExpiryTone\(/);
  });
});
