import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DRIVER_NOTIFICATIONS_ENABLED,
  deliverDriverNotice,
  incidentOpenedNotice,
  issueStatusChangedNotice,
  rentalEndedNotice,
  type DriverNotice,
} from "../src/lib/driver-notifications";
import {
  notifyIncidentOpened,
  notifyIssueStatusChanged,
  notifyRentalEnded,
} from "../src/lib/driver-notifications.server";

const lib = readFileSync("src/lib/driver-notifications.ts", "utf8");
const server = readFileSync("src/lib/driver-notifications.server.ts", "utf8");
const issues = readFileSync("src/lib/driver-issues.functions.ts", "utf8");

const sample = {
  firstName: "Ada",
  email: "ada@example.com",
  phone: "4045550100",
  applicationId: "11111111-1111-4111-8111-111111111111",
  driverId: "22222222-2222-4222-8222-222222222222",
  rentalId: "33333333-3333-4333-8333-333333333333",
};

function notices(): DriverNotice[] {
  return [
    rentalEndedNotice({ ...sample, vehicleLabel: "2020 Toyota Camry" }),
    incidentOpenedNotice({ ...sample, incidentType: "breakdown" }),
    issueStatusChangedNotice({ ...sample, issueTitle: "Flat tire", statusLabel: "Resolved" }),
  ];
}

describe("driver notifications flag", () => {
  it("is a hard false, and nothing sends while it is off", async () => {
    assert.equal(DRIVER_NOTIFICATIONS_ENABLED, false);
    assert.match(lib, /export const DRIVER_NOTIFICATIONS_ENABLED: boolean = false as boolean/);
    assert.match(issues, /const DRIVER_NOTIFICATIONS_ENABLED: boolean = false as boolean/);

    let calls = 0;
    const send = async () => {
      calls += 1;
      throw new Error("driver notice sent");
    };
    for (const notice of notices()) {
      const result = await deliverDriverNotice(notice, { send });
      assert.equal(result.skipped, "flag");
      assert.equal(result.email, "skipped");
      assert.equal(result.sms, "skipped");
      assert.equal(result.inApp, "skipped");
    }
    assert.equal(await notifyRentalEnded(sample.rentalId).then((r) => r.skipped), "flag");
    assert.equal(await notifyIncidentOpened("44444444-4444-4444-8444-444444444444").then((r) => r.skipped), "flag");
    assert.equal(await notifyIssueStatusChanged("55555555-5555-4555-8555-555555555555").then((r) => r.skipped), "flag");
    assert.equal(calls, 0);

    const guard = lib.indexOf("if (DRIVER_NOTIFICATIONS_ENABLED !== true) return");
    const senderImport = lib.indexOf('import("@/lib/driver-notifications.server")');
    assert.ok(guard !== -1 && senderImport !== -1 && guard < senderImport);
  });

  it("loads and sends only after the flag check, on the activation channels", () => {
    for (const name of ["notifyRentalEnded", "notifyIncidentOpened", "notifyIssueStatusChanged"]) {
      const start = server.indexOf(`export async function ${name}`);
      assert.ok(start !== -1, name);
      const next = server.indexOf("\nexport async function", start + name.length);
      const body = server.slice(start, next === -1 ? server.length : next);
      const guard = body.indexOf("DRIVER_NOTIFICATIONS_ENABLED !== true");
      const work = body.search(/await db\(|deliverDriverNotice\(/);
      assert.ok(guard !== -1 && work !== -1 && guard < work, name);
      assert.doesNotMatch(body.slice(0, guard), /sendEmail|sendSms|from\("notifications"\)/);
    }
    const sendStart = server.indexOf("export async function sendDriverNoticeChannels");
    const sendBody = server.slice(sendStart);
    assert.match(sendBody, /import\("@\/lib\/email\.server"\)/);
    assert.match(sendBody, /sendEmail\(\{/);
    assert.match(sendBody, /import\("@\/lib\/sms\.server"\)/);
    assert.match(sendBody, /sendSms\(\{/);
    assert.match(sendBody, /from\("notifications"\)\.insert/);
    assert.match(sendBody, /channels: \["in_app", "email"\]/);
    assert.doesNotMatch(sendBody, /requireConsent:\s*false/);

    const hook = issues.indexOf('import("@/lib/driver-notifications.server")');
    assert.ok(hook !== -1);
    assert.match(issues.slice(Math.max(0, hook - 280), hook), /DRIVER_NOTIFICATIONS_ENABLED === true/);
    assert.doesNotMatch(issues, /from ["']@\/lib\/driver-notifications/);
  });

  it("does not put claim or staff detail in the renter copy", () => {
    const incident = incidentOpenedNotice({ ...sample, incidentType: "breakdown" });
    assert.equal(incident.kind, "incident_opened");
    assert.doesNotMatch(incident.emailHtml, /claim|deductible|at fault|staff note/i);
    assert.match(incident.smsBody, /Reply STOP to opt out/);
    const ended = rentalEndedNotice({ ...sample, vehicleLabel: "2020 Toyota Camry" });
    assert.match(ended.body, /2020 Toyota Camry/);
    assert.match(ended.emailHtml, /Open Driver Portal/);
    const issue = issueStatusChangedNotice({ ...sample, issueTitle: "Flat tire", statusLabel: "Resolved" });
    assert.match(issue.body, /Flat tire is now Resolved/);
    const hostile = issueStatusChangedNotice({ ...sample, issueTitle: "<script>", statusLabel: "Resolved" });
    assert.doesNotMatch(hostile.emailHtml, /<script>/);
    assert.match(hostile.emailHtml, /&lt;script&gt;/);
  });
});
