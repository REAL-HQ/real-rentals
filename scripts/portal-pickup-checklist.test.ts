import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentExpiryTone } from "../src/lib/document-expiry";
import {
  PORTAL_PICKUP_CHECKLIST_ENABLED,
  assertPortalPickupChecklistEnabled,
  pickupChecklist,
  type PickupAgreement,
  type PickupDocument,
} from "../src/lib/portal-pickup-checklist";
import type { PayRental, PayRow } from "../src/lib/driver-payment-status";

const NOW = Date.parse("2026-10-21T00:00:00Z");
const DAY = 86400000;

const base = {
  applicationStatus: "approved" as string | null,
  hasActiveRental: false,
  documents: [] as PickupDocument[],
  licensePhotoPath: null as string | null,
  licenseExpiration: null as string | null,
  insuranceDocPath: null as string | null,
  insuranceExpiresOn: null as string | null,
  agreements: [] as PickupAgreement[],
  rentals: [] as PayRental[],
  payments: [] as PayRow[],
  now: NOW,
};

function doc(partial: Partial<PickupDocument> & Pick<PickupDocument, "category">): PickupDocument {
  return {
    expiresAt: null,
    isCurrent: true,
    visibleToDriver: true,
    createdAt: "2026-01-01T00:00:00Z",
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

describe("pickup checklist", () => {
  it("hides the card unless the application is approved and there is no active rental", () => {
    assert.equal(pickupChecklist({ ...base, applicationStatus: "reviewing" }).show, false);
    assert.equal(pickupChecklist({ ...base, applicationStatus: "active" }).show, false);
    assert.equal(pickupChecklist({ ...base, hasActiveRental: true }).show, false);
    assert.deepEqual(pickupChecklist({ ...base, applicationStatus: "declined" }).items, []);
  });

  it("lists an unsigned agreement and leaves a signed one off", () => {
    const waiting = pickupChecklist({
      ...base,
      agreements: [{ status: "sent", signedAt: null }],
    });
    assert.equal(waiting.show, true);
    assert.deepEqual(waiting.items.find((item) => item.id === "agreement"), {
      id: "agreement",
      label: "Rental Agreements",
      detail: "Awaiting your signature",
    });

    const signed = pickupChecklist({
      ...base,
      agreements: [{ status: "signed", signedAt: "2026-10-01T00:00:00Z" }],
      documents: [
        doc({ category: "license_front", expiresAt: new Date(NOW + 60 * DAY).toISOString() }),
        doc({ category: "license_back", expiresAt: new Date(NOW + 60 * DAY).toISOString() }),
        doc({ category: "insurance", expiresAt: new Date(NOW + 60 * DAY).toISOString() }),
      ],
    });
    assert.equal(signed.items.some((item) => item.id === "agreement"), false);
    assert.deepEqual(signed.items, []);
  });

  it("lists a missing document, an expired one, and one inside the vault's soon window", () => {
    const items = pickupChecklist({
      ...base,
      agreements: [{ status: "signed", signedAt: "2026-10-01T00:00:00Z" }],
      documents: [
        doc({ category: "license_front", expiresAt: new Date(NOW - DAY).toISOString() }),
        doc({ category: "insurance", expiresAt: new Date(NOW + 10 * DAY).toISOString() }),
      ],
    }).items;
    assert.deepEqual(
      items.map((item) => [item.id, item.detail]),
      [
        ["license_front", "Expired"],
        ["license_back", "Not on file"],
        ["insurance", "Expiring soon"],
      ],
    );
    assert.equal(items[0].label, "Driver's license (front)");
  });

  it("treats an undated file and a file 30 days out as current", () => {
    const items = pickupChecklist({
      ...base,
      agreements: [{ status: "signed", signedAt: "2026-10-01T00:00:00Z" }],
      licensePhotoPath: "apps/license.jpg",
      licenseExpiration: null,
      documents: [
        doc({ category: "license_back", expiresAt: new Date(NOW + 30 * DAY).toISOString() }),
        doc({ category: "insurance", expiresAt: null }),
      ],
      insuranceDocPath: "apps/insurance.pdf",
      insuranceExpiresOn: new Date(NOW + 90 * DAY).toISOString(),
    }).items;
    assert.deepEqual(items, []);
  });

  it("omits payment and deposit when nothing is recorded, and shows an unpaid deposit from the existing reading", () => {
    const quiet = pickupChecklist({
      ...base,
      agreements: [{ status: "signed", signedAt: "2026-10-01T00:00:00Z" }],
      documents: [
        doc({ category: "license_front", expiresAt: new Date(NOW + 90 * DAY).toISOString() }),
        doc({ category: "license_back", expiresAt: new Date(NOW + 90 * DAY).toISOString() }),
        doc({ category: "insurance", expiresAt: new Date(NOW + 90 * DAY).toISOString() }),
      ],
    });
    assert.deepEqual(quiet.items, []);

    const owed = pickupChecklist({
      ...base,
      agreements: [{ status: "signed", signedAt: "2026-10-01T00:00:00Z" }],
      documents: [
        doc({ category: "license_front", expiresAt: new Date(NOW + 90 * DAY).toISOString() }),
        doc({ category: "license_back", expiresAt: new Date(NOW + 90 * DAY).toISOString() }),
        doc({ category: "insurance", expiresAt: new Date(NOW + 90 * DAY).toISOString() }),
      ],
      rentals: [
        {
          id: "r1",
          status: "closed",
          deposit_amount: 200,
          deposit_held: false,
          deposit_status: "none",
          deposit_refund_amount: 0,
        },
      ],
      payments: [
        {
          rental_id: "r1",
          type: "rent",
          amount: 350,
          balance_due: 350,
          net_collected: 0,
          refunded_amount: 0,
          status: "failed",
          due_date: "2026-10-01",
        },
      ],
    });
    assert.deepEqual(
      owed.items.map((item) => [item.id, item.label, item.detail]),
      [
        ["payment", "Next Payment Due", "Failed"],
        ["deposit", "Refundable Deposit", "Unpaid · $200 Due"],
      ],
    );
  });
});

describe("portal pickup checklist flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(PORTAL_PICKUP_CHECKLIST_ENABLED, false);
    assert.throws(() => assertPortalPickupChecklistEnabled(), /not enabled/);
  });

  it("refuses in the server handler before any query", () => {
    const src = readFileSync("src/lib/portal-pickup-checklist.functions.ts", "utf8");
    const handler = src.slice(src.indexOf("handler(async"));
    const assertAt = handler.indexOf("assertPortalPickupChecklistEnabled");
    const queryAt = handler.indexOf(".from(");
    const roleAt = handler.indexOf("requireManager");
    assert.ok(assertAt >= 0 && queryAt > assertAt && roleAt > assertAt);
    assert.match(handler, /context\.supabase/);
    assert.match(handler, /app\.status !== "approved"/);
    assert.match(handler, /status === "active"/);
    assert.doesNotMatch(src, /supabaseAdmin|portalScope|stripe|resend|twilio|\.insert\(|\.update\(|\.delete\(/);
  });

  it("does not mount the card while the flag is off", () => {
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    assert.match(portal, /PORTAL_PICKUP_CHECKLIST_ENABLED \? <PortalPickupChecklist \/> : null/);
  });

  it("reads document expiry through the vault helper", () => {
    const vault = readFileSync("src/components/admin/DocumentVault.tsx", "utf8");
    assert.match(vault, /documentExpiryTone\(d\.expires_at\)/);
    assert.doesNotMatch(vault, /86400000/);
  });

  it("uses the business phone and existing checklist wording", () => {
    const card = readFileSync("src/components/portal/PickupChecklistCard.tsx", "utf8");
    assert.match(card, /useBusinessPhone/);
    assert.match(card, /Get Ready For Pickup/);
    assert.match(card, /You're Approved/);
    assert.match(card, /Call Support/);
    assert.doesNotMatch(card, /stripe|payRental|usePortalWrite|\$50|late fee/i);
  });
});
