import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resumeUrl } from "../src/lib/resume-tokens.server";
import { APPLICATION_RESUME_ENABLED, isClosedResumeStatus } from "../src/lib/application-resume-flag";
import {
  OWN_DRAFT_COLUMNS,
  canContinuePromotedApplication,
  continuationApplicationId,
  continueDraft,
  progressFromSnapshot,
  progressFromWizard,
  promotedApplicationLinkAllowed,
  resumeLinkForPromotion,
  resumeLinkForToken,
  snapshotFromOwnRow,
  type ResumeSnapshot,
} from "../src/lib/application-resume";

const flagFile = readFileSync("src/lib/application-resume-flag.ts", "utf8");
const lib = readFileSync("src/lib/application-resume.ts", "utf8");
const client = readFileSync("src/lib/application-resume-client.ts", "utf8");
const banner = readFileSync("src/components/site/ContinueApplicationBanner.tsx", "utf8");
const signedIn = readFileSync("src/components/site/SignedInContinueBanner.tsx", "utf8");
const home = readFileSync("src/routes/index.tsx", "utf8");
const apply = readFileSync("src/routes/apply.tsx", "utf8");
const wizard = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
const panel = readFileSync("src/components/admin/WaitlistPanel.tsx", "utf8");
const portal = readFileSync("src/lib/portal-access.functions.ts", "utf8");
const waitlistFns = readFileSync("src/lib/waitlist.functions.ts", "utf8");

