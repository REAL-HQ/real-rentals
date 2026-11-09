/**
 * Vehicles toolbar regression guard. No browser, no database.
 *
 * Why it kept breaking: the row switched layouts on VIEWPORT breakpoints
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

// 1. No viewport breakpoints decide the toolbar layout.
const allToolbarClasses = [toolbarSrc.match(/className="[^"]*"|className=\{`[^`]*`\}/g).join(" "), ...Object.values(TOOLBAR)].join(" ");
check(!/(?<![\w-])(sm|md|lg|xl):/.test(allToolbarClasses), "AdminToolbar layout uses no sm:/md:/lg:/xl: viewport switches");
check(!/\bmax-(md|lg|xl):/.test(allToolbarClasses), "AdminToolbar uses only max-sm: (phone full-width), nothing at tablet/desktop widths");

// 2. Every control is the same height.
for (const k of ["search", "select", "button", "primary", "segmented"]) check(/\bh-9\b/.test(TOOLBAR[k]), `TOOLBAR.${k} is h-9`);
check(!/\bpy-[12]\b/.test(Object.values(TOOLBAR).join(" ")), "no control sizes itself by vertical padding");
check(/\bwhitespace-nowrap\b/.test(TOOLBAR.button) && /\bshrink-0\b/.test(TOOLBAR.button) && /\bshrink-0\b/.test(TOOLBAR.primary), "action buttons never wrap their label or get squashed");

// 3. Structure: filters wrap, actions stay together at the right.
const html = renderToStaticMarkup(h(AdminToolbar, { filters: h("input", { "aria-label": "q" }), actions: h("button", null, "Add Vehicle"), footer: h("span", null, "Fleet readiness") }));
check(html.includes('class="admin-sticky-bar') && html.includes("data-admin-toolbar"), "renders as the sticky filter bar");
check(/data-toolbar-filters[^>]*|class="[^"]*flex-wrap[^"]*"[^>]*data-toolbar-filters/.test(html) && /flex-wrap[^"]*"\s+data-toolbar-filters/.test(html), "filter group wraps by available width");
check(/class="[^"]*ml-auto[^"]*shrink-0[^"]*"\s+data-toolbar-actions/.test(html), "actions are one ml-auto, shrink-0 group");
check(html.indexOf("Fleet readiness") > html.indexOf("Add Vehicle") && html.includes("Fleet readiness") && html.lastIndexOf("</div>") > html.indexOf("Fleet readiness"), "readiness footer stays inside the sticky bar");
check(css.includes(".admin-sticky-bar[data-admin-toolbar] > .flex-wrap") && /\[data-admin-toolbar\] > \.flex-wrap \{\s*flex-wrap: wrap;\s*overflow-x: visible;/.test(css), "phone side-scroll rule is overridden for AdminToolbar");

// 4. Vehicles uses it and has no leftover viewport-switched toolbar.
check(vehicles.includes("<AdminToolbar"), "Vehicles uses AdminToolbar");
check(!vehicles.includes("admin-sticky-bar flex flex-col lg:flex-row"), "the old lg:flex-row toolbar is gone");
check(!vehicles.includes("self-start lg:self-auto"), "the old lg: action row is gone");
for (const c of ["TOOLBAR.search", "TOOLBAR.select", "TOOLBAR.button", "TOOLBAR.primary", "TOOLBAR.segmented"]) check(vehicles.includes(c), `Vehicles uses ${c}`);
check(vehicles.includes("Add Vehicle") && vehicles.includes("fleet_inbox") && vehicles.includes('data-testid="fleet-readiness"'), "Add Vehicle, Import and Fleet readiness stay");
check(vehicles.includes("const VEHICLE_TOOLBAR") && vehicles.includes('w-[7.75rem]') && vehicles.includes('replace("h-9", "h-8")'), "Vehicles derives a compact 100%-desktop toolbar from the shared controls");
check(vehicles.includes("text-[13px]") && vehicles.includes("[&_td]:py-1") && vehicles.includes("[&_th]:py-1.5"), "Vehicles compacts table type and row spacing without changing shared tables");

// 5. Top search is visible and clearable.
check(renderToStaticMarkup(h(TopSearchChip, { value: "  ", onClear() {} })) === "", "no chip when the top search is empty");
const chip = renderToStaticMarkup(h(TopSearchChip, { value: " sch ", onClear() {} }));
check(chip.includes("Top search:") && chip.includes("“sch”") && chip.includes('aria-label="Clear top search"'), "chip names the applied top search and offers Clear");
check(/const effectiveQ = \(externalSearch \|\| q\)\.trim\(\);/.test(vehicles), "top search still applies to Vehicles (shared search kept)");
check(vehicles.includes("<TopSearchChip value={externalSearch}"), "Vehicles shows the top-search chip");
check(/const hasActiveFilters = topSearch !== "" \|\|/.test(vehicles), "top search counts as an active filter (Clear shows)");
check(/function clearAll\(\)[\s\S]{0,250}onClearExternalSearch\?\.\(\)/.test(vehicles), "Clear also clears the top search");
check(vehicles.includes("No Vehicles Match “${topSearch}”") && vehicles.includes("The top search “${topSearch}” is also applied here"), "empty state names the top search instead of a bare No Matching Vehicles");
check(/action=\{hasActiveFilters \? <button onClick=\{clearAll\}/.test(vehicles), "empty state offers Clear Filters");
check(admin.includes('<VehiclesPanel externalSearch={globalSearch} onClearExternalSearch={() => setGlobalSearch("")}'), "admin wires the clear back to the top search box");


// Ordinal is a separate first column; the table's old Unit cell is now a
// private staff thumbnail/slideshow, while cards retain their unit identifier.
check(/aria-label="Row number">#<\/th>\s*<th[^>]*>Photo/.test(vehicles), "narrow # column precedes Photo");
check(vehicles.includes("<VehicleListThumbnail vehicle={v} />"), "table unit cells are replaced by the vehicle thumbnail");
check(vehicles.includes('{v.unit_number ?? ""}'), "unit identifiers stay unchanged in cards");
check(vehicles.includes("async function openPhotos") && vehicles.includes("event.stopPropagation();") && vehicles.includes("<VehiclePhotoViewer"), "thumbnail clicks stop row navigation and open the shared slideshow");
check((vehicles.match(/rows\.map\(\(v, index\)/g) ?? []).length === 2 && (vehicles.match(/rowNumber\(index\)/g) ?? []).length === 2, "table and cards use the same visible ordinal");
check(vehicles.includes('vehicleRowNumber(result?.page ?? page, result?.pageSize ?? VEHICLE_LIST_PAGE_SIZE, index)'), "placeholder rows retain their returned page numbers while fetching");
check(vehicles.includes('vehicles total (including archived)') && vehicles.includes('{total} matching'), "fleet scope and filtered counts are explicitly labeled");
check(vehicles.includes('Loading vehicle total…') && vehicles.includes('Vehicle total unavailable'), "loading and missing counts never invent a zero");
check(!vehicles.includes('colSpan='), "empty and loading states are outside the table, so no stale colspans");

console.log(`${checks} admin toolbar checks passed`);
