// FLEET applicant review for applicants not driving for a gig app yet
// (Dolmar, t339u), the review-list skip it caused, and the RentID switch.
// Network refused; fake database. All names and numbers are fictional.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const rules = await import("@/lib/fleet-review");
const srv = await import("@/lib/fleet-review.server");
const rentid = await import("@/lib/fleet-rentid.server");

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


const D = "44444444-4444-4444-8444-444444444444";
const notYet = (id: string, extra: Row = {}) => goodApp(id, { gig_status: "Not yet, ready to start", rating: null, trips_completed: null, ...extra });
const base = { screening: null, disqualifiers: [], readinessState: "promising_more_info", openNeedsStaff: null, priorDeclined: 0, now: NOW };
const codesOf = (xs: { code: string }[]) => xs.map((x) => x.code);
const RENTID_ON = { key: "fleet_rentid", value: { record_results: true, require_for_approval: true } };

describe("not driving for a gig app yet: documents and the review list", () => {
  test("the skip: license only, no gig profile. Before, gig_profile was required for everyone", () => {
    // James Spence / Jonathan Simmons shape: license front only, Not yet.
    const a = rules.assessForFleet({ ...base, app: notYet(A), docs: docsFor(A, ["license_front"]) });
    expect(codesOf(a.hard_blockers)).not.toContain("missing_gig_profile");
    expect(codesOf(a.hard_blockers)).toEqual(["missing_income"]);
    expect(a.required_documents).toEqual(["license_front", "income"]);
    expect(a.no_track_record).toBe(true);
    // Gig drivers keep the gig profile rule.
    const gig = rules.assessForFleet({ ...base, app: goodApp(A), docs: docsFor(A, ["license_front"]) });
    expect(codesOf(gig.hard_blockers)).toContain("missing_gig_profile");
    expect(gig.required_documents).toEqual(["license_front", "gig_profile"]);
  });
  test("license + income proof (or a trip/earnings screenshot) is ready; gig profile never asked", () => {
    for (const cats of [["license_front", "income"], ["license_front", "trip_history"]]) {
      const a = rules.assessForFleet({ ...base, app: notYet(A), docs: docsFor(A, cats) });
      expect(a.hard_blockers).toEqual([]);
      expect(a.ready_for_review).toBe(true);
      expect(a.docs.missing_advisory).toEqual([]);
      expect(codesOf(a.notes)).not.toContain("requested_gig_profile");
      expect(rules.readyForReview(notYet(A), docsFor(A, cats))).toBe(true);
    }
    expect(rules.readyForReview(notYet(A), docsFor(A, ["license_front"]))).toBe(false);
  });
  test("which answers count as not driving: Not yet, No, Pending; blank and Yes do not", () => {
    expect(rules.notDrivingGigYet({ gig_status: "Not yet, ready to start" })).toBe(true);
    expect(rules.notDrivingGigYet({ gig_status: "No" })).toBe(true);
    expect(rules.notDrivingGigYet({ gig_status: "Pending" })).toBe(true);
    expect(rules.notDrivingGigYet({ gig_status: "Yes, already driving" })).toBe(false);
    expect(rules.notDrivingGigYet({ gig_status: "" })).toBe(false);
    expect(rules.notDrivingGigYet({ gig_status: null })).toBe(false);
    expect(rules.notDrivingGigYet({})).toBe(false);
  });
  test("list shows a not-yet applicant with license + income; ready_only=false shows the one still owed income", async () => {
    const db = fakeDb({
      applications: [notYet(A), notYet(B), goodApp(C, { gig_status: "Yes, already driving" })],
      documents: [...docsFor(A, ["license_front", "income"]), ...docsFor(B, ["license_front"]), ...docsFor(C, ["license_front"])],
      driver_screenings: [], agreements: [], fleet_review_decisions: [], fleet_webhook_deliveries: [],
    });
    const j = await (await srv.handleFleetApplicants(req("applicants", { action: "list" }), { admin: db, env: ENV, now: () => NOW })).json();
    expect(j.rows.map((r: any) => r.lead_id)).toEqual([A]);
    expect(j.rows[0]).toMatchObject({ recommendation: "approve", no_track_record: true, escalations: [] });
    const all = await (await srv.handleFleetApplicants(req("applicants", { action: "list", ready_only: false }), { admin: db, env: ENV, now: () => NOW })).json();
    const b = all.rows.find((r: any) => r.lead_id === B);
    expect(b).toMatchObject({ ready_for_review: false, docs_missing: ["income"], no_track_record: true });
    expect(all.rows.find((r: any) => r.lead_id === C).docs_missing).toEqual(["gig_profile"]);
  });
  test("sweep: queues the not-yet applicant once income lands, not before (reads gig_status)", async () => {
    const db = fakeDb({
      applications: [notYet(A), notYet(B)],
      documents: [...docsFor(A, ["license_front", "income"]), ...docsFor(B, ["license_front"])],
      fleet_webhook_deliveries: [],
    });
    const ids = await srv.sweepReadyForReview(db, { now: NOW });
    expect(ids).toHaveLength(1);
    expect(db.state.fleet_webhook_deliveries[0].application_id).toBe(A);
  });
});

