import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const messages = readFileSync("src/components/admin/MessagesOverlay.tsx", "utf8");

describe("Drivers row menu", () => {
  it("keeps one messaging action and drops Text / Open in Messages duplicates", () => {
    const menuStart = panel.indexOf('<DropdownMenuContent align="end" className="w-52 bg-white">');
    assert.ok(menuStart > 0);
    const menuEnd = panel.indexOf("</DropdownMenuContent>", menuStart);
    const menu = panel.slice(menuStart, menuEnd);
    assert.match(menu, /Send Message/);
    assert.doesNotMatch(menu, />\s*Text\s*</);
    assert.doesNotMatch(menu, /Open in Messages/);
    assert.match(menu, /Call/);
    assert.match(menu, /Record Payment/);
    assert.match(menu, /DropdownMenuSeparator/);
    assert.match(menu, /Delete/);
    // Delete is the last labeled action.
    assert.ok(menu.lastIndexOf("Delete") > menu.indexOf("Send Message"));
  });

  it("opens Record Payment in-place when an active rental exists", () => {
    assert.match(panel, /listRecordPay/);
    assert.match(panel, /RecordPaymentDialog/);
    assert.match(panel, /\.eq\("status", "active"\)/);
  });
});

describe("Drivers list layout", () => {
  it("wraps filter chips and drops the horizontal chip scroller", () => {
    assert.match(panel, /flex min-w-0 flex-wrap items-center gap-2/);
    assert.doesNotMatch(panel, /lg:overflow-x-auto lg:-mx-1/);
  });

  it("fits the table at 1280 without sideways scroll and keeps actions sticky", () => {
    assert.match(panel, /data-testid="drivers-table"/);
    assert.match(panel, /table-fixed/);
    assert.doesNotMatch(panel, /max-lg:min-w-\[56rem\]/);
    assert.match(panel, /sticky right-0/);
    assert.match(panel, /<th className="hidden">Email<\/th>/);
    assert.match(panel, /<th className="hidden">Deposit<\/th>/);
    assert.match(panel, /<th className="hidden">Created<\/th>/);
  });
});

describe("Send Message overlay", () => {
  it("does not re-fetch the thread on every render (avoids stuck Loading…)", () => {
    assert.match(messages, /open \+ applicationId only/);
    assert.match(messages, /Could Not Open This Conversation/);
    assert.match(messages, /Write the first one below/);
  });
});
