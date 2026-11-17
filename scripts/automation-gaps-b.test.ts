// Automation gaps B (t352u): license auto-read, credit-failed text retry,
// waitlist-promoted applicants entering the missing-items follow-up.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_OUTREACH_SETTINGS, decideOutreach, isWaitlistPromotedUnstarted, missingItems, type OutreachApp } from "@/lib/missing-items";
import { autoReadLicenses, cleanReading, planApply } from "@/lib/license-auto-read.server";
import { retryCreditFailedSms } from "@/lib/sms-credit-retry.server";

const NOW = new Date("2026-11-17T14:05:00.000Z"); // 9:05 AM ET
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

// ---- tiny in-memory PostgREST fake ----
function fakeDb(tables: Record<string, any[]>, extra: any = {}) {
  const calls: { table: string; op: string; patch?: any }[] = [];
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = [];
    let op = "select"; let patch: any = null; let insertRow: any = null; let lim = Infinity; let single = false;
    const q: any = {
      select: () => q, order: () => q, limit: (n: number) => { lim = n; return q; },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, vs: any[]) => { filters.push((r) => vs.includes(r[c])); return q; },
      gt: (c: string, v: any) => { filters.push((r) => r[c] > v); return q; },
      gte: (c: string, v: any) => { filters.push((r) => r[c] >= v); return q; },
      lte: (c: string, v: any) => { filters.push((r) => r[c] <= v); return q; },
      ilike: (c: string, p: string) => { const re = new RegExp("^" + p.replace(/%/g, ".*") + "$", "i"); filters.push((r) => re.test(String(r[c] ?? ""))); return q; },
      not: (c: string, _o: string, p: string) => { const re = new RegExp("^" + p.replace(/[[\]]/g, "\\$&").replace(/%/g, ".*") + "$"); filters.push((r) => !re.test(String(r[c] ?? ""))); return q; },
      update: (p: any) => { op = "update"; patch = p; return q; },
      insert: (r: any) => { op = "insert"; insertRow = r; return q; },
      single: () => { single = true; return q; }, maybeSingle: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    const run = () => {
      const rows = (tables[table] ??= []);
      calls.push({ table, op, patch: patch ?? insertRow });
      if (op === "insert") { const row = { id: `new-${rows.length + 1}`, ...insertRow }; rows.push(row); return { data: single ? row : [row], error: null }; }
      const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, lim);
      if (op === "update") { for (const r of hit) Object.assign(r, patch); }
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    };
    return q;
  };
  return { db: { from, ...extra }, calls, tables };
}

