// Missing-Items Outreach: rules, copy, idempotency, migration and wiring.
// No network: the database is an in-memory fake (or PGlite for the SQL), and
// the senders, link minting and Automations switch are injected.
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { AUTOMATIONS, isAutomationOn, isDefaultOff, settingKeyForEmailWorkflow } from "@/lib/automation-catalog";
import {
  DEFAULT_OUTREACH_SETTINGS, MISSING_ITEMS_AUTOMATION_KEY, MISSING_ITEMS_BACKFILL_KEY, MISSING_ITEMS_BACKFILL_WORKFLOW,
  MISSING_ITEMS_EMAIL_WORKFLOW, MISSING_ITEM_COPY, MISSING_ITEM_KEYS, canText, decideOutreach,
  decideAutoClose, comeBackEmail, comeBackSms, MISSING_ITEMS_AUTOCLOSE_KEY, MISSING_ITEMS_AUTOCLOSE_WORKFLOW, missingItems, missingKey, outreachEmail, outreachSms, readOutreachSettings, redactContact,
  type DecisionInput, type OutreachApp, type OutreachLogRow,
} from "@/lib/missing-items";
import { easternHour, handleFleetMissingItems, reopenAutoClosed, runMissingItemsAutoClose, runMissingItemsOutreach } from "@/lib/missing-items-outreach.server";

const NOW = new Date("2026-11-16T17:00:00.000Z"); // 12:00 PM ET
const daysAgo = (d: number, from = NOW) => new Date(from.getTime() - d * 86_400_000).toISOString();
const S = DEFAULT_OUTREACH_SETTINGS;
const app = (o: Partial<OutreachApp> = {}): OutreachApp => ({
  id: "a1", full_name: "jordan sample", status: "new", email: "jordan@example.com", phone: "(404) 555-0134",
  sms_consent: true, sms_opt_out_at: null, dob: null, license_expiration: null, license_photo_url: null,
  profile_screenshot_url: null, income_proof_url: null,
  vehicle_size: "Sedan", pickup_date: "2026-11-20", expected_duration: "1_month", gig_status: "active", drive_type: "full_time", created_at: daysAgo(10), updated_at: daysAgo(5),
  deleted_at: null, primary_application_id: null, legal_hold: false, ...o,
});
const decide = (o: Partial<DecisionInput> = {}) => {
  const a = o.app ?? app();
  return decideOutreach({ app: a, items: missingItems(a, []), log: [], activeEnrollment: false, lastOutboundAt: null,
    disqualified: false, optedOut: new Set(), now: NOW, settings: S, mode: "ongoing", ...o });
};
const ALL = [...MISSING_ITEM_KEYS];
const vars = { firstName: "Jordan", items: ALL, link: "https://drivereal.com/thank-you?t=X", companyPhone: "(888) 833-8280" };

describe("what counts as missing", () => {
  test("files only: license front, gig profile, income (DOB and expiry are read from the licence photo, never asked)", () => {
    expect(missingItems(app(), [])).toEqual(ALL.filter((k) => k !== "application_details"));
    const full = app({ license_photo_url: "a1/x.jpg", profile_screenshot_url: "a1/y.jpg", income_proof_url: "a1/z.pdf" });
    expect(missingItems(full, [])).toEqual([]);
  });
  test("a lead who never finished the first pages also owes the application answers", () => {
    expect(missingItems(app({ pickup_date: null }), [])[0]).toBe("application_details");
    expect(missingItems(app({ drive_type: " " }), [])).toContain("application_details");
  });
  test("vault documents count; rejected or replaced ones do not; legacy http URLs do not", () => {
    const a = app({ license_photo_url: "https://old.example/x.jpg" });
    expect(missingItems(a, [{ category: "license_front", review_status: "approved", is_current: true }])).not.toContain("license_front");
    expect(missingItems(a, [{ category: "license_front", review_status: "rejected", is_current: true }])).toContain("license_front");
    expect(missingItems(a, [{ category: "gig_profile", review_status: "pending", is_current: false }])).toContain("gig_profile");
    expect(missingItems(a, [])).toContain("license_front");
  });
  test("never asks for the licence back, insurance, background check or MVR", () => {
    const words = JSON.stringify(MISSING_ITEM_COPY).toLowerCase();
    for (const w of ["back of", "insurance", "background", "mvr", "motor vehicle record"]) expect(words).not.toContain(w);
  });
  test("missing key is order-independent", () => {
    expect(missingKey(["income", "gig_profile"])).toBe(missingKey(["gig_profile", "income"]));
  });
});

