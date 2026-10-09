// Role matrix for the back-office shell (run: bun scripts/admin-shell-roles.test.ts).
// Visibility only — server functions and RLS remain the enforcement.
import { railEntries, visibleWorkspaceTabs, visibleTabs, visibleCreateActions, navOwner, TABS, LEGACY_TABS, visibleSettingsSections } from "../src/components/admin/nav-config";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`); if (!c) fail++; };
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

const owner = ids(visibleTabs("owner")), mgr = ids(visibleTabs("manager")), coord = ids(visibleTabs("coordinator"));
ok(owner.length === TABS.length, "Owner sees every destination");
ok(visibleSettingsSections("manager").length > 0, "Manager: Settings sections (opened from profile menu)");
ok(JSON.stringify(ids(visibleSettingsSections("manager"))) === '["website","maintenance","vehicle_defaults","automations","activity"]', "Manager Settings: Website, Vehicle Defaults, Maintenance, Automations, Activity");
ok(ids(visibleSettingsSections("owner")).includes("team") && ids(visibleSettingsSections("owner")).includes("automations"), "Owner Settings: Team + Automations");
ok(visibleSettingsSections("coordinator").length === 0, "Coordinator: no Settings sections");
ok(mgr.includes("payments") && mgr.includes("expenses"), "Manager: money screens");
for (const t of ["payments", "charges", "expenses", "settings", "activity", "partners", "shops"])
  ok(!coord.includes(t), `Coordinator: no ${t}`);
ok(["overview", "drivers", "vehicles", "inspections", "vendors"].every((t) => coord.includes(t)), "Coordinator: operational screens");
ok(visibleTabs(null).length === 0, "No tier: nothing");

ok(!TABS.some((t) => ["messages", "automations", "team"].includes(t.id)), "No Messages/Automations/Team in main nav");
ok(LEGACY_TABS.waitlist.tab === "drivers" && LEGACY_TABS.waitlist.filter === "waitlist", "Old Waitlist bookmark → Drivers → Waitlist");
ok(!TABS.some((t) => t.id === "waitlist"), "No Waitlist in main nav");
ok(LEGACY_TABS.automations.section === "automations" && LEGACY_TABS.team.section === "team" && LEGACY_TABS.messages.messages === true, "Old bookmarks resolve");

ok(JSON.stringify(ids(visibleCreateActions("coordinator"))) === '["vehicle","fleet_files"]', "Coordinator Create: Add Vehicle, Upload Fleet Files");
ok(ids(visibleCreateActions("manager")).length === 5, "Manager Create: all five (incl. Service)");
ok(visibleTabs("coordinator").some((t) => t.id === "fleet_inbox" && t.group === "FLEET"), "Fleet Inbox under FLEET for Coordinator+");
ok(navOwner("shops") === "partners" && navOwner("vendors") === "partners" && navOwner("charges") === "payments" && navOwner("inspections") === "maintenance", "Child tabs highlight their workspace");
const rail = (t: any) => railEntries(t).map((e) => e.label).join(",");
ok(rail("owner") === "Overview,Drivers,Payments,Vehicles,Fleet Inbox,Service,Incidents,Expenses,Partners", "Owner rail matches target: " + rail("owner"));
ok(rail("coordinator") === "Overview,Drivers,Vehicles,Fleet Inbox,Service,Partners", "Coordinator rail: " + rail("coordinator"));
ok(JSON.stringify(visibleWorkspaceTabs("maintenance", "coordinator").map((k) => k.id)) === '["inspections"]', "Coordinator Service: Inspections only");
ok(JSON.stringify(visibleWorkspaceTabs("partners", "coordinator").map((k) => k.id)) === '["vendors"]', "Coordinator Partners: Vendors only");
ok(railEntries("coordinator").find((e) => e.id === "maintenance")!.href === "inspections", "Coordinator Service link opens Inspections");
ok(visibleWorkspaceTabs("payments", "coordinator").length === 0, "Coordinator: no Payments/Charges");
ok(LEGACY_TABS.websites.section === "website" && LEGACY_TABS.activity.section === "activity", "Websites/Activity bookmarks → Settings");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
