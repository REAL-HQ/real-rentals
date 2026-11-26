// Lead alert reliability (Dolmar, Nov 22 2026). Nov 16–22 the applicant
// alerts were fired with a bare `void` and cut off when the response went out:
// 15 rows stuck at "sending", 6 alerts never sent. Covers: the bounded
// keep-alive, both call sites awaiting it, subject/meta/idempotency on the
// alert, the webhook's pending-row claim, and the exactly-once sweep.
import { describe, expect, mock, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, any>;
const db: { rows: Record<string, Row[]>; insertError: any; rpcCalls: any[]; rpc: Record<string, (a: any) => any> } = {
  rows: {}, insertError: null, rpcCalls: [], rpc: {},
};
const T = (n: string) => (db.rows[n] ??= []);
let seq = 0;

function table(name: string): any {
  const preds: Array<(r: Row) => boolean> = [];
  let lim = Infinity; let patch: Row | null = null; let sorted: [string, boolean] | null = null;
  const run = () => {
    let rows = T(name).filter((r) => preds.every((p) => p(r)));
    if (sorted) { const [k, asc] = sorted; rows = [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1)); }
    rows = rows.slice(0, lim);
    if (patch) for (const r of rows) Object.assign(r, patch);
    return rows.map((r) => ({ ...r }));
  };
  const q: any = {
    select: () => q,
    eq(k: string, v: any) { preds.push((r) => r[k] === v); return q; },
    is(k: string, v: any) { preds.push((r) => (r[k] ?? null) === v); return q; },
    lt(k: string, v: any) { preds.push((r) => r[k] != null && r[k] < v); return q; },
    gte(k: string, v: any) { preds.push((r) => r[k] != null && r[k] >= v); return q; },
    lte(k: string, v: any) { preds.push((r) => r[k] != null && r[k] <= v); return q; },
    in(k: string, v: any[]) { preds.push((r) => v.includes(r[k])); return q; },
    order(k: string, o: any) { sorted = [k, o?.ascending !== false]; return q; },
    limit(n: number) { lim = n; return q; },
    update(p: Row) { patch = p; return q; },
    async maybeSingle() { const r = run(); return { data: r[0] ?? null, error: null }; },
    then(res: any, rej: any) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    insert(row: Row) {
      const err = name === "email_deliveries" && db.insertError && ("meta" in row || "subject" in row) ? db.insertError : null;
      const id = "row" + ++seq;
      if (!err) T(name).push({ id, created_at: new Date().toISOString(), resend_message_id: null, ...row });
      const res = { data: err ? null : { id }, error: err };
      const p: any = Promise.resolve(res); p.select = () => ({ single: async () => res }); return p;
    },
  };
  return q;
}
const supabaseAdmin = {
  from: (n: string) => table(n),
  rpc: async (fn: string, args: any) => {
    db.rpcCalls.push({ fn, args });
    if (db.rpc[fn]) return db.rpc[fn](args);
    if (fn === "email_delivery_attach") {
      const row = T("email_deliveries").find((r) => r.id === args._id);
      const ph = T("email_deliveries").find((r) => r.resend_message_id === args._resend_id && r.id !== args._id);
      if (ph) db.rows.email_deliveries = T("email_deliveries").filter((r) => r !== ph);
      if (row) Object.assign(row, { resend_message_id: args._resend_id, state: ph?.state === "delivered" ? "delivered" : "accepted" });
      return { data: null, error: null };
    }
    return { data: null, error: { code: "PGRST202", message: "not found" } };
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
let waitUntilFn: any = undefined;
mock.module("@tanstack/react-start/server", () => ({ getRequest: () => (waitUntilFn ? { waitUntil: waitUntilFn } : {}) }));
const fetches: Array<{ url: string; headers: any; body: any }> = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  fetches.push({ url: String(url), headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
  return new Response(JSON.stringify({ id: "re_" + fetches.length }), { status: 200 });
};
process.env.RESEND_API_KEY = "test-only";

const { keepAlive } = await import("@/lib/after-response.server");
const email = await import("@/lib/email.server");
const sweep = await import("@/lib/lead-alert-sweep.server");
const { claimPendingDelivery } = await import("@/lib/email-delivery-match.server");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
beforeEach(() => { db.rows = {}; db.insertError = null; db.rpcCalls = []; db.rpc = {}; fetches.length = 0; waitUntilFn = undefined; });

describe("keepAlive", () => {
  test("hands the work to waitUntil when the runtime has one", async () => {
    const got: Promise<unknown>[] = [];
    const out = await keepAlive(wait(50), { maxWaitMs: 10, waitUntil: (p) => got.push(p) });
    expect(out).toBe("background"); expect(got.length).toBe(1);
  });
  test("reads waitUntil from the request", async () => {
    const got: Promise<unknown>[] = []; waitUntilFn = (p: Promise<unknown>) => got.push(p);
    expect(await keepAlive(wait(5), { maxWaitMs: 10 })).toBe("background"); expect(got.length).toBe(1);
  });
  test("otherwise waits for the work", async () => {
    let finished = false;
    expect(await keepAlive(wait(20).then(() => { finished = true; }), { maxWaitMs: 1000, waitUntil: null })).toBe("done");
    expect(finished).toBe(true);
  });
  test("but never longer than maxWaitMs, and never throws", async () => {
    const t0 = Date.now();
    expect(await keepAlive(wait(500), { maxWaitMs: 30, waitUntil: null })).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(300);
    expect(await keepAlive(Promise.reject(new Error("boom")), { maxWaitMs: 30, waitUntil: null })).toBe("done");
  });
});

describe("call sites", () => {
  const src = readFileSync("src/lib/applications.functions.ts", "utf8");
  test("no fire-and-forget lead alert remains", () => {
    expect(src).not.toMatch(/void\s+sendLeadAlertEmail/);
    expect(src.match(/await keepAlive\(\s*sendLeadAlertEmail\(/g)?.length).toBe(2);
    expect(src).toMatch(/LEAD_ALERT_WAIT_MS = \d{4};/);
  });
  test("the sweep runs in the every-5-minute automations cron", () => {
    expect(readFileSync("src/routes/api/public/cron/automations.ts", "utf8")).toContain("sweepStuckLeadAlerts(supabaseAdmin)");
  });
});

const lead = (over: Record<string, unknown> = {}) => email.sendLeadAlertEmail({
  event: "complete", applicationId: "app-1", full_name: "Pat Sample", phone: null, email: null, city: "Tampa", state: "FL",
  market: "Tampa", pickup_date: null, return_date: null, platforms: null, sms_consent: null, source: null, ...over,
} as any);

describe("lead alert send", () => {
  test("records subject + meta and sends with a stable idempotency key", async () => {
    await lead();
    const row = T("email_deliveries")[0];
    expect(row).toMatchObject({ workflow: "lead_alert", meta: { applicationId: "app-1", event: "complete" } });
    expect(typeof row.subject).toBe("string");
    expect(fetches[0].headers["Idempotency-Key"]).toBe("lead-alert/app-1/complete");
    expect(email.leadAlertIdempotencyKey("app-1", "new")).toBe("lead-alert/app-1/new");
  });
  test("a sweep resend carries retry_of and the same key", async () => {
    await lead({ retryOf: "old-row" });
    expect(T("email_deliveries")[0].meta).toMatchObject({ retry_of: "old-row" });
    expect(fetches[0].headers["Idempotency-Key"]).toBe("lead-alert/app-1/complete");
  });
  test("before the migration, the row is still recorded without the new columns", async () => {
    db.insertError = { code: "PGRST204", message: "Could not find the 'meta' column of 'email_deliveries' in the schema cache" };
    const r = await email.sendEmail({ to: "a@drivereal.com", subject: "s", html: "<p>x</p>", track: { workflow: "test_email" } });
    expect(r.ok).toBe(true);
    expect(T("email_deliveries").length).toBe(1);
    expect(T("email_deliveries")[0]).not.toHaveProperty("meta");
  });
  test("isMissingColumnError only matches missing-column errors", () => {
    expect(email.isMissingColumnError({ code: "42703" })).toBe(true);
    expect(email.isMissingColumnError({ message: 'column "meta" does not exist' })).toBe(true);
    expect(email.isMissingColumnError({ code: "23505", message: "duplicate key" })).toBe(false);
  });
});

describe("webhook pending claim", () => {
  test("passes recipient, subject and send time to the SQL claim", async () => {
    db.rpc.email_delivery_claim_pending = () => ({ data: "attached", error: null });
    const out = await claimPendingDelivery(supabaseAdmin, { resendId: "re_9", recipient: "o@x.com", subject: "New Applicant: Pat", sentAt: "2026-11-22T14:00:00Z" });
    expect(out).toBe("attached");
    expect(db.rpcCalls[0].args).toEqual({ _resend_id: "re_9", _recipient: "o@x.com", _subject: "New Applicant: Pat", _sent_at: "2026-11-22T14:00:00.000Z" });
  });
  test("migration not applied, ambiguous, or throwing: stays unmatched", async () => {
    expect(await claimPendingDelivery(supabaseAdmin, { resendId: "r", recipient: "o@x.com", subject: null, sentAt: null })).toBe("unmatched");
    db.rpc.email_delivery_claim_pending = () => ({ data: "ambiguous", error: null });
    expect(await claimPendingDelivery(supabaseAdmin, { resendId: "r", recipient: "o@x.com", subject: null, sentAt: "bad" })).toBe("unmatched");
    db.rpc.email_delivery_claim_pending = () => { throw new Error("net"); };
    expect(await claimPendingDelivery(supabaseAdmin, { resendId: "r", recipient: "o@x.com", subject: null, sentAt: null })).toBe("unmatched");
  });
  test("the webhook route calls it only for unmatched events", () => {
    const src = readFileSync("src/routes/api/public/resend/webhook.ts", "utf8");
    expect(src).toMatch(/if \(data === "unmatched" && recipient\)/);
    expect(src).toContain("claimPendingDelivery(supabaseAdmin");
  });
});

describe("sweep", () => {
  const NOW = new Date("2026-11-22T15:00:00Z");
  const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
  const stuck = (id: string, min: number, meta: any = { applicationId: "app-1", event: "complete" }) =>
    T("email_deliveries").push({ id, workflow: "lead_alert", state: "sending", resend_message_id: null, recipient: "Owner@x.com", subject: "New Applicant: Pat", meta, created_at: ago(min) });
  const app = () => T("applications").push({ id: "app-1", full_name: "Pat Sample", email: "pat@x.com", city: "Tampa", state: "FL", market_id: null, platforms: ["Uber"], deleted_at: null });
  const sent: any[] = [];
  const send = async (a: any) => { sent.push(a); };
  beforeEach(() => { sent.length = 0; });

  test("inert until the migration adds meta", async () => {
    const admin = { ...supabaseAdmin, from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ lt: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: "42703", message: 'column "meta" does not exist' } }) }) }) }) }) }) }) }) };
    expect((await sweep.sweepStuckLeadAlerts(admin, { now: NOW, send })).inert).toBe("migration_pending");
    expect(sent.length).toBe(0);
  });
  test("leaves rows under 10 minutes alone", async () => {
    stuck("s1", 5); app();
    const r = await sweep.sweepStuckLeadAlerts(supabaseAdmin, { now: NOW, send });
    expect(r.checked).toBe(0); expect(sent.length).toBe(0);
  });
  test("links to Resend's unmatched webhook row instead of resending", async () => {
    stuck("s1", 30); app();
    T("email_deliveries").push({ id: "u1", workflow: "unmatched", state: "delivered", resend_message_id: "re_x", recipient: "owner@x.com", created_at: new Date(Date.parse(ago(30)) + 2500).toISOString() });
    const r = await sweep.sweepStuckLeadAlerts(supabaseAdmin, { now: NOW, send });
    expect(r.linked).toBe(1); expect(sent.length).toBe(0);
    expect(T("email_deliveries").find((x) => x.id === "s1")).toMatchObject({ resend_message_id: "re_x", state: "delivered" });
  });
  test("resends exactly once, even across overlapping runs", async () => {
    stuck("s1", 30); app();
    const [a, b] = await Promise.all([
      sweep.sweepStuckLeadAlerts(supabaseAdmin, { now: NOW, send }),
      sweep.sweepStuckLeadAlerts(supabaseAdmin, { now: NOW, send }),
    ]);
    expect(a.resent + b.resent).toBe(1);
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ event: "complete", applicationId: "app-1", retryOf: "s1", platforms: ["Uber"] });
    expect(T("email_deliveries").find((x) => x.id === "s1")).toMatchObject({ state: "failed", provider_reason: sweep.RESENT_REASON });
    expect((await sweep.sweepStuckLeadAlerts(supabaseAdmin, { now: NOW, send })).checked).toBe(0);
    expect(sent.length).toBe(1);
  });
  test("a stuck resend, an old row, or a row without meta is marked, never resent", async () => {
    stuck("r1", 30, { applicationId: "app-1", event: "complete", retry_of: "s0" });
    stuck("o1", 60 * 24, { applicationId: "app-1", event: "complete" });
    stuck("n1", 30, null); app();
    const r = await sweep.sweepStuckLeadAlerts(supabaseAdmin, { now: NOW, send });
    expect(r.markedOnly).toBe(3); expect(sent.length).toBe(0);
    for (const id of ["r1", "o1", "n1"]) expect(T("email_deliveries").find((x) => x.id === id)).toMatchObject({ state: "failed", provider_reason: sweep.NOT_SENT_REASON });
  });
  test("a deleted applicant is marked, not alerted", async () => {
    stuck("s1", 30); T("applications").push({ id: "app-1", deleted_at: "2026-11-22T00:00:00Z" });
    const r = await sweep.sweepStuckLeadAlerts(supabaseAdmin, { now: NOW, send });
    expect(r.markedOnly).toBe(1); expect(sent.length).toBe(0);
  });
});
