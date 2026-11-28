import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const column = readFileSync("src/components/admin/open-column.ts", "utf8");
const bookings = readFileSync("src/components/admin/BookingsPanel.tsx", "utf8");
const active = readFileSync("src/components/admin/ActiveRentalsPanel.tsx", "utf8");
const reserved = readFileSync("src/components/admin/ReservationsPanel.tsx", "utf8");
const drivers = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const vehicles = readFileSync("src/components/admin/VehiclesPanel.tsx", "utf8");
const incidents = readFileSync("src/components/admin/IncidentBoard.tsx", "utf8");

describe("Back-office lists have no Open column", () => {
  it("the whole row opens the record, so no Open header or button is left", () => {
    assert.doesNotMatch(column, /OPEN_COLUMN/);
    for (const [name, src] of Object.entries({ bookings, active, reserved, drivers, vehicles })) {
      assert.doesNotMatch(src, /OPEN_COLUMN/, name);
      assert.doesNotMatch(src, />\s*Open\s*<\/th>/, name);
      assert.doesNotMatch(src, /data-vehicles-open-col/, name);
    }
    assert.doesNotMatch(bookings, /Open <ArrowRight/);
    assert.doesNotMatch(vehicles, /Open( Record)? <ArrowRight/);
    assert.doesNotMatch(active, /<Link[^>]*>\s*Open\s*<\/Link>/);
    assert.doesNotMatch(reserved, /<Link[^>]*>\s*Open\s*<\/Link>/);
    assert.doesNotMatch(incidents, /"Hide" : "Open"/);
  });

  it("every one of those rows still opens through the shared row helper with a new tab link", () => {
    for (const [name, src] of Object.entries({ bookings, active, reserved, drivers, vehicles })) {
      assert.match(src, /rowOpenProps\(/, name);
      assert.match(src, /rowHref\(/, name);
    }
  });

  it("keeps the row menu in its own unlabeled column", () => {
    assert.match(column, /export const ROW_MENU_COLUMN/);
    assert.match(active, /ROW_MENU_COLUMN/);
    assert.match(reserved, /ROW_MENU_COLUMN/);
    assert.match(active, /aria-hidden="true"/);
    assert.match(reserved, /aria-hidden="true"/);
    // The Drivers menu column keeps a screen reader label.
    assert.match(drivers, /<span className="sr-only">Actions<\/span>/);
  });
});