describe("not driving yet: rule change (no automatic needs_staff by itself)", () => {
  const clean = () => rules.assessForFleet({ ...base, app: notYet(A), docs: docsFor(A, ["license_front", "income"]) });
  test("clean file: no not_driving_yet escalation, no trip/rating minimums, recommendation approve", () => {
    const a = clean();
    expect(codesOf(a.escalations)).toEqual([]);
    expect(codesOf(a.escalations)).not.toContain("not_driving_yet");
    expect(codesOf(a.notes)).toContain("no_track_record");
    expect(codesOf(a.notes)).not.toEqual(expect.arrayContaining(["no_trips"]));
    expect(codesOf(a.notes)).not.toContain("no_rating");
    expect(a.recommendation).toBe("approve");
    const zero = rules.assessForFleet({ ...base, app: notYet(A, { trips_completed: 0, rating: 0 }), docs: docsFor(A, ["license_front", "income"]) });
    expect(codesOf(zero.escalations)).not.toContain("few_trips");
    expect(zero.recommendation).toBe("approve");
  });
  test("each unclean fact still escalates: no DOB, expiry unknown or within 30 days, flags, prior decline, open check, low reported rating", () => {
    const cases: [Row, number, string][] = [
      [{ dob: null }, 0, "no_dob"],
      [{ license_expiration: null }, 0, "no_license_expiry"],
      [{ license_expiration: "2026-12-10" }, 0, "license_expiring"],
      [{ ai_flags: ["name mismatch"] }, 0, "ai_flags"],
      [{}, 1, "prior_declined"],
      [{ background_check_status: "in_progress" }, 0, "background_check_status_open"],
      [{ rating: 3.2 }, 0, "low_rating"],
    ];
    for (const [extra, prior, code] of cases) {
      const a = rules.assessForFleet({ ...base, priorDeclined: prior, app: notYet(A, extra), docs: docsFor(A, ["license_front", "income"]) });
      expect(codesOf(a.escalations)).toContain(code);
      expect(a.recommendation).toBe("needs_staff");
    }
    // A license expiring in 31+ days is clean.
    const ok31 = rules.assessForFleet({ ...base, app: notYet(A, { license_expiration: "2026-12-17" }), docs: docsFor(A, ["license_front", "income"]) });
    expect(codesOf(ok31.escalations)).toEqual([]);
  });
  test("income exception age is 23+ (Dolmar, Nov 21 2026; was 25+): 23 and 24 are clean, under 23 is a hard blocker", () => {
    // NOW is 2026-11-16. 2003-11-16 turns 23 today; 2002-06-01 is 24.
    for (const dob of ["2003-11-16", "2002-06-01"]) {
      const a = rules.assessForFleet({ ...base, app: notYet(A, { dob }), docs: docsFor(A, ["license_front", "income"]) });
      expect(a.hard_blockers).toEqual([]);
      expect(codesOf(a.escalations)).toEqual([]);
      expect(a.recommendation).toBe("approve");
    }
    const young = rules.assessForFleet({ ...base, app: notYet(A, { dob: "2003-11-17" }), docs: docsFor(A, ["license_front", "income"]) });
    expect(codesOf(young.hard_blockers)).toContain("under_min_age");
    expect(young.recommendation).not.toBe("approve");
    const note = rules.assessForFleet({ ...base, app: notYet(A), docs: docsFor(A, ["license_front", "income"]) }).notes.find((n) => n.code === "no_track_record");
    expect(note?.message).toContain("date of birth on file and 23+");
    expect(note?.message).not.toContain("25+");
  });
  test("background/MVR passed is clean; failed is a hard blocker sent to staff", () => {
    const passed = rules.assessForFleet({ ...base, app: notYet(A, { background_check_status: "passed", mvr_status: "passed" }), docs: docsFor(A, ["license_front", "income"]) });
    expect(passed.recommendation).toBe("approve");
    const failed = rules.assessForFleet({ ...base, app: notYet(A, { background_check_status: "failed" }), docs: docsFor(A, ["license_front", "income"]) });
    expect(failed.screening_flagged).toBe(true);
    expect(failed.recommendation).toBe("needs_staff");
  });
  test("gig drivers are unchanged: trip and rating minimums still escalate", () => {
    const a = rules.assessForFleet({ ...base, app: goodApp(A, { trips_completed: 20 }), docs: docsFor(A) });
    expect(codesOf(a.escalations)).toContain("few_trips");
    expect(a.no_track_record).toBe(false);
  });
});

