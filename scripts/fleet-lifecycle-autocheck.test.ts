// FLEET lifecycle check-offs: the rail is derived from real records, FLEET's
// actions leave a "by FLEET" audit trail, and FLEET can never record
// insurance, inspection, pickup, Active, screening or documents.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
globalThis.fetch = (async (url: any) => { throw new Error(`network refused in test: ${url}`); }) as any;
const life = await import("@/lib/driver-lifecycle");
const fl = await import("@/lib/fleet-lifecycle.server");
const agr = await import("@/lib/fleet-agreement.server");

type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>) {
  const state: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  let n = 1;
  function from(table: string) {
    state[table] ??= [];
    let op = "select"; let payload: any = null; let single = false; let returning = false;
    const f: ((r: Row) => boolean)[] = [];
    const q: any = {
      select: () => { if (op !== "select") returning = true; return q; },
      insert: (r: Row) => { op = "insert"; payload = r; return q; }, update: (r: Row) => { op = "update"; payload = r; return q; },
      eq: (c: string, v: any) => { f.push((r) => r[c] === v); return q; },
      is: (c: string, v: any) => { f.push((r) => (r[c] ?? null) === v); return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    function run() {
      const rows = state[table];
      if (op === "insert") { const r = { id: `${table}-${n++}`, ...payload }; rows.push(r); return { data: { id: r.id }, error: null }; }
      const hit = rows.filter((r) => f.every((x) => x(r)));
      if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null }; }
      return { data: single ? hit[0] ?? null : hit, error: null };
    }
    return q;
  }
  return { from, state };
}

const A = "11111111-1111-4111-8111-111111111111";
const V = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-11-16T20:10:00Z");
const base = { contacted: false, screening: false, approved: false, inspection: false, agreement: false, rentalActive: false };
const stateOf = (l: ReturnType<typeof life.driverLifecycle>, key: string) => l.stages.find((s) => s.key === key)?.state;

describe("rail: derived, never a fake checkmark", () => {
  test("FLEET-approved applicant with no income file or quote moves on to Agreement; the gaps stay open, unchecked", () => {
    const l = life.driverLifecycle({ ...base, contacted: true, approved: true });
    expect(l.current.key).toBe("agreement");
    expect(stateOf(l, "documents")).toBe("open");
    expect(stateOf(l, "screening")).toBe("open");
    expect(l.open.map((s) => s.key)).toEqual(["documents", "screening"]);
    // Open never counts: applied, contacted, approved = 3 of 11.
    expect(l.percent).toBe(27);
  });
  test("gating stages always stay current: no reservation means Reserved even after inspection", () => {
    const l = life.driverLifecycle({ ...base, contacted: true, documentsReceived: true, screening: true, approved: true, agreement: true, inspection: true });
    expect(l.current.key).toBe("reserved");
    expect(stateOf(l, "reserved")).toBe("current");
  });
  test("insurance is never done from a rental; it shows open, not checked", () => {
    const l = life.driverLifecycle({ ...base, contacted: true, documentsReceived: true, screening: true, approved: true, agreement: true, inspection: true, rentalActive: true });
    expect(stateOf(l, "insurance")).toBe("open");
    expect(stateOf(l, "active")).toBe("done");
  });
  test("a brand-new applicant with files but no contact stays on Contacted", () => {
    const l = life.driverLifecycle({ ...base });
    expect(l.current.key).toBe("contacted");
    expect(l.open).toEqual([]);
  });
});

