import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  APPLICATION_TIMELINE_ENABLED,
  buildApplicationTimeline,
  identityClear,
} from "../src/lib/application-timeline";

function labels(status: string, over: Partial<Parameters<typeof buildApplicationTimeline>[0]> = {}) {
  return buildApplicationTimeline({
    status,
    hasActiveRental: false,
    licenseOnFile: true,
    insuranceOnFile: true,
    identityClear: true,
    ...over,
  });
}

function byKey(view: ReturnType<typeof buildApplicationTimeline>, key: string) {
  return view.steps.find((s) => s.key === key);
}

describe("application status mapping", () => {
  it("hides the timeline for an approved driver and for a renting driver", () => {
    assert.equal(labels("approved").show, false);
    assert.equal(labels("active").show, false);
    assert.equal(labels("new", { hasActiveRental: true }).show, false);
    assert.equal(labels("reviewing", { hasActiveRental: true }).show, false);
    assert.deepEqual(labels("approved").steps, []);
  });

  it("maps an in-progress application without quoting the stored status", () => {
    const partial = labels("partial", { licenseOnFile: false, insuranceOnFile: false, identityClear: false });
    assert.equal(partial.show, true);
    assert.equal(byKey(partial, "submitted")?.state, "current");
    assert.equal(byKey(partial, "documents")?.state, "upcoming");
    assert.deepEqual(
      partial.missing.map((m) => m.label),
      ["Driver License", "Insurance", "Identity Review"],
    );

    const submitted = labels("new", { licenseOnFile: false, insuranceOnFile: true, identityClear: false });
    assert.equal(byKey(submitted, "submitted")?.label, "Submitted");
    assert.equal(byKey(submitted, "submitted")?.state, "done");
    assert.equal(byKey(submitted, "documents")?.label, "Documents Received");
    assert.equal(byKey(submitted, "documents")?.state, "current");
    assert.equal(byKey(submitted, "decision")?.label, "Needs Info");
    assert.deepEqual(
      submitted.missing.map((m) => m.key),
      ["license", "identity"],
    );

    const review = labels("reviewing");
    assert.equal(byKey(review, "documents")?.state, "done");
    assert.equal(byKey(review, "review")?.label, "Under Review");
    assert.equal(byKey(review, "review")?.state, "current");
    assert.equal(byKey(review, "decision")?.label, "Approved");
    assert.equal(byKey(review, "decision")?.state, "upcoming");
    assert.deepEqual(review.missing, []);
  });

  it("does not repeat internal statuses or check results", () => {
    assert.equal(identityClear("passed", "passed"), true);
    assert.equal(identityClear("pending", "passed"), false);
    assert.equal(identityClear("passed", "failed"), false);

    const declined = labels("declined", { identityClear: false });
    const text = JSON.stringify(declined);
    assert.equal(declined.show, true);
    assert.equal(byKey(declined, "decision")?.label, "Needs Info");
    assert.equal(byKey(declined, "decision")?.state, "current");
    assert.equal(/declined|failed|pending|suspended|duplicate|notes/i.test(text), false);
  });
});

describe("the timeline stays off", () => {
  it("is a false constant, and the read is gated before any query", () => {
    assert.equal(APPLICATION_TIMELINE_ENABLED, false);
    const fn = readFileSync(new URL("../src/lib/application-timeline.functions.ts", import.meta.url), "utf8");
    const portal = readFileSync(new URL("../src/routes/portal.tsx", import.meta.url), "utf8");
    const home = readFileSync(new URL("../src/components/portal/ApplicantHome.tsx", import.meta.url), "utf8");
    const gate = fn.indexOf("APPLICATION_TIMELINE_ENABLED");
    const query = fn.indexOf('.from("');
    assert.ok(gate !== -1 && query !== -1 && gate < query);
    assert.match(fn, /\.eq\("user_id", userId\)/);
    assert.match(fn, /\.eq\("driver_id", userId\)/);
    assert.equal(/sendEmail\(|sendSms\(|review_note|doc_request_note|\.notes/.test(fn), false);
    assert.match(portal, /APPLICATION_TIMELINE_ENABLED && !rental && applicationStatus !== "approved" && applicationStatus !== "active"/);
    assert.match(home, /APPLICATION_TIMELINE_ENABLED && data\.stage === "applicant"/);
  });
});
