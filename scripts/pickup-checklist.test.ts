import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PICKUP_CHECKLIST_ENABLED,
  PICKUP_SITE,
  paymentCollected,
  pickupChecklist,
  type PickupChecklistInput,
} from "../src/lib/pickup-checklist";

const lib = readFileSync("src/lib/pickup-checklist.ts", "utf8");
const client = readFileSync("src/lib/pickup-checklist-client.ts", "utf8");
const card = readFileSync("src/components/portal/PickupReadinessCard.tsx", "utf8");
const portal = readFileSync("src/routes/portal.tsx", "utf8");

function flagValue(source: string): string | null {
  const match = source.match(/const PICKUP_CHECKLIST_ENABLED: boolean = (false|true)/);
  return match?.[1] ?? null;
}

const empty: PickupChecklistInput = {
  status: "approved",
  pickupDate: null,
  pickupTime: null,
  agreements: [],
  documents: [],
  payments: [],
  depositHeld: false,
};

describe("pickup checklist flag", () => {
  it("is a hard false, and the portal does not load the module", () => {
    assert.equal(PICKUP_CHECKLIST_ENABLED, false);
    assert.equal(flagValue(lib), "false");
    assert.equal(flagValue(portal), null);
    assert.match(portal, /import \{ PICKUP_CHECKLIST_ENABLED \} from "@\/lib\/pickup-checklist"/);
    assert.doesNotMatch(portal, /from ["']@\/lib\/pickup-checklist-client/);
    assert.doesNotMatch(portal, /from ["']@\/components\/portal\/PickupReadinessCard/);
    assert.doesNotMatch(portal, /Pickup Readiness/);
    const load = portal.indexOf('import("@/lib/pickup-checklist');
    assert.ok(load !== -1);
    assert.match(portal.slice(0, load), /PICKUP_CHECKLIST_ENABLED !== true\) return/);
  });

  it("reads with the driver session and does not write or send", () => {
    assert.match(client, /if \(PICKUP_CHECKLIST_ENABLED !== true\) return null/);
    assert.match(
      client,
      /\.from\("applications"\)\s*\.select\("id,status,pickup_date,pickup_time"\)\s*\.eq\("user_id", uid\)/,
    );
    assert.doesNotMatch(client, /select\("\*"\)|supabaseAdmin|\.insert\(|\.update\(|\.delete\(|sendEmail|sendSms|\.or\(`|\.filter\(`/);
    assert.doesNotMatch(lib, /supabaseAdmin|\.insert\(|\.update\(|sendEmail/);
    assert.doesNotMatch(card, /supabaseAdmin|\.insert\(|sendEmail/);
    assert.match(card, /Pickup Readiness/);
    assert.match(card, /min-h-11/);
  });
});

describe("pickup checklist steps", () => {
  it("hides the card unless the driver is approved, and lists four pending steps", () => {
    assert.equal(pickupChecklist({ ...empty, status: "active" }), null);
    assert.equal(pickupChecklist({ ...empty, status: "new" }), null);
    const card = pickupChecklist(empty);
    assert.ok(card);
    assert.deepEqual(
      card.steps.map((step) => [step.id, step.done, step.link]),
      [
        ["agreement", false, "documents"],
        ["payment", false, "payments"],
        ["documents", false, "documents"],
        ["appointment", false, null],
      ],
    );
    assert.equal(card.site, PICKUP_SITE);
    assert.match(PICKUP_SITE.address, /not set/i);
    assert.match(PICKUP_SITE.hours, /not set/i);
    assert.match(PICKUP_SITE.rules, /not set/i);
    assert.doesNotMatch(`${PICKUP_SITE.address} ${PICKUP_SITE.hours}`, /\d{3,}|Monday|9:00|AM/);
  });

  it("marks a step done only from a signed agreement, collected money, verified docs, or a saved date", () => {
    const ready = pickupChecklist({
      ...empty,
      pickupDate: "2026-11-02",
      pickupTime: "10:30",
      agreements: [{ status: "signed", signedAt: "2026-10-01T15:00:00Z", voidedAt: null }],
      documents: [
        { category: "license_front", reviewStatus: "verified", current: true },
        { category: "insurance", reviewStatus: "verified", current: true },
      ],
      payments: [{ type: "rent", status: "paid", netCollected: 350, amount: 350 }],
    });
    assert.ok(ready);
    assert.deepEqual(
      ready.steps.map((step) => step.done),
      [true, true, true, true],
    );
    assert.equal(ready.steps[3].date, "2026-11-02");
    assert.equal(ready.steps[3].time, "10:30");

    const voided = pickupChecklist({
      ...empty,
      agreements: [{ status: "signed", signedAt: "2026-10-01T15:00:00Z", voidedAt: "2026-10-02T15:00:00Z" }],
    });
    assert.equal(voided?.steps[0].done, false);

    const uploaded = pickupChecklist({
      ...empty,
      documents: [
        { category: "license_front", reviewStatus: "uploaded", current: true },
        { category: "insurance", reviewStatus: "verified", current: true },
      ],
    });
    assert.equal(uploaded?.steps[2].done, false);

    const oldLicense = pickupChecklist({
      ...empty,
      documents: [
        { category: "license_back", reviewStatus: "verified", current: false },
        { category: "insurance", reviewStatus: "verified", current: true },
      ],
    });
    assert.equal(oldLicense?.steps[2].done, false);

    assert.equal(paymentCollected({ type: "rent", status: "paid", netCollected: 0, amount: 350 }), false);
    assert.equal(paymentCollected({ type: "rent", status: "paid", netCollected: null, amount: 350 }), true);
    assert.equal(paymentCollected({ type: "toll", status: "paid", netCollected: 40, amount: 40 }), true);

    const toll = pickupChecklist({
      ...empty,
      payments: [{ type: "toll", status: "paid", netCollected: 40, amount: 40 }],
    });
    assert.equal(toll?.steps[1].done, false);

    const held = pickupChecklist({ ...empty, depositHeld: true });
    assert.equal(held?.steps[1].done, true);
    assert.match(held?.steps[1].detail ?? "", /held/);
  });
});
