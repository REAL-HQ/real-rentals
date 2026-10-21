import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  APPLY_PROFILE_ITEMS,
  APPLY_PROGRESS_ENABLED,
  APPLY_PROGRESS_STEPS,
  applyProgressView,
  minutesLeft,
} from "../src/lib/apply-progress";

const wizard = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
const apply = readFileSync("src/routes/apply.tsx", "utf8");
const panel = readFileSync("src/components/site/ApplyProgress.tsx", "utf8");
const lib = readFileSync("src/lib/apply-progress.ts", "utf8");

function flagValue(source: string): string | null {
  const match = source.match(/const APPLY_PROGRESS_ENABLED: boolean = (false|true)/);
  return match?.[1] ?? null;
}

describe("apply progress flag", () => {
  it("is a hard false in the lib and on the module /apply already loads", () => {
    assert.equal(APPLY_PROGRESS_ENABLED, false);
    assert.equal(flagValue(lib), "false");
    assert.equal(flagValue(wizard), "false");
    assert.equal(flagValue(lib), flagValue(wizard));
  });

  it("does not load the panel while the flag is off", () => {
    const slot = wizard.slice(wizard.indexOf("function ApplyProgressSlot"));
    const gate = slot.indexOf("APPLY_PROGRESS_ENABLED !== true");
    const load = slot.indexOf('import("@/components/site/ApplyProgress")');
    assert.ok(gate !== -1 && load !== -1 && gate < load);
    assert.doesNotMatch(apply, /from "@\/lib\/apply-progress"|from "@\/components\/site\/ApplyProgress"/);
    assert.doesNotMatch(wizard, /from "@\/lib\/apply-progress"|from "@\/components\/site\/ApplyProgress"/);
    assert.match(apply, /<ApplyProgressSlot stepKey="your_info" showNeeded \/>/);
    assert.match(wizard, /<ApplyProgressSlot/);
  });

  it("adds no query, write, or interpolated filter", () => {
    for (const source of [lib, panel]) {
      assert.doesNotMatch(source, /\.from\(|supabase|fetch\(|\.insert\(|\.update\(|\.delete\(|\.or\(`|\.filter\(`/);
    }
    assert.equal(apply.split('.from("').length - 1, 1);
    assert.match(apply, /\.from\("sites"\)/);
    assert.match(apply, /savePartialApplication/);
    assert.match(apply, /full_name/);
    assert.match(apply, /sms_consent/);
    assert.match(apply, /SmsConsentField/);
  });
});

describe("apply progress steps", () => {
  it("follows the five existing steps and the documents the profile already asks for", () => {
    assert.deepEqual(
      APPLY_PROGRESS_STEPS.map((step) => step.label),
      ["Your Info", "Rental", "Driving", "Documents", "Profile"],
    );
    assert.equal(applyProgressView("your_info")?.heading, "Step 1 Of 5: Your Info");
    assert.equal(applyProgressView("rental")?.heading, "Step 2 Of 5: Rental");
    assert.equal(applyProgressView("driving")?.heading, "Step 3 Of 5: Driving");
    assert.equal(applyProgressView("documents")?.heading, "Step 4 Of 5: Documents");
    assert.equal(applyProgressView("profile_complete")?.heading, "Step 5 Of 5: Profile");
    assert.equal(applyProgressView("submitted")?.heading, "Step 3 Of 5: Driving");
    assert.equal(applyProgressView("unknown"), null);

    assert.equal(minutesLeft("your_info"), 2);
    assert.equal(minutesLeft("rental"), 1);
    assert.equal(minutesLeft("driving"), 1);
    assert.equal(minutesLeft("documents"), null);
    assert.equal(applyProgressView("your_info")?.timeLabel, "About 2 Minutes Left");
    assert.equal(applyProgressView("rental")?.timeLabel, "About 1 Minute Left");
    assert.equal(applyProgressView("driving")?.timeLabel, "About 1 Minute Left");
    assert.equal(applyProgressView("submitted")?.timeLabel, "2 Steps Left");
    assert.equal(applyProgressView("documents")?.timeLabel, "1 Step Left");
    assert.equal(applyProgressView("profile_complete")?.timeLabel, null);

    for (const item of APPLY_PROFILE_ITEMS) {
      assert.ok(wizard.includes(item.title), item.title);
      assert.ok(wizard.includes(item.blurb), item.blurb);
    }
    assert.match(panel, /What You'll Need/);
    assert.match(panel, /sticky top-0/);
    assert.match(panel, /min-h-11/);
    assert.doesNotMatch(panel, /uppercase|sticky bottom-0/);
  });

  it("leaves the sticky Continue bar and the contact step in place", () => {
    assert.match(
      wizard,
      /className="mt-6 sticky bottom-0 -mx-5 md:mx-0 md:static border-t border-border md:border-0 bg-white\/95 backdrop-blur md:bg-transparent md:backdrop-blur-none px-5 md:px-0 pt-3 md:pt-0 flex items-center justify-between gap-3"/,
    );
    assert.match(apply, /Step 1 Of 3/);
    assert.match(apply, /No documents needed\./);
    assert.match(wizard, /Quick Application · Step 1 Of 2/);
    assert.match(wizard, /Quick Application · Step 2 Of 2/);
  });
});
