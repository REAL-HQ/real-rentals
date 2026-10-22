// Roadside staff SMS. No network and no SMS.
// Run: node --import tsx --test scripts/roadside-sms-flag.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { deliverRoadsideStaffSms, type DriverIssueAlert } from "../src/lib/driver-issue-alert.server";

const FLAG = "ROADSIDE_SMS_ALERTS_ENABLED";
const prior = process.env[FLAG];

afterEach(() => {
  if (prior === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prior;
});

const issue: DriverIssueAlert = {
  issueId: null,
  title: "Flat tire",
  kind: "flat",
  severity: "urgent",
  rentalId: "rent-1",
  vehicleId: "veh-1",
};

describe("ROADSIDE_SMS_ALERTS_ENABLED", () => {
  it("does not read a phone or send while the constant is false, even if the env var is true", async () => {
    for (const value of [undefined, "", "false", "true", "TRUE", "1"]) {
      if (value === undefined) delete process.env[FLAG];
      else process.env[FLAG] = value;
      let calls = 0;
      const result = await deliverRoadsideStaffSms(issue, {
        readPhone: async () => {
          calls++;
          throw new Error("read");
        },
        send: async () => {
          calls++;
          throw new Error("send");
        },
      });
      assert.equal(result.skipped, "flag");
      assert.equal(result.sent, 0);
      assert.equal(calls, 0);
    }
  });
});

describe("wiring", () => {
  it("declares the constant once and checks it before any phone read or SMS send", () => {
    const flag = readFileSync(new URL("../src/lib/roadside-sms-flag.ts", import.meta.url), "utf8");
    const alert = readFileSync(new URL("../src/lib/driver-issue-alert.server.ts", import.meta.url), "utf8");
    assert.match(flag, /export const ROADSIDE_SMS_ALERTS_ENABLED = false/);
    assert.doesNotMatch(flag, /process\.env/);
    assert.doesNotMatch(alert, /process\.env\.ROADSIDE_SMS_ALERTS_ENABLED/);
    assert.doesNotMatch(alert, /export const ROADSIDE_SMS_ALERTS_ENABLED/);
    const deliver = alert.slice(alert.indexOf("export async function deliverRoadsideStaffSms"));
    const gate = deliver.indexOf("if (!ROADSIDE_SMS_ALERTS_ENABLED) return");
    const readPhone = deliver.indexOf("io.readPhone");
    const ioSend = deliver.indexOf("io.send");
    assert.ok(gate > 0 && readPhone > gate && ioSend > gate);
    const notify = alert.slice(alert.indexOf("export async function notifyManagersOfDriverIssue"));
    const notifyGate = notify.indexOf("if (ROADSIDE_SMS_ALERTS_ENABLED && plan.sms)");
    const read = notify.indexOf("getBusinessPhone");
    const send = notify.indexOf("sendSms");
    assert.ok(notifyGate > 0 && read > notifyGate && send > notifyGate);
  });
});
