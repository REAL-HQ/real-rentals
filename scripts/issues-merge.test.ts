import { LEGACY_TABS, TABS, railEntries } from "../src/components/admin/nav-config";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`); if (!c) fail++; };

ok(TABS.some((t) => t.id === "issues" && t.label === "Issues"), "Issues tab");
ok(!TABS.some((t) => t.id === "incidents" || t.id === "driver_issues"), "Old tabs gone");
ok(LEGACY_TABS.incidents.tab === "issues", "incidents → issues");
ok(LEGACY_TABS.driver_issues.tab === "issues" && LEGACY_TABS.driver_issues.filter === "driver", "driver_issues → issues?filter=driver");
ok(railEntries("manager").some((e) => e.id === "issues") && !railEntries("manager").some((e) => e.id === "driver_issues"), "Manager rail has Issues only");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
