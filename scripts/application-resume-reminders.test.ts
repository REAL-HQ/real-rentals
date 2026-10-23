import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { APPLICATION_RESUME_REMINDERS_ENABLED } from "../src/lib/application-resume-reminders-flag";
import {
  RESUME_REMINDER_READ_CAP,
  buildResumeReminders,
  isIdleOver24Hours,
  lastActivityLabel,
  type ResumeReminderSource,
} from "../src/lib/application-resume-reminders";

const flag = readFileSync("src/lib/application-resume-reminders-flag.ts", "utf8");
const rules = readFileSync("src/lib/application-resume-reminders.ts", "utf8");
const fn = readFileSync("src/lib/application-resume-reminders.functions.ts", "utf8");
const panel = readFileSync("src/components/admin/ApplicationResumeReminders.tsx", "utf8");
const drivers = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const admin = readFileSync("src/routes/admin.tsx", "utf8");
const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");

const now = new Date("2026-10-21T15:00:00.000Z");

function application(over: Partial<ResumeReminderSource> & { id: string }): ResumeReminderSource {
  return {
    full_name: "Ada Lopez",
    status: "partial",
    updated_at: "2026-10-19T15:00:00.000Z",
    contact_status: "attempted",
    contact_status_at: null,
    ...over,
  };
}

describe("application resume reminders", () => {
  it("stays off and refuses before the role check and any read", () => {
    assert.equal(APPLICATION_RESUME_REMINDERS_ENABLED, false);
    assert.equal((flag.match(/const APPLICATION_RESUME_REMINDERS_ENABLED/g) ?? []).length, 1);
    assert.match(flag, /export const APPLICATION_RESUME_REMINDERS_ENABLED: boolean = false as boolean/);
    assert.doesNotMatch(flag, /process\.env/);
    for (const source of [rules, fn, panel, drivers, admin]) {
      assert.equal((source.match(/const APPLICATION_RESUME_REMINDERS_ENABLED/g) ?? []).length, 0);
    }
    const middleware = fn.indexOf(".middleware([resumeReminderGate, requireSupabaseAuth])");
    const gate = fn.indexOf("if (APPLICATION_RESUME_REMINDERS_ENABLED !== true) throw new Error(\"Application resume reminders are not enabled.\")");
    assert.ok(gate !== -1 && middleware !== -1 && gate < middleware);
    const handler = fn.slice(fn.indexOf(".handler"));
    const thrown = handler.indexOf("APPLICATION_RESUME_REMINDERS_ENABLED !== true");
    const role = handler.indexOf("requireStaff");
    const read = handler.indexOf("context.supabase");
    assert.ok(thrown !== -1 && role !== -1 && read !== -1 && thrown < role && role < read);
    assert.ok(thrown < handler.indexOf("import("));
    assert.doesNotMatch(fn, /supabaseAdmin|client\.server|previewDriverId|inputValidator/);
    assert.match(fn, /\.from\("applications"\)/);
    assert.match(fn, /\.eq\("status", "partial"\)/);
    assert.match(fn, /\.is\("deleted_at", null\)/);
    assert.match(fn, /\.limit\(RESUME_REMINDER_READ_CAP \+ 1\)/);
    assert.equal(RESUME_REMINDER_READ_CAP, 999);
    assert.doesNotMatch(fn, /sendEmail|sendSms|resend|reissue|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.doesNotMatch(rules, /sendEmail|sendSms|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    assert.match(panel, /if \(APPLICATION_RESUME_REMINDERS_ENABLED !== true\) return null/);
    assert.match(panel, /Could Not Load Resume Reminders/);
    assert.match(panel, /Last Activity/);
    assert.match(panel, /Contact Status/);
    assert.doesNotMatch(panel, /reason\.message|sendEmail|Resend|text-transform|uppercase/);
    assert.match(drivers, /APPLICATION_RESUME_REMINDERS_ENABLED === true \? <ApplicationResumeReminders \/> : null/);
    assert.doesNotMatch(admin, /ApplicationResumeReminders|resume-reminders/);
    assert.doesNotMatch(nav, /resume_reminders|Resume Reminders/);
    assert.match(rules, /America\/New_York/);
  });

  it("lists only partial applications idle for more than 24 hours", () => {
    const list = buildResumeReminders({
      now,
      applications: [
        application({ id: "old", updated_at: "2026-10-19T14:00:00.000Z", contact_status: "voicemail" }),
        application({ id: "exact", updated_at: "2026-10-20T15:00:00.000Z" }),
        application({ id: "just", updated_at: "2026-10-20T14:59:59.000Z", contact_status: "interested" }),
        application({ id: "fresh", updated_at: "2026-10-21T14:00:00.000Z" }),
        application({ id: "submitted", status: "new", updated_at: "2026-10-01T00:00:00.000Z" }),
        application({
          id: "called",
          updated_at: "2026-10-01T00:00:00.000Z",
          contact_status_at: "2026-10-21T14:00:00.000Z",
          contact_status: "contacted",
        }),
        application({ id: "blank", full_name: "  ", updated_at: "2026-10-18T15:00:00.000Z", contact_status: null }),
      ],
    });
    assert.equal(list.truncated, false);
    assert.deepEqual(
      list.rows.map((row) => `${row.applicationId}:${row.driverName}:${row.contactStatusLabel}`),
      ["blank:Unnamed Driver:New", "old:Ada Lopez:Voicemail", "just:Ada Lopez:Interested"],
    );
    assert.equal(list.rows[1].lastActivityLabel, "Oct 19, 2026, 10:00 AM EDT");
    assert.equal(list.rows[1].driverSearch.id, "old");
    assert.equal(isIdleOver24Hours(application({ id: "exact", updated_at: "2026-10-20T15:00:00.000Z" }), now), false);
    assert.equal(isIdleOver24Hours(application({ id: "over", updated_at: "2026-10-20T14:59:59.999Z" }), now), true);
    assert.equal(lastActivityLabel(application({ id: "bad", updated_at: "not-a-date", contact_status_at: null })), "Unknown");
  });
});