describe("Contacted from real records", () => {
  test("no screening row, no contact status, only the resume email: NOT contacted (the old rail checked it)", () => {
    const c = life.firstContact({ contactedAt: null, contactStatus: "new", screeningStatus: null, activity: [{ activity_type: "email", direction: "outbound", status: "delivered", occurred_at: "2026-11-16T00:50:39Z" }] });
    expect(c.contacted).toBe(false);
  });
  test("a delivered text (FLEET, staff or the missing-items message) or a call counts; a skipped text does not", () => {
    expect(life.firstContact({ activity: [{ activity_type: "text", direction: "outbound", status: "skipped", occurred_at: "2026-11-16T14:00:00Z" }] }).contacted).toBe(false);
    const c = life.firstContact({ activity: [
      { activity_type: "text", direction: "outbound", status: "sent", occurred_at: "2026-11-16T14:05:00Z" },
      { activity_type: "text", direction: "inbound", status: null, occurred_at: "2026-11-16T14:30:00Z" },
    ] });
    expect(c).toEqual({ contacted: true, at: "2026-11-16T14:05:00Z", via: "text_or_call" });
  });
  test("staff Contact Status (call, voicemail, follow-up) and a screening row past New Lead count", () => {
    expect(life.firstContact({ contactStatus: "voicemail", contactStatusAt: "2026-11-10T15:00:00Z" })).toMatchObject({ contacted: true, via: "contact_status" });
    expect(life.firstContact({ screeningStatus: "new_lead" }).contacted).toBe(false);
    expect(life.firstContact({ screeningStatus: "docs_pending" }).contacted).toBe(true);
    expect(life.firstContact({ contactedAt: "2026-11-09T12:00:00Z", activity: [{ activity_type: "call", direction: "outbound", status: "completed", occurred_at: "2026-11-08T12:00:00Z" }] }).at).toBe("2026-11-08T12:00:00Z");
  });
});

describe("time in stage", () => {
  test("starts at the latest completion before the current stage, not the application date", () => {
    const l = life.driverLifecycle({ ...base, contacted: true });
    expect(life.stageStartedAt(l.stages, l.current.key, { applied: "2026-11-16T00:45:00Z", contacted: "2026-11-16T14:05:00Z" })).toBe("2026-11-16T14:05:00.000Z");
    const fresh = life.driverLifecycle({ ...base });
    expect(life.stageStartedAt(fresh.stages, fresh.current.key, { applied: "2026-11-16T00:45:00Z" })).toBe("2026-11-16T00:45:00.000Z");
  });
});

