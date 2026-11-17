// Staff coverage hours, DST/day-off edges, other-Quo-line picking, and
// handoff text routing. Network refused. No staff phone literals in new code.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;

const cov = await import("@/lib/staff-coverage");
const srv = await import("@/lib/staff-coverage.server");
const lines = (await import("@/lib/sms-provider.server")).QUO_KNOWN_SENDERS;
const LINE_888 = "PNrZULvFMn";
const LINE_813 = "PNcX8a0PLJ";

const schedules = cov.DEFAULT_STAFF_SCHEDULES;
const rosa = schedules.find((s) => s.staffKey === "rosa")!;
const FIELD_REP_TEST = "+10000000000";

describe("Rosa weekly hours (America/New_York, start inclusive / end exclusive)", () => {
  // Monday 5 Jan 2026 is EST (UTC-5). 2:00 PM ET = 19:00Z, 6:00 PM ET = 23:00Z.
  test("Monday start and end minutes in EST", () => {
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-05T18:59:00Z"))).toBe(false); // 1:59 PM
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-05T19:00:00Z"))).toBe(true); // 2:00 PM
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-05T22:59:00Z"))).toBe(true); // 5:59 PM
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-05T23:00:00Z"))).toBe(false); // 6:00 PM
  });

  // Monday 6 Jul 2026 is EDT (UTC-4). 2:00 PM ET = 18:00Z, 6:00 PM ET = 22:00Z.
  test("Monday start and end minutes in EDT (DST)", () => {
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-07-06T17:59:00Z"))).toBe(false); // 1:59 PM
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-07-06T18:00:00Z"))).toBe(true); // 2:00 PM
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-07-06T21:59:00Z"))).toBe(true); // 5:59 PM
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-07-06T22:00:00Z"))).toBe(false); // 6:00 PM
  });

  test("Tuesday and Wednesday 9 AM–3 PM, Friday 9 AM–1 PM", () => {
    // Tue 6 Jan 2026 EST: 9:00 AM = 14:00Z, 3:00 PM = 20:00Z
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-06T13:59:00Z"))).toBe(false);
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-06T14:00:00Z"))).toBe(true);
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-06T19:59:00Z"))).toBe(true);
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-06T20:00:00Z"))).toBe(false);
    // Wed 7 Jan 2026
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-07T14:00:00Z"))).toBe(true);
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-07T20:00:00Z"))).toBe(false);
    // Fri 2 Jan 2026 EST: 9:00 AM = 14:00Z, 1:00 PM = 18:00Z
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-02T14:00:00Z"))).toBe(true);
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-02T17:59:00Z"))).toBe(true);
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-02T18:00:00Z"))).toBe(false);
  });

  test("Thursday, Saturday and Sunday are off", () => {
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-08T16:00:00Z"))).toBe(false); // Thu 11 AM
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-10T16:00:00Z"))).toBe(false); // Sat
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-01-11T16:00:00Z"))).toBe(false); // Sun
  });
});

describe("DST transition days", () => {
  // DST starts 2026-03-08 2:00 AM ET. Monday 2026-03-09 is EDT.
  test("the Monday after spring-forward still uses 2:00–6:00 PM local", () => {
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-03-09T17:59:00Z"))).toBe(false); // 1:59 PM EDT
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-03-09T18:00:00Z"))).toBe(true); // 2:00 PM EDT
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-03-09T22:00:00Z"))).toBe(false); // 6:00 PM EDT
  });

  // DST ends 2026-11-01 2:00 AM ET. Monday 2026-11-02 is EST.
  test("the Monday after fall-back still uses 2:00–6:00 PM local", () => {
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-11-02T18:59:00Z"))).toBe(false); // 1:59 PM EST
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-11-02T19:00:00Z"))).toBe(true); // 2:00 PM EST
    expect(cov.isStaffOnDuty(rosa, [], new Date("2026-11-02T23:00:00Z"))).toBe(false); // 6:00 PM EST
  });
});