describe("decision endpoint: strict approve for no track record", () => {
  const call = async (db: any, body: unknown, approve: any) => {
    const res = await srv.handleFleetApplicantDecision(req("applicant-decision", body), { admin: db, env: ENV, now: () => NOW, audit: async () => {}, approve });
    return { status: res.status, body: await res.json() };
  };
  const mk = (apps: Row[], docs: Row[], extra: Record<string, Row[]> = {}) => fakeDb({ applications: apps, documents: docs, driver_screenings: [], agreements: [], fleet_review_decisions: [], fleet_webhook_deliveries: [], ...extra });
  test("clean not-yet applicant: FLEET approve goes through the staff core", async () => {
    const seen: any[] = [];
    const approve = async (a: any) => { seen.push(a); return { ok: true, agreementSent: false, portalAccount: "deferred" as const, approvalEmail: "sent" as const }; };
    const db = mk([notYet(A)], docsFor(A, ["license_front", "income"]));
    const r = await call(db, { lead_id: A, decision: "approve", reason: "Clean file, income on file" }, approve);
    expect(r.status).toBe(201);
    expect(seen).toHaveLength(1);
  });
  test("not-yet applicant with any escalation: approve refused (409), nothing approved", async () => {
    const seen: any[] = [];
    const approve = async (a: any) => { seen.push(a); return { ok: true } as any; };
    const db = mk([notYet(A, { dob: null })], docsFor(A, ["license_front", "income"]));
    const r = await call(db, { lead_id: A, decision: "approve", reason: "FLEET thinks it is fine" }, approve);
    expect(r.status).toBe(409);
    expect(codesOf(r.body.escalations)).toContain("no_dob");
    expect(seen).toHaveLength(0);
    expect(db.state.applications[0].status).toBe("new");
  });
  test("not-yet applicant without income proof: approve refused as a hard blocker", async () => {
    const db = mk([notYet(A)], docsFor(A, ["license_front"]));
    const r = await call(db, { lead_id: A, decision: "approve", reason: "FLEET thinks it is fine" }, async () => ({ ok: true }));
    expect(r.status).toBe(409);
    expect(codesOf(r.body.hard_blockers)).toEqual(["missing_income"]);
  });
  test("prior declined application blocks a not-yet approve (packet counts it)", async () => {
    const db = mk([notYet(A), notYet(D, { status: "declined", email: notYet(A).email })], docsFor(A, ["license_front", "income"]));
    const r = await call(db, { lead_id: A, decision: "approve", reason: "FLEET thinks it is fine" }, async () => ({ ok: true }));
    expect(r.status).toBe(409);
    expect(codesOf(r.body.escalations)).toContain("prior_declined");
  });
  test("gig drivers keep FLEET's discretion: an escalation does not refuse approve", async () => {
    const seen: any[] = [];
    const approve = async (a: any) => { seen.push(a); return { ok: true, agreementSent: false, portalAccount: "deferred" as const, approvalEmail: "sent" as const }; };
    const db = mk([goodApp(A, { dob: "2003-01-01" })], docsFor(A));
    const r = await call(db, { lead_id: A, decision: "approve", reason: "Young but strong record" }, approve);
    expect(r.status).toBe(201);
  });
});

