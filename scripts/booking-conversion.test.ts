import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  BOOKING_CONVERSION_ENABLED,
  BOOKING_CONVERSION_MAX_PAGES,
  BOOKING_CONVERSION_PAGE_SIZE,
  BOOKING_CONVERSION_ROW_CAP,
  addCalendarDays,
  assertBookingConversionEnabled,
  buildBookingConversion,
  conversionWindow,
  easternDate,
  easternMidnight,
  weekStart,
  type ApplicationFact,
  type WaitlistFact,
} from "../src/lib/booking-conversion.ts";

const NOW = new Date("2026-06-15T16:00:00.000Z");

function app(over: Partial<ApplicationFact> & Pick<ApplicationFact, "id" | "createdAt">): ApplicationFact {
  return {
    status: "new",
    source: null,
    utmSource: null,
    gclid: null,
    waitlistSource: null,
    ...over,
  };
}

function lead(over: Partial<WaitlistFact> & Pick<WaitlistFact, "id" | "createdAt">): WaitlistFact {
  return { source: null, utmSource: null, gclid: null, promotedApplicationId: null, ...over };
}

describe("flag", () => {
  it("is a hard false constant declared once, and the server refuses before the role check and the reads", () => {
    assert.equal(BOOKING_CONVERSION_ENABLED, false);
    assert.throws(() => assertBookingConversionEnabled(), /not enabled/);
    const lib = readFileSync(new URL("../src/lib/booking-conversion.ts", import.meta.url), "utf8");
    assert.equal(lib.match(/export const BOOKING_CONVERSION_ENABLED/g)?.length, 1);
    assert.match(lib, /BOOKING_CONVERSION_ENABLED: boolean = false/);
    const source = readFileSync(new URL("../src/lib/booking-conversion.functions.ts", import.meta.url), "utf8");
    assert.equal(source.includes("BOOKING_CONVERSION_ENABLED"), false);
    assert.match(source, /middleware\(\[bookingConversionGate, requireSupabaseAuth\]\)/);
    const handler = source.slice(source.indexOf("async ({ context })"));
    const enabled = handler.indexOf("assertBookingConversionEnabled()");
    const manager = handler.indexOf("await requireManager(");
    const query = handler.indexOf('.from("waitlist")');
    assert.ok(enabled >= 0 && enabled < manager && manager < query);
    assert.match(source, /readPages/);
    assert.match(source, /\.range\(from, to\)/);
    assert.match(source, /BOOKING_CONVERSION_PAGE_SIZE/);
    assert.match(source, /BOOKING_CONVERSION_MAX_PAGES/);
    assert.match(source, /\.not\("status", "in", "\(cancelled,canceled,void,voided\)"\)/);
    assert.equal(source.includes("waitlist: []"), false);
    assert.match(source, /truncated/);
    assert.equal(BOOKING_CONVERSION_PAGE_SIZE, 1000);
    assert.equal(BOOKING_CONVERSION_MAX_PAGES, 10);
    assert.equal(BOOKING_CONVERSION_ROW_CAP, 1000);
    assert.equal(handler.includes(".insert("), false);
    assert.equal(handler.includes(".update("), false);
    assert.equal(handler.includes(".delete("), false);
    assert.equal(handler.includes(".upsert("), false);
    assert.equal(source.includes("process.env"), false);
  });
});

