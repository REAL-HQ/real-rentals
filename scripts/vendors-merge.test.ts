import { VENDOR_TYPES } from "../src/components/admin/VendorsPanel";
import { LEGACY_TABS, TABS, WORKSPACE_TABS } from "../src/components/admin/nav-config";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`); if (!c) fail++; };

ok(VENDOR_TYPES.some((t) => t.value === "repair_shop" && t.label === "Repair"), "Repair type exists");
ok(VENDOR_TYPES.every((t) => !t.label.includes(" ") && !t.label.includes("/")), "Type labels are one word");
ok(!TABS.some((t) => t.id === "shops"), "No shops tab");
ok(!WORKSPACE_TABS.partners.some((t) => t.id === "shops"), "Partners workspace has no Repair Shops");
ok(LEGACY_TABS.shops.tab === "vendors" && LEGACY_TABS.shops.filter === "repair_shop", "Legacy shops → vendors");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
