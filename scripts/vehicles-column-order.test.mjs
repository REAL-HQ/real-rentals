// Vehicles list: Readiness comes before Availability in the table header,
// the table cells and the Cards status row (Dolmar, Nov 9 2026).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/admin/VehiclesPanel.tsx", "utf8");
const head = src.indexOf('<th className="px-3 py-2 font-medium">Readiness</th>');
const headAvail = src.indexOf('<th className="px-3 py-2 font-medium">Availability</th>');
assert.ok(head > -1 && headAvail > -1, "both headers exist");
assert.ok(head < headAvail, "Readiness header comes before Availability");
assert.match(src, /<td[^>]*><ReadinessPill v=\{v\} \/><\/td>\s*<td[^>]*><Availability v=\{v\} \/><\/td>/, "cells follow the header order");
assert.match(src, /data-vehicle-status-row[^>]*><ReadinessPill v=\{v\} \/><Availability v=\{v\} \/><\/div>/, "Cards row uses the same order");
assert.equal((src.match(/<th className="px-3 py-2 font-medium">/g) ?? []).length, 8, "no column added or removed");
console.log("vehicles-column-order: ok");
