// Documents Expiring. No network and no email or SMS.
// Run: node --import tsx --test scripts/document-expiry.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import {
  classifyActiveRenter,
  daysLeftLabel,
  defaultExpiryScope,
  etCalendarDate,
  expiryScopes,
  isApprovedDriverStatus,
  sortExpiringRenters,
  type RenterExpiryInput,
} from "../src/lib/document-expiry";
import { enrollDocumentExpiringNotices, runDocumentExpiryEnrollment } from "../src/lib/document-expiry.server";

const TODAY = "2026-10-21";
const FLAG = "DOCUMENT_EXPIRY_NOTICES_ENABLED";
const prior = process.env[FLAG];

afterEach(() => {
  if (prior === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prior;
});

function renter(over: Partial<RenterExpiryInput> = {}): RenterExpiryInput {
  return {
    applicationId: "app-1",
    rentalId: "rent-1",
    fullName: "Ada Lovelace",
    licenseExpiration: "2027-06-01",
    insuranceExpiresOn: "2027-06-01",
    documents: [{ category: "gig_profile", expiresAt: "2027-06-01" }],
    ...over,
  };
}

describe("calendar days in Eastern Time", () => {
  it("uses the Eastern calendar date, not UTC", () => {
    assert.equal(etCalendarDate(new Date("2026-10-21T03:30:00Z")), "2026-10-20");
    assert.equal(etCalendarDate(new Date("2026-10-21T16:00:00Z")), "2026-10-21");
  });
});

describe("classifyActiveRenter", () => {
  it("includes an expired license and sorts it ahead of a later window", () => {
    const expired = classifyActiveRenter(
      renter({ applicationId: "late", fullName: "Bea", licenseExpiration: "2026-10-20" }),
      TODAY,
    );
    const soon = classifyActiveRenter(
      renter({ applicationId: "soon", fullName: "Ada", licenseExpiration: "2026-11-01", documents: [{ category: "gig_profile", expiresAt: "2027-01-01" }] }),
      TODAY,
    );
    assert.ok(expired);
    assert.equal(expired.cells.find((c) => c.kind === "license")?.status, "expired");
    assert.equal(expired.cells.find((c) => c.kind === "license")?.daysLeft, -1);
    assert.equal(daysLeftLabel(-1, "expired"), "1 Day Overdue");
    assert.ok(soon);
    const sorted = sortExpiringRenters([soon, expired]);
    assert.deepEqual(sorted.map((row) => row.applicationId), ["late", "soon"]);
  });

  it("includes day 30 and leaves day 31 out when every date is later", () => {
    const inside = classifyActiveRenter(renter({ licenseExpiration: "2026-11-20" }), TODAY);
    const outside = classifyActiveRenter(
      renter({
        licenseExpiration: "2026-11-21",
        insuranceExpiresOn: "2026-12-01",
        documents: [{ category: "gig_profile", expiresAt: "2026-12-01" }],
      }),
      TODAY,
    );
    assert.equal(inside?.cells.find((c) => c.kind === "license")?.status, "expiring");
    assert.equal(inside?.cells.find((c) => c.kind === "license")?.daysLeft, 30);
    assert.equal(daysLeftLabel(30, "expiring"), "30 Days Left");
    assert.equal(outside, null);
  });

  it("shows a missing date as Unknown and still lists the renter", () => {
    const row = classifyActiveRenter(
      renter({
        licenseExpiration: null,
        insuranceExpiresOn: null,
        documents: [{ category: "license_front", expiresAt: null }, { category: "gig_profile", expiresAt: null }],
      }),
      TODAY,
    );
    assert.ok(row);
    assert.deepEqual(
      row.cells.map((c) => c.status),
      ["unknown", "unknown", "unknown"],
    );
    assert.equal(row.soonestDays, null);
    for (const cell of row.cells) {
      assert.equal(daysLeftLabel(cell.daysLeft, cell.status), "Unknown");
      assert.notEqual(daysLeftLabel(cell.daysLeft, cell.status), "OK");
    }
  });

  it("uses the soonest license date across the application and the current document", () => {
    const row = classifyActiveRenter(
      renter({
        licenseExpiration: "2027-01-01",
        documents: [
          { category: "license_front", expiresAt: "2026-10-25" },
          { category: "gig_profile", expiresAt: "2027-06-01" },
        ],
      }),
      TODAY,
    );
    assert.equal(row?.cells.find((c) => c.kind === "license")?.date, "2026-10-25");
    assert.equal(row?.cells.find((c) => c.kind === "license")?.status, "expiring");
    assert.equal(row?.soonestDays, 4);
  });

  it("treats a rideshare document with no expiry as Unknown, never as later", () => {
    const row = classifyActiveRenter(
      renter({ documents: [{ category: "trip_history", expiresAt: null }] }),
      TODAY,
    );
    assert.equal(row?.cells.find((c) => c.kind === "rideshare")?.status, "unknown");
    assert.notEqual(row?.cells.find((c) => c.kind === "rideshare")?.status, "later");
  });

  it("sorts Unknown-only renters after anyone with a real date", () => {
    const unknown = classifyActiveRenter(
      renter({ applicationId: "u", fullName: "Ada", licenseExpiration: null, insuranceExpiresOn: null, documents: [] }),
      TODAY,
    );
    const dated = classifyActiveRenter(
      renter({ applicationId: "d", fullName: "Zoe", licenseExpiration: "2026-11-01" }),
      TODAY,
    );
    assert.ok(unknown && dated);
    assert.deepEqual(sortExpiringRenters([unknown, dated]).map((row) => row.applicationId), ["d", "u"]);
  });
});

describe("population", () => {
  it("uses approved and active, the real statuses, and keeps an active rental in both scopes", () => {
    assert.equal(isApprovedDriverStatus("approved"), true);
    assert.equal(isApprovedDriverStatus("ACTIVE"), true);
    assert.equal(isApprovedDriverStatus("reviewing"), false);
    assert.equal(isApprovedDriverStatus("complete"), false);
    assert.deepEqual(expiryScopes({ hasActiveRental: false, status: "approved" }), ["approved"]);
    assert.deepEqual(expiryScopes({ hasActiveRental: false, status: "active" }), ["approved"]);
    assert.deepEqual(expiryScopes({ hasActiveRental: true, status: "closed" }), ["renting", "approved"]);
    assert.deepEqual(expiryScopes({ hasActiveRental: false, status: "reviewing" }), []);
  });

  it("defaults to Approved Drivers when Renting Now is empty", () => {
    assert.equal(defaultExpiryScope(0, 3), "approved");
    assert.equal(defaultExpiryScope(2, 5), "renting");
    assert.equal(defaultExpiryScope(0, 0), "approved");
  });
});

describe("DOCUMENT_EXPIRY_NOTICES_ENABLED", () => {
  it("does not load or enroll while the constant is false, even if the env var is true", async () => {
    for (const value of [undefined, "", "false", "true", "TRUE", "1"]) {
      if (value === undefined) delete process.env[FLAG];
      else process.env[FLAG] = value;
      let calls = 0;
      const result = await enrollDocumentExpiringNotices({
        load: async () => {
          calls++;
          throw new Error("load");
        },
        enroll: async () => {
          calls++;
          return { enrolled: 1 };
        },
      });
      assert.equal(result.skipped, "flag");
      assert.equal(calls, 0);
    }
  });

  it("enrolls expired and 30-day renters and skips Unknown-only", async () => {
    const expired = classifyActiveRenter(renter({ applicationId: "expired", licenseExpiration: "2026-10-01" }), TODAY);
    const window = classifyActiveRenter(renter({ applicationId: "window", rentalId: "rent-2", licenseExpiration: "2026-11-20" }), TODAY);
    const unknown = classifyActiveRenter(
      renter({ applicationId: "unknown", rentalId: "rent-3", licenseExpiration: null, insuranceExpiresOn: null, documents: [] }),
      TODAY,
    );
    assert.ok(expired && window && unknown);
    const seen: string[] = [];
    const result = await runDocumentExpiryEnrollment({
      load: async () => [expired, window, unknown],
      enroll: async (args) => {
        seen.push(args.applicationId);
        assert.equal(args.trigger, "document_expiring");
        return { enrolled: 1 };
      },
    });
    assert.deepEqual(seen.sort(), ["expired", "window"]);
    assert.equal(result.enrolled, 2);
    assert.equal(result.skipped, null);
  });

  it("swallows an enroll failure", async () => {
    const expired = classifyActiveRenter(renter({ licenseExpiration: "2026-10-01" }), TODAY);
    assert.ok(expired);
    const result = await runDocumentExpiryEnrollment({
      load: async () => [expired],
      enroll: async () => {
        throw new Error("transport down");
      },
    });
    assert.equal(result.enrolled, 0);
    assert.equal(result.skipped, null);
  });
});

describe("wiring", () => {
  it("keeps the cron enroll behind the flag and Overview to one chip", () => {
    const cron = readFileSync(new URL("../src/routes/api/public/cron/automations.ts", import.meta.url), "utf8");
    const overview = readFileSync(new URL("../src/components/admin/OverviewPanel.tsx", import.meta.url), "utf8");
    const helper = readFileSync(new URL("../src/lib/document-expiry.server.ts", import.meta.url), "utf8");
    const flag = readFileSync(new URL("../src/lib/document-expiry-flag.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../src/components/admin/AutomationsPanel.tsx", import.meta.url), "utf8");
    assert.match(flag, /export const DOCUMENT_EXPIRY_NOTICES_ENABLED = false/);
    assert.match(cron, /if \(DOCUMENT_EXPIRY_NOTICES_ENABLED\)/);
    assert.doesNotMatch(cron, /process\.env\.DOCUMENT_EXPIRY_NOTICES_ENABLED/);
    assert.match(helper, /if \(!DOCUMENT_EXPIRY_NOTICES_ENABLED\) return/);
    assert.doesNotMatch(helper, /process\.env\.DOCUMENT_EXPIRY_NOTICES_ENABLED/);
    assert.match(cron, /runDueAutomations\(\)/);
    assert.equal(overview.match(/<DocumentsExpiringChip \/>/g)?.length, 1);
    assert.match(panel, /document_expiring/);
    assert.match(panel, /is_active: false/);
    assert.doesNotMatch(helper, /sendEmail\(|sendSms\(/);
  });
});