describe("exceptions and on-duty resolution", () => {
  test("an off exception wins over a working Tuesday", () => {
    const ex = [{ staffKey: "rosa", date: "2026-01-06", kind: "off" as const, start: null, end: null, note: "Holiday" }];
    expect(cov.isStaffOnDuty(rosa, ex, new Date("2026-01-06T16:00:00Z"))).toBe(false);
    expect(cov.resolveOnDuty(schedules, ex, new Date("2026-01-06T16:00:00Z"))?.schedule.staffKey).toBe("dolmar");
  });

  test("an on exception covers a Thursday with its own window", () => {
    const ex = [{ staffKey: "rosa", date: "2026-01-08", kind: "on" as const, start: "10:00", end: "14:00", note: "Extra coverage" }];
    expect(cov.isStaffOnDuty(rosa, ex, new Date("2026-01-08T14:59:00Z"))).toBe(false); // 9:59 AM EST
    expect(cov.isStaffOnDuty(rosa, ex, new Date("2026-01-08T15:00:00Z"))).toBe(true); // 10:00 AM
    expect(cov.isStaffOnDuty(rosa, ex, new Date("2026-01-08T18:59:00Z"))).toBe(true); // 1:59 PM
    expect(cov.isStaffOnDuty(rosa, ex, new Date("2026-01-08T19:00:00Z"))).toBe(false); // 2:00 PM
  });

  test("after hours and Rosa's hours resolve to the right person", () => {
    const mon2pm = new Date("2026-01-05T19:00:00Z");
    const mon7pm = new Date("2026-01-06T00:00:00Z"); // Monday 7:00 PM EST
    expect(cov.resolveOnDuty(schedules, [], mon2pm)?.schedule.staffKey).toBe("rosa");
    expect(cov.resolveOnDuty(schedules, [], mon2pm)?.until).toBe("18:00");
    expect(cov.resolveOnDuty(schedules, [], mon7pm)?.schedule.staffKey).toBe("dolmar");
    expect(cov.resolveOnDuty(schedules, [], mon7pm)?.source).toBe("after_hours");
  });
});

describe("applicant call hours and renter texts", () => {
  test("no applicant calls after 6:00 PM ET, including the 6:00 minute", () => {
    expect(cov.mayPlaceApplicantCall(new Date("2026-01-05T12:59:00Z"))).toBe(false); // 7:59 AM EST
    expect(cov.mayPlaceApplicantCall(new Date("2026-01-05T13:00:00Z"))).toBe(true); // 8:00 AM
    expect(cov.mayPlaceApplicantCall(new Date("2026-01-05T22:59:00Z"))).toBe(true); // 5:59 PM
    expect(cov.mayPlaceApplicantCall(new Date("2026-01-05T23:00:00Z"))).toBe(false); // 6:00 PM
    // DST: 6:00 PM EDT on 6 Jul is 22:00Z
    expect(cov.mayPlaceApplicantCall(new Date("2026-07-06T21:59:00Z"))).toBe(true);
    expect(cov.mayPlaceApplicantCall(new Date("2026-07-06T22:00:00Z"))).toBe(false);
  });

  test("renter texting hours stay 8 AM–9 PM ET", () => {
    expect(cov.mayTextRenter(new Date("2026-01-05T13:00:00Z"))).toBe(true); // 8:00 AM
    expect(cov.mayTextRenter(new Date("2026-01-06T01:59:00Z"))).toBe(true); // 8:59 PM Mon
    expect(cov.mayTextRenter(new Date("2026-01-06T02:00:00Z"))).toBe(false); // 9:00 PM
  });
});

describe("other company line", () => {
  test("picks the line the renter is not already on, by id or E.164", () => {
    expect(cov.otherCompanyLine(lines, LINE_888)?.id).toBe(LINE_813);
    expect(cov.otherCompanyLine(lines, LINE_813)?.id).toBe(LINE_888);
    expect(cov.otherCompanyLine(lines, "+18888338280")?.id).toBe(LINE_813);
    expect(cov.otherCompanyLine(lines, "+18132124174")?.id).toBe(LINE_888);
  });

  test("missing or unknown active line defaults to the other-than-default line", () => {
    expect(lines[0].id).toBe(LINE_888);
    expect(cov.otherCompanyLine(lines, null)?.id).toBe(LINE_813);
    expect(cov.otherCompanyLine(lines, "PNunknown")?.id).toBe(LINE_813);
    expect(cov.otherCompanyLine(lines, "")?.id).toBe(LINE_813);
  });

  test("never returns the same line the renter is on", () => {
    for (const id of [LINE_888, LINE_813, "+18888338280", "+18132124174", null]) {
      const active = cov.activeCompanyLine(lines, id)!;
      const other = cov.otherCompanyLine(lines, id)!;
      expect(other.id).not.toBe(active.id);
      expect(other.e164).not.toBe(active.e164);
    }
  });

  test("company-line check recognizes both lines and rejects others", () => {
    expect(cov.isCompanyLine(lines, LINE_888)).toBe(true);
    expect(cov.isCompanyLine(lines, "+18132124174")).toBe(true);
    expect(cov.isCompanyLine(lines, "+15555550123")).toBe(false);
    expect(cov.isCompanyLine(lines, null)).toBe(false);
  });
});