describe("settings", () => {
  test("defaults; clamps junk", () => {
    expect(readOutreachSettings(null)).toEqual(S);
    const r = readOutreachSettings({ waitHours: -5, reminderDays: [9, 2], statuses: ["approved", "new"], batchLimit: 99999, smsHours: [2, 30] });
    expect(r.waitHours).toBeGreaterThanOrEqual(1);
    expect(r.statuses).toEqual(["new"]);
    expect(r.batchLimit).toBeLessThanOrEqual(200);
    expect(r.smsHours[0]).toBeGreaterThanOrEqual(8);
    expect(r.smsHours[1]).toBeLessThanOrEqual(21);
    expect(r.reminderDays[1]).toBeGreaterThan(r.reminderDays[0]);
  });
  test("defaults are 24h wait, reminders at 3 and 7 days, 48h gap", () => {
    expect([S.waitHours, S.reminderDays, S.minGapHours, S.statuses]).toEqual([24, [3, 7], 48, ["new", "reviewing"]]);
  });
});

describe("who gets it", () => {
  test("new and in-review only; never declined, closed, duplicate, active, approved, partial", () => {
    expect(decide().send).toBe(true);
    expect(decide({ app: app({ status: "reviewing" }) }).send).toBe(true);
    for (const st of ["declined", "closed", "duplicate", "active", "approved", "partial", "complete", "suspended"]) {
      expect(decide({ app: app({ status: st }) })).toEqual({ send: false, reason: `status_${st}` });
    }
  });
  test("merged duplicates, legal hold, deleted and disqualified are skipped", () => {
    expect(decide({ app: app({ primary_application_id: "p" }) }).send).toBe(false);
    expect(decide({ app: app({ legal_hold: true }) }).send).toBe(false);
    expect(decide({ app: app({ deleted_at: daysAgo(1) }) }).send).toBe(false);
    expect(decide({ disqualified: true }).send).toBe(false);
  });
  test("no double messages: follow-up still running, or anything sent in the last 48h", () => {
    expect(decide({ activeEnrollment: true })).toEqual({ send: false, reason: "followup_running" });
    expect(decide({ lastOutboundAt: daysAgo(1) })).toEqual({ send: false, reason: "messaged_recently" });
    expect(decide({ lastOutboundAt: daysAgo(3) }).send).toBe(true);
  });
  test("SMS only with consent, a valid US number, and no STOP", () => {
    expect((decide() as any).sms).toBe(true);
    expect((decide({ app: app({ sms_consent: false }) }) as any).sms).toBe(false);
    expect((decide({ app: app({ sms_opt_out_at: daysAgo(2) }) }) as any).sms).toBe(false);
    expect((decide({ app: app({ phone: "555" }) }) as any).sms).toBe(false);
    expect(canText(app({ phone: "1-404-555-0134" }), new Set(["+14045550134"]))).toBe(false);
    expect(decide({ app: app({ email: null, sms_consent: false }) })).toEqual({ send: false, reason: "unreachable" });
    expect((decide({ app: app({ email: null }) }) as any).email).toBe(false);
  });
});

describe("ongoing schedule: initial, 3 days, 7 days, then stop", () => {
  const key = missingKey(missingItems(app(), []));
  const row = (step: number, at: string, source: "ongoing" | "backfill" = "ongoing", k = key): OutreachLogRow => ({ missing_key: k, step, source, created_at: at });
  test("waits 24h after the last activity", () => {
    expect(decide({ app: app({ updated_at: daysAgo(0.5) }) })).toEqual({ send: false, reason: "waiting_after_activity" });
  });
  test("step 2 at day 3, step 3 at day 7, then done", () => {
    expect(decide({ log: [row(1, daysAgo(2))] })).toEqual({ send: false, reason: "step2_not_due" });
    expect(decide({ log: [row(1, daysAgo(3))] })).toMatchObject({ send: true, step: 2 });
    expect(decide({ log: [row(1, daysAgo(6)), row(2, daysAgo(3))] })).toEqual({ send: false, reason: "step3_not_due" });
    expect(decide({ log: [row(1, daysAgo(7)), row(2, daysAgo(4))] })).toMatchObject({ send: true, step: 3 });
    expect(decide({ log: [row(1, daysAgo(30)), row(2, daysAgo(27)), row(3, daysAgo(23))] })).toEqual({ send: false, reason: "sequence_done" });
  });
  test("re-triggers only when the missing set changes, at most 2 rounds", () => {
    const done = [row(1, daysAgo(30), "ongoing", "income"), row(2, daysAgo(27), "ongoing", "income"), row(3, daysAgo(23), "ongoing", "income")];
    expect(decide({ log: done })).toMatchObject({ send: true, step: 1 });
    const two = [...done, row(1, daysAgo(20), "ongoing", "gig_profile")];
    expect(decide({ log: two })).toEqual({ send: false, reason: "max_sequences" });
  });
  test("applications older than 60 days are not started", () => {
    expect(decide({ app: app({ created_at: daysAgo(61) }) })).toEqual({ send: false, reason: "too_old" });
  });
  test("after the one-time message, the same missing set is never chased again", () => {
    expect(decide({ log: [row(1, daysAgo(10), "backfill")] })).toEqual({ send: false, reason: "backfill_sent_once" });
  });
  test("backfill: once per applicant, ignores the 60-day cap unless set", () => {
    expect(decide({ mode: "backfill", app: app({ created_at: daysAgo(120) }) })).toMatchObject({ send: true, step: 1 });
    expect(decide({ mode: "backfill", log: [row(1, daysAgo(40), "ongoing", "income")] })).toEqual({ send: false, reason: "already_contacted" });
    expect(decide({ mode: "backfill", app: app({ created_at: daysAgo(120) }), settings: { ...S, backfillMaxAgeDays: 90 } })).toEqual({ send: false, reason: "too_old" });
    expect(decide({ mode: "backfill", app: app({ updated_at: daysAgo(0.2) }) })).toEqual({ send: false, reason: "waiting_after_activity" });
  });
});