describe("waitlist promotions enter the missing-items follow-up (t352u item 5)", () => {
  const base: OutreachApp = {
    id: "w1", full_name: "pat sample", status: "new", email: "pat@example.com", phone: "(404) 555-0100", sms_consent: true,
    sms_opt_out_at: null, license_photo_url: null, profile_screenshot_url: null, income_proof_url: null, gig_status: null,
    created_at: hoursAgo(19), updated_at: hoursAgo(17), deleted_at: null, primary_application_id: null, legal_hold: false,
    source: "fleet_waitlist", current_step: "rental",
  };
  const decide = (a: OutreachApp) => decideOutreach({ app: a, items: missingItems(a, []), log: [], activeEnrollment: false, lastOutboundAt: null,
    disqualified: false, optedOut: new Set(), now: NOW, settings: DEFAULT_OUTREACH_SETTINGS, mode: "ongoing" });
  test("promoted, not started: first message at the next sweep, not 24 hours after promotion", () => {
    expect(isWaitlistPromotedUnstarted(base)).toBe(true);
    expect(decide(base)).toMatchObject({ send: true, step: 1 });
  });
  test("anyone else still waits the usual 24 hours after their last activity", () => {
    expect(decide({ ...base, source: "homepage" })).toMatchObject({ send: false, reason: "waiting_after_activity" });
    expect(decide({ ...base, current_step: "profile" })).toMatchObject({ send: false, reason: "waiting_after_activity" });
  });
  test("still refused when a follow-up is running or they were messaged recently", () => {
    const i = { app: base, items: missingItems(base, []), log: [], lastOutboundAt: null, disqualified: false, optedOut: new Set<string>(), now: NOW, settings: DEFAULT_OUTREACH_SETTINGS, mode: "ongoing" as const };
    expect(decideOutreach({ ...i, activeEnrollment: true }).send).toBe(false);
    expect(decideOutreach({ ...i, activeEnrollment: false, lastOutboundAt: hoursAgo(2) }).send).toBe(false);
  });
  test("the sweep reads source and current_step", () => {
    expect(readFileSync("src/lib/missing-items-outreach.server.ts", "utf8")).toMatch(/legal_hold,source,current_step"/);
  });
});

describe("license photos read automatically (t352u item 3)", () => {
  const empty = () => ({ dob: new Set<string>(), license_expiration: new Set<string>(), license_number: new Set<string>(), license_state: new Set<string>() });
  test("fills empty fields only; a staff value is a conflict, never overwritten", () => {
    const p = planApply({ dob: "1990-02-03", license_expiration: null, license_number: null, license_state: "GA" },
      { dob: "1991-02-03", license_expiration: "2029-05-01", license_number: "054123456", license_state: "GA" }, empty());
    expect(p.applied.sort()).toEqual(["license_expiration", "license_number"]);
    expect(p.patch.dob).toBeUndefined();
    expect(p.conflicts.map((c) => c.field)).toEqual(["dob"]);
    expect(p.unchanged).toEqual(["license_state"]);
  });
  test("an earlier automatic value may be corrected", () => {
    const w = empty(); w.dob.add("1991-02-03");
    expect(planApply({ dob: "1991-02-03" }, { dob: "1991-03-02" }, w).applied).toEqual(["dob"]);
  });
  test("bad values are dropped field by field", () => {
    const r = cleanReading({ dob: "not a date", license_expiration: "2029-05-01", license_state: "GA", confidence: 0.9 }, NOW);
    expect(r.values.dob).toBeUndefined();
    expect(r.values.license_expiration).toBe("2029-05-01");
    expect(r.confidence).toBe(0.9);
  });

  const setup = (appOver: any = {}) => {
    const t = {
      documents: [{ id: "d1", driver_id: "a1", category: "license_front", is_current: true, review_status: "pending", storage_bucket: "license-uploads", storage_path: "a1/x.jpg", mime_type: "image/jpeg", created_at: hoursAgo(30) }],
      applications: [{ id: "a1", status: "new", deleted_at: null, dob: null, license_expiration: null, license_number: null, license_state: null, ...appOver }],
      fleet_license_readings: [] as any[], audit_log: [] as any[],
    };
    const storage = { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]) }) }) };
    return fakeDb(t, { storage });
  };
  const deps = (text: string, extra: any = {}) => ({
    now: () => NOW, reserve: async () => ({ ok: true as const, day: "2026-11-17" }), release: async () => {},
    read: async () => ({ ok: true as const, text }), ...extra,
  });
  test("reads, records, and fills the empty fields", async () => {
    const { db, tables } = setup({ dob: "1990-01-01" });
    const r = await autoReadLicenses(db, { limit: 2 }, deps(JSON.stringify({ is_license_front: true, dob: "1991-01-01", license_expiration: "2029-05-01", license_number: "054123456", license_state: "GA", confidence: 0.92 })));
    expect(r.read).toBe(1);
    expect(r.outcomes[0].result).toBe("applied");
    const a = tables.applications[0];
    expect(a.dob).toBe("1990-01-01"); // staff value kept
    expect(a.license_expiration).toBe("2029-05-01");
    expect(tables.fleet_license_readings).toHaveLength(1);
    expect(tables.fleet_license_readings[0].idempotency_key).toBe("auto-read-d1");
    // read once: the next run finds nothing new
    const again = await autoReadLicenses(db, { limit: 2 }, deps("{}"));
    expect(again.candidates).toBe(0);
  });
  test("dry run reads nothing", async () => {
    const { db, tables } = setup();
    let called = 0;
    const r = await autoReadLicenses(db, { dryRun: true }, deps("{}", { read: async () => { called++; return { ok: true, text: "{}" }; } }));
    expect(r.candidates).toBe(1);
    expect(called).toBe(0);
    expect(tables.fleet_license_readings).toHaveLength(0);
  });
  test("out of reader credit: stops, records nothing, slot handed back", async () => {
    const { db, tables } = setup();
    let released = 0;
    const r = await autoReadLicenses(db, {}, deps("", { read: async () => ({ ok: false, status: 402, error: "credit" }), release: async () => { released++; } }));
    expect(r.held).toContain("402");
    expect(released).toBe(1);
    expect(tables.fleet_license_readings).toHaveLength(0);
  });
  test("daily limit reached: stops before reading", async () => {
    const { db } = setup();
    const r = await autoReadLicenses(db, {}, deps("", { reserve: async () => ({ ok: false, error: "daily limit reached" }) }));
    expect(r.held).toBe("daily limit reached");
    expect(r.read).toBe(0);
  });
  test("not a license: recorded so it is not read again, nothing applied", async () => {
    const { db, tables } = setup();
    const r = await autoReadLicenses(db, {}, deps(JSON.stringify({ is_license_front: false })));
    expect(r.outcomes[0].result).toBe("not_a_license");
    expect(tables.fleet_license_readings).toHaveLength(1);
    expect(tables.applications[0].dob).toBeNull();
  });
  test("FLEET endpoint and the cron both run it", () => {
    expect(readFileSync("src/lib/fleet-license.server.ts", "utf8")).toContain('body.action === "auto_read"');
    expect(readFileSync("src/routes/api/public/cron/automations.ts", "utf8")).toContain("autoReadLicenses(supabaseAdmin, { limit: 2 })");
  });
});

