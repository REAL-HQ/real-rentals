// Role matrix for the back-office shell (run: bun scripts/admin-shell-roles.test.ts).
// Visibility only — server functions and RLS remain the enforcement.
import { visibleTabs, visibleApps, visibleCreateActions, appOf, navOwner, TABS } from "../src/components/admin/nav-config";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`); if (!c) fail++; };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

const owner = ids(visibleTabs("owner")), mgr = ids(visibleTabs("manager")), coord = ids(visibleTabs("coordinator"));
ok(owner.length === TABS.length, "Owner sees every destination");
ok(!mgr.includes("team") && !mgr.includes("settings"), "Manager: no Team/Settings");
ok(mgr.includes("payments") && mgr.includes("expenses"), "Manager: money screens");
for (const t of ["payments", "charges", "expenses", "automations", "team", "settings", "activity", "partners", "shops"])
  ok(!coord.includes(t), `Coordinator: no ${t}`);
ok(["overview", "drivers", "waitlist", "vehicles", "inspections", "vendors", "messages"].every((t) => coord.includes(t)), "Coordinator: operational screens");
ok(visibleTabs(null).length === 0 && visibleApps(null).length === 0, "No tier: nothing");

ok(JSON.stringify(ids(visibleApps("owner"))) === '["operations","messages","automations"]', "Owner dock: Operations, Messages, Automations");
ok(JSON.stringify(ids(visibleApps("coordinator"))) === '["operations","messages"]', "Coordinator dock: no Automations");
ok(!ids(visibleApps("owner")).some((a) => a === "esign" || a === "reports"), "No dead eSign/Reports apps");

ok(JSON.stringify(ids(visibleCreateActions("coordinator"))) === '["vehicle","fleet_files","message"]', "Coordinator Create: Add Vehicle, Upload Fleet Files, Send Message");
ok(ids(visibleCreateActions("manager")).length === 5, "Manager Create: all five");
ok(visibleTabs("coordinator").some((t) => t.id === "fleet_inbox" && t.group === "FLEET"), "Fleet Inbox under FLEET for Coordinator+");

ok(appOf("messages") === "messages" && appOf("automations") === "automations" && appOf("drivers") === "operations", "Tab → app mapping");
ok(!TABS.some((t) => (t.id === "messages" || t.id === "automations") && t.group), "Messages/Automations not duplicated in Operations nav");
ok(navOwner("shops") === "vendors" && !TABS.find((t) => t.id === "shops")!.group, "Repair Shops lives under Vendors");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
