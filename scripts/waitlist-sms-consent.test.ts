// Waitlist SMS consent (Automation Blueprint). The real migration SQL runs in
// a throwaway in-memory Postgres (PGlite); the promoted application is then
// fed to the real sendSms with a fake database and a mocked Quo, so the
// follow-up texts' consent gate is exercised without any text leaving.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";

const MIGRATION = "supabase/migrations/20261114120000_waitlist_sms_consent.sql";
const SQL = readFileSync(MIGRATION, "utf8");
const FN_SQL = SQL.replace(/REVOKE[\s\S]*$/, ""); // roles don't exist in PGlite; grants checked statically below

let pg: PGlite;
const W = "11111111-1111-4111-8111-111111111111";
const EXISTING = "22222222-2222-4222-8222-222222222222";

async function setupPg() {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE applications (id uuid primary key default gen_random_uuid(), full_name text, email text, phone text,
      city text, state text, market_id uuid, pickup_date date, sms_consent boolean default false,
      sms_consent_at timestamptz, sms_consent_source text, sms_consent_version text, sms_consent_text text,
      sms_consent_phone text, sms_consent_page text, sms_opt_out_at timestamptz,
      source text, status text default 'partial', current_step text, utm_source text, utm_medium text, utm_campaign text,
      utm_content text, utm_term text, gclid text, waitlist_signed_up_at timestamptz, waitlist_source text,
      primary_application_id uuid, created_at timestamptz default now());
    CREATE TABLE waitlist (id uuid primary key, market_id uuid, full_name text, email text, phone text, driver_status text,
      source text, utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, gclid text,
      created_at timestamptz default now(), status text default 'waiting', pickup_date date, notified_at timestamptz,
      promoted_application_id uuid, promoted_at timestamptz, city text, state text, review_reason text, review_flagged_at timestamptz);
  `);
  await pg.exec(FN_SQL);
}
const one = async (q: string, p: any[] = []) => (await pg.query<any>(q, p)).rows[0];
const promote = async () => (await one(`SELECT public.promote_waitlist_entry($1) AS r`, [W])).r;
async function addWaitlist(consent: boolean, phone = "(813) 555-0142") {
  await pg.query(
    `INSERT INTO waitlist (id, full_name, email, phone, source, sms_consent, sms_consent_at, sms_consent_source, sms_consent_version,
       sms_consent_text, sms_consent_phone, sms_consent_page)
     VALUES ($1,'Sam Test','sam@example.com',$2,'fleet_waitlist',$3,$4,$5,$6,$7,$8,$9)`,
    consent
      ? [W, phone, true, "2026-11-14T15:00:00Z", "website_application", "2026-10-07.v1", "I agree to receive texts... Reply STOP to opt out.", "+18135550142", "/tampa"]
      : [W, phone, false, null, null, null, null, null, null],
  );
}

describe("migration shape", () => {
  test("additive only: consent columns on waitlist, function replaced, no deletes or drops", () => {
    for (const c of ["sms_consent boolean NOT NULL DEFAULT false", "sms_consent_at timestamptz", "sms_consent_source text", "sms_consent_version text", "sms_consent_text text", "sms_consent_phone text", "sms_consent_page text"]) {
      expect(SQL).toContain(`ADD COLUMN IF NOT EXISTS ${c}`);
    }
    expect(SQL).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.promote_waitlist_entry(uuid) FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.promote_waitlist_entry(uuid) TO service_role;");
    expect(SQL).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public'/);
  });
});

describe("promote_waitlist_entry carries consent", () => {
  beforeEach(setupPg);

  test("opted-in waitlist entry becomes a consented application with the same evidence", async () => {
    await addWaitlist(true);
    const r = await promote();
    expect(r).toMatchObject({ created: true });
    const a = await one(`SELECT * FROM applications WHERE id = $1`, [r.application_id]);
    expect(a).toMatchObject({ sms_consent: true, sms_consent_source: "website_application", sms_consent_version: "2026-10-07.v1", sms_consent_phone: "+18135550142", sms_consent_page: "/tampa", status: "new" });
    expect(new Date(a.sms_consent_at).toISOString()).toBe("2026-11-14T15:00:00.000Z");
  });

  test("no opt-in: application stays unconsented with no evidence (as today)", async () => {
    await addWaitlist(false);
    const r = await promote();
    const a = await one(`SELECT * FROM applications WHERE id = $1`, [r.application_id]);
    expect(a.sms_consent).toBe(false);
    expect(a.sms_consent_at).toBeNull();
    expect(a.sms_consent_text).toBeNull();
  });

  test("email match: consent added only when the application has none, no opt-out and the same phone", async () => {
    await pg.query(`INSERT INTO applications (id, full_name, email, phone, sms_consent) VALUES ($1,'Sam','Sam@Example.com','813-555-0142',false)`, [EXISTING]);
    await addWaitlist(true);
    expect(await promote()).toMatchObject({ application_id: EXISTING, created: false });
    expect((await one(`SELECT sms_consent, sms_consent_phone FROM applications WHERE id=$1`, [EXISTING]))).toMatchObject({ sms_consent: true, sms_consent_phone: "+18135550142" });
  });

  test("email match with an opt-out on file: the opt-out wins", async () => {
    await pg.query(`INSERT INTO applications (id, full_name, email, phone, sms_consent, sms_opt_out_at) VALUES ($1,'Sam','sam@example.com','8135550142',false,now())`, [EXISTING]);
    await addWaitlist(true);
    await promote();
    expect((await one(`SELECT sms_consent FROM applications WHERE id=$1`, [EXISTING])).sms_consent).toBe(false);
  });

  test("email match with earlier consent evidence: left untouched", async () => {
    await pg.query(`INSERT INTO applications (id, full_name, email, phone, sms_consent, sms_consent_version, sms_consent_page) VALUES ($1,'Sam','sam@example.com','8135550142',true,'old.v0','/apply')`, [EXISTING]);
    await addWaitlist(true);
    await promote();
    expect(await one(`SELECT sms_consent_version, sms_consent_page FROM applications WHERE id=$1`, [EXISTING])).toEqual({ sms_consent_version: "old.v0", sms_consent_page: "/apply" });
  });

  test("identity review paths unchanged (phone-only match is flagged, nothing linked)", async () => {
    await pg.query(`INSERT INTO applications (id, full_name, email, phone) VALUES ($1,'Other','other@example.com','8135550142')`, [EXISTING]);
    await addWaitlist(true);
    expect(await promote()).toMatchObject({ needs_review: true, reason: "phone_only_match" });
    expect((await one(`SELECT sms_consent FROM applications WHERE id=$1`, [EXISTING])).sms_consent).toBe(false);
  });
});

// ---- the follow-up texts' gate (sendSms, kind "automation") --------------------
type Row = Record<string, any>;
let state: Record<string, Row[]>;
function from(table: string) {
  state[table] ??= [];
  let op: "select" | "insert" | "update" = "select";
  let payload: any = null;
  let single = false;
  const filters: ((r: Row) => boolean)[] = [];
  const q: any = {
    select: () => q,
    insert: (r: Row) => { op = "insert"; payload = r; return q; },
    update: (r: Row) => { op = "update"; payload = r; return q; },
    eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return q; },
    in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return q; },
    order: () => q, limit: () => q,
    maybeSingle: () => { single = true; return q; },
    single: () => { single = true; return q; },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  function run() {
    const rows = state[table];
    const match = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "insert") { const r = { id: `row-${rows.length + 1}`, ...payload }; rows.push(r); return { data: single ? { id: r.id } : null, error: null }; }
    if (op === "update") { for (const r of match) Object.assign(r, payload); return { data: null, error: null }; }
    return { data: single ? match[0] ?? null : match, error: null };
  }
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => from(t) } }));
const quoCalls: string[] = [];
globalThis.fetch = (async (url: any, init: any) => {
  if (!String(url).startsWith("https://api.quo.com/")) throw new Error(`network refused in test: ${url}`);
  quoCalls.push(String(init?.body ?? ""));
  return new Response(JSON.stringify({ data: { id: "AC1", status: "queued" } }), { status: 202, headers: { "content-type": "application/json" } });
}) as any;
const { sendSms } = await import("@/lib/sms.server");

async function promotedRow(consent: boolean) {
  await setupPg();
  await addWaitlist(consent);
  const r = await promote();
  return one(`SELECT id, phone, sms_consent, sms_opt_out_at FROM applications WHERE id = $1`, [r.application_id]);
}

describe("follow-up text gate with promoted waitlist leads (no real send)", () => {
  beforeEach(() => {
    quoCalls.length = 0;
    for (const k of ["QUO_PHONE_NUMBER_ID", "QUO_FROM_NUMBERS", "SMS_DRY_RUN", "TWILIO_ACCOUNT_SID"]) delete process.env[k];
    process.env.QUO_API_KEY = "quo-test-key";
  });

  test("opted-in waitlist lead: the automation text passes the consent gate (sent via mocked Quo, from 888)", async () => {
    const app = await promotedRow(true);
    state = { applications: [app], outbound_messages: [], sms_opt_outs: [] };
    const r = await sendSms({ to: app.phone, body: "Hi Sam, it's REAL RENTALS. Reply STOP to opt out.", kind: "automation", applicationId: app.id, enrollmentId: "e1", stepId: "s1" });
    expect(r.ok).toBe(true);
    expect(quoCalls.length).toBe(1);
    expect(state.outbound_messages[0]).toMatchObject({ status: "sent", kind: "automation", application_id: app.id, from_address: "+18888338280" });
  });

  test("waitlist lead who did not opt in: skipped and logged, nothing sent", async () => {
    const app = await promotedRow(false);
    state = { applications: [app], outbound_messages: [], sms_opt_outs: [] };
    const r = await sendSms({ to: app.phone, body: "Hi", kind: "automation", applicationId: app.id, enrollmentId: "e1", stepId: "s1" });
    expect(r).toMatchObject({ ok: false, skipped: true, reason: "no_consent" });
    expect(quoCalls.length).toBe(0);
    expect(state.outbound_messages[0]).toMatchObject({ status: "skipped", error: "no SMS consent on file" });
  });

  test("STOP still wins over a waitlist opt-in", async () => {
    const app = await promotedRow(true);
    state = { applications: [app], outbound_messages: [], sms_opt_outs: [{ phone: "+18135550142" }] };
    const r = await sendSms({ to: app.phone, body: "Hi", kind: "automation", applicationId: app.id });
    expect(r).toMatchObject({ skipped: true, reason: "opted_out" });
    expect(quoCalls.length).toBe(0);
  });
});

describe("site wiring", () => {
  test("joinWaitlist stores server-side evidence only for an affirmative opt-in", async () => {
    const { waitlistConsentEvidence } = await import("@/lib/waitlist.functions");
    const { SMS_CONSENT_TEXT, SMS_CONSENT_VERSION } = await import("@/lib/sms-consent");
    expect(await waitlistConsentEvidence({ phone: "813-555-0142" })).toEqual({ sms_consent: false });
    expect(await waitlistConsentEvidence({ phone: "813-555-0142", sms_consent: false })).toEqual({ sms_consent: false });
    const e = await waitlistConsentEvidence({ phone: "(813) 555-0142", sms_consent: true, consent_page: "/tampa" }, () => new Date("2026-11-14T15:00:00Z"));
    expect(e).toEqual({
      sms_consent: true, sms_consent_at: "2026-11-14T15:00:00.000Z", sms_consent_source: "website_application",
      sms_consent_version: SMS_CONSENT_VERSION, sms_consent_text: SMS_CONSENT_TEXT, sms_consent_phone: "+18135550142", sms_consent_page: "/tampa",
    });
    const src = readFileSync("src/lib/waitlist.functions.ts", "utf8");
    expect(src).toContain("...consentEvidence,");
  });

  test("the city form shows the same optional opt-in in waitlist mode and sends it", () => {
    const s = readFileSync("src/components/site/CityHeroLeadForm.tsx", "utf8");
    expect(s.match(/<SmsConsentField /g)?.length).toBe(1);
    expect(s).not.toMatch(/waitlistMode \?[\s\S]{0,400}: \(\s*<>\s*<SmsConsentField/);
    expect(s).toMatch(/source: "fleet_waitlist",\s*sms_consent: form\.sms_consent,/);
  });

  test("the follow-up texts themselves are untouched (still kind automation, still consent-gated)", () => {
    const a = readFileSync("src/lib/automations.server.ts", "utf8");
    expect(a).toMatch(/sendSms\(\{[\s\S]{0,200}kind: "automation"/);
    expect(a).not.toMatch(/requireConsent:\s*false/);
  });
});
