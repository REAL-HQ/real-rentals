/**
 * Vehicles table at ~1024px content width: the right edge (Open column) was
 * clipped by lg:overflow-hidden. The table now scrolls sideways inside its card
 * at every width, and the Open column stays pinned on the right. Class checks only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/admin/VehiclesPanel.tsx", "utf8");
let n = 0;
const ok = (cond, label) => { assert.equal(cond, true, label); n++; console.log("PASS", label); };

const scroller = src.match(/<div data-vehicles-table-scroller className="([^"]+)"/);
ok(!!scroller, "the vehicles table has one scroller");
const cls = scroller[1].split(/\s+/);
ok(cls.includes("overflow-x-auto"), "it scrolls sideways at every width");
ok(cls.includes("min-w-0"), "it can shrink inside the admin column");
ok(!cls.some((c) => /overflow-hidden|overflow-x-clip/.test(c)), "it never clips the right edge");
ok(cls.includes("hidden") && cls.includes("md:block"), "the table still shows from md up (cards below)");

const table = src.slice(scroller.index).match(/<table className="([^"]+)"/)[1].split(/\s+/);
ok(table.includes("min-w-[64rem]") && !table.some((c) => c.startsWith("max-lg:min-w")), "the table keeps one min width at every width");

const openCols = [...src.matchAll(/<t[hd] data-vehicles-open-col className="([^"]+)"/g)].map((m) => m[1].split(/\s+/));
ok(openCols.length === 2, "the Open header and cell are both marked");
for (const c of openCols) {
  ok(c.includes("sticky") && c.includes("right-0"), "the Open column is pinned to the right");
  ok(c.some((x) => /^bg-(white|\[#)/.test(x)), "the pinned column has a solid background");
  ok(c.includes("border-l"), "the pinned column has a solid divider");
  ok(!c.some((x) => /gradient|from-|to-|via-/.test(x)), "no gradients");
}
ok(/<tr key=\{v\.id\}.{0,120}className="group /.test(src), "row hover reaches the pinned cell");
ok(src.includes('group-hover:bg-[#FAFAFB]'), "the pinned cell follows the row hover color");
ok(/<span className="sr-only">Open<\/span>/.test(src), "the Open header label stays for screen readers");
ok(src.includes("<AdminToolbar"), "the toolbar is untouched (scripts/admin-toolbar.test.mjs guards it)");
console.log(`vehicles-table-scroll: ${n} checks ok`);