describe("handoff SMS plan", () => {
  const coverage = { schedules: [...schedules], exceptions: [], fromDefaults: true };
  const rosaHours = new Date("2026-01-05T19:00:00Z"); // Mon 2:00 PM EST
  const afterHours = new Date("2026-01-06T00:00:00Z"); // Mon 7:00 PM EST
  const night = new Date("2026-01-06T04:00:00Z"); // Mon 11:00 PM EST

  test("during Rosa's hours a regular handoff texts the other line from the renter's line", async () => {
    const plan = await srv.planStaffHandoffSms({
      admin: { from: () => ({ select: () => Promise.resolve({ data: [], error: { code: "42P01" } }) }) },
      now: rosaHours,
      reason: "complaint",
      activeLine: LINE_888,
      fieldRepNumbers: [FIELD_REP_TEST],
      coverage,
    });
    expect(plan.quietHours).toBe(false);
    expect(plan.coverage.onDuty?.staffKey).toBe("rosa");
    expect(plan.targets).toEqual([
      expect.objectContaining({ to: "+18132124174", fromId: LINE_888, via: "other_quo_line", staffKey: "rosa" }),
    ]);
    expect(plan.toLine?.id).toBe(LINE_813);
    expect(plan.fromLine?.id).toBe(LINE_888);
  });

  test("a renter already on 813 is handed off to 888", async () => {
    const plan = await srv.planStaffHandoffSms({
      admin: {},
      now: rosaHours,
      reason: "complaint",
      activeLine: LINE_813,
      fieldRepNumbers: [FIELD_REP_TEST],
      coverage,
    });
    expect(plan.targets[0]).toMatchObject({ to: "+18888338280", fromId: LINE_813, via: "other_quo_line" });
  });

  test("outside Rosa's hours a regular handoff texts the field-rep setting", async () => {
    const plan = await srv.planStaffHandoffSms({
      admin: {},
      now: afterHours,
      reason: "complaint",
      activeLine: LINE_888,
      fieldRepNumbers: [FIELD_REP_TEST],
      coverage,
    });
    expect(plan.coverage.onDuty?.staffKey).toBe("dolmar");
    expect(plan.targets).toEqual([
      expect.objectContaining({ to: FIELD_REP_TEST, via: "field_rep_sms", staffKey: "dolmar" }),
    ]);
  });

  test("non-urgent handoffs wait for 8 AM–9 PM ET; injuries go to the field rep at any hour", async () => {
    const quiet = await srv.planStaffHandoffSms({
      admin: {},
      now: night,
      reason: "complaint",
      activeLine: LINE_888,
      fieldRepNumbers: [FIELD_REP_TEST],
      coverage,
    });
    expect(quiet.quietHours).toBe(true);
    expect(quiet.targets).toEqual([]);

    const injury = await srv.planStaffHandoffSms({
      admin: {},
      now: night,
      reason: "injury",
      activeLine: LINE_888,
      fieldRepNumbers: [FIELD_REP_TEST],
      coverage,
    });
    expect(injury.quietHours).toBe(false);
    expect(injury.targets).toEqual([
      expect.objectContaining({ to: FIELD_REP_TEST, via: "field_rep_sms" }),
    ]);
  });

  test("an injury during Rosa's hours texts the other line and the field rep", async () => {
    const plan = await srv.planStaffHandoffSms({
      admin: {},
      now: rosaHours,
      reason: "injury",
      activeLine: LINE_888,
      fieldRepNumbers: [FIELD_REP_TEST],
      coverage,
    });
    expect(plan.targets.map((t) => t.via).sort()).toEqual(["field_rep_sms", "other_quo_line"]);
    expect(plan.targets.some((t) => t.to === "+18132124174" && t.fromId === LINE_888)).toBe(true);
    expect(plan.targets.some((t) => t.to === FIELD_REP_TEST)).toBe(true);
  });
});

describe("no staff phone numbers in the new coverage code", () => {
  test("staff-coverage sources have no +1XXXXXXXXXX literals", () => {
    for (const f of [
      "src/lib/staff-coverage.ts",
      "src/lib/staff-coverage.server.ts",
      "supabase/migrations/20261117030000_staff_schedules.sql",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/\+1\d{10}/);
    }
  });
});
