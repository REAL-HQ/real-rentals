import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { railEntries, resolveAdminTab } from "../src/components/admin/nav-config";
import {
  BOOKING_CONVERSION_ENABLED,
  BOOKING_CONVERSION_MAX_DAYS,
  BOOKING_CONVERSION_ROW_CAP,
  SUBMITTED_MEDIAN_NOTE,
  buildBookingConversion,
  calendarDay,
  daysBetween,
  defaultBookingRange,
  parseBookingRange,
  rangeInstants,
  takeCapped,
  type BookingApplicationRow,
  type BookingConversionStepId,
} from "../src/lib/booking-conversion";

function app(over: Partial<BookingApplicationRow> & Pick<BookingApplicationRow, "id">): BookingApplicationRow {
  return {
    status: "new",
    createdAt: "2026-06-04T16:00:00.000Z",
    deletedAt: null,
    waitlistSignedUpAt: null,
    cardOnFileAt: null,
    cardLast4: null,
    stripePaymentMethodId: null,
    ...over,
  };
}

function step(report: ReturnType<typeof buildBookingConversion>, id: BookingConversionStepId) {
  const found = report.steps.find((row) => row.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("booking conversion flag", () => {
  it("is a hard false constant declared once", () => {
    assert.equal(BOOKING_CONVERSION_ENABLED, false);
    const source = readFileSync(new URL("../src/lib/booking-conversion.ts", import.meta.url), "utf8");
    const declared = source.match(/export const BOOKING_CONVERSION_ENABLED: boolean = false;/g) ?? [];
    assert.equal(declared.length, 1);
    const server = readFileSync(new URL("../src/lib/booking-conversion.functions.ts", import.meta.url), "utf8");
    assert.equal(server.includes("BOOKING_CONVERSION_ENABLED: boolean"), false);
    assert.match(server, /middleware\(\[bookingConversionGate, requireSupabaseAuth\]\)/);
    const gate = server.slice(server.indexOf("const bookingConversionGate"), server.indexOf("const INPUT"));
    assert.ok(gate.indexOf("BOOKING_CONVERSION_ENABLED") < gate.indexOf("return next()"));
    const handler = server.slice(server.indexOf("handler(async"));
    assert.ok(handler.indexOf("assertBookingConversionEnabled") < handler.indexOf("requireManager"));
    assert.ok(handler.indexOf("requireManager") < handler.indexOf(".from("));
    assert.match(server, /limit\(LIMIT\)/);
    assert.match(server, /const LIMIT = BOOKING_CONVERSION_ROW_CAP \+ 1/);
    assert.equal(/\.(insert|update|delete|upsert|rpc)\(/.test(server), false);
    const panel = readFileSync(new URL("../src/components/admin/BookingConversionPanel.tsx", import.meta.url), "utf8");
    const admin = readFileSync(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
    assert.equal(panel.includes("uppercase"), false);
    assert.match(admin, /BOOKING_CONVERSION_ENABLED && tab === "booking_conversion"/);
    assert.equal(railEntries("owner").some((tab) => tab.id === "booking_conversion"), false);
    assert.equal(railEntries("manager").some((tab) => tab.id === "booking_conversion"), false);
    assert.equal(resolveAdminTab({ urlTab: "booking_conversion", tier: "owner", navTabs: [] }), "overview");
  });
});

describe("booking conversion dates", () => {
  it("uses Eastern midnights across the 2026 daylight-saving boundaries", () => {
    const spring = rangeInstants("2026-03-08", "2026-03-08");
    assert.equal(spring.start, "2026-03-08T05:00:00.000Z");
    assert.equal(spring.end, "2026-03-09T04:00:00.000Z");
    const fall = rangeInstants("2026-11-01", "2026-11-01");
    assert.equal(fall.start, "2026-11-01T04:00:00.000Z");
    assert.equal(fall.end, "2026-11-02T05:00:00.000Z");
    assert.equal(calendarDay("2026-03-08T04:30:00.000Z"), "2026-03-07");
    assert.equal(calendarDay("2026-03-08T05:30:00.000Z"), "2026-03-08");
    assert.equal(calendarDay("2026-03-08T06:30:00.000Z"), "2026-03-08");
    assert.equal(calendarDay("2026-03-08T07:30:00.000Z"), "2026-03-08");
    assert.equal(calendarDay("2026-11-01T03:30:00.000Z"), "2026-10-31");
    assert.equal(calendarDay("2026-11-01T04:30:00.000Z"), "2026-11-01");
    assert.equal(calendarDay("2026-11-02T04:30:00.000Z"), "2026-11-01");
    assert.equal(calendarDay("2026-11-02T05:30:00.000Z"), "2026-11-02");
  });

  it("rejects an inverted range, a fake day, and a span past 366 days", () => {
    assert.equal(parseBookingRange("2026-02-31", "2026-03-01").ok, false);
    assert.equal(parseBookingRange("2026-06-02", "2026-06-01").ok, false);
    assert.equal(parseBookingRange("2024-01-01", "2024-12-31").ok, true);
    assert.equal(daysBetween("2024-01-01", "2024-12-31") + 1, BOOKING_CONVERSION_MAX_DAYS);
    assert.equal(parseBookingRange("2024-01-01", "2025-01-01").ok, false);
    const range = defaultBookingRange(new Date("2026-10-21T15:00:00.000Z"));
    assert.equal(range.to, "2026-10-21");
    assert.equal(daysBetween(range.from, range.to) + 1, 30);
  });

  it("treats cap + 1 rows as overflow and keeps a full cap", () => {
    assert.deepEqual(takeCapped([1, 2], 2), { ok: true, rows: [1, 2] });
    assert.deepEqual(takeCapped([1, 2, 3], 2), { ok: false });
    assert.equal(takeCapped(Array.from({ length: BOOKING_CONVERSION_ROW_CAP + 1 })).ok, false);
  });
});

describe("booking conversion counts", () => {
  it("counts the cohort, rates, and median calendar days", () => {
    const report = buildBookingConversion({
      from: "2026-06-01",
      to: "2026-06-30",
      leads: [
        { id: "w1", createdAt: "2026-06-01T16:00:00.000Z", promotedApplicationId: null },
        { id: "w2", createdAt: "2026-06-02T16:00:00.000Z", promotedApplicationId: "a1" },
      ],
      applications: [
        app({
          id: "a1",
          createdAt: "2026-06-04T16:00:00.000Z",
          cardOnFileAt: "2026-06-10T16:00:00.000Z",
          cardLast4: "4242",
        }),
        app({ id: "a2", status: "partial", createdAt: "2026-06-06T16:00:00.000Z", waitlistSignedUpAt: "2026-06-01T16:00:00.000Z" }),
        app({ id: "a3", status: "approved", createdAt: "2026-06-06T16:00:00.000Z" }),
        app({ id: "a4", status: "declined", createdAt: "2026-06-07T16:00:00.000Z" }),
        app({ id: "deleted", createdAt: "2026-06-08T16:00:00.000Z", deletedAt: "2026-06-09T16:00:00.000Z" }),
      ],
      agreements: [
        { applicationId: "a1", status: "signed", signedAt: "2026-06-08T16:00:00.000Z", voidedAt: null },
        { applicationId: "a1", status: "voided", signedAt: "2026-06-01T16:00:00.000Z", voidedAt: "2026-06-02T16:00:00.000Z" },
      ],
      rentals: [
        { applicationId: "a1", createdAt: "2026-06-12T16:00:00.000Z" },
        { applicationId: "a1", createdAt: "2026-07-01T16:00:00.000Z" },
      ],
      approvals: [{ applicationId: "a1", createdAt: "2026-06-06T16:00:00.000Z" }],
    });

    assert.equal(step(report, "waitlist_leads").count, 3);
    assert.equal(step(report, "started").count, 4);
    assert.equal(step(report, "started").conversion, "133.3%");
    assert.equal(step(report, "submitted").count, 3);
    assert.equal(step(report, "submitted").conversion, "75%");
    assert.equal(step(report, "submitted").medianDays, null);
    assert.equal(step(report, "submitted").medianNote, SUBMITTED_MEDIAN_NOTE);
    assert.equal(step(report, "approved").count, 2);
    assert.equal(step(report, "approved").conversion, "66.7%");
    assert.equal(step(report, "approved").medianNote, SUBMITTED_MEDIAN_NOTE);
    assert.equal(step(report, "agreement_signed").count, 1);
    assert.equal(step(report, "agreement_signed").conversion, "50%");
    assert.equal(step(report, "agreement_signed").medianDays, "2 Days");
    assert.equal(step(report, "card_on_file").count, 1);
    assert.equal(step(report, "card_on_file").medianDays, "2 Days");
    assert.equal(step(report, "first_rental").count, 1);
    assert.equal(step(report, "first_rental").medianDays, "2 Days");
    assert.equal(step(report, "started").medianDays, "3.5 Days");
  });

  it("keeps a May waitlist out of a June cohort and follows it in May", () => {
    const leads = [{ id: "w", createdAt: "2026-05-01T16:00:00.000Z", promotedApplicationId: "a" }];
    const applications = [app({ id: "a", createdAt: "2026-06-05T16:00:00.000Z" })];
    const june = buildBookingConversion({
      from: "2026-06-01",
      to: "2026-06-30",
      leads,
      applications,
      agreements: [],
      rentals: [],
      approvals: [],
    });
    assert.equal(step(june, "started").count, 0);
    assert.equal(step(june, "waitlist_leads").count, 0);
    const may = buildBookingConversion({
      from: "2026-05-01",
      to: "2026-05-01",
      leads,
      applications,
      agreements: [],
      rentals: [],
      approvals: [],
    });
    assert.equal(step(may, "waitlist_leads").count, 1);
    assert.equal(step(may, "started").count, 1);
    assert.equal(step(may, "started").medianDays, "35 Days");
  });

  it("measures one calendar day across each 2026 midnight change and zero across the skipped hour", () => {
    const springGap = buildBookingConversion({
      from: "2026-03-07",
      to: "2026-03-08",
      leads: [{ id: "w", createdAt: "2026-03-08T04:30:00.000Z", promotedApplicationId: "a" }],
      applications: [app({ id: "a", createdAt: "2026-03-08T05:30:00.000Z" })],
      agreements: [],
      rentals: [],
      approvals: [],
    });
    assert.equal(step(springGap, "started").medianDays, "1 Day");

    const springSame = buildBookingConversion({
      from: "2026-03-08",
      to: "2026-03-08",
      leads: [{ id: "w", createdAt: "2026-03-08T06:30:00.000Z", promotedApplicationId: "a" }],
      applications: [app({ id: "a", createdAt: "2026-03-08T07:30:00.000Z" })],
      agreements: [],
      rentals: [],
      approvals: [],
    });
    assert.equal(step(springSame, "started").count, 1);
    assert.equal(step(springSame, "started").medianDays, "0 Days");

    const fallGap = buildBookingConversion({
      from: "2026-11-01",
      to: "2026-11-02",
      leads: [{ id: "w", createdAt: "2026-11-02T04:30:00.000Z", promotedApplicationId: "a" }],
      applications: [app({ id: "a", createdAt: "2026-11-02T05:30:00.000Z" })],
      agreements: [],
      rentals: [],
      approvals: [],
    });
    assert.equal(step(fallGap, "started").medianDays, "1 Day");
  });

  it("includes only the Eastern day asked for at each boundary", () => {
    const rows = [
      "2026-03-08T04:30:00.000Z",
      "2026-03-08T05:30:00.000Z",
      "2026-03-09T03:30:00.000Z",
      "2026-03-09T04:30:00.000Z",
    ].map((createdAt, index) => app({ id: `s${index}`, createdAt }));
    const spring = buildBookingConversion({
      from: "2026-03-08",
      to: "2026-03-08",
      leads: [],
      applications: rows,
      agreements: [],
      rentals: [],
      approvals: [],
    });
    assert.equal(step(spring, "started").count, 2);

    const fallRows = [
      "2026-11-01T03:30:00.000Z",
      "2026-11-01T04:30:00.000Z",
      "2026-11-02T04:30:00.000Z",
      "2026-11-02T05:30:00.000Z",
    ].map((createdAt, index) => app({ id: `f${index}`, createdAt }));
    const fall = buildBookingConversion({
      from: "2026-11-01",
      to: "2026-11-01",
      leads: [],
      applications: fallRows,
      agreements: [],
      rentals: [],
      approvals: [],
    });
    assert.equal(step(fall, "started").count, 2);
  });

  it("counts one person when two waitlist rows share a missing application", () => {
    const report = buildBookingConversion({
      from: "2026-06-01",
      to: "2026-06-02",
      leads: [
        { id: "w1", createdAt: "2026-06-01T16:00:00.000Z", promotedApplicationId: "gone" },
        { id: "w2", createdAt: "2026-06-02T16:00:00.000Z", promotedApplicationId: "gone" },
      ],
      applications: [],
      agreements: [],
      rentals: [],
      approvals: [],
    });
    assert.equal(step(report, "waitlist_leads").count, 1);
    assert.equal(step(report, "started").count, 0);
    assert.equal(step(report, "started").conversion, "0%");
  });

  it("leaves a card without a timestamp out of the median", () => {
    const report = buildBookingConversion({
      from: "2026-06-01",
      to: "2026-06-30",
      leads: [],
      applications: [app({ id: "a", cardLast4: "4242" })],
      agreements: [{ applicationId: "a", status: "signed", signedAt: "2026-06-08T16:00:00.000Z", voidedAt: null }],
      rentals: [],
      approvals: [{ applicationId: "a", createdAt: "2026-06-06T16:00:00.000Z" }],
    });
    assert.equal(step(report, "card_on_file").count, 1);
    assert.equal(step(report, "card_on_file").medianDays, null);
    assert.equal(step(report, "card_on_file").medianNote, "Not Recorded");
  });
});
