import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { documentExpiryTone } from "../src/lib/document-expiry";
import {
  PORTAL_NOTICES_ENABLED,
  assertPortalNoticesEnabled,
  buildPortalNotices,
  type PortalNoticeInput,
} from "../src/lib/portal-notices";

const NOW = new Date("2026-10-21T16:00:00.000Z");

function input(partial: Partial<PortalNoticeInput> = {}): PortalNoticeInput {
  return {
    application: null,
    applicationReadable: true,
    documents: [],
    rentals: [],
    payments: [],
    agreements: [],
    ...partial,
  };
}

const visible = {
  is_current: true,
  review_status: "uploaded",
  visibility: ["driver"],
};

describe("portal notices flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(PORTAL_NOTICES_ENABLED, false);
    assert.throws(() => assertPortalNoticesEnabled(), /Portal notices are not enabled/);
  });

  it("throws in the handler before a scope lookup or any read", () => {
    const source = readFileSync("src/lib/portal-notices.functions.ts", "utf8");
    const handler = source.slice(source.indexOf(".handler("));
    const guard = handler.indexOf("assertPortalNoticesEnabled()");
    const roles = handler.indexOf('from("user_roles")');
    const read = handler.indexOf('from("applications")');
    assert.ok(guard !== -1 && guard < roles && roles < read);
    assert.doesNotMatch(source, /portalScope|supabaseAdmin|stripe|\.insert\(|\.update\(|\.delete\(|email|sms/);
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    assert.match(portal, /PORTAL_NOTICES_ENABLED \? <PortalNoticesGate/);
    assert.match(portal, /usePortalRead\(getPortalNotices\)/);
  });
});

describe("document expiry tone", () => {
  it("matches the vault: expired before now, soon under 30 days, quiet at 30", () => {
    const now = NOW.getTime();
    const day = 86400000;
    assert.equal(documentExpiryTone(new Date(now - day).toISOString(), now), "expired");
    assert.equal(documentExpiryTone(new Date(now + 29 * day).toISOString(), now), "soon");
    assert.equal(documentExpiryTone(new Date(now + 30 * day).toISOString(), now), null);
    assert.equal(documentExpiryTone(null, now), null);
  });
});

describe("portal notices", () => {
  it("shows nothing when there is nothing to act on", () => {
    const notices = buildPortalNotices(
      input({
        documents: [
          { category: "license_front", expires_at: null, ...visible },
          { category: "license_back", expires_at: null, ...visible },
          { category: "insurance", expires_at: null, ...visible },
          { category: "gig_profile", expires_at: null, ...visible },
        ],
        agreements: [{ status: "signed", signed_at: "2026-10-01T00:00:00.000Z" }],
        payments: [{ status: "paid", due_date: "2026-10-21" }],
        rentals: [{ next_payment_due: "2026-11-01", payment_status: "current" }],
      }),
      NOW,
    );
    assert.deepEqual(notices, []);
  });

  it("reports an approved or declined application only when that status is readable", () => {
    const approved = buildPortalNotices(input({ application: { status: "approved" }, documents: null }), NOW);
    assert.equal(approved[0]?.text, "Your application was approved.");
    assert.equal(approved[0]?.section, "dashboard");
    const declined = buildPortalNotices(input({ application: { status: "declined" }, documents: null }), NOW);
    assert.equal(declined[0]?.text, "Your application was declined.");
    const hidden = buildPortalNotices(
      input({ applicationReadable: false, application: { status: "approved" }, documents: null }),
      NOW,
    );
    assert.equal(hidden.some((notice) => notice.id.startsWith("application")), false);
    const pending = buildPortalNotices(input({ application: { status: "reviewing" }, documents: null }), NOW);
    assert.equal(pending.some((notice) => notice.section === "dashboard"), false);
  });

  it("names a missing, rejected, or expiring document and opens Documents", () => {
    const notices = buildPortalNotices(
      input({
        documents: [
          { category: "license_back", expires_at: null, ...visible },
          { category: "insurance", expires_at: null, ...visible, review_status: "rejected" },
          { category: "gig_profile", expires_at: "2026-10-20T12:00:00.000Z", ...visible },
          { category: "license_front", expires_at: "2026-11-01T12:00:00.000Z", ...visible },
          { category: "verification_recording", expires_at: "2026-10-01T00:00:00.000Z", ...visible },
        ],
      }),
      NOW,
    );
    const text = notices.map((notice) => notice.text);
    assert.ok(text.includes("Driver's license (front) expires on Nov 1, 2026."));
    assert.ok(text.includes("Gig profile screenshot has expired."));
    assert.ok(text.includes("Insurance card needs a replacement."));
    assert.equal(text.some((line) => /verification/i.test(line)), false);
    assert.equal(text.some((line) => /license \(back\)/i.test(line)), false);
    assert.ok(notices.filter((notice) => notice.id.startsWith("document")).every((notice) => notice.section === "documents"));
  });

  it("omits document notices when the vault could not be read", () => {
    const notices = buildPortalNotices(input({ documents: null }), NOW);
    assert.equal(notices.some((notice) => notice.section === "documents"), false);
  });

  it("notices a payment due within 3 days or a failed payment, without an amount", () => {
    const due = buildPortalNotices(
      input({
        documents: null,
        rentals: [{ next_payment_due: "2026-10-24", payment_status: "current" }],
        payments: [{ status: "current", due_date: "2026-10-30" }],
      }),
      NOW,
    );
    assert.deepEqual(
      due.map((notice) => notice.text),
      ["A payment is due on Oct 24, 2026."],
    );
    assert.equal(due[0]?.section, "payments");

    const later = buildPortalNotices(
      input({ documents: null, rentals: [{ next_payment_due: "2026-10-25", payment_status: "current" }] }),
      NOW,
    );
    assert.deepEqual(later, []);

    const failed = buildPortalNotices(
      input({ documents: null, payments: [{ status: "failed", due_date: "2026-10-01" }] }),
      NOW,
    );
    assert.deepEqual(
      failed.map((notice) => notice.text),
      ["A payment failed."],
    );
    assert.doesNotMatch(failed.map((notice) => notice.text).join(" "), /\$|late fee|amount/i);
  });

  it("uses the existing awaiting-signature sentence and skips a signed or voided agreement", () => {
    const open = buildPortalNotices(
      input({ documents: null, agreements: [{ status: "viewed", signed_at: null }] }),
      NOW,
    );
    assert.equal(open[0]?.text, "Awaiting your signature.");
    assert.equal(open[0]?.section, "documents");
    const closed = buildPortalNotices(
      input({
        documents: null,
        agreements: [
          { status: "signed", signed_at: "2026-10-02T00:00:00.000Z" },
          { status: "voided", signed_at: null },
        ],
      }),
      NOW,
    );
    assert.deepEqual(closed, []);
  });
});
