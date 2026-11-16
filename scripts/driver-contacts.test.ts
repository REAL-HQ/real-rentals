// Extra phones and emails on a driver profile. Fake database; network refused.
// Fixtures use reserved 555 numbers and example.com only — never real renters.
import { describe, expect, test } from "bun:test";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;

import { readFileSync } from "node:fs";
import { fakeDb, KEY, req } from "./fleet-fake-db";
import {
  contactSmsDecision,
  fleetContactsPayload,
  formatDriverPhone,
  last10Digits,
  normalizeDriverEmail,
  normalizeDriverPhone,
  sameEmail,
  samePhone,
} from "@/lib/driver-contacts";
import {
  findApplicationsByEmail,
  findApplicationsByPhone,
  fleetContactsFor,
  lookupLeadByContact,
  matchLeadByPhone,
  renterEmailTargets,
  renterSmsTargets,
  sendRenterEmail,
  sendRenterSms,
} from "@/lib/driver-contacts.server";
import { matchLeadByPhone as quoMatch } from "@/lib/quo-events.server";

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const PRIMARY_PHONE = "+15550100000";
const EXTRA_PHONE = "+15550100001";
const OTHER_PHONE = "+15550100002";
const PRIMARY_EMAIL = "driver.one@example.com";
const EXTRA_EMAIL = "driver.one.alt@example.com";
const OTHER_EMAIL = "driver.two@example.com";

const env = { FLEET_API_KEY: KEY };

function appRow(id: string, extra: Record<string, any> = {}) {
  return {
    id,
    full_name: "Test Driver",
    email: PRIMARY_EMAIL,
    phone: PRIMARY_PHONE,
    status: "new",
    created_at: "2026-11-10T12:00:00Z",
    deleted_at: null,
    primary_application_id: null,
    sms_consent: true,
    sms_opt_out_at: null,
    sms_consent_phone: PRIMARY_PHONE,
    ...extra,
  };
}

function contact(partial: Record<string, any>) {
  return {
    id: partial.id ?? "c1",
    application_id: partial.application_id ?? L1,
    kind: partial.kind,
    value: partial.value,
    label: partial.label ?? null,
    is_primary: partial.is_primary ?? false,
    receives_messages: partial.receives_messages ?? false,
    consented_at: partial.consented_at ?? null,
    created_by: null,
    created_at: "2026-11-16T12:00:00Z",
    updated_at: "2026-11-16T12:00:00Z",
  };
}

describe("normalize and compare", () => {
  test("phones become E.164 and compare on the last 10 digits", () => {
    expect(normalizeDriverPhone("(555) 010-0000")).toBe(PRIMARY_PHONE);
    expect(normalizeDriverPhone("15550100000")).toBe(PRIMARY_PHONE);
    expect(samePhone(PRIMARY_PHONE, "5550100000")).toBe(true);
    expect(samePhone(PRIMARY_PHONE, EXTRA_PHONE)).toBe(false);
    expect(last10Digits(PRIMARY_PHONE)).toBe("5550100000");
    expect(formatDriverPhone(PRIMARY_PHONE)).toBe("555-010-0000");
  });
  test("emails trim and lowercase", () => {
    expect(normalizeDriverEmail("  Driver.One@Example.com ")).toBe(PRIMARY_EMAIL);
    expect(normalizeDriverEmail("not-an-email")).toBeNull();
    expect(sameEmail(PRIMARY_EMAIL, "DRIVER.ONE@example.com")).toBe(true);
  });
});

