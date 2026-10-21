import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DRIVER_NOTIFICATIONS_ENABLED,
  deliverDriverNotice,
  incidentOpenedNotice,
  noticeChannels,
  issueStatusChangedNotice,
  rentalEndedNotice,
  type DriverNotice,
} from "../src/lib/driver-notifications";
import {
  deliverDriverNoticeChannels,
  notifyIncidentOpened,
  notifyIssueStatusChanged,
  notifyRentalEnded,
  sendDriverNoticeChannels,
} from "../src/lib/driver-notifications.server";

const { describe, it } = process.versions.bun ? await import("bun:test") : await import("node:test");

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
    assert.equal((lib.match(/const DRIVER_NOTIFICATIONS_ENABLED/g) ?? []).length, 1);
    assert.equal((issues.match(/const DRIVER_NOTIFICATIONS_ENABLED/g) ?? []).length, 0);
    assert.match(issues, /import \{ DRIVER_NOTIFICATIONS_ENABLED \} from ["']@\/lib\/driver-notifications["']/);

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
    const channelGuard = sendBody.indexOf("if (DRIVER_NOTIFICATIONS_ENABLED !== true) return noticeHeld()");
    const channelSend = sendBody.indexOf("deliverDriverNoticeChannels(notice, deps)");
    assert.ok(channelGuard !== -1 && channelSend !== -1 && channelGuard < channelSend);
    assert.match(sendBody, /deps\.sendSms \?\? \(await import\("@\/lib\/sms\.server"\)\)\.sendSms/);
    assert.match(sendBody, /import\("@\/lib\/email\.server"\)/);
    assert.match(sendBody, /sendEmail\(\{/);
    assert.match(sendBody, /import\("@\/lib\/sms\.server"\)/);
    assert.match(sendBody, /sendSms\(\{/);
    assert.match(sendBody, /from\("notifications"\)\.insert/);
    assert.match(sendBody, /const r = await sendEmail\(/);
    assert.match(sendBody, /if \(!r\.ok\)/);
    assert.doesNotMatch(sendBody, /await sendEmail\([\s\S]{0,240}\);\s*result\.email = "sent"/);
    assert.match(sendBody, /channels: noticeChannels\(result\.email\)/);
    assert.doesNotMatch(sendBody, /channels:\s*\[[^\]]*email/);
    assert.doesNotMatch(sendBody, /requireConsent:\s*false/);
    assert.deepEqual(noticeChannels("sent"), ["in_app", "email"]);
    assert.deepEqual(noticeChannels("skipped"), ["in_app"]);
    assert.deepEqual(noticeChannels("failed"), ["in_app"]);

    const hook = issues.indexOf('import("@/lib/driver-notifications.server")');
    assert.ok(hook !== -1);
    assert.match(issues.slice(Math.max(0, hook - 400), hook), /DRIVER_NOTIFICATIONS_ENABLED === true/);
    assert.match(issues.slice(Math.max(0, hook - 80), hook), /try \{/);
    assert.match(issues, /await import\("@\/lib\/driver-notifications\.server"\)/);
    assert.match(issues, /await notifyIssueStatusChanged\(data\.id\)/);
    assert.doesNotMatch(issues, /void import\("@\/lib\/driver-notifications\.server"\)/);
    assert.doesNotMatch(issues, /from ["']@\/lib\/driver-notifications\.server["']/);
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

  it("does not call channel stubs while the flag is off", async () => {
    const notice = rentalEndedNotice({ ...sample, vehicleLabel: "2020 Toyota Camry" });
    let calls = 0;
    const result = await sendDriverNoticeChannels(notice, {
      sendEmail: async () => {
        calls += 1;
        return { ok: true };
      },
      sendSms: async () => {
        calls += 1;
        return { ok: true };
      },
      insertInApp: async () => {
        calls += 1;
        return { error: null };
      },
    });
    assert.equal(result.skipped, "flag");
    assert.equal(calls, 0);
  });

  it("marks email failed when sendEmail returns ok false", async () => {
    const notice = rentalEndedNotice({ ...sample, phone: null, vehicleLabel: "2020 Toyota Camry" });
    let channels: string[] | null = null;
    const result = await deliverDriverNoticeChannels(notice, {
      sendEmail: async () => ({ ok: false, error: "rejected" }),
      sendSms: async () => {
        throw new Error("sms stub should not run");
      },
      insertInApp: async (row) => {
        channels = [...row.channels];
        return { error: null };
      },
    });
    assert.equal(result.email, "failed");
    assert.equal(result.sms, "skipped");
    assert.equal(result.inApp, "sent");
    assert.deepEqual(channels, ["in_app"]);
  });

  it("uses the injected SMS sender", async () => {
    const notice = rentalEndedNotice({ ...sample, email: null, vehicleLabel: "2020 Toyota Camry" });
    let smsArgs: { to: string; applicationId: string } | null = null;
    const result = await deliverDriverNoticeChannels(notice, {
      sendSms: async (args) => {
        smsArgs = { to: args.to, applicationId: args.applicationId };
        return { ok: false, skipped: true };
      },
      insertInApp: async () => ({ error: null }),
    });
    assert.equal(result.sms, "skipped");
    assert.equal(result.email, "skipped");
    assert.deepEqual(smsArgs, { to: sample.phone, applicationId: sample.applicationId });
  });
});