describe("copy", () => {
  test("every SMS names the brand, has the link and STOP wording, and no broker or carrier names", () => {
    for (const st of [1, 2, 3] as const) {
      const sms = outreachSms(st, vars);
      expect(sms).toContain("REAL RENTALS");
      expect(sms).toContain(vars.link);
      expect(sms).toContain("Reply STOP to opt out.");
      const email = outreachEmail(st, vars);
      expect(email.body).toContain(vars.link);
      expect(email.body).toContain("14 days");
      for (const k of ALL) expect(email.body).toContain(MISSING_ITEM_COPY[k].email);
      for (const t of [sms, email.body, email.subject]) {
        expect(t.toLowerCase()).not.toMatch(/broker|carrier|no extra cost|no surprise fee|free insurance|insured/);
        expect(t.toLowerCase()).not.toMatch(/\bproof of insurance|insurance (card|proof|document)/); // never asks for insurance
      }
      // The approved insurance line is in every step, text and email.
      expect(sms).toMatch(/insurance (with a rideshare endorsement )?is now INCLUDED in your weekly rental\./i);
      expect(email.body).toMatch(/insurance is now INCLUDED in your weekly rental, rideshare endorsement and all\./);
    }
  });
  test("step 1 opens with the approved insurance news, then the list and the quote", () => {
    const e = outreachEmail(1, vars).body;
    expect(e).toContain("Hi Jordan,\n\nBig news, Jordan: insurance is now INCLUDED in your weekly rental, rideshare endorsement and all. No shopping around for coverage. Just grab the keys and start earning. You're almost there: finish your application and you could be driving this week.\n\nTo finish qualifying you and get you a quote to rent the car, we still need:\n\n•");
    expect(outreachSms(1, vars)).toMatch(/^Hi Jordan, it's REAL RENTALS\. Big news: insurance with a rideshare endorsement is now INCLUDED in your weekly rental\. No shopping for coverage, just grab the keys and start earning\. To finish qualifying and get your quote, we still need your /);
    expect(outreachEmail(2, vars).body).toMatch(/still interested/i);
  });
  test("one item reads naturally", () => {
    const one = { ...vars, items: ["income" as const] };
    expect(outreachSms(1, one)).toContain("we still need your proof of income (gig work or any other source). Add it here:");
    expect(outreachEmail(1, one).body).toContain("• Proof of income from gig work or any other source, like a recent earnings summary, pay stub, or bank statement. This just helps us make sure the rental is a good fit and comfortable for your budget.");
    expect(outreachEmail(1, one).body).toContain("Add it here:");
  });
  test("redaction hides contacts", () => {
    const r = redactContact(app());
    expect(JSON.stringify(r)).not.toContain("jordan@example.com");
    expect(JSON.stringify(r)).not.toContain("555-0134");
  });
});

describe("never asks applicants to type DOB or licence expiry", () => {
  test("not an item, not in any copy", () => {
    expect(MISSING_ITEM_KEYS as readonly string[]).not.toContain("dob");
    expect(MISSING_ITEM_KEYS as readonly string[]).not.toContain("license_expiration");
    const blob = [1, 2, 3].map((st) => outreachEmail(st as 1, vars).body + outreachSms(st as 1, vars)).join(" ").toLowerCase();
    expect(blob).not.toMatch(/date of birth|expir/);
  });
});

// ---------------------------------------------------------------- fake DB

function fakeDb(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = { ...Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))])) };
  const writes: { table: string; op: string; row: any }[] = [];
  let seq = 0;
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    const filters: ((r: any) => boolean)[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: any = null;
    let lim = Infinity;
    const q: any = {
      select: () => q,
      in: (f: string, vs: any[]) => (filters.push((r) => vs.includes(r[f])), q),
      eq: (f: string, v: any) => (filters.push((r) => r[f] === v), q),
      is: (f: string, v: any) => (filters.push((r) => (r[f] ?? null) === v), q),
      gte: (f: string, v: any) => (filters.push((r) => String(r[f]) >= String(v)), q),
      like: (f: string, v: string) => (filters.push((r) => new RegExp("^" + v.replace(/%/g, ".*") + "$").test(String(r[f] ?? ""))), q),
      order: () => q,
      limit: (n: number) => ((lim = n), q),
      insert: (r: any) => ((op = "insert"), (payload = r), q),
      update: (r: any) => ((op = "update"), (payload = r), q),
      delete: () => ((op = "delete"), q),
      maybeSingle: () => run().then((r: any) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
      then: (res: any, rej: any) => run().then(res, rej),
    };
    const run = async () => {
      if (op === "insert") {
        const r = { id: `id${++seq}`, created_at: NOW.toISOString(), ...payload };
        if (table === "applicant_outreach_log") {
          const clash = rows().some((x) => x.application_id === r.application_id && ((x.missing_key === r.missing_key && x.step === r.step) || (x.source === "backfill" && r.source === "backfill")));
          if (clash) return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        if (table === "applicant_autoclose" && rows().some((x) => x.application_id === r.application_id && !x.reopened_at)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        rows().push(r);
        writes.push({ table, op, row: r });
        return { data: [r], error: null };
      }
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); writes.push({ table, op, row: payload }); return { data: hit, error: null }; }
      if (op === "delete") { tables[table] = rows().filter((r) => !hit.includes(r)); writes.push({ table, op, row: null }); return { data: hit, error: null }; }
      return { data: hit.slice(0, lim), error: null };
    };
    return q;
  };
  return { admin: { from }, tables, writes };
}

