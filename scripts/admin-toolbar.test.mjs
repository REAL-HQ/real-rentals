/**
 * Vehicles toolbar regression guard. No browser, no database.
 *
 * Historical failure: the row switched layouts on VIEWPORT breakpoints
 * (lg = 1024px window) while the admin column is the window minus the
 * sidebar, so "desktop" kicked in with ~830px and the actions misaligned;
 * control heights differed (py-2 vs h-9 vs a ~28px toggle); and a phone CSS
 * rule forced any `.admin-sticky-bar > .flex-wrap` into a side-scroll strip.
 * The old layout test then froze those lg: classes.
 *
 * Also: the shared top-bar search ("sch" typed on Drivers) was applied to
 * Vehicles silently — empty search box, no Clear, "No Matching Vehicles".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let checks = 0;
const check = (cond, label) => { assert.equal(cond, true, label); checks += 1; console.log("PASS", label); };

const vehicles = readFileSync("src/components/admin/VehiclesPanel.tsx", "utf8");
const toolbarSrc = readFileSync("src/components/admin/AdminToolbar.tsx", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");

const { AdminToolbar, TOOLBAR, TopSearchChip } = await import("../src/components/admin/AdminToolbar.tsx");

// Deliberate row membership: render the actual component, not a copied layout.
const html = renderToStaticMarkup(h(AdminToolbar, { search: h("input", { "aria-label": "q" }), filters: h("button", null, "Status"), actions: h("button", null, "Add Vehicle"), footer: h("span", null, "Fleet readiness") }));
check(html.includes('data-admin-toolbar'), "renders as the sticky filter bar");
check(/data-toolbar-primary[^]*data-toolbar-search[^]*aria-label="q"[^]*data-toolbar-actions/.test(html), "search and actions belong to one intentional row");
check(html.indexOf('data-toolbar-filters') > html.indexOf('Add Vehicle'), "filters are a separate row, not a wrapping sibling of actions");
check(html.indexOf('Fleet readiness') > html.indexOf('data-toolbar-filters'), "readiness stays below controls within sticky bar");
check(css.includes('container-type: inline-size') && css.includes('@container (max-width: 40rem)'), "adaptive layout uses available admin width");
check(css.includes('grid-template-columns: repeat(4, minmax(0, 1fr))') && css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'), "filters use balanced four/two-column grids instead of orphan wrapping");
for (const k of ["search", "select", "button", "primary", "segmented"]) check(/\bh-9\b/.test(TOOLBAR[k]), `TOOLBAR.${k} is h-9`);
check(TOOLBAR.search.includes('w-full') && TOOLBAR.select.includes('w-full'), "search and filters fill their assigned grid cells");
check(!TOOLBAR.search.includes('max-w-') && !TOOLBAR.select.includes('w-['), "no fixed control widths fight the grid");
check(/\bwhitespace-nowrap\b/.test(TOOLBAR.button) && /\bshrink-0\b/.test(TOOLBAR.button), "action labels do not squash or wrap");

const compact = renderToStaticMarkup(h(AdminToolbar, { compact: true, search: h("input", { "aria-label": "q" }), filters: h("button", null, "Status"), actions: h("button", null, "Add Vehicle") }));
check(compact.includes('data-toolbar-compact'), "compact variant is explicit, leaving default shared behavior intact");
check(compact.indexOf('data-toolbar-search') < compact.indexOf('data-toolbar-filters') && compact.indexOf('data-toolbar-filters') < compact.indexOf('data-toolbar-actions'), "compact source order matches visual and keyboard order");
check(css.includes('flex: 4 0 28rem') && css.includes('flex-wrap: wrap'), "content groups wrap on available space, not a viewport pin");
check(vehicles.includes('<AdminToolbar compact'), "Vehicles requests its natural-fit compact layout");

// 4. Vehicles uses it and has no leftover viewport-switched toolbar.
check(vehicles.includes("<AdminToolbar"), "Vehicles uses AdminToolbar");
check(!vehicles.includes("admin-sticky-bar flex flex-col lg:flex-row"), "the old lg:flex-row toolbar is gone");
check(!vehicles.includes("self-start lg:self-auto"), "the old lg: action row is gone");
for (const c of ["TOOLBAR.search", "TOOLBAR.select", "TOOLBAR.button", "TOOLBAR.primary", "TOOLBAR.segmented"]) check(vehicles.includes(c), `Vehicles uses ${c}`);
check(vehicles.includes("Add Vehicle") && vehicles.includes("fleet_inbox") && vehicles.includes('data-testid="fleet-readiness"'), "Add Vehicle, Import and Fleet readiness stay");

// 5. Top search is visible and clearable.
check(renderToStaticMarkup(h(TopSearchChip, { value: "  ", onClear() {} })) === "", "no chip when the top search is empty");
const chip = renderToStaticMarkup(h(TopSearchChip, { value: " sch ", onClear() {} }));
check(chip.includes("Top search:") && chip.includes("“sch”") && chip.includes('aria-label="Clear Top Search"'), "chip names the applied top search and offers Clear");
check(/const effectiveQ = \(externalSearch \|\| q\)\.trim\(\);/.test(vehicles), "top search still applies to Vehicles (shared search kept)");
check(vehicles.includes("<TopSearchChip value={externalSearch}"), "Vehicles shows the top-search chip");
check(/const hasActiveFilters = topSearch !== "" \|\|/.test(vehicles), "top search counts as an active filter (Clear shows)");
check(/function clearAll\(\)[\s\S]{0,250}onClearExternalSearch\?\.\(\)/.test(vehicles), "Clear also clears the top search");
check(vehicles.includes("No Vehicles Match “${topSearch}”") && vehicles.includes("The top search “${topSearch}” is also applied here"), "empty state names the top search instead of a bare No Matching Vehicles");
check(/action=\{hasActiveFilters \? <button onClick=\{clearAll\}/.test(vehicles), "empty state offers Clear Filters");
check(admin.includes('<VehiclesPanel externalSearch={globalSearch} onClearExternalSearch={() => setGlobalSearch("")}'), "admin wires the clear back to the top search box");


// Ordinal is a separate first column; mobile/cards retain the same number.
check(/aria-label="Row Number">#<\/th>\s*<th[^>]*>Unit/.test(vehicles), "narrow # column precedes Unit");
check(vehicles.includes('{v.unit_number ?? <span') && vehicles.includes('{v.unit_number ?? ""}'), "unit identifiers stay unchanged in table and cards");
check((vehicles.match(/rows\.map\(\(v, index\)/g) ?? []).length === 2 && (vehicles.match(/rowNumber\(index\)/g) ?? []).length === 2, "table and cards use the same visible ordinal");
check(vehicles.includes('vehicleRowNumber(result?.page ?? page, result?.pageSize ?? VEHICLE_LIST_PAGE_SIZE, index)'), "placeholder rows retain their returned page numbers while fetching");
check(vehicles.includes('vehicles total (including archived)') && vehicles.includes('{total} matching'), "fleet scope and filtered counts are explicitly labeled");
check(vehicles.includes('Loading vehicle total…') && vehicles.includes('Vehicle total unavailable'), "loading and missing counts never invent a zero");
check(!vehicles.includes('colSpan='), "empty and loading states are outside the table, so no stale colspans");

console.log(`${checks} admin toolbar checks passed`);
