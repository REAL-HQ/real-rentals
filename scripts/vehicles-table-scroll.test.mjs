/**
 * Vehicles table at ~1024px content width: the right edge was
 * clipped by lg:overflow-hidden. The table now scrolls sideways inside its card
 * at every width. The Open column is gone (the whole row opens). Class checks only.
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

ok(!/data-vehicles-open-col/.test(src), "the Open column is gone: the whole row opens the vehicle");
ok(!/>\s*Open(\s+Record)?\s*</.test(src) && !/<span className="sr-only">Open<\/span>/.test(src), "no Open or Open Record button is left");
ok(/<tr key=\{v\.id\}.{0,120}className="group /.test(src), "row hover styling is kept");
ok(/rowOpenProps\(\(\) => setViewing\(v\.id\), rowHref\(\{ tab: "vehicles", id: v\.id \}\)\)/.test(src), "rows and cards open the vehicle and carry a new tab link");
ok(src.includes("<AdminToolbar"), "the toolbar is untouched (scripts/admin-toolbar.test.mjs guards it)");
console.log(`vehicles-table-scroll: ${n} checks ok`);
