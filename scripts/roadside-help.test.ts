import { readFileSync } from "node:fs";
import {
  buildRoadsideIssue,
  driverIssueAlertPlan,
  issueAgeLabel,
  issueAlertBadge,
  pinIssues,
} from "../src/lib/driver-issues";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const portal = readFileSync("src/lib/portal.functions.ts", "utf8");
const alert = readFileSync("src/lib/driver-issue-alert.server.ts", "utf8");
const inbox = readFileSync("src/lib/driver-issues.functions.ts", "utf8");
const panel = readFileSync("src/components/admin/DriverIssuesPanel.tsx", "utf8");
const page = readFileSync("src/routes/portal.tsx", "utf8");
const incidents = readFileSync("src/lib/incidents.functions.ts", "utf8");

const create = portal.slice(portal.indexOf("export const createDriverIssue"), portal.indexOf("export type DriverReferral"));
ok(/driver_id: userId/.test(create), "a roadside report is filed as the signed-in driver");
ok(!/driver_id:\s*(data|d|input)\b/.test(create), "the client cannot choose whose issue is created");
ok(/\.eq\("driver_id", userId\)/.test(create), "the linked rental is the driver's own active rental");
ok(/\.eq\("driver_id", sc\.userId\)/.test(portal), "the driver list stays scoped to their own rows");

const off = driverIssueAlertPlan(
  { emailEnabled: false, smsEnabled: false },
  { kind: "flat", severity: "urgent" },
);
ok(off.email === false && off.sms === false, "both flags off sends nothing, including a roadside report");
ok(
  driverIssueAlertPlan({ emailEnabled: true, smsEnabled: false }, { kind: "tow", severity: "urgent" }).sms === false,
  "email on does not turn SMS on",
);
ok(
  driverIssueAlertPlan({ emailEnabled: false, smsEnabled: true }, { kind: "lockout", severity: "urgent" }).sms === true,
  "SMS is allowed only for a roadside kind when its flag is on",
);
ok(
  driverIssueAlertPlan({ emailEnabled: false, smsEnabled: true }, { kind: "vehicle", severity: "urgent" }).sms === false,
  "an urgent non-roadside report does not take the SMS path",
);
ok(process.env.DRIVER_ISSUE_ALERTS_ENABLED !== "true", "DRIVER_ISSUE_ALERTS_ENABLED is off in this run");
ok(process.env.ROADSIDE_SMS_ALERTS_ENABLED !== "true", "ROADSIDE_SMS_ALERTS_ENABLED is off in this run");
ok(/if \(!plan\.email && !plan\.sms\) return/.test(alert), "the notifier returns before it loads a provider");

const built = buildRoadsideIssue({
  kind: "lockout",
  location: "I-4 exit 7",
  drivable: false,
  note: "Keys inside",
});
ok(built.kind === "lockout" && built.severity === "urgent" && built.title === "Lockout", "lockout is stored as kind with urgent severity");
ok(built.body.includes("Location: I-4 exit 7") && built.body.includes("Drivable: No") && built.body.includes("Keys inside"), "location and drivable use the existing body text");
const blank = buildRoadsideIssue({ kind: "not-a-type", drivable: true });
ok(blank.kind === "breakdown" && blank.body.includes("Location: Not Given") && blank.body.includes("Drivable: Yes"), "an unknown type falls back to breakdown");

const ordered = pinIssues([
  { id: "old-normal", kind: "vehicle", severity: "normal", createdAt: "2026-10-21T05:00:00.000Z" },
  { id: "older-roadside", kind: "flat", severity: "urgent", createdAt: "2026-10-21T03:00:00.000Z" },
  { id: "urgent", kind: "vehicle", severity: "urgent", createdAt: "2026-10-21T04:00:00.000Z" },
  { id: "newer-roadside", kind: "breakdown", severity: "urgent", createdAt: "2026-10-21T06:00:00.000Z" },
  { id: "newest-normal", kind: "account", severity: "normal", createdAt: "2026-10-21T07:00:00.000Z" },
]).map((r) => r.id);
ok(
  ordered.join(",") === "newer-roadside,urgent,older-roadside,newest-normal,old-normal",
  "roadside and urgent rows pin above newer ordinary reports, newest first inside each group",
);
ok(issueAlertBadge({ kind: "flat", severity: "urgent" }) === "Roadside", "a roadside kind gets the Roadside badge");
ok(issueAlertBadge({ kind: "vehicle", severity: "urgent" }) === "Urgent", "other urgent rows get the Urgent badge");
ok(issueAlertBadge({ kind: "vehicle", severity: "normal" }) === null, "an ordinary report has no alert badge");
ok(inbox.includes("pinIssues("), "the inbox applies the pin order to the loaded rows");

const t = Date.parse("2026-10-21T05:40:00.000Z");
ok(issueAgeLabel("2026-10-21T05:40:00.000Z", t + 20_000) === "Just Now", "a fresh report reads Just Now");
ok(issueAgeLabel("2026-10-21T05:40:00.000Z", t + 5 * 60_000) === "5 Minutes", "age counts whole minutes");
ok(issueAgeLabel("2026-10-21T05:40:00.000Z", t + 90 * 60_000) === "1 Hour 30 Minutes", "age counts hours and leftover minutes");
ok(issueAgeLabel("2026-10-21T05:40:00.000Z", t + 3 * 24 * 60 * 60_000) === "3 Days", "age counts days after two days");

ok(page.includes("Need Roadside Help") && page.includes("buildRoadsideIssue"), "the portal entry builds a roadside issue");
ok(page.includes("businessPhone.display") && page.includes("Is The Car Drivable"), "the driver sees the company phone and the drivable choice");
ok(panel.includes("issueAlertBadge") && panel.includes("issueAgeLabel") && panel.includes("setInterval"), "the inbox shows the red badge and a ticking age");
ok(!incidents.includes("roadside") && !incidents.includes("driver-issues"), "incidents.functions.ts is untouched");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall roadside checks pass");
process.exit(fails ? 1 : 0);
