import { describe, expect, test } from "bun:test";
import {
  agreementSms,
  dueAgreementStep,
  duePickupStep,
  pickupSms,
  runRenterReminders,
} from "../src/lib/renter-reminders.server";
import { isDefaultOff } from "../src/lib/automation-catalog";

function fakeDb(tables: Record<string, any[]>, opts: { noClaimTable?: boolean } = {}) {
  const db: any = { tables, inserts: [] as any[], updates: [] as any[] };
  db.from = (name: string) => {
    const filters: ((r: any) => boolean)[] = [];
    const q: any = {
      select: () => q,
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), q),
      in: (k: string, v: any[]) => (filters.push((r) => v.includes(r[k])), q),
      gte: (k: string, v: any) => (filters.push((r) => r[k] >= v), q),
      lte: (k: string, v: any) => (filters.push((r) => r[k] <= v), q),
      limit: () => q,
      rows: () => (tables[name] ?? []).filter((r) => filters.every((f) => f(r))),
      maybeSingle: async () => ({ data: q.rows()[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: q.rows(), error: null }).then(res, rej),
      insert: async (row: any) => {
        if (name === "renter_reminder_sends" && opts.noClaimTable) return { error: { code: "42P01", message: 'relation "renter_reminder_sends" does not exist' } };
        tables[name] = tables[name] ?? [];
        if (tables[name].some((r) => r.key === row.key)) return { error: { code: "23505", message: "duplicate key" } };
        tables[name].push({ ...row });
        db.inserts.push({ name, row });
        return { error: null };
      },
      update: (patch: any) => ({
        eq: async (k: string, v: any) => {
          for (const r of tables[name] ?? []) if (r[k] === v) Object.assign(r, patch);
          db.updates.push({ name, patch });
          return { error: null };
        },
      }),
    };
    return q;
  };
  return db;
}

const at = (iso: string) => new Date(iso);
const note = (time: string) => JSON.stringify({ reservation_details: 1, pickup_time: time, pickup_location: "3500 E Hillsborough Ave, Tampa, FL 33610" });
const facts = { firstName: "Sam", date: "2026-11-18", time: "09:30", location: "3500 E Hillsborough Ave, Tampa, FL 33610", vehicle: "2017 Ford Fusion" };

describe("copy", () => {
  test("every pickup text has the address, license line, 888 and STOP, and no 15-minute rule", () => {
    for (const step of ["booked", "evening", "two_hour"] as const) {
      const b = pickupSms(step, facts);
      expect(b).toContain("3500 E Hillsborough Ave, Tampa, FL 33610");
      expect(b).toContain("Bring your driver's license.");
      expect(b).toContain("(888) 833-8280");
      expect(b).toContain("Reply STOP to opt out.");
      expect(b).not.toMatch(/15|minutes late|released/i);
    }
    expect(pickupSms("booked", facts)).toContain("Wed 11/18 9:30 AM ET");
  });
  test("agreement texts have STOP wording", () => {
    for (const step of ["four_hour", "morning"] as const) expect(agreementSms(step)).toContain("Reply STOP to opt out.");
  });
  test("both switches are off by default", () => {
    expect(isDefaultOff("pickup_reminders")).toBe(true);
    expect(isDefaultOff("agreement_sign_texts")).toBe(true);
  });
});

describe("timing", () => {
  const r = { start_date: "2026-11-18", pickupTime: "09:30", created_at: "2026-11-16T15:00:00Z" };
  test("booked right after booking", () => expect(duePickupStep(r, at("2026-11-16T15:05:00Z"))).toEqual(["booked"]));
  test("evening before at 6 PM ET", () => {
    expect(duePickupStep(r, at("2026-11-17T22:59:00Z"))).toEqual([]); // 5:59 PM ET
    expect(duePickupStep(r, at("2026-11-17T23:00:00Z"))).toEqual(["evening"]); // 6 PM ET
    expect(duePickupStep(r, at("2026-11-18T02:00:00Z"))).toEqual([]); // 9 PM ET
  });
  test("2 hours before", () => {
    expect(duePickupStep(r, at("2026-11-18T12:30:00Z"))).toEqual(["two_hour"]); // 7:30 AM ET
    expect(duePickupStep(r, at("2026-11-18T13:45:00Z"))).toEqual([]); // 45 min before
  });
  test("agreement 4 hours after, inside texting hours", () => {
    expect(dueAgreementStep({ sent_at: "2026-11-16T15:00:00Z" }, at("2026-11-16T19:00:00Z"))).toEqual(["four_hour"]);
    expect(dueAgreementStep({ sent_at: "2026-11-16T15:00:00Z" }, at("2026-11-16T18:59:00Z"))).toEqual([]);
  });
  test("agreement sent at 10 PM: no 4-hour text overnight, one text at 9 AM next morning", () => {
    const a = { sent_at: "2026-11-17T03:00:00Z" }; // 10 PM ET Nov 16
    expect(dueAgreementStep(a, at("2026-11-17T07:00:00Z"))).toEqual([]);
    expect(dueAgreementStep(a, at("2026-11-17T13:00:00Z"))).toEqual([]); // 8 AM ET
    expect(dueAgreementStep(a, at("2026-11-17T14:00:00Z"))).toEqual(["morning"]); // 9 AM ET
  });
});

