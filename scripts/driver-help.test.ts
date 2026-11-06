import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DRIVER_HELP_ENABLED,
  DRIVER_HELP_EMAIL,
  DRIVER_HELP_PHONE,
  DRIVER_HELP_TOPICS,
} from "../src/lib/driver-help";

describe("driver help flag", () => {
  it("is off", () => {
    assert.equal(DRIVER_HELP_ENABLED, false);
  });

  it("redirects /portal/help before the page, and the portal link is gated", () => {
    const route = readFileSync("src/routes/portal_.help.tsx", "utf8");
    const guard = route.indexOf("DRIVER_HELP_ENABLED");
    const bounce = route.indexOf("redirect(");
    const component = route.indexOf("component:");
    assert.ok(guard !== -1 && bounce !== -1 && guard < bounce && bounce < component);
    assert.match(route, /to: "\/portal"/);
    assert.doesNotMatch(route, /supabase|useQuery|\.from\(|stripe/);

    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    assert.match(portal, /DRIVER_HELP_ENABLED \? <DriverHelpLink/);
    const ungated = portal
      .split("\n")
      .filter((line) => line.includes("<DriverHelpLink") && !line.includes("DRIVER_HELP_ENABLED"));
    assert.deepEqual(ungated, []);

    const page = readFileSync("src/components/portal/DriverHelp.tsx", "utf8");
    const lib = readFileSync("src/lib/driver-help.ts", "utf8");
    assert.match(page, /to="\/portal\/help"/);
    assert.doesNotMatch(`${page}\n${lib}`, /supabase|useQuery|useServerFn|\.from\(|stripe|\.insert\(|\.update\(|\.delete\(/);
  });
});

describe("driver help copy", () => {
  it("covers the six topics with site wording and no dollar amounts", () => {
    assert.deepEqual(
      DRIVER_HELP_TOPICS.map((topic) => topic.title),
      [
        "How To Pay",
        "When Payment Is Due",
        "If A Payment Fails",
        "Upload Or Replace Documents",
        "Pickup And Return",
        "Who To Contact",
      ],
    );
    const stated = DRIVER_HELP_TOPICS.flatMap((topic) => topic.stated).join("\n");
    assert.match(stated, /Debit, credit, or Cash App/);
    assert.match(stated, /in advance every week/);
    assert.match(stated, /update your card to avoid interruption/i);
    assert.match(stated, /Uploading a new file replaces the old one/);
    assert.match(stated, /Schedule pickup at our lot/);
    assert.match(stated, /Return the vehicle in the same condition/);
    assert.equal(DRIVER_HELP_PHONE, "(888) 833-8280");
    assert.equal(DRIVER_HELP_EMAIL, "team@drivereal.com");
    assert.ok(stated.includes(DRIVER_HELP_PHONE));
    assert.ok(stated.includes(DRIVER_HELP_EMAIL));
    assert.doesNotMatch(stated, /\$/);
  });

  it("leaves only the gaps the repo does not state", () => {
    const todos = Object.fromEntries(DRIVER_HELP_TOPICS.map((topic) => [topic.title, topic.todo]));
    assert.equal(todos["How To Pay"], null);
    assert.equal(todos["Upload Or Replace Documents"], null);
    assert.equal(todos["Who To Contact"], null);
    assert.match(todos["When Payment Is Due"] ?? "", /weekday and time/);
    assert.match(todos["If A Payment Fails"] ?? "", /late-fee amount/);
    assert.match(todos["Pickup And Return"] ?? "", /lot address/);
  });
});
