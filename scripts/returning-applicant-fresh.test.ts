// Returning applicant whose earlier application is closed / merged / declined
// (Dolmar, t316u): the old link opened "Already Submitted" with no way forward.
// Runs the real savePartialApplication handler against an in-memory database.
// No network, no real database, nothing sent.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, any>;
let db: Record<string, Row[]> = {};
let sent: string[] = [];
let tokens: string[] = [];
let seq = 0;

function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let lim = Infinity;
  let op: "select" | "update" | "insert" = "select";
  let payload: any = null;
  const rows = () => (db[table] ??= []);
  const run = () => {
    if (op === "insert") {
      const list = Array.isArray(payload) ? payload : [payload];
      const out = list.map((p: Row) => ({ id: `${table}-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...p }));
      rows().push(...out);
      return out;
    }
    let hit = rows().filter((r) => filters.every((f) => f(r)));
    if (op === "update") hit.forEach((r) => Object.assign(r, payload));
    if (q._sort) hit = [...hit].sort((a, b) => (q._sort.asc ? 1 : -1) * String(a[q._sort.k]).localeCompare(String(b[q._sort.k])));
    return hit.slice(0, lim);
  };
  const q: any = {
    select: () => q,
    eq: (k: string, v: any) => (filters.push((r) => r[k] === v), q),
    in: (k: string, vs: any[]) => (filters.push((r) => vs.includes(r[k])), q),
    is: (k: string, v: any) => (filters.push((r) => (r[k] ?? null) === v), q),
    ilike: (k: string, v: string) => (filters.push((r) => String(r[k] ?? "").toLowerCase() === v.replace(/\\(.)/g, "$1").toLowerCase()), q),
    order: (k: string, o?: { ascending?: boolean }) => Object.assign(q, { _sort: { k, asc: o?.ascending !== false } }),
    limit: (n: number) => ((lim = n), q),
    insert: (p: any) => ((op = "insert"), (payload = p), q),
    update: (p: any) => ((op = "update"), (payload = p), q),
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => ({ data: run()[0], error: null }),
    then: (res: any, rej: any) => {
      return Promise.resolve({ data: run(), error: null }).then(res, rej);
    },
  };
  return q;
}
const supabaseAdmin = { from: (t: string) => query(t) };

let handler: (a: { data: any }) => Promise<any>;
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    const chain: any = {
      middleware: () => chain,
      inputValidator: (v: any) => ((chain._v = v), chain),
      handler: (h: any) => {
        const fn = (a: { data: any }) => h({ data: chain._v ? chain._v(a.data) : a.data });
        if (!handler) handler = fn;
        return fn;
      },
    };
    return chain;
  },
  useServerFn: (f: any) => f,
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));
const realTok = await import("@/lib/resume-tokens.server");
const realEmail = await import("@/lib/email.server");
mock.module("@/lib/resume-tokens.server", () => ({
  ...realTok,
  issueResumeToken: async (_: any, id: string) => (tokens.push(id), `tok-${id}`),
}));
mock.module("@/lib/email.server", () => ({
  ...realEmail,
  sendApplicationResumeEmail: async ({ applicationId }: any) => (sent.push(applicationId), { ok: true }),
  sendPortalHandoffEmail: async () => (sent.push("portal"), { ok: true }),
  sendLeadAlertEmail: async () => ({ ok: true }),
}));
mock.module("@/lib/portal-handoff", () => ({
  shouldHandoffToPortal: async (_: any, app: any) => ["approved", "active"].includes(app?.status),
}));
mock.module("@/lib/step-one-email.server", () => ({ sendStepOneThankYouEmail: async () => (sent.push("step1"), { ok: true }) }));
mock.module("@/lib/fleet-webhook.server", () => ({ dispatchFleetWebhooks: async () => ({}) }));

const mod = await import("@/lib/applications.functions");
const save = mod.savePartialApplication as unknown as (a: { data: any }) => Promise<any>;
const { returningAction } = await import("@/lib/returning-applicant");

const EMAIL = "returning.renter@example.com";
const form = (over: Row = {}) => ({
  full_name: "Pat Example", phone: "8135550199", email: EMAIL, sms_consent: false,
  market_id: null, city: null, state: null, source: "homepage", ...over,
});
const old = (status: string, extra: Row = {}) => {
  const row = { id: "old-app", email: EMAIL, full_name: "ESIGN Test", phone: "8135550199", status, created_at: "2026-10-05T08:45:00Z", deleted_at: null, primary_application_id: null, resubmission_count: 0, resubmission_history: [], ...extra };
  db.applications = [row];
  return row;
};

beforeEach(() => {
  db = { applications: [], applicant_autoclose: [], application_identity_reviews: [] };
  sent = []; tokens = []; seq = 0;
});

describe("returningAction", () => {
  test("in-progress resumes", () => {
    for (const s of ["partial", "new", "complete", "reviewing"]) expect(returningAction(s)).toBe("resume");
  });
  test("closed and merged start fresh; declined starts fresh with review", () => {
    expect(returningAction("closed")).toBe("fresh");
    expect(returningAction("duplicate")).toBe("fresh");
    expect(returningAction("Declined")).toBe("fresh_review");
  });
  test("our missing-items auto-close resumes (it reopens on the link)", () => {
    expect(returningAction("closed", true)).toBe("resume");
  });
  test("current renters are never given a second application", () => {
    for (const s of ["approved", "active", "suspended", "", null, "weird"]) expect(returningAction(s as any)).toBe("resume");
  });
});

describe("savePartialApplication with a returning email", () => {
  test("closed match: new application, link for the NEW one, no token to the caller", async () => {
    old("closed");
    const r = await save({ data: form() });
    expect(r.token).toBeNull();
    expect(r.id).toBeNull();
    expect(r.fresh).toBe(true);
    expect(r.linkStatus).toBe("sent");
    const fresh = db.applications.find((a) => a.id !== "old-app")!;
    expect(fresh.status).toBe("partial");
    expect(fresh.full_name).toBe("Pat Example");
    expect(fresh.email).toBe(EMAIL);
    expect(sent).toEqual([fresh.id]); // not the old app, and no Step 1 email on top
    expect(tokens).toEqual([]);
    expect(fresh.resubmission_history[0].previous_application_id).toBe("old-app");
    const prev = db.applications.find((a) => a.id === "old-app")!;
    expect(prev.status).toBe("closed");
    expect(prev.full_name).toBe("ESIGN Test");
    expect(prev.resubmission_history.at(-1).reapplied_as).toBe(fresh.id);
    expect(db.application_identity_reviews.length).toBe(0);
  });

  test("submitting again resumes that new application instead of making more", async () => {
    old("closed");
    await save({ data: form() });
    const before = db.applications.length;
    const r = await save({ data: form({ full_name: "Pat Again" }) });
    expect(db.applications.length).toBe(before);
    expect(r.fresh).toBeUndefined();
    expect(r.token).toBeNull();
    expect(["sent", "recent"]).toContain(r.linkStatus);
  });

  test("declined match: new application plus an open staff review", async () => {
    old("declined");
    const r = await save({ data: form() });
    expect(r.fresh).toBe(true);
    const fresh = db.applications.find((a) => a.id !== "old-app")!;
    expect(db.application_identity_reviews).toHaveLength(1);
    expect(db.application_identity_reviews[0].application_id).toBe(fresh.id);
    expect(db.application_identity_reviews[0].kind).toBe("reapplied_after_decline");
    expect(db.applications.find((a) => a.id === "old-app")!.status).toBe("declined");
  });

  test("in-progress match: unchanged, link to the existing application", async () => {
    old("new");
    const r = await save({ data: form() });
    expect(r.fresh).toBeUndefined();
    expect(db.applications).toHaveLength(1);
    expect(sent).toEqual(["old-app"]);
    expect(r.token).toBeNull();
  });

  test("auto-closed by missing-items: resumes (reopens on the link)", async () => {
    old("closed");
    db.applicant_autoclose.push({ id: "c1", application_id: "old-app", reopened_at: null, prior_status: "new" });
    const r = await save({ data: form() });
    expect(r.fresh).toBeUndefined();
    expect(sent).toEqual(["old-app"]);
  });

  test("approved renter: still the portal sign-in email, no new application", async () => {
    old("approved");
    const r = await save({ data: form() });
    expect(db.applications).toHaveLength(1);
    expect(sent).toEqual(["portal"]);
    expect(r.token).toBeNull();
  });

  test("phone-only match with a different email: still staff review, nothing created or sent", async () => {
    old("closed", { email: "someone.else@example.com" });
    const r = await save({ data: form() });
    expect(r.linkStatus).toBe("review");
    expect(db.applications).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  test("brand-new applicant: unchanged, token straight to the wizard", async () => {
    const r = await save({ data: form() });
    expect(typeof r.token).toBe("string");
    expect(r.existing).toBe(false);
  });
});

describe("the locked page is not a dead end", () => {
  const wiz = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
  const locked = wiz.slice(wiz.indexOf("function ApplicationLocked()"), wiz.indexOf("function SideRail("));
  test("offers Start A New Application and still Contact Us", () => {
    expect(locked).toContain('to="/apply"');
    expect(locked).toContain("Start A New Application");
    expect(locked).toContain("Contact Us");
    expect(locked).toContain("APPLICATION_LOCKED_NEXT_STEP");
    expect(locked).not.toContain("Back To Home");
  });
  test("next-step copy stays generic about the decision", async () => {
    const { APPLICATION_LOCKED_NEXT_STEP } = await import("@/lib/application-edit-status");
    expect(APPLICATION_LOCKED_NEXT_STEP).not.toMatch(/declin|approv|reject/i);
  });
});