function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSources(path));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

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
  it("is a hard false, declared once, and / and /apply do not load the resume module", () => {
    assert.equal(APPLICATION_RESUME_ENABLED, false);
    assert.equal(flagValue(flagFile), "false");
    const declarations = walkSources("src").filter((path) =>
      /const APPLICATION_RESUME_ENABLED\b/.test(readFileSync(path, "utf8")),
    );
    assert.deepEqual(declarations, ["src/lib/application-resume-flag.ts"]);
    const dead = walkSources("src").filter((path) =>
      readFileSync(path, "utf8").includes("stashedTokenContinuesApplication"),
    );
    assert.deepEqual(dead, []);
    for (const source of [lib, client, home, apply, wizard, panel, portal]) {
      assert.match(source, /from ["']@\/lib\/application-resume-flag["']/);
    }
    for (const source of [home, apply, wizard]) {
      assert.doesNotMatch(source, /from ["']@\/lib\/application-resume["']/);
      assert.doesNotMatch(source, /from ["']@\/lib\/application-resume-client["']/);
      assert.doesNotMatch(source, /from ["']@\/components\/site\/ContinueApplicationBanner["']/);
      const load = source.indexOf('import("@/lib/application-resume');
      assert.ok(load !== -1);
      assert.match(source.slice(0, load), /APPLICATION_RESUME_ENABLED (?:!== true\) return|=== true\))/);
    }
    assert.doesNotMatch(home, /Continue Your Application/);
    assert.doesNotMatch(apply, /Continue Your Application/);
    assert.doesNotMatch(lib, /stashedTokenContinuesApplication/);
    assert.doesNotMatch(client, /stashedTokenContinuesApplication/);
  });

  it("reads the signed-in applicant's own row, and does not write or send", () => {
    const sources = [lib, client, banner];
    for (const source of sources) {
      assert.doesNotMatch(source, /supabaseAdmin|\.or\(`|\.filter\(`|\.insert\(|\.update\(|\.delete\(|sendApplication|sendSms|sms_consent/);
    }
    assert.match(client, /\.from\("applications"\)\s*\.select\(OWN_DRAFT_COLUMNS\)\s*\.eq\("user_id", uid\)/);
    assert.doesNotMatch(client, /select\("\*"\)/);
    assert.doesNotMatch(client, /readResumeToken|getApplicationForWizard|sessionStorage|applications\.functions/);
    assert.match(client, /continueDraft\(snapshotFromOwnRow\([\s\S]*?\), false\)/);
    assert.doesNotMatch(OWN_DRAFT_COLUMNS, /email|phone|policy|notes|stripe|dob|license_number|user_id|score|card_/i);
    assert.match(banner, /Continue Your Application/);
    assert.match(banner, /Step \{progress\.step\} Of \{progress\.total\}/);
    assert.match(banner, /Missing Documents/);
  });

  it("does not continue an application from a token left in the tab", () => {
    assert.match(apply, /allowStashed:\s*false/);
    assert.doesNotMatch(apply, /allowStashed:\s*true/);
    assert.doesNotMatch(apply, /allowStashed:\s*APPLICATION_RESUME_ENABLED/);
    assert.doesNotMatch(client, /readResumeToken|sessionStorage/);
    assert.doesNotMatch(home, /readResumeToken|sessionStorage/);
    assert.doesNotMatch(signedIn, /readResumeToken|sessionStorage/);
  });

  it("gives a signed-in draft on /apply a Continue path through the account", () => {
    assert.match(banner, /onContinue/);
    assert.match(banner, />\s*Continue\s*</);
    const accountContinue = banner.indexOf("onClick={() => void onContinue()}");
    const wizardContinue = banner.indexOf('to="/thank-you"');
    assert.ok(accountContinue !== -1 && wizardContinue !== -1 && accountContinue < wizardContinue);
    assert.doesNotMatch(banner, /These are the answers already saved/);
    assert.match(signedIn, /openMyApplication/);
    assert.match(signedIn, /onContinue=/);
    assert.doesNotMatch(signedIn, /to="\/thank-you"/);
    const slot = apply.indexOf("function SavedApplicationSlot");
    const load = apply.indexOf('import("@/components/site/SignedInContinueBanner")', slot);
    assert.ok(slot !== -1 && load !== -1);
    assert.match(apply.slice(slot, load), /APPLICATION_RESUME_ENABLED !== true\) return/);
    assert.doesNotMatch(apply, /from ["']@\/components\/site\/SignedInContinueBanner["']/);
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
    assert.equal(flagValue(panel), null);
    assert.equal(APPLICATION_RESUME_ENABLED, false);
    assert.doesNotMatch(panel, /from ["']@\/lib\/application-resume["']/);
    assert.doesNotMatch(panel, /sendEmail|sendApplication|sendSms/);
    const load = panel.indexOf('import("@/lib/application-resume")');
    assert.ok(load !== -1);
    assert.match(panel.slice(0, load), /APPLICATION_RESUME_ENABLED === true/);
    assert.match(panel, /Copy Link/);
    assert.match(panel, /This page does not send an email/);
    assert.match(panel, /Resume Link For \{resumeLink\.name\}/);
    const promoteFn = panel.slice(panel.indexOf("async function handlePromote"), panel.indexOf("const statusTone"));
    const cleared = promoteFn.indexOf("setResumeLink(null)");
    const request = promoteFn.indexOf("promote(");
    assert.ok(cleared !== -1 && request !== -1 && cleared < request);
    assert.match(promoteFn, /setResumeLink\(null\);\s*try \{/);
    assert.match(promoteFn, /if \(!res\.ok\) \{\s*setResumeLink\(null\);/);
    assert.match(promoteFn, /catch \(e: any\) \{\s*setResumeLink\(null\);/);
    assert.match(panel, /resumeLink\?\.href && resumeLink\.name/);
    assert.match(promoteFn, /resumeLinkForPromotion\(\{ ok: res\.ok, token: res\.token, name: entry\.full_name \}\)/);
    const token = "abc+def/ghi";
    const named = resumeLinkForPromotion({ ok: true, token, name: "Ada Lovelace" });
    assert.deepEqual(named, { href: resumeUrl(token), name: "Ada Lovelace" });
    assert.equal(resumeLinkForPromotion({ ok: false, token, name: "Ada Lovelace" }), null);
    assert.equal(resumeLinkForPromotion({ ok: false, token: null, name: "Ada Lovelace" }), null);
    assert.equal(resumeLinkForPromotion({ ok: true, token: null, name: "Ada Lovelace" }), null);
    assert.equal(resumeLinkForPromotion({ ok: true, token, name: "  " }), null);
    const promoteStart = waitlistFns.indexOf("export const promoteToApplicant");
    const promoteEnd = waitlistFns.indexOf("export const listWaitlistHolds");
    const promote = waitlistFns.slice(promoteStart, promoteEnd);
    assert.match(promote, /if \(r\.created\) \{[\s\S]*issueResumeToken/);
    assert.doesNotMatch(promote, /sendEmail|sendApplication|sendSms/);
    assert.equal(resumeLinkForToken(token), resumeUrl(token));
    assert.equal(resumeLinkForToken(token).startsWith("https://drivereal.com/thank-you?t="), true);
  });

  it("continues the application promotion already created or linked", () => {
    assert.equal(flagValue(portal), null);
    assert.doesNotMatch(portal, /from ["']@\/lib\/application-resume["']/);
    assert.doesNotMatch(portal, /sendEmail|sendSms/);
    const calls = [...portal.matchAll(/applicationFromPromotion\(/g)];
    assert.equal(calls.length, 2);
    for (const call of calls) {
      if (portal.slice(call.index!, call.index! + 40).includes("admin: any")) continue;
      assert.match(portal.slice(Math.max(0, call.index! - 220), call.index!), /APPLICATION_RESUME_ENABLED === true && !app && verified && email && !review/);
    }
    const reader = portal.slice(portal.indexOf("async function applicationFromPromotion"));
    assert.match(reader, /import\("@\/lib\/application-resume"\)/);
    assert.match(reader, /promotedApplicationLinkAllowed\(list, id, userId\)/);
    assert.match(reader, /\.ilike\("email", exactLike\(email\)\)/);
    assert.doesNotMatch(reader, /promote_waitlist_entry|\.insert\(|\.update\(|\.delete\(|\.or\(`|\.filter\(`|issueResumeToken/);

    const openStart = portal.indexOf("export const openMyApplication");
    const openEnd = portal.indexOf("/** Waitlist leads update");
    const open = portal.slice(openStart, openEnd);
    assert.match(open, /linkVerifiedApplication/);
    const reviewRefuse = open.indexOf('decision === "review"');
    const issue = open.indexOf("issueResumeToken");
    assert.ok(reviewRefuse !== -1 && issue !== -1 && reviewRefuse < issue);
    const closed = open.indexOf("CLOSED_RESUME_STATUSES");
    assert.ok(closed !== -1 && closed < issue);
    assert.match(portal, /CLOSED_RESUME_STATUSES\s*\} from ["']@\/lib\/application-resume-flag["']/);
    assert.doesNotMatch(open, /\["declined", "closed"\]/);
    assert.doesNotMatch(open, /const CLOSED_RESUME_STATUSES/);
    assert.doesNotMatch(open, /applicationFromPromotion/);
    for (const status of ["approved", "active", "suspended", "declined", "closed", "duplicate", "complete"]) {
      assert.equal(isClosedResumeStatus(status), true);
    }
    assert.equal(isClosedResumeStatus("partial"), false);
    assert.equal(isClosedResumeStatus("new"), false);
    assert.equal(isClosedResumeStatus("  Approved "), true);

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

    const other = "22222222-2222-4222-8222-222222222222";
    const user = "user-1";
    assert.equal(promotedApplicationLinkAllowed([{ id: promoted, user_id: null }], promoted, user), true);
    assert.equal(
      promotedApplicationLinkAllowed(
        [
          { id: promoted, user_id: null },
          { id: other, user_id: null },
        ],
        promoted,
        user,
      ),
      false,
    );
    assert.equal(
      promotedApplicationLinkAllowed(
        [
          { id: promoted, user_id: null },
          { id: other, user_id: "someone-else" },
        ],
        promoted,
        user,
      ),
      false,
    );
    assert.equal(promotedApplicationLinkAllowed([{ id: promoted, user_id: "someone-else" }], promoted, user), false);
    assert.equal(promotedApplicationLinkAllowed([{ id: promoted, user_id: user }], promoted, user), false);
    assert.equal(promotedApplicationLinkAllowed([{ id: other, user_id: null }], promoted, user), false);
    assert.equal(promotedApplicationLinkAllowed([], promoted, user), false);
  });
});
