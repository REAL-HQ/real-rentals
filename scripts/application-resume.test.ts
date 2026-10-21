import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resumeUrl } from "../src/lib/resume-tokens.server";
import {
  APPLICATION_RESUME_ENABLED,
  OWN_DRAFT_COLUMNS,
  canContinuePromotedApplication,
  continuationApplicationId,
  continueDraft,
  progressFromSnapshot,
  progressFromWizard,
  resumeLinkForToken,
  snapshotFromOwnRow,
  type ResumeSnapshot,
} from "../src/lib/application-resume";

const lib = readFileSync("src/lib/application-resume.ts", "utf8");
const client = readFileSync("src/lib/application-resume-client.ts", "utf8");
const banner = readFileSync("src/components/site/ContinueApplicationBanner.tsx", "utf8");
const home = readFileSync("src/routes/index.tsx", "utf8");
const apply = readFileSync("src/routes/apply.tsx", "utf8");
const wizard = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
const panel = readFileSync("src/components/admin/WaitlistPanel.tsx", "utf8");
const portal = readFileSync("src/lib/portal-access.functions.ts", "utf8");
const waitlistFns = readFileSync("src/lib/waitlist.functions.ts", "utf8");

function flagValue(source: string): string | null {
  const match = source.match(/const APPLICATION_RESUME_ENABLED: boolean = (false|true)/);
  return match?.[1] ?? null;
}

const filled: ResumeSnapshot = {
  status: "partial",
  deleted: false,
  fullName: "Ada Lovelace",
  vehicleSize: "SUV",
  pickupDate: "2026-11-02",
  expectedDuration: "2_months",
  city: "Atlanta",
  state: "GA",
  platforms: ["Uber"],
  gigStatus: "Yes, already driving",
  driveType: "full_time",
  insuranceAnswer: "yes",
  licenseValid: true,
  licenseOnFile: true,
  insuranceOnFile: true,
  profileOnFile: true,
  tripCount: 1,
  address: "1 Peachtree St",
  zip: "30303",
};

