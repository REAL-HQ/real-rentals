import { readFileSync } from "node:fs";
import { formatIssueTimeEt, incidentSeedFromIssue, isIssueClosed, DRIVER_ISSUE_NOTES_ENABLED } from "../src/lib/driver-issues";
import { visibleTabs } from "../src/components/admin/nav-config";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const fn = readFileSync("src/lib/driver-issues.functions.ts", "utf8");
const portal = readFileSync("src/lib/portal.functions.ts", "utf8");
const alert = readFileSync("src/lib/driver-issue-alert.server.ts", "utf8");
const incidents = readFileSync("src/lib/incidents.functions.ts", "utf8");

ok(!/requireStaff\(/.test(fn), "the inbox does not call requireStaff (that would admit Coordinators)");
const tabIds = (tier: "coordinator" | "manager" | "owner") => visibleTabs(tier).map((t) => t.id);
ok(!tabIds("coordinator").includes("driver_issues"), "a Coordinator does not see Driver Issues");
ok(tabIds("manager").includes("driver_issues") && tabIds("owner").includes("driver_issues"), "a Manager and an Owner do");
ok(fn.split("await gate(").length >= 5, "list, status, note, and incident seed all pass the manager gate");
ok(/async function gate[\s\S]{0,180}requireManager\(userId\)/.test(fn), "the gate is requireManager, matching admin/team RLS");
ok(/\.eq\("driver_id", sc\.userId\)/.test(portal), "a driver still reads only their own issues");
ok(/driver_id: userId/.test(portal), "a driver still files the issue as themselves");

const create = portal.slice(portal.indexOf("export const createDriverIssue"), portal.indexOf("export type DriverReferral"));
ok(create.indexOf("if (error) return") < create.indexOf("notifyManagersOfDriverIssue"), "the staff alert runs only after the insert succeeds");
ok(!/from\("notifications"\)/.test(alert), "the staff alert does not write a driver-facing notification");
ok(/DRIVER_ISSUE_ALERTS_ENABLED = process\.env\.DRIVER_ISSUE_ALERTS_ENABLED === "true"/.test(alert), "external email stays off unless the env flag is true");
const roadsideFlag = readFileSync("src/lib/roadside-sms-flag.ts", "utf8");
ok(/export const ROADSIDE_SMS_ALERTS_ENABLED = false/.test(roadsideFlag), "roadside SMS is a hard-false constant");
ok(!/process\.env\.ROADSIDE_SMS_ALERTS_ENABLED/.test(alert + roadsideFlag), "env true cannot enable roadside SMS");
const notifyBody = alert.slice(alert.indexOf("export async function notifyManagersOfDriverIssue"));
const smsBranch = notifyBody.indexOf("if (ROADSIDE_SMS_ALERTS_ENABLED && plan.sms)");
ok(/if \(!plan\.email && !plan\.sms\) return/.test(notifyBody), "both flags off returns before mail or SMS");
ok(notifyBody.indexOf("if (!plan.email && !plan.sms) return") < notifyBody.indexOf("await import"), "the early return happens before either helper loads");
ok(smsBranch > 0 && !notifyBody.slice(0, smsBranch).includes("sendSms"), "sendSms is not called on the email path");
ok(notifyBody.slice(smsBranch).includes("sendSms"), "roadside SMS reuses the existing sendSms helper");

ok(DRIVER_ISSUE_NOTES_ENABLED === false, "staff notes are off");
ok(!/\.update\(\{[^}]*staff_note/.test(fn), "nothing writes a staff_note column");
ok(/Staff notes are not installed/.test(fn), "the note handler refuses");
ok(!fn.includes("incidents.functions"), "issue code does not call the incident writer");
ok(!incidents.includes("driver-issues"), "incidents.functions.ts was not wired to issues");

ok(isIssueClosed("resolved") && isIssueClosed("closed") && !isIssueClosed("open"), "open stays open; resolved and closed are the closed filter");
ok(formatIssueTimeEt("2026-10-21T05:40:00.000Z") === "Oct 21, 2026, 1:40 AM ET", "created time is Eastern Time");
const seed = incidentSeedFromIssue({
  kind: "vehicle",
  title: "Check engine light",
  body: "Started on the highway",
  vehicleId: "veh-1",
  createdAt: "2026-10-21T05:40:00.000Z",
});
ok(seed.incidentType === "other" && seed.vehicleId === "veh-1" && seed.description.includes("highway"), "a vehicle report prefills the incident form and does not invent a type");
ok(
  incidentSeedFromIssue({ kind: "breakdown", title: "Stalled", body: null, vehicleId: null, createdAt: "2026-10-21T05:40:00.000Z" }).incidentType === "breakdown",
  "a breakdown kind keeps the existing incident type",
);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall driver-issue access checks pass");
process.exit(fails ? 1 : 0);