describe("FLEET audit trail", () => {
  test("entries say FLEET; insurance, inspection, pickup, Active, screening and documents are refused", async () => {
    const e = fl.lifecycleStepEntry({ applicationId: A, step: "approved", evidence: "Clean packet", source: "applicant-decision", at: NOW });
    expect(e).toMatchObject({ action: "application.lifecycle_step", entityType: "application", entityId: A, metadata: { step: "approved", by: "FLEET (automated)" } });
    expect(e.summary).toContain("checked off by FLEET (automated)");
    for (const step of ["insurance", "inspection", "pickup", "active", "screening", "documents"]) {
      expect(() => fl.lifecycleStepEntry({ applicationId: A, step: step as any, evidence: "x", source: "t", at: NOW })).toThrow();
      const audits: any[] = [];
      await fl.recordFleetLifecycleStep(async (x) => { audits.push(x); }, { applicationId: A, step: step as any, evidence: "x", source: "t", at: NOW });
      expect(audits).toHaveLength(0);
    }
  });
  test("contacted_at is filled only when blank; a staff date is never moved", async () => {
    const db = fakeDb({ applications: [{ id: A, contacted_at: null }] });
    const audits: any[] = [];
    expect(await fl.stampContactedByFleet(db, async (x) => { audits.push(x); }, { applicationId: A, evidence: "YES", source: "t", at: NOW })).toBe(true);
    expect(db.state.applications[0].contacted_at).toBe(NOW.toISOString());
    expect(audits[0].metadata).toMatchObject({ step: "contacted", by: "FLEET (automated)" });
    const staff = fakeDb({ applications: [{ id: A, contacted_at: "2026-11-01T10:00:00Z" }] });
    const none: any[] = [];
    expect(await fl.stampContactedByFleet(staff, async (x) => { none.push(x); }, { applicationId: A, evidence: "YES", source: "t", at: NOW })).toBe(false);
    expect(staff.state.applications[0].contacted_at).toBe("2026-11-01T10:00:00Z");
    expect(none).toHaveLength(0);
  });
  test("marks reader keeps only FLEET rows for recordable steps", async () => {
    const db = fakeDb({ audit_log: [
      { entity_type: "application", entity_id: A, action: "application.lifecycle_step", created_at: "2026-11-16T15:00:00Z", summary: "Approved checked off by FLEET (automated): ok", metadata: { step: "approved", by: "FLEET (automated)" } },
      { entity_type: "application", entity_id: A, action: "application.lifecycle_step", created_at: "2026-11-16T15:01:00Z", summary: "forged", metadata: { step: "insurance", by: "FLEET (automated)" } },
      { entity_type: "application", entity_id: A, action: "application.lifecycle_step", created_at: "2026-11-16T15:02:00Z", summary: "staff", metadata: { step: "reserved", by: "someone" } },
    ] });
    (db as any).from = ((orig) => (t: string) => { const q = orig(t); q.order = () => q; q.limit = () => q; return q; })(db.from);
    const marks = await fl.readFleetLifecycleMarks(db, A);
    expect(marks.map((m) => m.step)).toEqual(["approved"]);
  });
  test("send-agreement after a confirmed call: contacted filled, Agreement Sent recorded by FLEET", async () => {
    const db = fakeDb({ applications: [{ id: A, status: "approved", full_name: "Test Renter", email: "t@example.com", deleted_at: null, contacted_at: null }], agreement_terms_confirmations: [] });
    const audits: any[] = [];
    const res = await agr.handleFleetSendAgreement(new Request("https://drivereal.com/api/public/fleet/send-agreement", {
      method: "POST", headers: { Authorization: `Bearer ${"k".repeat(40)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: A, terms_confirmation: { confirmed_at: "2026-11-16T15:04:00-05:00", channel: "call", call_id: "ACcall1", summary: "Confirmed $325/week, no deposit, pickup Wed.", weekly_rate: 325, deposit: 0, start_date: "2026-11-18", vehicle_id: V } }),
    }), {
      admin: db, env: { FLEET_API_KEY: "k".repeat(40) }, now: () => NOW, audit: async (e) => { audits.push(e); },
      check: async () => ({ blockers: [], weeklyRate: 325, deposit: 0, startDate: "2026-11-18", vehicleId: V, vehicleLabel: "2021 Toyota Camry" }) as any,
      hasOpenOrSigned: async () => false,
      issue: async () => ({ id: "agr-1", url: "https://drivereal.com/sign/SECRET", delivery: { email: "sent", sms: "sent", delivered: true } }) as any,
    });
    expect(res.status).toBe(201);
    expect(audits.map((a) => a.action)).toEqual(["agreement.fleet_sent", "application.lifecycle_step", "application.lifecycle_step"]);
    expect(audits.slice(1).map((a) => a.metadata.step)).toEqual(["contacted", "agreement"]);
    expect(db.state.applications[0].contacted_at).toBe(NOW.toISOString());
    // Sent is not signed: the rail's Agreement stage still needs the signature.
    expect(db.state.applications[0].status).toBe("approved");
  });
});

describe("wiring", () => {
  test("approve and pickup booking record their step; the profile reads FLEET marks and real contact records", () => {
    const review = readFileSync("src/lib/fleet-review.server.ts", "utf8");
    expect(review).toContain('step: "approved"');
    const pickup = readFileSync("src/lib/fleet-pickup.server.ts", "utf8");
    expect(pickup).toContain('step: "reserved"');
    const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    expect(panel).toContain("firstContact(");
    expect(panel).toContain("getFleetLifecycleMarks");
    expect(panel).not.toContain('scrStatus !== "new_lead"');
    // No renter phone numbers anywhere in the new code.
    for (const f of ["src/lib/fleet-lifecycle.server.ts", "src/lib/driver-lifecycle.ts", "src/lib/fleet-lifecycle.functions.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/\+1\d{10}|\(\d{3}\) ?\d{3}-\d{4}/);
    }
  });
});

describe("Dolmar's decisions (t306s1653)", () => {
  const doc = (category: string, x: Row = {}) => ({ id: `${category}-1`, category, is_current: true, review_status: "uploaded", storage_path: `p/${category}`, ...x });
  test("1. a trip-history / gig earnings screenshot counts as income proof everywhere it is counted", async () => {
    const { missingRequiredCategories, activationRequirements } = await import("@/lib/activation-readiness");
    const { documentCollection } = await import("@/lib/checklist-evidence");
    const { docPicture } = await import("@/lib/fleet-review");
    const { canonicalRequiredDoc } = await import("@/lib/required-docs");
    const docs = [doc("license_front"), doc("gig_profile"), doc("trip_history")];
    expect(missingRequiredCategories(docs)).toEqual([]);
    expect(missingRequiredCategories([doc("license_front"), doc("gig_profile")])).toEqual(["income"]);
    // A rejected screenshot does not count.
    expect(missingRequiredCategories([doc("license_front"), doc("gig_profile"), doc("trip_history", { review_status: "rejected" })])).toEqual(["income"]);
    expect(documentCollection({ applicationId: A, events: [], documents: docs.map((d) => ({ ...d, applicationId: A })) }).collected).toBe(true);
    expect(docPicture(docs).missing_advisory).toEqual([]);
    expect(canonicalRequiredDoc({ category: "trip_history", is_current: true })).toBe("income");
    const reqs = activationRequirements({ documents: docs, agreements: [], insurance: { status: "unverified" }, status: "approved", hasPassedInspection: false } as any);
    expect(reqs.find((r) => r.key === "income")?.met).toBe(true);
    // Receipt only: no verification, insurance or license change.
    expect(reqs.find((r) => r.key === "insurance_verified")?.met).toBe(false);
  });
  test("2. once approved, the header offers Send Agreement / Activate instead of Record Interview", async () => {
    const { primaryStep } = await import("@/lib/activation-readiness");
    const { nextStep } = await import("@/lib/next-step");
    expect(primaryStep({ screeningDone: false, docsComplete: false, insuranceOk: false, approved: true, rentalActive: false, isManager: true })).toBe("activate");
    expect(primaryStep({ screeningDone: false, docsComplete: true, insuranceOk: false, approved: false, rentalActive: false, isManager: true })).toBe("interview");
    const n = nextStep({ step: "activate", entry: "enabled" as any, loading: false, failed: false, readiness: { requirements: [
      { key: "interview", label: "Interview Complete", met: false, enforcement: "soft" },
      { key: "signed_agreement", label: "Rental Agreement Signed", met: false, enforcement: "hard" },
    ] } as any });
    expect(n.label).toBe("Send Agreement");
    expect(n.blockers.map((b) => b.key)).not.toContain("local");
  });
  test("3. approval never fills contacted_at (staff or FLEET)", () => {
    const src = readFileSync("src/lib/applications.functions.ts", "utf8");
    const legacy = src.slice(src.indexOf('const patch: Record<string, unknown> = { status: "approved" };'), src.indexOf('const patch: Record<string, unknown> = { status: "approved" };') + 300);
    expect(legacy).not.toContain("contacted_at");
  });
  test("4. the rail has no Documents Received checkbox; the Next Step checklist keeps the check-offs", () => {
    const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    expect(panel).not.toContain("stageCheckoffs=");
    expect(panel).not.toContain('label: "Documents Received"');
    expect(panel).toContain('documents: () => openSection("documents", "profile-documents")');
    expect(panel).toContain("void toggleEvidence(presentation.fields)");
  });
});