const SEED = () => ({
  app_settings: [{ key: "missing_items_outreach", value: { ...S } }],
  applications: [
    app({ id: "a1" }),
    app({ id: "a2", full_name: "Sam Lee", sms_consent: false, email: "sam@example.com", license_photo_url: "a2/l.jpg" }),
    app({ id: "a3", status: "declined" }),
    app({ id: "a4", status: "new", phone: "(404) 555-0199", email: "pat@example.com" }),
  ],
  documents: [],
  applicant_outreach_log: [],
  automation_enrollments: [{ application_id: "a4", status: "active" }],
  outbound_messages: [],
  driver_screenings: [],
  sms_opt_outs: [],
});

type Gate = "send" | "off" | "held";
function deps(gate: Gate = "send", per: Record<string, Gate> = {}) {
  const emails: any[] = [], texts: any[] = [], links: string[] = [];
  return {
    emails, texts, links,
    d: {
      now: () => NOW,
      gate: async (_a: any, key: string) => per[key] ?? gate,
      mintLink: async (_a: any, id: string) => { links.push(id); return `https://drivereal.com/thank-you?t=T-${id}`; },
      companyPhone: async () => "(888) 833-8280",
      sendEmail: async (a: any) => { emails.push(a); return { ok: true }; },
      sendSms: async (a: any) => { texts.push(a); return { ok: true }; },
    },
  };
}

