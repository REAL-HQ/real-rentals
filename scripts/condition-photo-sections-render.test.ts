/**
 * Booking Inspections tab: Pickup / Return / Issues with Ours / Renter.
 * Run: bun test scripts/condition-photo-sections-render.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConditionPhotoSections, type ConditionPhotoItem } from "../src/components/ConditionPhotoSections";
import { fmtDateTime } from "../src/lib/date-format";

const TAKEN = "2026-11-12T15:04:00-05:00";
const UPLOADED = "2026-11-12T16:10:00-05:00";

function photo(partial: Partial<ConditionPhotoItem> & Pick<ConditionPhotoItem, "id">): ConditionPhotoItem {
  return {
    url: `https://example.test/${partial.id}.jpg`,
    phase: "checkout",
    angle: "front",
    captured_by_role: "staff",
    taken_at: TAKEN,
    taken_at_source: "exif",
    missing_exif_time: false,
    ...partial,
  };
}

function render(photos: ConditionPhotoItem[], extra: { showGps?: boolean; audience?: "staff" | "renter" } = {}) {
  return renderToStaticMarkup(
    createElement(ConditionPhotoSections, {
      photos,
      audience: extra.audience ?? "staff",
      showGps: extra.showGps,
    }),
  );
}

describe("admin booking condition photo sections", () => {
  it("renders Pickup, Return, and Issues, with Ours and Renter (not Yours)", () => {
    const html = render([]);
    assert.match(html, /data-testid="condition-section-pickup"/);
    assert.match(html, /data-testid="condition-section-return"/);
    assert.match(html, /data-testid="condition-section-during"/);
    assert.match(html, />Pickup</);
    assert.match(html, />Return</);
    assert.match(html, />Issues</);
    assert.match(html, />Ours</);
    assert.match(html, />Renter</);
    assert.doesNotMatch(html, />Yours</);
    assert.equal((html.match(/No Photos Yet/g) ?? []).length, 6);
  });

  it("maps Checkout photos to Pickup and checkin or return photos to Return", () => {
    const html = render([
      photo({ id: "pickup-ours", phase: "checkout", angle: "front", captured_by_role: "staff" }),
      photo({ id: "return-renter", phase: "checkin", angle: "rear", captured_by_role: "driver" }),
      photo({ id: "return-alias", phase: "return", angle: "driver_side", captured_by_role: "staff" }),
      photo({ id: "issue", phase: "damage", angle: "damage", captured_by_role: "driver" }),
    ]);

    const pickup = html.split('data-testid="condition-section-pickup"')[1].split('data-testid="condition-section-return"')[0];
    const ret = html.split('data-testid="condition-section-return"')[1].split('data-testid="condition-section-during"')[0];
    const issues = html.split('data-testid="condition-section-during"')[1];

    assert.match(pickup, /example\.test\/pickup-ours\.jpg/);
    assert.match(pickup, />Front</);
    assert.doesNotMatch(pickup, /Checkout/i);
    assert.doesNotMatch(pickup, /return-renter/);

    assert.match(ret, /example\.test\/return-renter\.jpg/);
    assert.match(ret, /example\.test\/return-alias\.jpg/);
    assert.match(ret, />Rear</);
    assert.match(ret, />Driver Side</);

    const retOurs = ret.split('data-testid="condition-role-return-staff"')[1].split('data-testid="condition-role-return-driver"')[0];
    const retRenter = ret.split('data-testid="condition-role-return-driver"')[1];
    assert.match(retOurs, /return-alias/);
    assert.match(retRenter, /return-renter/);

    assert.match(issues, /example\.test\/issue\.jpg/);
    assert.match(issues, />Damage</);
  });

  it("shows EXIF date/time and staff-only GPS, and hides GPS when asked", () => {
    const stamp = fmtDateTime(TAKEN);
    const uploadStamp = fmtDateTime(UPLOADED);
    const withGps = render([
      photo({
        id: "gps",
        gps_lat: 26.14123,
        gps_lng: -80.12345,
      }),
      photo({
        id: "upload-time",
        phase: "checkin",
        captured_by_role: "driver",
        taken_at: UPLOADED,
        taken_at_source: "upload",
        missing_exif_time: true,
        gps_lat: 25.7,
        gps_lng: -80.2,
      }),
    ]);
    assert.match(withGps, new RegExp(stamp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(withGps.split("gps.jpg")[1].split("upload-time")[0] ?? "", /Upload Time/);
    assert.match(withGps, new RegExp(uploadStamp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(withGps, /Upload Time/);
    assert.match(withGps, /data-testid="condition-photo-gps"/);
    assert.match(withGps, /GPS 26\.14123, -80\.12345/);

    const hidden = render(
      [
        photo({
          id: "gps",
          gps_lat: 26.14123,
          gps_lng: -80.12345,
        }),
      ],
      { showGps: false },
    );
    assert.doesNotMatch(hidden, /data-testid="condition-photo-gps"/);
    assert.doesNotMatch(hidden, /26\.14123/);
  });

  it("uses Yours, not Renter, in the renter audience, and still hides GPS", () => {
    const html = render(
      [photo({ id: "gps", gps_lat: 26.14, gps_lng: -80.12 })],
      { audience: "renter", showGps: false },
    );
    assert.match(html, />Yours</);
    assert.doesNotMatch(html, />Renter</);
    assert.doesNotMatch(html, /26\.14/);
  });

  it("keeps the booking Inspections tab on the shared staff layout", () => {
    const src = readFileSync(new URL("../src/components/admin/BookingDetails.tsx", import.meta.url), "utf8");
    assert.match(src, /ConditionPhotoSections/);
    assert.match(src, /audience="staff"/);
    assert.match(src, /showGps/);
    assert.doesNotMatch(src, /titleCase\(String\(m\.phase/);
  });
});
