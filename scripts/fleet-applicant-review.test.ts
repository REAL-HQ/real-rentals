// FLEET applicant review: the rules, the list/get packet, the decision
// endpoint (approve through the staff code path, needs_staff, no decline),
// the ready-for-review sweep, and the proposed table (PGlite).
// Network refused; fake database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const rules = await import("@/lib/fleet-review");
const srv = await import("@/lib/fleet-review.server");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>, opts: { missing?: string[] } = {}) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  const unique: Record<string, string> = { fleet_review_decisions: "idempotency_key", fleet_webhook_deliveries: "dedupe_key" };
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let lim: number | null = null; let wantRows = false; let cols = "";
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: (c?: string) => { wantRows = true; cols = c ?? ""; return q; },
      insert: (r: Row) => { op = "insert"; payload = r; return q; },
      update: (r: Row) => { op = "update"; payload = r; return q; },
      upsert: (r: Row, o: any) => { op = o?.ignoreDuplicates ? "insert_ignore" : "insert"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      neq: (c: string, v: any) => { f.push((r) => r[c] !== v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      gte: (c: string, v: any) => { f.push((r) => String(r[c] ?? "") >= String(v)); return q; },
      in: (c: string, v: any[]) => { f.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      limit: (x: number) => { lim = x; return q; },
      maybeSingle: () => { single = true; return q; },
      single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      if (opts.missing?.includes(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
      if (table === "applications" && cols.includes("approval_evidence_version"))
        return { data: null, error: { code: "42703", message: "column applications.approval_evidence_version does not exist" } };
      const rows = state[table];
      if (op === "insert" || op === "insert_ignore") {
        const u = unique[table];
        if (u && payload[u] != null && rows.some((r) => r[u] === payload[u])) {
          if (op === "insert_ignore") return { data: [], error: null };
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        if (table === "fleet_review_decisions" && payload.decision === "needs_staff" && rows.some((r) => r.application_id === payload.application_id && r.decision === "needs_staff" && !r.resolved_at))
          return { data: null, error: { code: "23505", message: "one open" } };
        const r = { id: `${table}-${n++}`, created_at: new Date().toISOString(), resolved_at: null, ...payload };
        rows.push(r);
        return { data: wantRows ? (single ? { id: r.id } : [{ id: r.id }]) : null, error: null };
      }
      let m = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { for (const r of m) Object.assign(r, payload); return { data: wantRows ? m.map((r) => ({ ...r })) : null, error: null }; }
      if (lim != null) m = m.slice(0, lim);
      return { data: single ? m[0] ?? null : m, error: null };
    }
    return q;
  }
  return { from, state, storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed.example/${p}?t=1` } }) }) } };
}

const KEY = "k".repeat(40);
const ENV = { FLEET_API_KEY: KEY };
const NOW = new Date("2026-11-16T15:00:00Z");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const goodApp = (id: string, extra: Row = {}) => ({
  id, full_name: "Test Renter", email: `t${id.slice(0, 2)}@example.com`, phone: "8135550100", status: "new", dob: "1990-02-03",
  license_expiration: "2028-01-01", license_valid: true, rating: 4.95, trips_completed: 2400, gig_status: "Yes, already driving",
  background_check_status: "pending", mvr_status: "pending", deleted_at: null, primary_application_id: null, resubmission_count: 0,
  created_at: "2026-11-15T12:00:00Z", updated_at: "2026-11-16T14:30:00Z", insurance_status: "unknown", ...extra,
});
const docsFor = (id: string, cats = ["license_front", "license_back", "gig_profile", "income"]) =>
  cats.map((c, i) => ({ id: `${id}-d${i}`, driver_id: id, category: c, review_status: "uploaded", is_current: true, created_at: "2026-11-16T14:00:00Z", storage_bucket: "vault", storage_path: `${id}/${c}.jpg` }));
function seed() {
  return {
    applications: [goodApp(A), goodApp(B, { status: "partial" }), goodApp(C, { dob: "2006-01-01" })],
    documents: [...docsFor(A), ...docsFor(B), ...docsFor(C)],
    driver_screenings: [],
    agreements: [],
    fleet_review_decisions: [],
    fleet_webhook_deliveries: [],
  };
}
const req = (path: string, body: unknown, key: string | null = KEY) => new Request(`https://drivereal.com/api/public/fleet/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body),
});

describe("rules", () => {
  const base = { screening: null, disqualifiers: [], readinessState: "promising_more_info", openNeedsStaff: null, priorDeclined: 0, now: NOW };
  test("a clean, submitted applicant with the three hard documents has no blockers", () => {
    const a = rules.assessForFleet({ ...base, app: goodApp(A), docs: docsFor(A) });
    expect(a.hard_blockers).toEqual([]);
    expect(a.ready_for_review).toBe(true);
    expect(a.recommendation).toBe("approve");
    // pending checks and no interview are notes, not escalations
    expect(a.notes.map((x) => x.code)).toContain("background_check_status_pending");
    expect(a.notes.map((x) => x.code)).toContain("no_interview");
    // card t310s1681: a pending background check is a note, never a blocker or flag
    expect(a.hard_blockers.map((x) => x.code)).not.toContain("background_check_status_pending");
    expect(a.hard_blockers.map((x) => x.code)).not.toContain("background_check_status_open");
  });
  test("hard blockers: partial, missing docs, rejected doc, disqualifier, under 21, expired license, bad check, open flag, duplicate, no email", () => {
    const codes = (app: Row, docs = docsFor(A), extra: Row = {}) => rules.assessForFleet({ ...base, app, docs, ...extra }).hard_blockers.map((b) => b.code);
    expect(codes(goodApp(A, { status: "partial" }))).toContain("not_submitted");
    expect(codes(goodApp(A), docsFor(A, ["gig_profile"]))).toContain("missing_license_front");
    expect(codes(goodApp(A), [...docsFor(A, ["gig_profile"]), { category: "license_front", review_status: "rejected", is_current: true }])).toEqual(expect.arrayContaining(["missing_license_front", "rejected_license_front"]));
    // Only the front is required: no back, or a rejected back, is not a blocker.
    expect(codes(goodApp(A), docsFor(A, ["license_front", "gig_profile"]))).toEqual([]);
    const rejectedBack = rules.assessForFleet({ ...base, app: goodApp(A), docs: [...docsFor(A, ["license_front", "gig_profile"]), { category: "license_back", review_status: "rejected", is_current: true }] });
    expect(rejectedBack.hard_blockers).toEqual([]);
    expect(rejectedBack.escalations.map((e) => e.code)).toContain("rejected_license_back");
    expect(codes(goodApp(A), docsFor(A), { disqualifiers: ["DUI on record"] })).toContain("disqualifier");
    expect(codes(goodApp(A, { dob: "2006-06-01" }))).toContain("under_21");
    expect(codes(goodApp(A, { license_expiration: "2026-11-01" }))).toContain("license_expired");
    expect(codes(goodApp(A, { background_check_status: "failed" }))).toContain("background_check_status_failed");
    expect(codes(goodApp(A), docsFor(A), { openNeedsStaff: { reason: "check", created_at: null } })).toContain("open_needs_staff");
    expect(codes(goodApp(A, { primary_application_id: B }))).toContain("duplicate");
    expect(codes(goodApp(A, { email: "" }))).toContain("no_email");
    expect(codes(goodApp(A, { status: "declined" }))).toContain("stage_not_reviewable");
    expect(codes(goodApp(A, { status: "active" }))).toContain("stage_not_reviewable");
  });
  test("applied before: only an earlier declined or closed application escalates (t298s1611)", () => {
    const resub = rules.assessForFleet({ ...base, app: goodApp(A, { resubmission_count: 2 }), docs: docsFor(A) });
    expect(resub.escalations.map((e) => e.code)).not.toContain("resubmitted");
    expect(resub.notes.map((e) => e.code)).toContain("resubmitted");
    expect(resub.recommendation).toBe("approve");
    const prior = rules.assessForFleet({ ...base, app: goodApp(A, { resubmission_count: 2 }), docs: docsFor(A), priorDeclined: 1 });
    expect(prior.escalations.map((e) => e.code)).toContain("prior_declined");
    expect(prior.recommendation).toBe("needs_staff");
  });
  test("no income document alone does not send to staff", () => {
    const a = rules.assessForFleet({ ...base, app: goodApp(A), docs: docsFor(A, ["license_front", "gig_profile"]) });
    expect(a.hard_blockers).toEqual([]);
    expect(a.escalations).toEqual([]);
    expect(a.recommendation).toBe("approve");
  });
  test("income is advisory; escalations are FLEET's call", () => {
    const a = rules.assessForFleet({ ...base, app: goodApp(A, { dob: "2003-01-01", rating: 3.9, trips_completed: 20, ai_flags: ["name mismatch"] }), docs: docsFor(A, ["license_front", "license_back", "gig_profile"]), priorDeclined: 1 });
    expect(a.hard_blockers).toEqual([]);
    expect(a.escalations.map((e) => e.code)).toEqual(expect.arrayContaining(["young_driver", "low_rating", "few_trips", "ai_flags", "prior_declined"]));
    // Missing income proof is requested, not sent to staff (t298s1611).
    expect(a.escalations.map((e) => e.code)).not.toContain("missing_income");
    expect(a.notes.map((e) => e.code)).toContain("requested_income");
    // Gig bar is 100 trips and a 4.0 rating (Dolmar, Nov 16 2026; was 200).
    expect(rules.FLEET_ESCALATION_DEFAULTS.minRating).toBe(4.0);
    expect(rules.FLEET_ESCALATION_DEFAULTS.minTrips).toBe(100);
    const ok = rules.assessForFleet({ ...base, app: goodApp(A, { rating: 4.5, trips_completed: 100 }), docs: docsFor(A, ["license_front", "license_back", "gig_profile", "income"]) });
    expect(ok.escalations.map((e) => e.code)).not.toContain("low_rating");
    expect(ok.escalations.map((e) => e.code)).not.toContain("few_trips");
    const below = rules.assessForFleet({ ...base, app: goodApp(A, { rating: 4.5, trips_completed: 99 }), docs: docsFor(A, ["license_front", "license_back", "gig_profile", "income"]) });
    expect(below.escalations.map((e) => e.code)).toContain("few_trips");
    expect(below.recommendation).toBe("needs_staff");
    const mid = rules.assessForFleet({ ...base, app: goodApp(A, { rating: 4.5, trips_completed: 150 }), docs: docsFor(A, ["license_front", "license_back", "gig_profile", "income"]) });
    expect(mid.escalations.map((e) => e.code)).not.toContain("few_trips");
    const edge = rules.assessForFleet({ ...base, app: goodApp(A, { rating: 4.0, trips_completed: 100 }), docs: docsFor(A, ["license_front", "license_back", "gig_profile", "income"]) });
    expect(edge.escalations.map((e) => e.code)).not.toContain("low_rating");
    expect(edge.escalations.map((e) => e.code)).not.toContain("few_trips");
    expect(a.recommendation).toBe("needs_staff");
  });
  test("no insurance / no full coverage is not a flag, blocker, or missing item", () => {
    const a = rules.assessForFleet({
      ...base,
      app: goodApp(A, {
        insurance_answer: "no",
        full_coverage_insurance: false,
        insurance_status: "none",
        insurance_doc_url: null,
        insurance_rideshare_endorsement: false,
      }),
      docs: docsFor(A, ["license_front", "license_back", "gig_profile", "income"]),
      screening: { has_personal_insurance: false },
    });
    const codes = [...a.hard_blockers, ...a.escalations, ...a.notes].map((e) => e.code);
    const messages = [...a.hard_blockers, ...a.escalations, ...a.notes].map((e) => e.message);
    expect(codes.some((c) => /insurance/i.test(c))).toBe(false);
    expect(messages.some((m) => /no insurance|no full coverage|missing.*insurance|insurance document/i.test(m))).toBe(false);
    expect(a.recommendation).toBe("approve");
  });
});

describe("background checks (Dolmar, t299s1618)", () => {
  const base = { screening: null, disqualifiers: [], readinessState: "promising_more_info", openNeedsStaff: null, priorDeclined: 0, now: NOW };
  test("a clear check with the gig bar met: FLEET may pass", () => {
    const a = rules.assessForFleet({ ...base, app: goodApp(A, { background_check_status: "clear", mvr_status: "passed" }), docs: docsFor(A) });
    expect(a.hard_blockers).toEqual([]);
    expect(a.escalations).toEqual([]);
    expect(a.screening_flagged).toBe(false);
    expect(a.recommendation).toBe("approve");
  });
  test("any flagged background or MVR result goes to staff, never not_ready or approve", () => {
    for (const [k, v] of [["background_check_status", "consider"], ["background_check_status", "flagged"], ["mvr_status", "failed"], ["background_check_status", "declined"]]) {
      const a = rules.assessForFleet({ ...base, app: goodApp(A, { [k]: v }), docs: docsFor(A) });
      expect(a.screening_flagged).toBe(true);
      expect(a.recommendation).toBe("needs_staff");
      expect(a.hard_blockers.map((b) => b.code)).toContain(`${k}_${v}`);
    }
  });
  test("unknown trips or rating is a note telling FLEET to confirm the 100 / 4.0 bar", () => {
    const a = rules.assessForFleet({ ...base, app: goodApp(A, { trips_completed: null, rating: null }), docs: docsFor(A) });
    expect(a.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["no_trips", "no_rating"]));
    expect(a.notes.find((n) => n.code === "no_trips")!.message).toContain("100+");
  });
  test("a Florida license with a different address is not escalated (t359u)", () => {
    const a = rules.assessForFleet({
      ...base,
      app: goodApp(A, { license_state: "FL", address: "100 Example Rd", city: "Plant City", state: "FL", zip: "33567" }),
      docs: docsFor(A),
      licenseReading: { license_state: "FL", address_city: "Exampleville", address_state: "FL", address_zip: "34448" },
    });
    expect(a.escalations.map((e) => e.code)).not.toContain("address_mismatch");
    expect(a.escalations.map((e) => e.code)).not.toContain("out_of_state_license");
    expect(a.notes.map((n) => n.code)).toContain("license_address_recorded");
    expect(a.recommendation).toBe("approve");
  });
  test("an out-of-state license escalates to staff (t359u)", () => {
    const a = rules.assessForFleet({
      ...base,
      app: goodApp(A, { license_state: "GA" }),
      docs: docsFor(A),
      licenseReading: { license_state: "GA" },
    });
    expect(a.escalations.map((e) => e.code)).toContain("out_of_state_license");
    expect(a.escalations.map((e) => e.code)).not.toContain("address_mismatch");
    expect(a.recommendation).toBe("needs_staff");
  });
});

describe("applicants endpoint", () => {
  test("auth: missing or wrong key refused; unconfigured is 503", async () => {
    const db = fakeDb(seed());
    expect((await srv.handleFleetApplicants(req("applicants", { action: "list" }, null), { admin: db, env: ENV })).status).toBe(401);
    expect((await srv.handleFleetApplicants(req("applicants", { action: "list" }, "x".repeat(40)), { admin: db, env: ENV })).status).toBe(401);
    expect((await srv.handleFleetApplicants(req("applicants", { action: "list" }), { admin: db, env: {} })).status).toBe(503);
  });
  test("list returns ready applicants only by default", async () => {
    const db = fakeDb(seed());
    const r = await srv.handleFleetApplicants(req("applicants", { action: "list" }), { admin: db, env: ENV, now: () => NOW });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.rows.map((x: any) => x.lead_id)).toEqual([A]);
    expect(j.rows[0]).toMatchObject({ ready_for_review: true, recommendation: "approve", needs_staff_open: false });
    const all = await (await srv.handleFleetApplicants(req("applicants", { action: "list", ready_only: false }), { admin: db, env: ENV, now: () => NOW })).json();
    expect(all.rows.map((x: any) => x.lead_id).sort()).toEqual([A, C].sort()); // partial is not "awaiting review"
  });
  test("get returns the packet without URLs unless asked; license masked; insurance as recorded", async () => {
    const db = fakeDb(seed());
    const j = await (await srv.handleFleetApplicants(req("applicants", { action: "get", lead_id: A }), { admin: db, env: ENV, now: () => NOW })).json();
    expect(j.ok).toBe(true);
    const p = j.packet;
    expect(p.documents).toHaveLength(4);
    expect(p.documents.every((d: any) => d.url === null)).toBe(true);
    expect(p.answers.license_number).toBeUndefined();
    expect(p.answers.stripe_customer_id).toBeUndefined();
    expect(p.insurance.insurance_verified_by_staff).toBe(false);
    expect(p.insurance.required).toBe(false);
    expect(p.insurance.provided_by_company).toBe(true);
    expect(p.insurance).not.toHaveProperty("carrier");
    expect(JSON.stringify(p.insurance)).not.toMatch(/geico|progressive|state farm|broker/i);
    expect(p.readiness_blockers).toEqual([]);
    const withUrls = await (await srv.handleFleetApplicants(req("applicants", { action: "get", lead_id: A, include_urls: true }), { admin: db, env: ENV, now: () => NOW })).json();
    expect(withUrls.packet.documents[0].url).toContain("https://signed.example/");
    expect(withUrls.packet.documents[0].url_expires_in_seconds).toBe(900);
    expect((await srv.handleFleetApplicants(req("applicants", { action: "get", lead_id: "nope" }), { admin: db, env: ENV })).status).toBe(400);
  });
});

describe("decision endpoint", () => {
  const call = async (db: any, body: unknown, extra: Row = {}) => {
    const audits: any[] = [];
    const res = await srv.handleFleetApplicantDecision(req("applicant-decision", body), { admin: db, env: ENV, now: () => NOW, audit: async (e) => { audits.push(e); }, ...extra });
    return { status: res.status, body: await res.json(), audits };
  };
  test("decline is refused; bad input refused; nothing written", async () => {
    const db = fakeDb(seed());
    for (const d of ["decline", "declined", "reject"]) {
      const r = await call(db, { lead_id: A, decision: d, reason: "Not a fit for us" });
      expect(r.status).toBe(400);
      expect(r.body.error).toContain("needs_staff");
    }
    expect((await call(db, { lead_id: A, decision: "approve", reason: "ok" })).status).toBe(400);
    expect((await call(db, { lead_id: "x", decision: "approve", reason: "Looks good" })).status).toBe(400);
    expect(db.state.applications.find((a) => a.id === A)!.status).toBe("new");
    expect(db.state.fleet_review_decisions).toHaveLength(0);
  });
  test("approve runs the staff approval core with FLEET labels; refused with blockers", async () => {
    const db = fakeDb(seed());
    const seen: any[] = [];
    const approve = async (a: any) => { seen.push(a); return { ok: true, agreementSent: false, portalAccount: "deferred" as const, approvalEmail: "sent" as const }; };
    const blocked = await call(db, { lead_id: C, decision: "approve", reason: "Looks good to FLEET" }, { approve });
    expect(blocked.status).toBe(409);
    expect(blocked.body.hard_blockers.map((b: any) => b.code)).toContain("under_21");
    expect(seen).toHaveLength(0);
    const ok = await call(db, { lead_id: A, decision: "approve", reason: "All checks clean", idempotency_key: "rev-A-1" }, { approve });
    expect(ok.status).toBe(201);
    expect(seen[0]).toMatchObject({ data: { id: A, sendAgreement: false }, actor: null, createdBy: null, decidedBy: { label: "FLEET (automated)", reason: "All checks clean" } });
    expect((await seen[0].rpc("approve_application_checked", {})).error.code).toBe("FLEET_NO_SESSION");
    expect(db.state.fleet_review_decisions[0]).toMatchObject({ application_id: A, decision: "approved", decided_by: "FLEET (automated)" });
    expect(ok.audits[0]).toMatchObject({ action: "application.fleet_approved", entityId: A, metadata: { decided_by: "FLEET (automated)" } });
    const again = await call(db, { lead_id: A, decision: "approve", reason: "All checks clean", idempotency_key: "rev-A-1" }, { approve });
    expect(again.body).toMatchObject({ ok: true, duplicate: true });
    expect(seen).toHaveLength(1);
    const reused = await call(db, { lead_id: C, decision: "needs_staff", reason: "Young driver", idempotency_key: "rev-A-1" }, { approve });
    expect(reused.status).toBe(409);
  });
  test("approve through the real core: legacy path writes approved and never touches insurance or screening", { timeout: 60000 }, async () => {
    const db = fakeDb(seed());
    const before = JSON.stringify({ ins: db.state.applications[0].insurance_status, bg: db.state.applications[0].background_check_status });
    const r = await call(db, { lead_id: A, decision: "approve", reason: "All checks clean" });
    expect(r.status).toBe(201);
    const app = db.state.applications.find((a) => a.id === A)!;
    expect(app.status).toBe("approved");
    expect(JSON.stringify({ ins: app.insurance_status, bg: app.background_check_status })).toBe(before);
    expect(db.state.driver_screenings).toHaveLength(0);
    // Already approved: idempotent, nothing new.
    const again = await call(db, { lead_id: A, decision: "approve", reason: "All checks clean" });
    expect(again.body).toMatchObject({ ok: true, duplicate: true, already_approved: true });
  });
  test("needs_staff opens one flag (idempotent), blocks FLEET approve until staff clear it", async () => {
    const db = fakeDb(seed());
    const r = await call(db, { lead_id: A, decision: "needs_staff", reason: "Rating dipped last month", escalation_codes: ["low_rating"] });
    expect(r.status).toBe(201);
    expect(db.state.fleet_review_decisions[0]).toMatchObject({ decision: "needs_staff", escalation_codes: ["low_rating"], resolved_at: null });
    expect(r.audits[0].action).toBe("application.fleet_needs_staff");
    const again = await call(db, { lead_id: A, decision: "needs_staff", reason: "Rating dipped last month" });
    expect(again.body.duplicate).toBe(true);
    expect(db.state.fleet_review_decisions).toHaveLength(1);
    const approve = await call(db, { lead_id: A, decision: "approve", reason: "Changed my mind" });
    expect(approve.status).toBe(409);
    expect(approve.body.hard_blockers.map((b: any) => b.code)).toContain("open_needs_staff");
    expect(db.state.applications.find((a) => a.id === A)!.status).toBe("new");
  });
  test("needs_staff before the table exists: 503 and nothing changes", async () => {
    const db = fakeDb(seed(), { missing: ["fleet_review_decisions"] });
    const r = await call(db, { lead_id: A, decision: "needs_staff", reason: "Rating dipped last month" });
    expect(r.status).toBe(503);
    expect(r.audits).toHaveLength(0);
  });
});

describe("ready-for-review sweep", () => {
  test("queues once per ready applicant; skips partial and not-ready", async () => {
    const s = seed();
    s.documents = s.documents.filter((d) => !(d.driver_id === C && d.category === "license_front"));
    const db = fakeDb(s);
    const ids = await srv.sweepReadyForReview(db, { now: NOW });
    expect(ids).toHaveLength(1);
    expect(db.state.fleet_webhook_deliveries[0]).toMatchObject({ event_type: "application_ready_for_review", dedupe_key: `application_ready_for_review:${A}`, application_id: A });
    expect(db.state.fleet_webhook_deliveries[0].payload).toMatchObject({ lead_id: A, phone: "+18135550100" });
    expect(await srv.sweepReadyForReview(db, { now: NOW })).toHaveLength(0);
  });
});

describe("wiring", () => {
  test("routes POST-only; webhook event typed; cron sweeps; staff approve uses the shared core", () => {
    for (const r of ["applicants", "applicant-decision"]) {
      const src = readFileSync(`src/routes/api/public/fleet/${r}.ts`, "utf8");
      expect(src).toContain(`createFileRoute("/api/public/fleet/${r}")`);
      expect(src).not.toMatch(/GET:/);
      expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain(`/api/public/fleet/${r}`);
    }
    expect(readFileSync("src/lib/fleet-webhook.server.ts", "utf8")).toContain('"application_ready_for_review"');
    expect(readFileSync("src/routes/api/public/cron/fleet-webhooks.ts", "utf8")).toContain("sweepReadyForReview");
    const apps = readFileSync("src/lib/applications.functions.ts", "utf8");
    const handler = apps.slice(apps.indexOf("export const approveApplication"), apps.indexOf("export type ApproveApplicationResult"));
    expect(handler).toContain("approveApplicationCore(");
    const srvSrc = readFileSync("src/lib/fleet-review.server.ts", "utf8");
    expect(srvSrc).toContain("approveApplicationCore");
    expect(srvSrc).not.toMatch(/insurance_verified\s*:/);
    expect(srvSrc).not.toMatch(/update\(\{[^}]*(insurance|background_check|mvr_status|screening)/);
  });
});

describe("proposed migration (PGlite)", () => {
  const SQL = readFileSync("proposed/fleet-applicant-review-v1.sql", "utf8");
  test("table, one open flag per applicant, reason check, constraint has every event; re-runnable", async () => {
    const pg = new PGlite();
    await pg.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
      CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'SELECT true';
      CREATE TABLE public.applications (id uuid primary key default gen_random_uuid());
      CREATE TABLE public.fleet_webhook_deliveries (id uuid primary key default gen_random_uuid(), event_type text, dedupe_key text unique,
        CONSTRAINT fleet_webhook_deliveries_event_type_check CHECK (event_type IN ('lead_created')));
    `);
    await pg.exec(SQL);
    const app = (await pg.query<any>(`INSERT INTO applications DEFAULT VALUES RETURNING id`)).rows[0].id;
    const ins = (d: string, reason = "Needs a human look") => pg.query(`INSERT INTO fleet_review_decisions (application_id, decision, reason) VALUES ($1, $2, $3)`, [app, d, reason]);
    await ins("needs_staff");
    await expect(ins("needs_staff")).rejects.toThrow();
    await pg.query(`UPDATE fleet_review_decisions SET resolved_at = now()`);
    await ins("needs_staff");
    await ins("approved");
    await expect(ins("declined")).rejects.toThrow();
    await expect(ins("approved", "x")).rejects.toThrow();
    for (const e of ["lead_created", "stage_changed", "quo_message_received", "quo_call", "quo_voicemail", "quo_transcript", "agreement_signed_by_renter", "application_ready_for_review"])
      await pg.query(`INSERT INTO fleet_webhook_deliveries (event_type, dedupe_key) VALUES ($1, $2)`, [e, `k:${e}`]);
    await expect(pg.query(`INSERT INTO fleet_webhook_deliveries (event_type, dedupe_key) VALUES ('nope', 'k:nope')`)).rejects.toThrow();
    await pg.exec(SQL);
    expect(SQL).toMatch(/PROPOSED, NOT APPLIED/);
  });
});