describe("application resume flag", () => {
  it("is a hard false, and / and /apply do not load the module", () => {
    assert.equal(APPLICATION_RESUME_ENABLED, false);
    for (const source of [lib, home, apply, wizard]) {
      assert.equal(flagValue(source), "false");
    }
    for (const source of [home, apply, wizard]) {
      assert.doesNotMatch(source, /from ["']@\/lib\/application-resume/);
      assert.doesNotMatch(source, /from ["']@\/lib\/application-resume-client/);
      assert.doesNotMatch(source, /from ["']@\/components\/site\/ContinueApplicationBanner/);
      const load = source.indexOf('import("@/lib/application-resume');
      assert.ok(load !== -1);
      assert.match(source.slice(0, load), /APPLICATION_RESUME_ENABLED (?:!== true\) return|=== true\))/);
    }
    assert.doesNotMatch(home, /Continue Your Application/);
    assert.doesNotMatch(apply, /Continue Your Application/);
  });

  it("reads with the applicant session or the existing wizard endpoint, and does not write or send", () => {
    const sources = [lib, client, banner];
    for (const source of sources) {
      assert.doesNotMatch(source, /supabaseAdmin|\.or\(`|\.filter\(`|\.insert\(|\.update\(|\.delete\(|sendApplication|sendSms|sms_consent/);
    }
    assert.match(client, /\.from\("applications"\)\s*\.select\(OWN_DRAFT_COLUMNS\)\s*\.eq\("user_id", uid\)/);
    assert.doesNotMatch(client, /select\("\*"\)/);
    const tokenGate = client.indexOf("if (!token) return null;");
    const wizardLoad = client.indexOf('import("@/lib/applications.functions")');
    assert.ok(tokenGate !== -1 && wizardLoad !== -1 && tokenGate < wizardLoad);
    assert.doesNotMatch(client, /from ["']@\/lib\/applications\.functions["']/);
    assert.doesNotMatch(OWN_DRAFT_COLUMNS, /email|phone|policy|notes|stripe|dob|license_number|user_id|score|card_/i);
    assert.match(banner, /Continue Your Application/);
    assert.match(banner, /Step \{progress\.step\} Of \{progress\.total\}/);
    assert.match(banner, /Missing Documents/);
  });
});

describe("application resume progress", () => {
  it("lands on the first incomplete step and lists missing documents", () => {
    const started = progressFromSnapshot({ ...filled, vehicleSize: null, licenseOnFile: false, tripCount: 0 });
    assert.equal(started.step, 2);
    assert.equal(started.total, 4);
    assert.equal(started.label, "Rental");
    assert.equal(started.phase, "rental");
    assert.deepEqual(started.missingDocuments, ["Driver's Licence", "Trip History"]);

    const driving = progressFromSnapshot({ ...filled, gigStatus: null, insuranceOnFile: false, address: null });
    assert.equal(driving.label, "Driving");
    assert.equal(driving.phase, "driving");
    assert.deepEqual(driving.missingDocuments, ["Insurance", "Your Address"]);

    const docs = progressFromSnapshot({ ...filled, licenseValid: null, profileOnFile: false });
    assert.equal(docs.step, 4);
    assert.equal(docs.phase, "documents");
    assert.deepEqual(docs.missingDocuments, ["Driver's Licence", "Gig Profile"]);

    const done = progressFromSnapshot(filled);
    assert.equal(done.complete, true);
    assert.equal(done.phase, null);
  });

  it("drops storage paths and skips a closed application", () => {
    const path = "11111111-1111-1111-1111-111111111111/license-secret.jpg";
    const snapshot = snapshotFromOwnRow({
      status: "partial",
      full_name: "Ada Lovelace",
      vehicle_size: "XL",
      license_photo_url: path,
      trip_screenshots: [`folder/${path}`],
      insurance_policy_number: "SHOULD-NOT-BE-READ",
    });
    assert.equal(snapshot.licenseOnFile, true);
    assert.equal(snapshot.tripCount, 1);
    assert.equal(snapshot.vehicleSize, "XL");
    assert.equal(JSON.stringify(snapshot).includes("license-secret"), false);
    assert.equal(JSON.stringify(snapshot).includes("SHOULD-NOT-BE-READ"), false);

    const draft = continueDraft(snapshot, false);
    assert.ok(draft);
    assert.equal(draft.canOpenWizard, false);
    assert.equal(draft.answers.some((answer) => answer.value === "Minivan"), true);
    assert.equal(JSON.stringify(draft).includes(path), false);

    assert.equal(continueDraft({ ...filled, status: "approved" }, true), null);
    assert.equal(continueDraft({ ...filled, status: "declined" }, true), null);
    assert.equal(continueDraft({ ...filled, deleted: true }, true), null);
    assert.equal(continueDraft(filled, true), null);
  });

  it("uses the wizard payload, which is presence flags rather than paths", () => {
    const progress = progressFromWizard({
      full_name: "Ada",
      vehicle_size: "Sedan",
      pickup_date: "2026-11-02",
      expected_duration: "1_month",
      gig_status: null,
      drive_type: null,
      insurance_answer: null,
      license_photo_on_file: false,
      trip_screenshot_names: [],
    });
    assert.equal(progress.phase, "driving");
    assert.equal(progress.step, 3);
    assert.ok(progress.missingDocuments.includes("Driver's Licence"));
  });
});

describe("waitlist promotion resume", () => {
  it("shows the minted link in admin and does not email it", () => {
    assert.equal(flagValue(panel), "false");
    assert.equal(APPLICATION_RESUME_ENABLED, false);
    assert.doesNotMatch(panel, /from ["']@\/lib\/application-resume/);
    assert.doesNotMatch(panel, /sendEmail|sendApplication|sendSms/);
    const load = panel.indexOf('import("@/lib/application-resume")');
    assert.ok(load !== -1);
    assert.match(panel.slice(0, load), /APPLICATION_RESUME_ENABLED === true/);
    assert.match(panel, /Copy Link/);
    assert.match(panel, /This page does not send an email/);
    const promoteStart = waitlistFns.indexOf("export const promoteToApplicant");
    const promoteEnd = waitlistFns.indexOf("export const listWaitlistHolds");
    const promote = waitlistFns.slice(promoteStart, promoteEnd);
    assert.match(promote, /if \(r\.created\) \{[\s\S]*issueResumeToken/);
    assert.doesNotMatch(promote, /sendEmail|sendApplication|sendSms/);
    const token = "abc+def/ghi";
    assert.equal(resumeLinkForToken(token), resumeUrl(token));
    assert.equal(resumeLinkForToken(token).startsWith("https://drivereal.com/thank-you?t="), true);
  });

  it("continues the application promotion already created or linked", () => {
    assert.equal(flagValue(portal), "false");
    assert.doesNotMatch(portal, /from ["']@\/lib\/application-resume["']/);
    assert.doesNotMatch(portal, /sendEmail|sendSms/);
    const calls = [...portal.matchAll(/applicationFromPromotion\(/g)];
    assert.equal(calls.length, 3);
    for (const call of calls) {
      if (portal.slice(call.index!, call.index! + 40).includes("admin: any")) continue;
      assert.match(portal.slice(Math.max(0, call.index! - 180), call.index!), /APPLICATION_RESUME_ENABLED === true/);
    }
    const reader = portal.slice(portal.indexOf("async function applicationFromPromotion"));
    assert.match(reader, /import\("@\/lib\/application-resume"\)/);
    assert.match(reader, /\.eq\("id", id\)/);
    assert.doesNotMatch(reader, /promote_waitlist_entry|\.insert\(|\.update\(|\.delete\(|\.or\(`|\.filter\(`/);

    const promoted = "11111111-1111-4111-8111-111111111111";
    assert.equal(
      continuationApplicationId([
        { promoted_application_id: null },
        { promoted_application_id: promoted },
      ]),
      promoted,
    );
    assert.equal(continuationApplicationId([{ promoted_application_id: null }]), null);
    const app = { email: "Ada@Example.com", deleted_at: null, user_id: null };
    assert.equal(canContinuePromotedApplication(app, "ada@example.com", "user-1"), true);
    assert.equal(canContinuePromotedApplication(app, "other@example.com", "user-1"), false);
    assert.equal(canContinuePromotedApplication({ ...app, deleted_at: "2026-01-01" }, "ada@example.com", "user-1"), false);
    assert.equal(canContinuePromotedApplication({ ...app, user_id: "someone-else" }, "ada@example.com", "user-1"), false);
    assert.equal(canContinuePromotedApplication({ ...app, user_id: "user-1" }, "ada@example.com", "user-1"), true);
  });
});
