import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  APPLICATION_STATUS_TRACKER_ENABLED,
  TRACKER_OMITTED,
  assertApplicationStatusTrackerEnabled,
  buildApplicationStatus,
  formatTrackerDate,
  isApprovedStatus,
  type TrackerApplication,
  type TrackerDocument,
} from "../src/lib/application-status-tracker";

function app(partial: Partial<TrackerApplication> = {}): TrackerApplication {
  return { status: "new", reviewed_at: null, waitlist_signed_up_at: null, ...partial };
}

function doc(category: string, created_at: string | null = "2026-10-01T16:00:00.000Z"): TrackerDocument {
  return { category, created_at, is_current: true };
}

const ALL = [
  doc("license_front", "2026-10-01T16:00:00.000Z"),
  doc("license_back", "2026-10-02T16:00:00.000Z"),
  doc("insurance", "2026-10-03T16:00:00.000Z"),
  doc("gig_profile", "2026-10-04T16:00:00.000Z"),
];

describe("application status tracker flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(APPLICATION_STATUS_TRACKER_ENABLED, false);
    assert.throws(() => assertApplicationStatusTrackerEnabled(), /Application status tracker is not enabled/);
  });

  it("throws in the handler before any role or table read, and the card stays unmounted", () => {
    const source = readFileSync("src/lib/application-status-tracker.functions.ts", "utf8");
    const handler = source.slice(source.indexOf(".handler("));
    const guard = handler.indexOf("assertApplicationStatusTrackerEnabled()");
    const read = handler.indexOf('.from("');
    assert.ok(guard !== -1 && read !== -1 && guard < read);
    assert.doesNotMatch(source, /supabaseAdmin|stripe|user_roles|application_identity_reviews|review_note|\.insert\(|\.update\(|\.delete\(/);
    assert.doesNotMatch(source, /select\("[^"]*notes/);
    assert.match(source, /context\.supabase/);
    const home = readFileSync("src/components/portal/ApplicantHome.tsx", "utf8");
    assert.match(home, /APPLICATION_STATUS_TRACKER_ENABLED \? <ApplicationStatusGate/);
    assert.match(home, /function ApplicationStatusGate/);
    assert.match(home, /useServerFn\(getApplicationStatus\)/);
    const card = readFileSync("src/components/portal/ApplicationStatusTracker.tsx", "utf8");
    assert.doesNotMatch(card, /stripe|supabaseAdmin|\.from\(/);
    assert.match(readFileSync("src/routes/apply.tsx", "utf8"), /createFileRoute\("\/apply"\)/);
    assert.equal(readFileSync("src/routeTree.gen.ts", "utf8").includes("'/documents'"), false);
  });
});

describe("application status tracker", () => {
  it("formats a timestamp in Eastern Time", () => {
    assert.equal(formatTrackerDate("2026-10-21T03:30:00.000Z"), "Oct 20, 2026");
    assert.equal(formatTrackerDate(null), null);
  });

  it("hides the tracker once the applicant is approved", () => {
    assert.equal(isApprovedStatus("approved"), true);
    assert.equal(isApprovedStatus("active"), true);
    assert.equal(isApprovedStatus("reviewing"), false);
    assert.equal(isApprovedStatus("declined"), false);
  });

  it("lists a submitted application, names missing documents, and leaves the decision open", () => {
    const view = buildApplicationStatus(app(), [doc("license_front"), doc("insurance", null)]);
    assert.equal(view.steps[0]?.title, "Application Submitted");
    assert.equal(view.steps[0]?.state, "done");
    assert.equal(view.steps[0]?.date, null);
    assert.equal(view.steps[1]?.state, "current");
    assert.deepEqual(view.stillMissing, ["Driver's License (Back)", "Gig Profile Screenshot"]);
    assert.equal(view.steps[2]?.state, "waiting");
    assert.equal(view.steps[3]?.title, "Approved, Declined, Or Waitlisted");
    assert.equal(view.steps[3]?.state, "waiting");
    assert.equal(view.applyHref, "/apply");
    assert.equal(view.documentsHref, null);
    assert.ok(view.missing.includes("Submitted Date"));
    assert.ok(view.missing.includes("Insurance Card Date"));
    assert.ok(view.missing.includes("Documents Link"));
    assert.ok(view.missing.includes("Resume Link"));
    assert.deepEqual(view.omitted, [...TRACKER_OMITTED]);
  });

  it("does not invent a document list when the documents read failed", () => {
    const view = buildApplicationStatus(app({ status: "partial" }), null);
    assert.equal(view.steps[0]?.state, "current");
    assert.deepEqual(view.received, []);
    assert.deepEqual(view.stillMissing, []);
    assert.ok(view.missing.includes("Documents"));
    assert.equal(view.steps[1]?.detail, null);
  });

  it("dates review in Eastern Time and names a declined application without a decision date", () => {
    const view = buildApplicationStatus(
      app({ status: "declined", reviewed_at: "2026-10-21T03:30:00.000Z" }),
      ALL,
    );
    assert.equal(view.steps[1]?.state, "done");
    assert.equal(view.steps[1]?.date, "Oct 4, 2026");
    assert.equal(view.steps[2]?.date, "Oct 20, 2026");
    assert.equal(view.steps[2]?.state, "done");
    assert.equal(view.steps[3]?.title, "Declined");
    assert.equal(view.steps[3]?.date, null);
    assert.ok(view.missing.includes("Declined Date"));
    assert.equal(view.missing.includes("Under Review Date"), false);
  });

  it("shows a waitlist date and still omits position", () => {
    const view = buildApplicationStatus(
      app({ status: "new", waitlist_signed_up_at: "2026-09-01T15:00:00.000Z" }),
      ALL,
      { applyRouteLive: false },
    );
    assert.equal(view.steps[3]?.title, "Waitlisted");
    assert.equal(view.steps[3]?.date, "Sep 1, 2026");
    assert.ok(view.omitted.includes("Waitlist Position"));
    assert.equal(view.applyHref, null);
  });
});