describe("contactSmsDecision", () => {
  const consentedApp = { phone: PRIMARY_PHONE, sms_consent: true, sms_opt_out_at: null, sms_consent_phone: PRIMARY_PHONE };

  test("primary with application consent can be texted", () => {
    expect(contactSmsDecision({ e164: PRIMARY_PHONE, isPrimary: true, receivesMessages: true, optedOut: false, app: consentedApp }).canText).toBe(true);
  });
  test("primary without application consent cannot", () => {
    const r = contactSmsDecision({ e164: PRIMARY_PHONE, isPrimary: true, receivesMessages: true, optedOut: false, app: { ...consentedApp, sms_consent: false } });
    expect(r).toEqual({ canText: false, reason: "no_consent" });
  });
  test("primary STOP blocks the primary", () => {
    const r = contactSmsDecision({ e164: PRIMARY_PHONE, isPrimary: true, receivesMessages: true, optedOut: false, app: { ...consentedApp, sms_opt_out_at: "2026-11-16T12:00:00Z" } });
    expect(r).toEqual({ canText: false, reason: "opted_out" });
  });
  test("extra without receives_messages is not sent", () => {
    const r = contactSmsDecision({ e164: EXTRA_PHONE, isPrimary: false, receivesMessages: false, optedOut: false, app: consentedApp, consentedAt: "2026-11-16T12:00:00Z" });
    expect(r).toEqual({ canText: false, reason: "not_enabled" });
  });
  test("extra with receives_messages but no consent for that number is skipped", () => {
    const r = contactSmsDecision({ e164: EXTRA_PHONE, isPrimary: false, receivesMessages: true, optedOut: false, app: consentedApp, consentedAt: null });
    expect(r).toEqual({ canText: false, reason: "no_consent_for_number" });
  });
  test("application consent does not extend to an extra number", () => {
    const r = contactSmsDecision({ e164: EXTRA_PHONE, isPrimary: false, receivesMessages: true, optedOut: false, app: consentedApp });
    expect(r.canText).toBe(false);
    if (!r.canText) expect(r.reason).toBe("no_consent_for_number");
  });
  test("extra with receives_messages and its own consented_at can be texted", () => {
    const r = contactSmsDecision({ e164: EXTRA_PHONE, isPrimary: false, receivesMessages: true, optedOut: false, app: consentedApp, consentedAt: "2026-11-16T15:00:00Z" });
    expect(r.canText).toBe(true);
  });
  test("extra is texted when sms_consent_phone is that number", () => {
    const r = contactSmsDecision({
      e164: EXTRA_PHONE, isPrimary: false, receivesMessages: true, optedOut: false,
      app: { ...consentedApp, sms_consent_phone: EXTRA_PHONE },
    });
    expect(r.canText).toBe(true);
  });
  test("per-number opt-out blocks an extra even with consent", () => {
    const r = contactSmsDecision({ e164: EXTRA_PHONE, isPrimary: false, receivesMessages: true, optedOut: true, app: consentedApp, consentedAt: "2026-11-16T15:00:00Z" });
    expect(r).toEqual({ canText: false, reason: "opted_out" });
  });
});

describe("fleetContactsPayload", () => {
  test("falls back to applications.phone/email when no contact rows exist", () => {
    const out = fleetContactsPayload([], { phone: PRIMARY_PHONE, email: PRIMARY_EMAIL, sms_consent: true, sms_opt_out_at: null });
    expect(out.phones).toEqual([expect.objectContaining({ value: PRIMARY_PHONE, is_primary: true, receives_messages: true, sms_ok: true })]);
    expect(out.emails).toEqual([expect.objectContaining({ value: PRIMARY_EMAIL, is_primary: true, receives_messages: true })]);
  });
  test("lists extras and marks sms_ok only when that number is textable", () => {
    const out = fleetContactsPayload(
      [
        contact({ id: "p", kind: "phone", value: PRIMARY_PHONE, is_primary: true, receives_messages: true }),
        contact({ id: "x", kind: "phone", value: EXTRA_PHONE, receives_messages: true, consented_at: null, label: "Other" }),
        contact({ id: "e", kind: "email", value: EXTRA_EMAIL, receives_messages: true, label: "Alt" }),
        contact({ id: "pe", kind: "email", value: PRIMARY_EMAIL, is_primary: true, receives_messages: true }),
      ],
      { phone: PRIMARY_PHONE, email: PRIMARY_EMAIL, sms_consent: true, sms_opt_out_at: null, sms_consent_phone: PRIMARY_PHONE },
    );
    expect(out.phones[0]).toMatchObject({ value: PRIMARY_PHONE, is_primary: true, sms_ok: true });
    expect(out.phones[1]).toMatchObject({ value: EXTRA_PHONE, is_primary: false, receives_messages: true, sms_ok: false, sms_reason: "no_consent_for_number", label: "Other" });
    expect(out.emails.map((e) => e.value).sort()).toEqual([EXTRA_EMAIL, PRIMARY_EMAIL].sort());
  });
});

function dbWithContacts(extra: Record<string, any[]> = {}) {
  return fakeDb({
    applications: [appRow(L1), appRow(L2, { email: OTHER_EMAIL, phone: OTHER_PHONE, full_name: "Other Driver" })],
    driver_contacts: [
      contact({ id: "p1", application_id: L1, kind: "phone", value: PRIMARY_PHONE, is_primary: true, receives_messages: true }),
      contact({ id: "x1", application_id: L1, kind: "phone", value: EXTRA_PHONE, receives_messages: true, consented_at: "2026-11-16T15:00:00Z", label: "Other" }),
      contact({ id: "e1", application_id: L1, kind: "email", value: PRIMARY_EMAIL, is_primary: true, receives_messages: true }),
      contact({ id: "e2", application_id: L1, kind: "email", value: EXTRA_EMAIL, receives_messages: true }),
      contact({ id: "p2", application_id: L2, kind: "phone", value: OTHER_PHONE, is_primary: true, receives_messages: true }),
    ],
    sms_opt_outs: [],
    ...extra,
  });
}