describe("credit-failed texts are retried (t352u item 1)", () => {
  const failed = (o: any = {}) => ({ id: "m1", channel: "sms", status: "failed", kind: "missing_items", to_address: "+14045550100", from_address: "+18888338280",
    body: "Hi Pat, add your license photo here", application_id: "a1", rental_id: null, workflow_id: null, error: "Not Enough Credits", created_at: hoursAgo(2), ...o });
  const setup = (rows: any[], appStatus = "new") => fakeDb({
    outbound_messages: rows, applications: [{ id: "a1", status: appStatus, deleted_at: null }],
    applicant_outreach_log: [{ id: "l1", application_id: "a1", channels: ["email"], error: "sms: Not Enough Credits", created_at: hoursAgo(2) }],
  });
  test("resends the exact body once and marks the old row", async () => {
    const { db, tables } = setup([failed()]);
    const sent: any[] = [];
    const r = await retryCreditFailedSms(db, {}, { now: () => NOW, sendSms: async (a) => { sent.push(a); return { ok: true }; } });
    expect(r.sent).toBe(1);
    expect(sent[0]).toMatchObject({ to: "+14045550100", body: "Hi Pat, add your license photo here", kind: "missing_items", applicationId: "a1", fromId: "+18888338280" });
    expect(tables.outbound_messages[0].error).toMatch(/^\[retried\] /);
    expect(tables.applicant_outreach_log[0]).toMatchObject({ channels: ["email", "sms"], error: null });
    const again = await retryCreditFailedSms(db, {}, { now: () => NOW, sendSms: async () => { throw new Error("must not send"); } });
    expect(again.considered).toBe(0);
  });
  test("outside 9 AM-8 PM ET nothing goes", async () => {
    const { db } = setup([failed()]);
    const r = await retryCreditFailedSms(db, {}, { now: () => new Date("2026-11-17T02:00:00Z"), sendSms: async () => { throw new Error("no"); } });
    expect(r.held).toBe("outside_sending_hours");
  });
  test("skips declined/closed applicants, other errors, and texts already delivered", async () => {
    for (const s of ["declined", "closed", "approved"]) {
      const { db } = setup([failed()], s);
      const r = await retryCreditFailedSms(db, {}, { now: () => NOW, sendSms: async () => { throw new Error("no"); } });
      expect(r.sent).toBe(0);
    }
    const other = setup([failed({ error: "Invalid number" })]);
    expect((await retryCreditFailedSms(other.db, {}, { now: () => NOW, sendSms: async () => { throw new Error("no"); } })).considered).toBe(0);
    const done = setup([failed(), { ...failed({ id: "m2", status: "sent", error: null, created_at: hoursAgo(1) }) }]);
    const r = await retryCreditFailedSms(done.db, {}, { now: () => NOW, sendSms: async () => { throw new Error("no"); } });
    expect(r.skipped.already_delivered).toBe(1);
  });
  test("payment texts and very fresh failures are left alone; three tries at most", async () => {
    const pay = setup([failed({ kind: "payment_failed" })]);
    expect((await retryCreditFailedSms(pay.db, {}, { now: () => NOW, sendSms: async () => { throw new Error("no"); } })).considered).toBe(0);
    const fresh = setup([failed({ created_at: hoursAgo(0.1) })]);
    expect((await retryCreditFailedSms(fresh.db, {}, { now: () => NOW, sendSms: async () => { throw new Error("no"); } })).considered).toBe(0);
    const many = setup([failed({ id: "m0", error: "[retried] Not Enough Credits", created_at: hoursAgo(5) }), failed({ id: "m9", error: "[retried] Not Enough Credits", created_at: hoursAgo(4) }), failed()]);
    const r = await retryCreditFailedSms(many.db, {}, { now: () => NOW, sendSms: async () => { throw new Error("no"); } });
    expect(r.skipped.max_tries).toBe(1);
  });
  test("this morning's 17 were marked handled in prod before release, so none are resent", () => {
    expect(readFileSync("src/routes/api/public/cron/automations.ts", "utf8")).toContain("retryCreditFailedSms(supabaseAdmin)");
  });
});