function world() {
  return {
    rentals: [{ id: "r1", status: "reserved", application_id: "a1", vehicle_id: "v1", start_date: "2026-11-18", reservation_note: note("09:30"), created_at: "2026-11-16T15:00:00Z" }],
    applications: [
      { id: "a1", full_name: "Sam Lee", phone: "8135550101", email: "sam@example.com" },
      { id: "a2", full_name: "Kim Ray", phone: "8135550102", email: "kim@example.com" },
    ],
    vehicles: [{ id: "v1", year: 2017, make: "Ford", model: "Fusion" }],
    agreements: [{ id: "g1", status: "sent", application_id: "a2", rental_id: null, sent_at: "2026-11-16T15:00:00Z", signed_at: null, voided_at: null, token_expires_at: "2026-11-30T00:00:00Z", signer_email: null }],
    renter_reminder_sends: [] as any[],
  };
}

describe("runRenterReminders", () => {
  test("off switches send nothing", async () => {
    const db = fakeDb(world());
    const sms: any[] = [];
    const out = await runRenterReminders(db, { now: () => at("2026-11-16T15:05:00Z"), gates: { pickup: "off", agreement: "off" }, sendSms: async (a) => (sms.push(a), { ok: true }), sendEmail: async () => ({ ok: true }) });
    expect(out.outcomes).toEqual([]);
    expect(sms).toEqual([]);
  });
  test("sends once per step; email fallback when SMS is refused for consent", async () => {
    const db = fakeDb(world());
    const sms: any[] = [];
    const emails: any[] = [];
    const deps = {
      gates: { pickup: "send", agreement: "send" } as const,
      sendSms: async (a: any) => (sms.push(a), a.applicationId === "a2" ? { ok: false, skipped: true, reason: "no_consent" } : { ok: true, id: "m1" }),
      sendEmail: async (a: any) => (emails.push(a), { ok: true }),
    };
    const t = "2026-11-16T19:05:00Z"; // 2:05 PM ET: booked text for r1, 4-hour for g1
    const one = await runRenterReminders(db, { ...deps, now: () => at(t) });
    expect(one.outcomes.map((o) => `${o.kind}:${o.channel}:${o.status}`)).toEqual(["pickup_reminder_booked:sms:sent", "agreement_sign_four_hour:email:sent"]);
    expect(sms[0].body).toContain("You're booked, Sam!");
    expect(emails[0].to).toBe("kim@example.com");
    expect(emails[0].track.workflow).toBe("agreement_sign_reminder");
    const two = await runRenterReminders(db, { ...deps, now: () => at(t) });
    expect(two.outcomes).toEqual([]);
  });
  test("staff-text pause: a paused renter gets no reminder and nothing is claimed; others still get theirs", async () => {
    const w: any = world();
    w.bot_text_pauses = [{ phone_key: "8135550101", paused_until: "2026-11-18T19:00:00Z", cleared_at: null }];
    const db = fakeDb(w);
    const sms: any[] = [];
    const deps = { gates: { pickup: "send", agreement: "send" } as const, sendSms: async (a: any) => (sms.push(a), { ok: true, id: "m" }), sendEmail: async () => ({ ok: true }) };
    const t = "2026-11-16T19:05:00Z";
    const out = await runRenterReminders(db, { ...deps, now: () => at(t) });
    expect(out.outcomes.map((o) => `${o.kind}:${o.channel}:${o.status}`)).toEqual(["pickup_reminder_booked:none:paused_staff_texting", "agreement_sign_four_hour:sms:sent"]);
    expect(sms.map((x) => x.applicationId)).toEqual(["a2"]);
    expect(w.renter_reminder_sends.some((r: any) => String(r.key).startsWith("pickup:"))).toBe(false);
    // Pause cleared inside the window: the booked text still goes.
    w.bot_text_pauses[0].cleared_at = "2026-11-16T19:06:00Z";
    const db2 = fakeDb(w);
    const again = await runRenterReminders(db2, { ...deps, now: () => at("2026-11-16T19:10:00Z") });
    expect(again.outcomes.find((o) => o.kind === "pickup_reminder_booked")?.status).toBe("sent");
  });
  test("signed agreements and quiet hours send nothing", async () => {
    const w = world();
    w.agreements[0].signed_at = "2026-11-16T16:00:00Z";
    const db = fakeDb(w);
    const out = await runRenterReminders(db, { now: () => at("2026-11-16T19:05:00Z"), gates: { pickup: "off", agreement: "send" }, sendSms: async () => ({ ok: true }), sendEmail: async () => ({ ok: true }) });
    expect(out.outcomes).toEqual([]);
    const night = await runRenterReminders(fakeDb(world()), { now: () => at("2026-11-17T03:30:00Z"), gates: { pickup: "send", agreement: "send" }, sendSms: async () => ({ ok: true }), sendEmail: async () => ({ ok: true }) });
    expect(night.outcomes).toEqual([]);
  });
  test("no claim table: nothing sent", async () => {
    const db = fakeDb(world(), { noClaimTable: true });
    const sms: any[] = [];
    const out = await runRenterReminders(db, { now: () => at("2026-11-16T15:05:00Z"), gates: { pickup: "send", agreement: "off" }, sendSms: async (a) => (sms.push(a), { ok: true }), sendEmail: async () => ({ ok: true }) });
    expect(out.ok).toBe(false);
    expect(sms).toEqual([]);
  });
});