describe("Eastern weeks", () => {
  it("uses midnight Eastern on both sides of daylight saving", () => {
    assert.equal(easternMidnight("2026-03-08").toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(easternMidnight("2026-03-09").toISOString(), "2026-03-09T04:00:00.000Z");
    assert.equal(easternMidnight("2026-11-01").toISOString(), "2026-11-01T04:00:00.000Z");
    assert.equal(easternMidnight("2026-11-02").toISOString(), "2026-11-02T05:00:00.000Z");
    assert.equal(easternDate(new Date("2026-03-08T04:59:00.000Z")), "2026-03-07");
    assert.equal(easternDate(new Date("2026-03-09T04:00:00.000Z")), "2026-03-09");
    assert.equal(weekStart("2026-03-08"), "2026-03-02");
    assert.equal(weekStart("2026-03-09"), "2026-03-09");
    assert.equal(weekStart("2026-11-01"), "2026-10-26");
    assert.equal(weekStart("2026-11-02"), "2026-11-02");
  });

  it("covers eight Eastern weeks and keeps the end exclusive", () => {
    const window = conversionWindow(NOW);
    assert.equal(window.startMonday, "2026-04-27");
    assert.equal(window.endMonday, "2026-06-22");
    assert.equal(new Date(window.startMs).toISOString(), "2026-04-27T04:00:00.000Z");
    assert.equal(new Date(window.endMs).toISOString(), "2026-06-22T04:00:00.000Z");
    assert.equal(addCalendarDays(window.endMonday, -1), "2026-06-21");
  });
});

describe("funnel by source and week", () => {
  it("counts a lead, a booking request, approval, and the first rental once", () => {
    const report = buildBookingConversion({
      now: NOW,
      waitlist: [
        lead({
          id: "w-google",
          createdAt: "2026-05-06T15:00:00.000Z",
          gclid: "click",
          utmSource: "google",
          promotedApplicationId: "app-google",
        }),
        lead({
          id: "w-google-again",
          createdAt: "2026-05-07T15:00:00.000Z",
          source: "city_lp",
          promotedApplicationId: "app-google",
        }),
        lead({ id: "w-city", createdAt: "2026-06-04T15:00:00.000Z", source: "city_lp" }),
        lead({ id: "w-early", createdAt: "2026-04-01T15:00:00.000Z", source: "homepage_waitlist" }),
        lead({ id: "w-edge", createdAt: "2026-06-22T04:00:00.000Z", source: "fleet_waitlist" }),
      ],
      applications: [
        app({ id: "app-google", createdAt: "2026-06-03T15:00:00.000Z", status: "approved", source: "homepage" }),
        app({ id: "app-facebook", createdAt: "2026-06-02T15:00:00.000Z", status: "new", utmSource: "facebook" }),
        app({ id: "app-audit", createdAt: "2026-06-02T16:00:00.000Z", status: "reviewing", gclid: "ad", utmSource: "google" }),
        app({ id: "app-closed", createdAt: "2026-06-08T15:00:00.000Z", status: "closed" }),
        app({ id: "app-rented", createdAt: "2026-06-09T15:00:00.000Z", status: "new", source: "search" }),
        app({ id: "app-dup", createdAt: "2026-06-02T15:00:00.000Z", status: "duplicate", source: "homepage" }),
        app({ id: "app-start", createdAt: "2026-04-27T04:00:00.000Z", status: "new", source: "homepage" }),
      ],
      approvals: [{ applicationId: "app-audit" }],
      rentals: [{ applicationId: "app-google" }, { applicationId: "app-google" }, { applicationId: "app-rented" }],
      truncated: false,
    });
    assert.equal(report.truncated, false);
    if (report.truncated) return;
    const by = (week: string, source: string) => report.rows.find((row) => row.weekStart === week && row.source === source);
    const google = by("2026-05-04", "Google Ads");
    assert.deepEqual(google?.counts, { leads: 1, applications: 1, approved: 1, firstRentals: 1 });
    assert.deepEqual(google?.rates, { toApplication: 100, toApproved: 100, toFirstRental: 100 });
    const city = by("2026-06-01", "city_lp");
    assert.deepEqual(city?.counts, { leads: 1, applications: 0, approved: 0, firstRentals: 0 });
    assert.equal(city?.rates.toApplication, 0);
    assert.equal(city?.rates.toApproved, null);
    const facebook = by("2026-06-01", "facebook");
    assert.deepEqual(facebook?.counts, { leads: 1, applications: 1, approved: 0, firstRentals: 0 });
    assert.deepEqual(facebook?.rates, { toApplication: 100, toApproved: 0, toFirstRental: null });
    const ads = by("2026-06-01", "Google Ads");
    assert.deepEqual(ads?.counts, { leads: 1, applications: 1, approved: 1, firstRentals: 0 });
    const closed = by("2026-06-08", "Direct");
    assert.deepEqual(closed?.counts, { leads: 1, applications: 1, approved: 0, firstRentals: 0 });
    const search = by("2026-06-08", "search");
    assert.deepEqual(search?.counts, { leads: 1, applications: 1, approved: 1, firstRentals: 1 });
    const opening = by("2026-04-27", "homepage");
    assert.equal(opening?.counts.leads, 1);
    assert.equal(report.rows.some((row) => row.source === "homepage_waitlist" || row.source === "fleet_waitlist"), false);
    assert.equal(report.rows.some((row) => row.weekStart === "2026-06-01" && row.source === "homepage"), false);
    assert.equal(report.totals.leads, 7);
    assert.equal(report.totals.applications, 6);
    assert.equal(report.totals.approved, 3);
    assert.equal(report.totals.firstRentals, 2);
    assert.equal(report.rates.toApplication, 85.7);
    assert.equal(report.rates.toApproved, 50);
    assert.equal(report.rates.toFirstRental, 66.7);
  });

  it("does not treat a never-approved closed application as approved", () => {
    const report = buildBookingConversion({
      now: NOW,
      waitlist: [],
      applications: [app({ id: "closed-only", createdAt: "2026-06-08T15:00:00.000Z", status: "closed" })],
      approvals: [],
      rentals: [],
      truncated: false,
    });
    assert.equal(report.truncated, false);
    assert.equal(report.totals.leads, 1);
    assert.equal(report.totals.applications, 1);
    assert.equal(report.totals.approved, 0);
    assert.equal(report.totals.firstRentals, 0);
  });

  it("does not count a cancelled or voided rental as the first rental", () => {
    const report = buildBookingConversion({
      now: NOW,
      waitlist: [],
      applications: [
        app({ id: "voided", createdAt: "2026-06-02T15:00:00.000Z", status: "new" }),
        app({ id: "kept", createdAt: "2026-06-02T16:00:00.000Z", status: "new" }),
      ],
      approvals: [],
      rentals: [
        { applicationId: "voided", status: "cancelled" },
        { applicationId: "voided", status: "voided" },
        { applicationId: "kept", status: "active" },
      ],
      truncated: false,
    });
    assert.equal(report.totals.applications, 2);
    assert.equal(report.totals.approved, 1);
    assert.equal(report.totals.firstRentals, 1);
  });

  it("keeps the counts and marks the report capped when a read stops early", () => {
    const report = buildBookingConversion({
      now: NOW,
      waitlist: [lead({ id: "w", createdAt: "2026-06-02T15:00:00.000Z", source: "city_lp" })],
      applications: [],
      approvals: [],
      rentals: [],
      truncated: true,
    });
    assert.equal(report.truncated, true);
    assert.equal(report.cap, 10000);
    assert.equal(report.totals.leads, 1);
    assert.equal(report.rows.length, 1);
  });
});

describe("screens", () => {
  it("extends Bookings and Leads and does not add a screen", () => {
    const bookings = readFileSync(new URL("../src/components/admin/BookingsPanel.tsx", import.meta.url), "utf8");
    const overview = readFileSync(new URL("../src/components/admin/OverviewPanel.tsx", import.meta.url), "utf8");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    const nav = readFileSync(new URL("../src/components/admin/nav-config.ts", import.meta.url), "utf8");
    const view = readFileSync(new URL("../src/components/admin/BookingConversion.tsx", import.meta.url), "utf8");
    assert.match(bookings, /<BookingConversion canView=\{canViewConversion\} \/>/);
    assert.match(
      overview,
      /<LeadPriorities isManager=\{canSeeCollections\} \/>\s*<BookingFollowupSlot \/>\s*<BookingConversion canView=\{canSeeCollections\} \/>/,
    );
    assert.match(admin, /canViewConversion=\{tierAllows\(tier, "manager"\)\}/);
    assert.equal(nav.includes("booking_conversion"), false);
    const gate = view.indexOf("if (BOOKING_CONVERSION_ENABLED !== true || canView !== true) return null;");
    const fetch = view.indexOf("useServerFn(getBookingConversion)");
    assert.ok(gate >= 0 && gate < fetch);
    assert.match(view, /Weeks Start Monday \(Eastern\)/);
    assert.match(view, /Counts Are Capped/);
    assert.match(view, /Leads \/ Requests/);
    assert.equal(/uppercase|lowercase|capitalize/.test(view), false);
    assert.equal(view.includes(".insert("), false);
    assert.equal(view.includes('.from("'), false);
  });
});