describe("engine", () => {
  test("switch off: nothing sent, nothing written", async () => {
    const db = fakeDb(SEED());
    const h = deps("off");
    const r = await runMissingItemsOutreach(db.admin, { mode: "ongoing" }, h.d);
    expect(r.held).toBe("switched_off");
    expect(h.emails.length + h.texts.length + db.writes.length).toBe(0);
  });
  test("outside 9 AM-8 PM ET: held", async () => {
    const db = fakeDb(SEED());
    const h = deps();
    const late = new Date("2026-11-17T03:00:00.000Z"); // 10 PM ET
    expect(easternHour(late)).toBe(22);
    const r = await runMissingItemsOutreach(db.admin, { mode: "ongoing" }, { ...h.d, now: () => late });
    expect(r.held).toBe("outside_sending_hours");
    expect(h.emails.length).toBe(0);
  });
  test("dry run: counts and redacted samples; sends nothing, mints nothing, writes nothing (even with the switch off)", async () => {
    const db = fakeDb(SEED());
    const h = deps("off");
    const r = await runMissingItemsOutreach(db.admin, { mode: "backfill", dryRun: true }, h.d);
    expect(r.eligible).toBe(2); // a1, a2 (a3 declined, a4 in the follow-up)
    expect(r.channels).toEqual({ email_only: 1, email_and_sms: 1, sms_only: 0 });
    expect(r.byItem.license_front).toBe(1);
    expect(r.byItem.income).toBe(2);
    expect(r.considered).toBe(3); // the declined one is never even loaded
    expect(r.skipped).toEqual({ followup_running: 1 });
    expect(r.samples.length).toBe(2);
    const blob = JSON.stringify(r.samples);
    for (const s of ["jordan@example.com", "sam@example.com", "555-0134", "Sam Lee"]) expect(blob).not.toContain(s);
    expect(h.emails.length + h.texts.length + h.links.length + db.writes.length).toBe(0);
  });
  test("backfill sends once per applicant; a second run sends nothing", async () => {
    const db = fakeDb(SEED());
    const h = deps();
    const r1 = await runMissingItemsOutreach(db.admin, { mode: "backfill" }, h.d);
    expect(r1.sent).toBe(2);
    expect(h.emails.map((e) => e.to).sort()).toEqual(["jordan@example.com", "sam@example.com"]);
    expect(h.emails.every((e) => e.track.workflow === MISSING_ITEMS_BACKFILL_WORKFLOW)).toBe(true);
    expect(h.texts.map((t) => t.applicationId)).toEqual(["a1"]); // a2 has no SMS consent
    expect(h.texts[0].body).toContain("Reply STOP to opt out.");
    expect(h.texts[0].body).toContain("https://drivereal.com/thank-you?t=T-a1");
    const log = db.tables.applicant_outreach_log;
    expect(log.length).toBe(2);
    expect(log.find((l) => l.application_id === "a1").channels).toEqual(["email", "sms"]);
    const r2 = await runMissingItemsOutreach(db.admin, { mode: "backfill" }, h.d);
    expect(r2.sent).toBe(0);
    expect(h.emails.length).toBe(2);
    // And the ongoing sweep leaves them alone for the same missing items.
    const r3 = await runMissingItemsOutreach(db.admin, { mode: "ongoing" }, { ...h.d, now: () => new Date(NOW.getTime() + 5 * 86_400_000) });
    expect(r3.sent).toBe(0);
  });
  test("two overlapping runs cannot double-send: the claim wins", async () => {
    const db = fakeDb(SEED());
    const h = deps();
    db.tables.applicant_outreach_log.push({ id: "x", application_id: "a1", missing_key: "other", step: 1, source: "backfill", created_at: NOW.toISOString() });
    // Pretend the plan was made before that row landed: decide ignores it by mode, the DB refuses the insert.
    const r = await runMissingItemsOutreach(db.admin, { mode: "backfill" }, h.d);
    expect(h.emails.find((e) => e.to === "jordan@example.com")).toBeUndefined();
    expect(r.sent).toBe(1);
  });
  test("link failure releases the claim (nothing went out)", async () => {
    const db = fakeDb(SEED());
    const h = deps();
    await runMissingItemsOutreach(db.admin, { mode: "backfill", limit: 1 }, { ...h.d, mintLink: async () => { throw new Error("boom"); } });
    expect(db.tables.applicant_outreach_log.length).toBe(0);
    expect(h.emails.length).toBe(0);
  });
  test("ongoing respects the batch limit", async () => {
    const seed = SEED();
    seed.app_settings[0].value = { ...S, batchLimit: 1 };
    // The one-time message has gone out (someone else) and its switch is Off.
    seed.applicant_outreach_log.push({ id: "bf", application_id: "zz", missing_key: "income", step: 1, source: "backfill", created_at: NOW.toISOString() } as any);
    const db = fakeDb(seed);
    const h = deps("send", { missing_items_backfill: "off" });
    const r = await runMissingItemsOutreach(db.admin, { mode: "ongoing" }, h.d);
    expect(r.eligible).toBe(2);
    expect(r.sent).toBe(1);
    expect(h.emails[0].track.workflow).toBe(MISSING_ITEMS_EMAIL_WORKFLOW);
  });
  test("Follow-Up never starts message 1 before the one-time message has gone out", async () => {
    // No backfill yet: held even with every switch on.
    const db = fakeDb(SEED());
    const h = deps("send", { missing_items_backfill: "off" });
    const r = await runMissingItemsOutreach(db.admin, { mode: "ongoing" }, h.d);
    expect(r.sent).toBe(0);
    expect(r.skipped.waiting_for_one_time_message).toBe(2);
    expect(h.emails.length + h.texts.length + db.writes.length).toBe(0);
    // Backfill under way (One-Time switch still on): still held.
    const seed = SEED();
    seed.applicant_outreach_log.push({ id: "bf", application_id: "zz", missing_key: "income", step: 1, source: "backfill", created_at: NOW.toISOString() } as any);
    const db2 = fakeDb(seed);
    const h2 = deps("send");
    const r2 = await runMissingItemsOutreach(db2.admin, { mode: "ongoing" }, h2.d);
    expect(r2.sent).toBe(0);
    expect(r2.skipped.waiting_for_one_time_message).toBe(2);
    // Backfill done and switched off: the Follow-Up picks up whoever it missed.
    const h3 = deps("send", { missing_items_backfill: "off" });
    const r3 = await runMissingItemsOutreach(db2.admin, { mode: "ongoing" }, h3.d);
    expect(r3.sent).toBe(2);
  });
  test("backfill with Auto-Close on: step-1 email and text carry the 14-day close line", async () => {
    const db = fakeDb(SEED());
    const h = deps("send");
    await runMissingItemsOutreach(db.admin, { mode: "backfill" }, h.d);
    const t = h.texts.find((x) => x.applicationId === "a1");
    expect(t.body).toMatch(/^Hi Jordan, it's REAL RENTALS\. Big news: insurance with a rideshare endorsement is now INCLUDED in your weekly rental\. No shopping for coverage, just grab the keys and start earning\. To finish qualifying and get your quote, we still need your .+\. Add (it|them) here: https:\/\/drivereal\.com\/thank-you\?t=T-a1 No reply in 14 days and we'll close your application\. Reply STOP to opt out\.$/);
    const e = h.emails.find((x) => x.to === "jordan@example.com");
    expect(e.html).toContain("Finish My Profile");
    expect(e.html).toContain("The link is private to you and works for 14 days.");
    expect(e.html).toMatch(/If we don(&#39;|&#x27;|')t hear from you in the next 14 days, we(&#39;|&#x27;|')ll close your application\./);
    expect(e.html).toContain("Questions? Reply to this email or call us at (888) 833-8280.");
  });
});

describe("FLEET endpoint", () => {
  const KEY = "k".repeat(40);
  const req = (body: any, auth = `Bearer ${KEY}`) => new Request("https://drivereal.com/api/public/fleet/missing-items", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
  const env = { FLEET_API_KEY: KEY };
  test("unauthorized without the key", async () => {
    const res = await handleFleetMissingItems(req({ action: "preview" }, "Bearer nope"), { env, admin: fakeDb(SEED()).admin, ...deps().d });
    expect(res.status).toBe(401);
  });
  test("preview is a dry run", async () => {
    const db = fakeDb(SEED());
    const h = deps();
    const res = await handleFleetMissingItems(req({ action: "preview" }), { env, admin: db.admin, ...h.d });
    const j: any = await res.json();
    expect(j.dryRun).toBe(true);
    expect(j.eligible).toBe(2);
    expect(h.emails.length + db.writes.length).toBe(0);
  });
  test("backfill needs confirm and the One-Time switch", async () => {
    const db = fakeDb(SEED());
    const h = deps("off");
    expect((await handleFleetMissingItems(req({ action: "backfill" }), { env, admin: db.admin, ...h.d })).status).toBe(400);
    expect((await handleFleetMissingItems(req({ action: "backfill", confirm: "send-once" }), { env, admin: db.admin, ...h.d })).status).toBe(409);
    expect(h.emails.length).toBe(0);
    const on = deps("send");
    const audits: any[] = [];
    const res = await handleFleetMissingItems(req({ action: "backfill", confirm: "send-once", limit: 10 }), { env, admin: db.admin, ...on.d, audit: async (e: any) => { audits.push(e); } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).sent).toBe(2);
    expect(audits[0].action).toBe("applicant.missing_items_backfill");
  });
});

describe("Automations list", () => {
  test("both entries are catalogued, Off by default, and gate their own email workflow", () => {
    for (const [key, wf] of [[MISSING_ITEMS_AUTOMATION_KEY, MISSING_ITEMS_EMAIL_WORKFLOW], [MISSING_ITEMS_BACKFILL_KEY, MISSING_ITEMS_BACKFILL_WORKFLOW]]) {
      const def = AUTOMATIONS.find((a) => a.key === key)!;
      expect(def.defaultOn).toBe(false);
      expect(isDefaultOff(key)).toBe(true);
      expect(def.emailWorkflows).toEqual([wf]);
      expect(settingKeyForEmailWorkflow(wf)).toBe(key);
      expect(isAutomationOn({ off: {} } as any, key)).toBe(false);
    }
  });
});

describe("migration (PGlite)", () => {
  const SQL = readFileSync("supabase/migrations/20261116040000_missing_items_outreach.sql", "utf8");
  test("income column, log table with once-only rules, settings seeded; re-runnable", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
      CREATE TYPE app_role AS ENUM ('admin');
      CREATE FUNCTION private.has_role(uuid, app_role) RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
      CREATE TABLE public.applications (id uuid primary key default gen_random_uuid());
      CREATE TABLE public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);`);
    await pg.exec(SQL);
    await pg.exec(SQL);
    const id = ((await pg.query(`INSERT INTO applications DEFAULT VALUES RETURNING id`)).rows[0] as any).id;
    await pg.query(`UPDATE applications SET income_proof_url = $1 WHERE id = $2`, [`${id}/x.pdf`, id]);
    const ins = (key: string, step: number, source: string) => pg.query(`INSERT INTO applicant_outreach_log (application_id, missing_key, step, source) VALUES ($1,$2,$3,$4)`, [id, key, step, source]);
    await ins("gig_profile", 1, "backfill");
    await expect(ins("income", 1, "backfill")).rejects.toThrow(/backfill_once/);
    await expect(ins("gig_profile", 1, "ongoing")).rejects.toThrow(/applicant_outreach_log_once/);
    await ins("income", 1, "ongoing");
    await expect(ins("income", 4, "ongoing")).rejects.toThrow();
    await expect(ins("x", 1, "manual")).rejects.toThrow();
    const s = (await pg.query(`SELECT value FROM app_settings WHERE key = 'missing_items_outreach'`)).rows[0] as any;
    expect(readOutreachSettings(s.value)).toEqual(S);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  test("wizard collects proof of income (and never DOB or expiry); server stores it in the applicant's own folder", () => {
    const fn = read("src/lib/applications.functions.ts");
    expect(fn).not.toMatch(/\n\s+dob: z/);
    expect(fn).not.toMatch(/\n\s+license_expiration: z/);
    expect(fn).toContain(`"profile_screenshot_url", "income_proof_url"]`);
    expect(fn).toContain(`income_proof_on_file: Boolean(r.income_proof_url)`);
    expect(fn).toContain(`"trip_history", "income"]`);
    expect(fn).toContain(`data.kind === "income"`);
    expect(fn).not.toMatch(/\n\s+dob: \(r\.dob/); // value never returned
    const wiz = read("src/components/site/ApplicationWizard.tsx");
    expect(wiz).toContain(`kind="income"`);
    expect(wiz).not.toContain(`Date Of Birth`);
    // Opening the come-back link reopens an auto-closed application first.
    expect(fn.match(/reopenAutoClosed\(supabaseAdmin, id\)/g)?.length).toBe(2);
    // The resume link in the message opens the upload step for a submitted applicant.
    expect(wiz).toMatch(/owesItems && !earlierStepOpen && \(stored === "submitted" \|\| stored === "documents" \|\| stored === "profile_complete"\)\) \{\s*phase = "documents";/);
  });
  test("uploaded income proof lands in the vault (and so in FLEET's review)", () => {
    expect(read("src/lib/documents.functions.ts")).toMatch(/column: "income_proof_url",\s*category: "income"/);
  });
  test("the 5-minute automations cron runs the sweep; the FLEET route exists", () => {
    expect(read("src/routes/api/public/cron/automations.ts")).toContain(`runMissingItemsOutreach(supabaseAdmin, { mode: "ongoing" })`);
    expect(existsSync("src/routes/api/public/fleet/missing-items.ts")).toBe(true);
  });
});

describe("auto-close after 14 days with no reply", () => {
  const key = missingKey(missingItems(app(), []));
  const row = (step: number, at: string, source: "ongoing" | "backfill" = "ongoing"): OutreachLogRow => ({ missing_key: key, step, source, created_at: at });
  const base = (o: any = {}) => decideAutoClose({ app: app(), items: missingItems(app(), []), log: [row(3, daysAgo(15))], lastResponseAt: null, activeEnrollment: false, disqualified: false, now: NOW, settings: S, ...o });
  test("closes 14 days after the LAST message (step 3, or the one-time message)", () => {
    expect(S.autoCloseDays).toBe(14);
    expect(base()).toMatchObject({ close: true, email: true, sms: true });
    expect(base({ log: [row(1, daysAgo(20), "backfill")] })).toMatchObject({ close: true });
    expect(base({ log: [row(3, daysAgo(13))] })).toEqual({ close: false, reason: "waiting" });
    expect(base({ log: [row(1, daysAgo(30)), row(2, daysAgo(27))] })).toEqual({ close: false, reason: "sequence_not_finished" });
    expect(base({ log: [] })).toEqual({ close: false, reason: "never_messaged" });
    expect(base({ settings: { ...S, autoCloseDays: 30 } })).toEqual({ close: false, reason: "waiting" });
  });
  test("any sign of life after the last message stops it", () => {
    expect(base({ lastResponseAt: daysAgo(5) })).toEqual({ close: false, reason: "responded" });
    expect(base({ lastResponseAt: daysAgo(20) })).toMatchObject({ close: true }); // before the last message
  });
  test("never closes the wrong people", () => {
    expect(base({ app: app({ status: "approved" }) }).close).toBe(false);
    expect(base({ items: [] })).toEqual({ close: false, reason: "nothing_missing" });
    expect(base({ activeEnrollment: true }).close).toBe(false);
    expect(base({ disqualified: true }).close).toBe(false);
    expect(base({ app: app({ legal_hold: true }) }).close).toBe(false);
  });
  test("copy: come back anytime, pick up where you left off, link, STOP; last reminder says when", () => {
    const v = { firstName: "Jordan", link: "https://drivereal.com/thank-you?t=X", companyPhone: "(888) 833-8280" };
    const e = comeBackEmail(v);
    expect(e.body).toMatch(/come back anytime and pick up right where you left off/);
    expect(e.body).toContain(v.link);
    expect(e.body.toLowerCase()).not.toMatch(/declin|broker|carrier|no extra cost|no surprise fee/);
    expect(e.body).toContain("insurance is now INCLUDED in your weekly rental, rideshare endorsement and all.");
    expect(comeBackSms(v)).toContain("Insurance is now INCLUDED in your weekly rental.");
    expect(comeBackSms(v)).toContain("Reply STOP to opt out.");
    expect(comeBackSms(v)).toContain(v.link);
    expect(outreachEmail(3, { ...vars, closeInDays: 14 }).body).toContain("If we don't hear from you in the next 14 days, we'll close your application.");
    expect(outreachSms(3, { ...vars, closeInDays: 14 })).toContain("No reply in 14 days and we'll close your application.");
    expect(outreachEmail(3, vars).body).not.toContain("close your application");
  });

  const closeSeed = () => {
    const s = SEED();
    s.applicant_outreach_log = [
      { id: "l1", application_id: "a1", missing_key: missingKey(missingItems(app(), [])), step: 1, source: "backfill", created_at: daysAgo(15) },
      { id: "l2", application_id: "a2", missing_key: "x", step: 1, source: "backfill", created_at: daysAgo(15) },
    ] as any;
    (s as any).application_resume_tokens = [{ application_id: "a2", last_used_at: daysAgo(3) }]; // a2 opened their link
    return s;
  };
  test("switch off: nothing closed or sent", async () => {
    const db = fakeDb(closeSeed());
    const h = deps("off");
    const r = await runMissingItemsAutoClose(db.admin, {}, h.d);
    expect(r.held).toBe("switched_off");
    expect(db.tables.applications.find((a: any) => a.id === "a1").status).toBe("new");
  });
  test("dry run counts without writing", async () => {
    const db = fakeDb(closeSeed());
    const r = await runMissingItemsAutoClose(db.admin, { dryRun: true }, deps("off").d);
    expect(r.eligible).toBe(1);
    expect(r.skipped.responded).toBe(1);
    expect(db.writes.length).toBe(0);
    expect(JSON.stringify(r.samples)).not.toContain("jordan@example.com");
  });
  test("on: closes (not declines) once, sends one come-back message; the link reopens it", async () => {
    const db = fakeDb(closeSeed());
    const h = deps("send");
    const r = await runMissingItemsAutoClose(db.admin, {}, h.d);
    expect(r.closed).toBe(1);
    const a1 = db.tables.applications.find((a: any) => a.id === "a1");
    expect(a1.status).toBe("closed");
    expect(h.emails.length).toBe(1);
    expect(h.emails[0].track.workflow).toBe(MISSING_ITEMS_AUTOCLOSE_WORKFLOW);
    expect(h.texts.length).toBe(1);
    expect(h.texts[0].body).toContain("pick up where you left off");
    // Second run: already closed, nothing more.
    const r2 = await runMissingItemsAutoClose(db.admin, {}, h.d);
    expect(r2.closed).toBe(0);
    expect(h.emails.length).toBe(1);
    // They open the link: back to New.
    expect(await reopenAutoClosed(db.admin, "a1", NOW)).toBe(true);
    expect(a1.status).toBe("new");
    expect(await reopenAutoClosed(db.admin, "a1", NOW)).toBe(false);
    // A staff close is never reopened.
    db.tables.applications.find((a: any) => a.id === "a3").status = "closed";
    expect(await reopenAutoClosed(db.admin, "a3", NOW)).toBe(false);
  });
  test("with auto-close on, the one-time message warns about the 14 days", async () => {
    const db = fakeDb(SEED());
    const h = deps("send");
    await runMissingItemsOutreach(db.admin, { mode: "backfill" }, h.d);
    expect(h.emails[0].html).toContain("next 14 days");
  });
  test("catalogued Off by default", () => {
    const def = AUTOMATIONS.find((a) => a.key === MISSING_ITEMS_AUTOCLOSE_KEY)!;
    expect(def.defaultOn).toBe(false);
    expect(settingKeyForEmailWorkflow(MISSING_ITEMS_AUTOCLOSE_WORKFLOW)).toBe(MISSING_ITEMS_AUTOCLOSE_KEY);
  });
  test("migration: one open auto-close per application", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
      CREATE TYPE app_role AS ENUM ('admin');
      CREATE FUNCTION private.has_role(uuid, app_role) RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
      CREATE TABLE public.applications (id uuid primary key default gen_random_uuid());
      CREATE TABLE public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);`);
    await pg.exec(readFileSync("supabase/migrations/20261116040000_missing_items_outreach.sql", "utf8"));
    const id = ((await pg.query(`INSERT INTO applications DEFAULT VALUES RETURNING id`)).rows[0] as any).id;
    const ins = () => pg.query(`INSERT INTO applicant_autoclose (application_id, prior_status) VALUES ($1, 'new')`, [id]);
    await ins();
    await expect(ins()).rejects.toThrow(/applicant_autoclose_open_once/);
    await pg.query(`UPDATE applicant_autoclose SET reopened_at = now()`);
    await ins();
  });
});