describe("lookup and inbound matching", () => {
  test("finds a driver by an extra phone", async () => {
    const db = dbWithContacts();
    const rows = await findApplicationsByPhone(db, EXTRA_PHONE);
    expect(rows.map((r) => r.id)).toEqual([L1]);
    expect(await matchLeadByPhone(db, EXTRA_PHONE)).toBe(L1);
    expect(await quoMatch(db, EXTRA_PHONE)).toBe(L1);
  });
  test("finds a driver by an extra email", async () => {
    const db = dbWithContacts();
    const rows = await findApplicationsByEmail(db, "Driver.One.Alt@example.com");
    expect(rows.map((r) => r.id)).toEqual([L1]);
  });
  test("lookup action shape names the matched extra contact", async () => {
    const db = dbWithContacts();
    const found = await lookupLeadByContact(db, { phone: EXTRA_PHONE });
    expect(found.status).toBe(200);
    if (found.status !== 200) return;
    expect(found.body.lead_id).toBe(L1);
    expect(found.body.phone).toBe(PRIMARY_PHONE);
    expect(found.body.email).toBe(PRIMARY_EMAIL);
    expect(found.body.matched).toEqual({ kind: "phone", value: EXTRA_PHONE, is_primary: false });
    expect(found.body.contacts.phones.some((p) => p.value === EXTRA_PHONE && p.is_primary === false)).toBe(true);
  });
  test("lookup by unknown contact is 404", async () => {
    const db = dbWithContacts();
    const found = await lookupLeadByContact(db, { phone: "+15550100999" });
    expect(found).toMatchObject({ status: 404 });
  });
  test("ignores a missing contacts table and still matches the primary", async () => {
    const db = fakeDb({ applications: [appRow(L1)] }, { missing: ["driver_contacts"] });
    expect(await matchLeadByPhone(db, PRIMARY_PHONE)).toBe(L1);
    const contacts = await fleetContactsFor(db, L1, appRow(L1));
    expect(contacts.phones[0]?.value).toBe(PRIMARY_PHONE);
    expect(contacts.phones[0]?.is_primary).toBe(true);
  });
});

describe("outbound targets", () => {
  test("texts go to the primary plus a consented, opted-in extra", async () => {
    const db = dbWithContacts();
    const targets = await renterSmsTargets(db, L1, appRow(L1));
    const sendable = targets.filter((t) => t.canText).map((t) => t.e164).sort();
    expect(sendable).toEqual([EXTRA_PHONE, PRIMARY_PHONE].sort());
  });
  test("an extra without consent is listed but not sendable", async () => {
    const db = dbWithContacts({
      driver_contacts: [
        contact({ id: "p1", application_id: L1, kind: "phone", value: PRIMARY_PHONE, is_primary: true, receives_messages: true }),
        contact({ id: "x1", application_id: L1, kind: "phone", value: EXTRA_PHONE, receives_messages: true, consented_at: null }),
      ],
    });
    const targets = await renterSmsTargets(db, L1, appRow(L1));
    const extra = targets.find((t) => t.e164 === EXTRA_PHONE);
    expect(extra).toMatchObject({ canText: false, reason: "no_consent_for_number" });
    expect(targets.find((t) => t.e164 === PRIMARY_PHONE)?.canText).toBe(true);
  });
  test("emails go to the primary plus extras with receives_messages on", async () => {
    const db = dbWithContacts();
    const emails = await renterEmailTargets(db, L1, { email: PRIMARY_EMAIL });
    expect(emails.sort()).toEqual([EXTRA_EMAIL, PRIMARY_EMAIL].sort());
  });
  test("sendRenterSms fans out only to sendable numbers", async () => {
    const db = dbWithContacts();
    const sent: string[] = [];
    const fan = await sendRenterSms({
      admin: db,
      applicationId: L1,
      body: "Test reminder",
      kind: "test",
      sendSms: async (a) => { sent.push(a.to); return { ok: true, id: "m1" }; },
      app: appRow(L1),
    });
    expect(sent.sort()).toEqual([EXTRA_PHONE, PRIMARY_PHONE].sort());
    expect(fan.sent).toBe(2);
  });
  test("sendRenterEmail fans out and unique-ifies the idempotency key", async () => {
    const db = dbWithContacts();
    const sent: { to: string; key?: string }[] = [];
    const fan = await sendRenterEmail({
      admin: db,
      applicationId: L1,
      subject: "Test",
      html: "<p>Hi</p>",
      idempotencyKey: "notice-1",
      sendEmail: async (a) => { sent.push({ to: a.to, key: a.idempotencyKey }); return { ok: true }; },
      app: { email: PRIMARY_EMAIL },
    });
    expect(sent.map((s) => s.to).sort()).toEqual([EXTRA_EMAIL, PRIMARY_EMAIL].sort());
    expect(new Set(sent.map((s) => s.key)).size).toBe(2);
    expect(fan.sent).toBe(2);
  });
  test("transactional primary still sends when marketing consent is off; extras do not", async () => {
    const db = dbWithContacts();
    const app = appRow(L1, { sms_consent: false, sms_consent_phone: null });
    const targets = await renterSmsTargets(db, L1, app, { transactionalPrimary: true });
    expect(targets.find((t) => t.is_primary)?.canText).toBe(true);
    expect(targets.find((t) => t.e164 === EXTRA_PHONE)?.canText).toBe(true); // extra still has consented_at
    const noConsentExtra = await renterSmsTargets(
      fakeDb({
        applications: [app],
        driver_contacts: [
          contact({ id: "p1", application_id: L1, kind: "phone", value: PRIMARY_PHONE, is_primary: true, receives_messages: true }),
          contact({ id: "x1", application_id: L1, kind: "phone", value: EXTRA_PHONE, receives_messages: true, consented_at: null }),
        ],
        sms_opt_outs: [],
      }),
      L1,
      app,
      { transactionalPrimary: true },
    );
    expect(noConsentExtra.find((t) => t.is_primary)?.canText).toBe(true);
    expect(noConsentExtra.find((t) => t.e164 === EXTRA_PHONE)?.canText).toBe(false);
  });
});

