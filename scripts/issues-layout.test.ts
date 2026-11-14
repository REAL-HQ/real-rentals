import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const issues = readFileSync("src/components/admin/IssuesPanel.tsx", "utf8");
const incidents = readFileSync("src/components/admin/IncidentsPanel.tsx", "utf8");
const drivers = readFileSync("src/components/admin/DriverIssuesPanel.tsx", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const bookings = readFileSync("src/components/admin/BookingsWorkspace.tsx", "utf8");
const payments = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
const vendors = readFileSync("src/components/admin/VendorsPanel.tsx", "utf8");
const settings = readFileSync("src/components/admin/SettingsWorkspace.tsx", "utf8");

describe("Issues page single header + embedded sections", () => {
  it("owns one Title Case page title and puts source chips on that row", () => {
    assert.match(issues, /data-testid="issues-panel"/);
    assert.match(issues, />Issues</);
    assert.match(issues, /Accidents, Claims, Breakdowns And Driver Reports/);
    assert.doesNotMatch(issues, /other reports in one place/i);
    assert.match(issues, /role="tablist"/);
    assert.match(issues, /All/);
    assert.match(issues, /Incident/);
    assert.match(issues, /Driver/);
    // Only one h1 in the Issues panel itself
    assert.equal((issues.match(/<h1\b/g) ?? []).length, 1);
  });

  it("suppresses the admin shell page title on the Issues tab", () => {
    assert.match(admin, /tab !== "issues"/);
    assert.match(admin, /tab !== "overview" && tab !== "issues"/);
  });

  it("embeds Incidents with a one-word heading and no nested sticky bar", () => {
    assert.match(issues, /<IncidentsPanel[^>]*embedded/);
    assert.match(incidents, /embedded = false/);
    assert.match(incidents, />Incidents</);
    assert.match(incidents, /data-testid="incident-status-chips"/);
    // Embedded path drops admin-sticky-bar
    assert.match(incidents, /embedded\s*\?\s*"flex flex-wrap/);
    assert.match(incidents, /admin-sticky-bar/);
  });

  it("embeds Driver with a matching section heading and visible chips", () => {
    assert.match(issues, /<DriverIssuesPanel embedded/);
    assert.match(drivers, /embedded = false/);
    assert.match(drivers, />Driver</);
    assert.match(drivers, /data-testid="driver-status-chips"/);
    assert.match(drivers, /embedded\s*\?\s*"flex flex-wrap/);
  });

  it("does not stack a second Issues h2 above the embedded panels", () => {
    assert.doesNotMatch(issues, /<h2[^>]*>Incident</);
    assert.doesNotMatch(issues, /<h2[^>]*>Driver</);
  });
});

describe("Recently merged wrappers are free of double page titles", () => {
  it("Bookings workspace has view chips only — no second page h1", () => {
    assert.doesNotMatch(bookings, /<h1\b/);
    assert.match(bookings, /admin-sticky-bar/);
    assert.match(bookings, /Booked|Active|Past/);
  });

  it("Payments panel has no second page h1", () => {
    assert.doesNotMatch(payments, /<h1\b/);
  });

  it("Vendors panel has no second page h1", () => {
    assert.doesNotMatch(vendors, /<h1\b/);
  });

  it("Partners → Vendors keeps type chips inside the sticky bar (not clipped)", () => {
    assert.match(vendors, /data-testid="vendors-panel"/);
    assert.match(vendors, /data-testid="vendor-type-chips"/);
    // Chips must be nested inside the sticky bar block, not a sibling after it.
    const sticky = vendors.indexOf("admin-sticky-bar");
    const chips = vendors.indexOf('data-testid="vendor-type-chips"');
    const stickyEnd = vendors.indexOf("</div>", vendors.indexOf("Add Vendor"));
    assert.ok(sticky >= 0 && chips > sticky, "chips after sticky open");
    // The old pattern put chips after the sticky bar closed; require chips before the list/empty state.
    const empty = vendors.indexOf("No Vendors Yet");
    assert.ok(chips < empty, "chips appear before the empty/list body");
  });

  it("Settings workspace uses a section h2 under the shell Settings title, not a duplicate Settings h1", () => {
    assert.doesNotMatch(settings, /<h1\b/);
    assert.match(settings, /<h2[^>]*>\{current\.label\}/);
  });
});
