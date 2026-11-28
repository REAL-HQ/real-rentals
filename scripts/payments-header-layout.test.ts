/**
 * Payments workspace header: the section toggle shares the title row and
 * sits at the far right. The subtitle stays under the title. Other
 * workspaces keep the stacked toggle. Class checks only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const admin = readFileSync("src/routes/admin.tsx", "utf8");

describe("Payments header puts the section toggle on the title row", () => {
  it("aligns the existing toggle to the right of the Payments title and keeps the subtitle underneath", () => {
    assert.match(admin, /const paymentsHeader = ownerTab === "payments" && tab !== "overview" && tab !== "issues" && !recordParent/);
    assert.match(admin, /paymentsHeader \? \([\s\S]*?flex flex-wrap items-center justify-between gap-x-4 gap-y-2/);
    const paymentsBlock = admin.slice(admin.indexOf("paymentsHeader ? ("), admin.indexOf(") : ("));
    assert.match(paymentsBlock, /<h1 className="shrink-0 text-\[22px\] font-semibold tracking-tight text-\[#111114\]">\{workspace\.label\}<\/h1>/);
    assert.match(paymentsBlock, /<p className="text-\[13px\] text-\[#55555E\] mt-1">\{workspace\.description\}<\/p>/);
    assert.ok(paymentsBlock.indexOf("<h1") < paymentsBlock.indexOf("{sectionToggle"));
    assert.ok(paymentsBlock.indexOf("{sectionToggle") < paymentsBlock.indexOf("workspace.description"));
    assert.match(paymentsBlock, /max-w-full shrink-0 overflow-x-auto/);
    assert.doesNotMatch(paymentsBlock, /gradient|border-l-|border-t-\[|accent/);
  });

  it("keeps the segmented toggle's markup and leaves other workspaces stacked", () => {
    assert.equal((admin.match(/role="tablist"/g) ?? []).length, 1);
    assert.match(admin, /inline-flex rounded-lg bg-\[#F0F0F2\] p-0\.5 w-max/);
    assert.match(admin, /bg-white text-\[#111114\] shadow-sm/);
    assert.match(admin, /text-\[#55555E\] hover:text-\[#111114\]/);
    assert.match(admin, /aria-selected=\{tab === v\.id\}/);
    assert.match(admin, /-mx-4 px-4 md:mx-0 md:px-0 mb-3 overflow-x-auto/);
    assert.match(admin, /tab !== "overview" && tab !== "issues"/);
  });
});