describe("FLEET status API", () => {
  test("lead status includes contacts; lookup matches an extra phone", async () => {
    const s = await import("@/lib/fleet-status.server");
    const db = dbWithContacts({
      documents: [],
      agreements: [],
      rentals: [],
      payments: [],
      quo_events: [],
      outbound_messages: [],
      fleet_review_decisions: [],
      application_status_changes: [],
    });
    const leadRes = await s.handleFleetStatus(req({ action: "lead", lead_id: L1 }), { env, admin: db, now: () => new Date("2026-11-16T15:00:00Z") });
    expect(leadRes.status).toBe(200);
    const leadBody = await leadRes.json();
    expect(leadBody.ok).toBe(true);
    expect(leadBody.lead.phone).toBe(PRIMARY_PHONE);
    expect(leadBody.lead.email).toBe(PRIMARY_EMAIL);
    expect(leadBody.lead.contacts.phones.some((p: any) => p.value === EXTRA_PHONE && p.is_primary === false)).toBe(true);

    const lookup = await s.handleFleetStatus(req({ action: "lookup", phone: EXTRA_PHONE }), { env, admin: db });
    expect(lookup.status).toBe(200);
    const lookupBody = await lookup.json();
    expect(lookupBody).toMatchObject({ ok: true, lead_id: L1, matched: { kind: "phone", value: EXTRA_PHONE, is_primary: false } });
  });
});

describe("FLEET applicants packet", () => {
  test("get packet includes contacts", async () => {
    const r = await import("@/lib/fleet-review.server");
    const db = dbWithContacts({
      documents: [],
      driver_screenings: [],
      agreements: [],
      fleet_review_decisions: [],
      license_readings: [],
    });
    const res = await r.handleFleetApplicants(req({ action: "get", lead_id: L1 }), { env, admin: db, now: () => new Date("2026-11-16T15:00:00Z") });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.packet.contacts.emails.some((e: any) => e.value === EXTRA_EMAIL && e.is_primary === false)).toBe(true);
    expect(body.packet.answers.phone).toBe(PRIMARY_PHONE);
  });
});

describe("migration", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261116160000_driver_contacts.sql", import.meta.url), "utf8");
  test("creates the table, staff-only RLS, and primary sync triggers", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.driver_contacts");
    expect(sql).toContain("private.is_staff()");
    expect(sql).toContain("applications.phone");
    expect(sql).toContain("applications_sync_primary_contacts");
    expect(sql).toContain("driver_contacts_apply_primary");
    expect(sql).toContain("REVOKE ALL ON public.driver_contacts FROM anon");
    expect(sql).toContain("consented_at");
    expect(sql.toLowerCase()).not.toMatch(/james|regina|destiny|jonathan|smithjayreon|js4482/);
  });
});
