/**
 * Workspace headers that have a section toggle share one layout: the pill
 * sits on the title row at the far right, and the subtitle stays under the
 * title. Drivers, Payments, Service, and Partners all use it. Class checks only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const admin = readFileSync("src/routes/admin.tsx", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");

describe("Workspace headers put the section toggle on the title row", () => {
  it("uses one title-row layout for every workspace toggle, with the subtitle underneath", () => {
    assert.match(admin, /const shellTitle = tab !== "overview" && tab !== "issues" && !recordParent/);
    assert.doesNotMatch(admin, /paymentsHeader/);
    assert.doesNotMatch(admin, /-mx-4 px-4 md:mx-0 md:px-0 mb-3 overflow-x-auto/);
    const header = admin.slice(admin.indexOf("{shellTitle ? ("), admin.indexOf(") : null}"));
    assert.match(header, /flex flex-wrap items-center justify-between gap-x-4 gap-y-2/);
    assert.match(header, /<h1 className="shrink-0 text-\[22px\] font-semibold tracking-tight text-\[#111114\]">\{workspace\.label\}<\/h1>/);
    assert.match(header, /<div className="max-w-full shrink-0 overflow-x-auto">\{sectionToggle\}<\/div>/);
    assert.match(header, /<p className="text-\[13px\] text-\[#55555E\] mt-1">\{workspace\.description\}<\/p>/);
    assert.ok(header.indexOf("<h1") < header.indexOf("{sectionToggle}"));
    assert.ok(header.indexOf("{sectionToggle}") < header.indexOf("workspace.description"));
    assert.doesNotMatch(header, /gradient|border-l-|border-t-\[|accent/);
  });

  it("covers Drivers, Payments, Service, and Partners with the same toggle", () => {
    assert.match(nav, /drivers: \[\{ id: "drivers", label: "Drivers" \}, \{ id: "dnc", label: "DNC" \}\]/);
    assert.match(nav, /payments: \[\{ id: "payments", label: "Payments" \}, \{ id: "charges", label: "Charges" \}/);
    assert.match(nav, /maintenance: \[\{ id: "maintenance", label: "Maintenance" \}, \{ id: "inspections", label: "Inspections" \}\]/);
    assert.match(nav, /partners: \[\{ id: "partners", label: "Partners" \}, \{ id: "vendors", label: "Vendors" \}\]/);
    assert.match(admin, /workspaceTabs\.length > 1 && !recordParent/);
    assert.match(admin, /ownerTab in WORKSPACE_TABS/);
  });

  it("keeps the segmented toggle's markup and still hides the shell title on records", () => {
    assert.equal((admin.match(/role="tablist"/g) ?? []).length, 1);
    assert.match(admin, /inline-flex rounded-lg bg-\[#F0F0F2\] p-0\.5 w-max/);
    assert.match(admin, /bg-white text-\[#111114\] shadow-sm/);
    assert.match(admin, /text-\[#55555E\] hover:text-\[#111114\]/);
    assert.match(admin, /aria-selected=\{tab === v\.id\}/);
    assert.match(admin, /tab !== "overview" && tab !== "issues"/);
    assert.match(admin, /!recordParent/);
  });
});
