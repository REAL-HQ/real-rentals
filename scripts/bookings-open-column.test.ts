import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const column = readFileSync("src/components/admin/open-column.ts", "utf8");
const bookings = readFileSync("src/components/admin/BookingsPanel.tsx", "utf8");
const active = readFileSync("src/components/admin/ActiveRentalsPanel.tsx", "utf8");
const reserved = readFileSync("src/components/admin/ReservationsPanel.tsx", "utf8");

describe("Bookings Open column", () => {
  it("shares one alignment and does not pin the header to the page edge", () => {
    assert.match(column, /export const OPEN_COLUMN = "[^"]+"/);
    const openClass = column.match(/export const OPEN_COLUMN = "([^"]+)"/)?.[1] ?? "";
    assert.equal(openClass.includes("sticky") || openClass.includes("right-0"), false);
    assert.match(openClass, /text-center/);
    for (const src of [bookings, active, reserved]) {
      assert.match(src, /OPEN_COLUMN/);
      assert.doesNotMatch(src, /sticky right-0/);
      assert.match(src, />Open<\/th>/);
    }
  });

  it("keeps the row menu in its own unlabeled column", () => {
    assert.match(column, /export const ROW_MENU_COLUMN/);
    assert.match(active, /ROW_MENU_COLUMN/);
    assert.match(reserved, /ROW_MENU_COLUMN/);
    assert.doesNotMatch(bookings, /ROW_MENU_COLUMN/);
    assert.match(active, /aria-hidden="true"/);
    assert.match(reserved, /aria-hidden="true"/);
  });
});