describe("RentID switch (off by default)", () => {
  const callRes = async (db: any, body: unknown) => {
    const audits: any[] = [];
    const res = await rentid.handleFleetScreeningResult(req("screening-result", body), { admin: db, env: ENV, now: () => NOW, audit: async (e) => { audits.push(e); } });
    return { status: res.status, body: await res.json(), audits };
  };
  const good = { lead_id: A, provider: "rentid", order_id: "INV-2FFV7P9C", license_status: "active", criminal_record: "not_detected", checked_at: "2026-11-16T14:00:00Z" };
  test("off: missing setting means no writes and no approval requirement", async () => {
    const db = fakeDb({ applications: [notYet(A)], documents: docsFor(A, ["license_front", "income"]), app_settings: [] });
    expect(await rentid.readRentidSettings(db)).toEqual({ record_results: false, require_for_approval: false });
    const r = await callRes(db, good);
    expect(r.status).toBe(403);
    expect(db.state.applications[0].background_check_status).toBe("pending");
    const p = await srv.buildReviewPacket(db, A, { now: NOW });
    expect(codesOf(p!.assessment.hard_blockers)).toEqual([]);
    // Only literal true switches it on.
    const weird = fakeDb({ app_settings: [{ key: "fleet_rentid", value: { record_results: "true", require_for_approval: 1 } }] });
    expect(await rentid.readRentidSettings(weird)).toEqual({ record_results: false, require_for_approval: false });
  });
  test("on: approve needs both checks passed; pending keeps the applicant in FLEET's list but not_ready", async () => {
    const db = fakeDb({ applications: [notYet(A)], documents: docsFor(A, ["license_front", "income"]), driver_screenings: [], fleet_review_decisions: [], app_settings: [RENTID_ON] });
    const list = await (await srv.handleFleetApplicants(req("applicants", { action: "list" }), { admin: db, env: ENV, now: () => NOW })).json();
    expect(list.rows.map((r: any) => r.lead_id)).toEqual([A]);
    expect(list.rows[0].recommendation).toBe("not_ready");
    expect(list.rows[0].hard_blockers).toEqual(["rentid_background_check_status_required", "rentid_mvr_status_required"]);
    const refused = await srv.handleFleetApplicantDecision(req("applicant-decision", { lead_id: A, decision: "approve", reason: "Clean file here" }), { admin: db, env: ENV, now: () => NOW, audit: async () => {}, approve: async () => ({ ok: true }) as any });
    expect(refused.status).toBe(409);
    const w = await callRes(db, good);
    expect(w.status).toBe(201);
    expect(db.state.applications[0]).toMatchObject({ background_check_status: "passed", mvr_status: "passed" });
    expect(w.audits[0]).toMatchObject({ action: "application.rentid_result_recorded", metadata: { order_id: "INV-2FFV7P9C", provider: "rentid" } });
    const p = await srv.buildReviewPacket(db, A, { now: NOW });
    expect(p!.assessment.hard_blockers).toEqual([]);
    expect(p!.assessment.recommendation).toBe("approve");
  });
  test("on: criminal record detected or license suspended -> failed, staff decide; failed never overwritten with passed", async () => {
    const db = fakeDb({ applications: [notYet(A)], documents: docsFor(A, ["license_front", "income"]), driver_screenings: [], fleet_review_decisions: [], app_settings: [RENTID_ON] });
    const r = await callRes(db, { ...good, license_status: "Suspended", criminal_record: "detected" });
    expect(r.status).toBe(201);
    expect(db.state.applications[0]).toMatchObject({ background_check_status: "failed", mvr_status: "failed" });
    expect(r.body.next).toContain("needs_staff");
    const p = await srv.buildReviewPacket(db, A, { now: NOW });
    expect(p!.assessment.screening_flagged).toBe(true);
    expect(p!.assessment.recommendation).toBe("needs_staff");
    const back = await callRes(db, { ...good, order_id: "INV-AAAAAAAA" });
    expect(back.body.kept).toHaveLength(2);
    expect(db.state.applications[0]).toMatchObject({ background_check_status: "failed", mvr_status: "failed" });
  });
  test("on: provisional / unavailable writes nothing; bad input refused", async () => {
    const db = fakeDb({ applications: [notYet(A)], app_settings: [RENTID_ON] });
    const r = await callRes(db, { ...good, license_status: "provisional", criminal_record: "unavailable" });
    expect(r.status).toBe(201);
    expect(r.body.applied).toEqual({});
    expect(db.state.applications[0]).toMatchObject({ background_check_status: "pending", mvr_status: "pending" });
    for (const bad of [{ ...good, order_id: "12345" }, { ...good, provider: "other" }, { ...good, license_status: "great" }, { ...good, lead_id: "x" }, { lead_id: A, provider: "rentid", order_id: "INV-2FFV7P9C" }, { ...good, checked_at: "2027-01-01T00:00:00Z" }]) {
      expect((await callRes(db, bad)).status).toBe(400);
    }
    expect((await callRes(db, { ...good, lead_id: D })).status).toBe(404);
  });
  test("mapping table", () => {
    expect(rentid.mapLicenseStatus("Active")).toBe("passed");
    expect(rentid.mapLicenseStatus("revoked")).toBe("failed");
    expect(rentid.mapLicenseStatus("provisional")).toBeNull();
    expect(rentid.mapLicenseStatus("nope")).toBeUndefined();
    expect(rentid.mapCriminalRecord("Not detected")).toBe("passed");
    expect(rentid.mapCriminalRecord("detected")).toBe("failed");
  });
  test("wiring: route POST-only, no RentID secret in code, auth required", async () => {
    const route = readFileSync("src/routes/api/public/fleet/screening-result.ts", "utf8");
    expect(route).toContain("POST:");
    expect(route).not.toContain("GET:");
    const mod = readFileSync("src/lib/fleet-rentid.server.ts", "utf8");
    expect(mod).not.toMatch(/process\.env|api[_-]?key\s*[:=]/i);
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).toContain("/api/public/fleet/screening-result");
    const db = fakeDb({ applications: [notYet(A)], app_settings: [RENTID_ON] });
    expect((await rentid.handleFleetScreeningResult(req("screening-result", good, null), { admin: db, env: ENV })).status).toBe(401);
  });
});
