// Driver activation readiness (PR 2, revised).
//
// Runs the real getActivationReadiness / activateRental handlers from
// src/lib/rentals.functions.ts, the real setDocumentReview from
// src/lib/documents.functions.ts and the real Owner setting functions from
// src/lib/rental-activation-settings.functions.ts, bundled with esbuild,
// against an in-memory fake of the Supabase clients. Nothing here reaches a
// network: the Supabase clients, email, SMS, audit and account provisioning
// are stubbed, and the real requireManager / requireOwner (roles.server.ts)
// run against the fake user_roles table, so the role refusals are the
// production checks. The SQL side (the wrapper, the setter, RLS, locks) is
// proven on a real Postgres by scripts/activation-insurance-setting.db.test.ts.
import { build } from "esbuild";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-activation-"));
let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL", name);
    console.log(e);
  }
}

const STUBS = {
  "@tanstack/react-start": `export const createServerFn = () => { const api = { middleware: () => api, inputValidator: (v) => { api._v = v; return api; }, handler: (fn) => (arg = {}) => fn({ ...arg, data: api._v ? api._v(arg.data) : arg.data }) }; return api; };`,
  "@/integrations/supabase/auth-middleware": `export const requireSupabaseAuth = {};`,
  "@/integrations/supabase/client.server": `export const supabaseAdmin = new Proxy({}, { get: (_t, k) => globalThis.__fake[k] });`,
  "@/lib/audit.server": `export async function logAudit(actor, entry) { globalThis.__audit.push({ actor, entry }); }`,
  "@/lib/driver-account.server": `export async function provisionDriverAccount(_admin, args) { globalThis.__provisioned.push(args); return globalThis.__provision ?? { userId: "99999999-9999-4999-8999-999999999999", created: false, inviteUrl: null, conflict: false }; }`,
  "@/lib/email.server": `export async function sendEmail(m) { globalThis.__sent.push(["email", m.to]); }`,
  "@/lib/sms.server": `export async function sendSms(m) { globalThis.__sent.push(["sms", m.to]); }`,
  "@/lib/renter-lifecycle-notices.server": `export async function enrollRenterLifecycleNotice() {}`,
};
const stubPlugin = {
  name: "stubs",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => (STUBS[args.path] != null ? { path: args.path, namespace: "stub" } : null));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js" }));
  },
};

// ---------------------------------------------------------------- fake db
function fakeDb(tables, rpcs = {}) {
  const calls = { rpc: [], inserts: [], updates: [] };
  function query(table) {
    const filters = [];
    let limitN = null;
    let order = null;
    let patch = null;
    const rows = () => {
      let r = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      if (order) r = [...r].sort((a, b) => (a[order.col] > b[order.col] ? 1 : -1) * (order.asc ? 1 : -1));
      if (limitN != null) r = r.slice(0, limitN);
      return r;
    };
    const run = () => {
      if (patch) {
        const hit = rows();
        for (const row of hit) Object.assign(row, patch);
        calls.updates.push({ table, patch, n: hit.length });
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    };
    const q = {
      select: () => q,
      eq: (c, v) => (filters.push((r) => r[c] === v), q),
      neq: (c, v) => (filters.push((r) => r[c] !== v), q),
      in: (c, vs) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c, v) => (filters.push((r) => (r[c] ?? null) === v), q),
      gte: () => q,
      not: () => q,
      order: (col, o) => ((order = { col, asc: o?.ascending !== false }), q),
      limit: (n) => ((limitN = n), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
      update: (p) => ((patch = p), q),
      insert: (row) => {
        calls.inserts.push({ table, row });
        if (globalThis.__failInsert === table) {
          return { select: () => ({ single: async () => ({ data: null, error: { message: "denied" } }) }), then: (res) => res({ error: { message: "denied" } }) };
        }
        (tables[table] ??= []).push({ ...row });
        return { select: () => ({ single: async () => ({ data: { id: "ins" }, error: null }) }), then: (res) => res({ error: null }) };
      },
    };
    return q;
  }
  return {
    calls,
    tables,
    from: (t) => query(t),
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      const fn = rpcs[name];
      return fn ? fn(args) : { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "staff@example.test" } } }) } },
  };
}

const APP = "11111111-1111-4111-8111-111111111111";
const VEH = "22222222-2222-4222-8222-222222222222";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const COORD = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";
const DRIVER = "99999999-9999-4999-8999-999999999999";
const RENTAL = "77777777-7777-4777-8777-777777777777";
const PAPER = "88888888-8888-4888-8888-888888888888";
const REVIEWED = "2026-10-20T15:00:00.123Z";

let docSeq = 0;
const doc = (category, extra = {}) => ({ id: `d${String(++docSeq).padStart(7, "0")}-0000-4000-8000-000000000000`, driver_id: APP, category, is_current: true, review_status: "uploaded", expires_at: null, reviewed_at: null, storage_bucket: "driver-docs", storage_path: `${APP}/${category}.pdf`, content_sha256: null, label: null, ...extra });
const paperDoc = (extra = {}) => doc("agreement", { id: PAPER, review_status: "verified", reviewed_at: REVIEWED, storage_path: `${APP}/signed-paper.pdf`, ...extra });
const paperAudit = (extra = {}, meta = {}) => ({ action: "document.verified", entity_type: "application", entity_id: APP, actor_role: "team", metadata: { documentId: PAPER, paper_agreement: true, storage_path: `${APP}/signed-paper.pdf`, reviewed_at_ms: Date.parse(REVIEWED), ...meta }, ...extra });
const baseDocs = () => [doc("license_front"), doc("license_back"), doc("insurance"), doc("gig_profile")];
const esign = { application_id: APP, source: "rental", status: "signed", signed_at: "2026-10-02T10:00:00Z", voided_at: null, rental_id: null };

/** A fully ready applicant; each test removes exactly one thing. */
function world(over = {}) {
  return {
    applications: [{ id: APP, full_name: "Dana Driver", email: "dana@example.test", phone: "+15555550100", status: "approved", vehicle_id: VEH, weekly_rent: 325, user_id: DRIVER, insurance_status: "declared", insurance_expires_on: null, sms_consent: true, ...(over.app ?? {}) }],
    documents: over.documents ?? baseDocs(),
    driver_screenings: over.screenings ?? [{ lead_id: APP, interview_completed_at: "2026-10-01T10:00:00Z", insurance_verified: true }],
    agreements: over.agreements ?? [{ ...esign }],
    audit_log: over.audits ?? [],
    app_settings: over.settings ?? [{ key: "rental_activation", value: { allow_activation_without_insurance_verification: false } }],
    rentals: over.rentals ?? [],
    vehicles: [{ id: VEH, year: 2022, make: "Toyota", model: "Camry", status: "available", weekly_rate: 325, deposit: 249, license_plate: "ABC123", registration_expires_on: null, insurance_expires_on: null, current_odometer: 1000 }],
    inspections: over.inspections ?? [{ vehicle_id: VEH, inspection_type: "pre_delivery", status: "passed", completed_at: "2026-10-03T10:00:00Z", odometer: 1000 }],
    user_roles: [
      { user_id: MANAGER, role: "team" },
      { user_id: COORD, role: "coordinator" },
      { user_id: OWNER, role: "admin" },
    ],
    notifications: [],
  };
}

const checkedOk = (args) => ({
  data: { rental_id: RENTAL, insurance_status: globalThis.__txStatus ?? "verified", exception_used: args._insurance_exception_ack === true, setting_present: true, setting_allow: globalThis.__txAllow ?? false, acknowledged: args._insurance_exception_ack === true, audit_id: "a1" },
  error: null,
});

function install(tables, rpcs = {}) {
  globalThis.__fake = fakeDb(tables, {
    vehicle_rental_ready_missing: async () => ({ data: [], error: null }),
    activate_rental_checked_tx: async (args) => checkedOk(args),
    activate_rental_tx: async () => ({ data: RENTAL, error: null }),
    ...rpcs,
  });
  globalThis.__audit = [];
  globalThis.__sent = [];
  globalThis.__provisioned = [];
  globalThis.__provision = undefined;
  globalThis.__failInsert = undefined;
  globalThis.__txStatus = undefined;
  globalThis.__txAllow = undefined;
  return globalThis.__fake;
}

const activateInput = (extra = {}) => ({
  applicationId: APP,
  vehicleId: VEH,
  weeklyRate: 325,
  depositAmount: 249,
  startDate: "2026-10-25",
  pickupMileage: 1000,
  ...extra,
});

try {
  const bundle = (entry, name, plugins = [stubPlugin]) =>
    build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: join(out, name), alias: { "@": resolve("src") }, plugins, logLevel: "warning" });
  await bundle("src/lib/activation-readiness.ts", "rules.mjs", []);
  await bundle("src/lib/rentals.functions.ts", "rentals.mjs");
  await bundle("src/lib/documents.functions.ts", "documents.mjs");
  await bundle("src/lib/rental-activation-settings.functions.ts", "settings.mjs");
  const rules = await import(join(out, "rules.mjs"));
  const rentals = await import(join(out, "rentals.mjs"));
  const documents = await import(join(out, "documents.mjs"));
  const settingsFns = await import(join(out, "settings.mjs"));
  const readiness = (userId, data = { applicationId: APP, vehicleId: VEH }) =>
    rentals.getActivationReadiness({ data, context: { userId, supabase: null } });
  const activate = (userId, data) => rentals.activateRental({ data: activateInput(data), context: { userId, supabase: null } });
  const codes = (bs) => (bs ?? []).map((b) => b.code).sort();
  const txCalls = (db) => db.calls.rpc.filter((c) => c.name === "activate_rental_checked_tx" || c.name === "activate_rental_tx");
  const reason = "Owner said it is fine to proceed";

  // ------------------------------------------------------------ readiness
  await test("a fully ready applicant has no blockers and every required item met", async () => {
    install(world());
    const r = await readiness(MANAGER);
    assert.deepEqual(r.blockers, []);
    assert.equal(r.ready, true);
    assert.equal(r.insurance.status, "verified");
    assert.ok(r.requirements.filter((q) => q.enforcement !== "advisory").every((q) => q.met === true), JSON.stringify(r.requirements));
  });

  await test("the readiness payload lists incomplete requirements with their enforcement", async () => {
    install(world({ app: { status: "reviewing" }, documents: [doc("license_front")], screenings: [], agreements: [], inspections: [] }));
    const r = await readiness(MANAGER);
    const byKey = Object.fromEntries(r.requirements.map((q) => [q.key, q]));
    assert.deepEqual(r.requirements.map((q) => q.key), ["approved", "license_documents", "signed_agreement", "insurance_verified", "interview", "inspection", "insurance_document", "gig_profile", "gig_platform"]);
    for (const k of Object.keys(byKey)) assert.equal(byKey[k].met, false, k);
    assert.deepEqual(Object.fromEntries(r.requirements.map((q) => [q.key, q.enforcement])), {
      approved: "hard", license_documents: "hard", signed_agreement: "hard", insurance_verified: "hard",
      interview: "soft", inspection: "soft", insurance_document: "advisory", gig_profile: "advisory", gig_platform: "advisory",
    });
    assert.equal(byKey.insurance_verified.detail, "No Insurance Document");
    assert.deepEqual(codes(r.blockers), ["insurance_not_verified", "missing_documents", "no_interview", "no_passed_inspection", "no_signed_agreement", "not_approved"]);
  });

  await test("gig platform is shown separately and never as verified; gig profile is advisory", async () => {
    install(world());
    const r = await readiness(MANAGER);
    const gp = r.requirements.find((q) => q.key === "gig_platform");
    assert.deepEqual([gp.label, gp.met, gp.enforcement], ["Gig Platform: Not Verified", false, "advisory"]);
    assert.equal(r.requirements.find((q) => q.key === "gig_profile").label, "Gig Profile Screenshot On File (Not Platform-Verified)");
    install(world({ documents: [doc("license_front"), doc("license_back"), doc("insurance")] }));
    const r2 = await readiness(MANAGER);
    assert.deepEqual(r2.blockers, [], "no gig profile does not block");
    for (const q of [...r.requirements, ...r2.requirements]) assert.doesNotMatch(q.label, /approved by|verified by|uber|lyft/i);
  });

  await test("inspection is not judged before a vehicle is chosen", async () => {
    install(world({ app: { vehicle_id: null } }));
    const r = await readiness(MANAGER, { applicationId: APP, vehicleId: null });
    assert.equal(r.requirements.find((q) => q.key === "inspection").met, null);
    assert.deepEqual(codes(r.blockers), ["no_vehicle"]);
  });

  await test("a Coordinator is refused readiness and activation by the server", async () => {
    const db = install(world());
    await assert.rejects(readiness(COORD), /Forbidden/);
    await assert.rejects(activate(COORD, {}), /Forbidden/);
    assert.equal(txCalls(db).length, 0);
  });

  await test("a caller with no staff role is refused", async () => {
    install(world());
    await assert.rejects(activate(DRIVER, {}), /Forbidden/);
  });

  // ------------------------------------------------------ hard blockers
  const notVerified = [{ lead_id: APP, interview_completed_at: "2026-10-01T10:00:00Z", insurance_verified: false }];
  const HARD_CASES = [
    ["not approved", { app: { status: "reviewing" } }, "not_approved"],
    ["no agreement at all", { agreements: [] }, "no_signed_agreement"],
    ["agreement only sent", { agreements: [{ ...esign, status: "sent", signed_at: null }] }, "no_signed_agreement"],
    ["agreement voided", { agreements: [{ ...esign, status: "voided", signed_at: null, voided_at: "2026-10-02T00:00:00Z" }] }, "no_signed_agreement"],
    ["signed agreement already used by an earlier rental", { agreements: [{ ...esign, rental_id: RENTAL }] }, "no_signed_agreement"],
    ["licence back missing", { documents: [doc("license_front"), doc("insurance"), doc("gig_profile")] }, "missing_documents"],
    ["licence front rejected", { documents: [doc("license_front", { review_status: "rejected" }), doc("license_back"), doc("insurance"), doc("gig_profile")] }, "missing_documents"],
    ["insurance unverified, setting OFF", { screenings: notVerified }, "insurance_not_verified"],
    ["insurance verified but expired, setting OFF", { app: { insurance_expires_on: "2020-01-01" } }, "insurance_not_verified"],
    ["insurance unverified, setting row missing (reads OFF)", { settings: [], screenings: notVerified }, "insurance_not_verified"],
    ["insurance unverified, setting value not a boolean (reads OFF)", { settings: [{ key: "rental_activation", value: { allow_activation_without_insurance_verification: "true" } }], screenings: notVerified }, "insurance_not_verified"],
  ];
  for (const [name, over, code] of HARD_CASES) {
    await test(`hard: ${name} → ${code} is refused even with an override, a reason and an insurance acknowledgement`, async () => {
      const db = install(world(over));
      const r = await readiness(MANAGER);
      assert.deepEqual(codes(r.blockers), [code]);
      assert.equal(rules.isHardBlocker(code), true);
      const res = await activate(MANAGER, { overrideBlockers: true, overrideReason: reason, insuranceExceptionAck: true });
      assert.equal(res.ok, false);
      assert.deepEqual(codes(res.blockers), [code]);
      assert.equal(txCalls(db).length, 0, "no rental transaction");
      assert.equal(globalThis.__provisioned.length, 0, "no account provisioning");
      assert.equal(globalThis.__audit.length, 0);
    });
  }

  await test("hard and soft together: the override is refused and only the hard blocker is returned", async () => {
    install(world({ agreements: [], inspections: [] }));
    const res = await activate(MANAGER, { overrideBlockers: true, overrideReason: "Inspection booked for tomorrow" });
    assert.equal(res.ok, false);
    assert.deepEqual(codes(res.blockers), ["no_signed_agreement"]);
  });

  // ------------------------------------------------------ insurance exception
  const unverified = { screenings: notVerified };
  const settingOn = [{ key: "rental_activation", value: { allow_activation_without_insurance_verification: true } }];

  await test("setting ON + unverified: refused without the insurance acknowledgement (a soft reason does not count)", async () => {
    const db = install(world({ ...unverified, settings: settingOn }));
    const r = await readiness(MANAGER);
    assert.deepEqual(r.blockers, []);
    assert.deepEqual([r.insurance.status, r.insurance.exceptionAllowed], ["unverified", true]);
    assert.equal(r.requirements.find((q) => q.key === "insurance_verified").enforcement, "acknowledge");
    for (const extra of [{}, { overrideBlockers: true, overrideReason: reason }]) {
      const res = await activate(MANAGER, extra);
      assert.deepEqual(codes(res.blockers), ["insurance_ack_required"]);
      assert.match(res.blockers[0].message, /does not mark insurance as verified/);
    }
    assert.equal(txCalls(db).length, 0);
  });

  for (const [status, over] of [
    ["unverified", unverified],
    ["missing", { ...unverified, documents: [doc("license_front"), doc("license_back")] }],
    ["expired", { app: { insurance_expires_on: "2020-01-01" } }],
  ]) {
    await test(`setting ON + ${status}: permitted with the acknowledgement; audited with status, setting and acknowledgement`, async () => {
      const db = install(world({ ...over, settings: settingOn }));
      globalThis.__txStatus = status;
      globalThis.__txAllow = true;
      const r = await readiness(MANAGER);
      assert.equal(r.insurance.status, status);
      const res = await activate(MANAGER, { insuranceExceptionAck: true });
      assert.equal(res.ok, true, JSON.stringify(res));
      const call = db.calls.rpc.find((c) => c.name === "activate_rental_checked_tx");
      assert.equal(call.args._insurance_exception_ack, true);
      assert.equal(db.calls.rpc.some((c) => c.name === "activate_rental_tx"), false, "the wrapper, not the bare transaction");
      const meta = globalThis.__audit.find((a) => a.entry.action === "rental.activated").entry.metadata.insurance;
      assert.equal(meta.status, status);
      assert.equal(meta.exception_used, true);
      assert.equal(meta.setting_allow_without_verification, true);
      assert.equal(meta.acknowledged, true);
      assert.equal(meta.acting_user_id, MANAGER);
      assert.equal(meta.checked_in_transaction, true);
      assert.ok(meta.at && meta.transaction_audit_id);
      assert.equal(db.calls.updates.filter((u) => u.table === "driver_screenings").length, 0, "insurance never marked verified");
    });
  }

  await test("setting ON + verified: normal activation, no exception, acknowledgement not sent", async () => {
    const db = install(world({ settings: settingOn }));
    globalThis.__txAllow = true;
    const res = await activate(MANAGER, { insuranceExceptionAck: true });
    assert.equal(res.ok, true);
    assert.equal(db.calls.rpc.find((c) => c.name === "activate_rental_checked_tx").args._insurance_exception_ack, false);
    const meta = globalThis.__audit.find((a) => a.entry.action === "rental.activated").entry.metadata.insurance;
    assert.deepEqual([meta.status, meta.exception_used, meta.acknowledged], ["verified", false, false]);
  });

  await test("setting changed between readiness and the transaction: the transaction's own locked read refuses", async () => {
    install(world({ ...unverified, settings: settingOn }), {
      activate_rental_checked_tx: async () => ({ data: null, error: { code: "P0001", message: "insurance_not_verified:unverified" } }),
    });
    const res = await activate(MANAGER, { insuranceExceptionAck: true });
    assert.equal(res.ok, false);
    assert.deepEqual(codes(res.blockers), ["insurance_not_verified"]);
    assert.equal(globalThis.__audit.length, 0);
  });

  await test("wrapper not installed (PGRST202): fail closed — exception unavailable, unverified refused", async () => {
    const db = install(world({ ...unverified, settings: settingOn }), { activate_rental_checked_tx: undefined });
    const res = await activate(MANAGER, { insuranceExceptionAck: true });
    assert.equal(res.ok, false);
    assert.deepEqual(codes(res.blockers), ["insurance_not_verified"]);
    assert.match(res.blockers[0].message, /database update/);
    assert.equal(db.calls.rpc.some((c) => c.name === "activate_rental_tx"), false, "the bare transaction is not used");
  });

  await test("wrapper not installed (PGRST202): verified insurance uses the existing activate_rental_tx", async () => {
    const db = install(world(), { activate_rental_checked_tx: undefined });
    const res = await activate(MANAGER, {});
    assert.equal(res.ok, true);
    assert.equal(db.calls.rpc.filter((c) => c.name === "activate_rental_tx").length, 1);
    const meta = globalThis.__audit.find((a) => a.entry.action === "rental.activated").entry.metadata.insurance;
    assert.deepEqual([meta.checked_in_transaction, meta.setting_source, meta.exception_used], [false, "wrapper_not_installed_treated_as_off", false]);
  });

  await test("other wrapper errors are not treated as 'not installed'", async () => {
    const db = install(world(), { activate_rental_checked_tx: async () => ({ data: null, error: { code: "42501", message: "permission denied for function activate_rental_checked_tx" } }) });
    await assert.rejects(activate(MANAGER, {}), /permission denied/);
    assert.equal(db.calls.rpc.some((c) => c.name === "activate_rental_tx"), false);
  });

  // ------------------------------------------------------ paper agreements
  await test("paper: a verified, archived paper agreement with its audited verification counts", async () => {
    install(world({ agreements: [], documents: [...baseDocs(), paperDoc()], audits: [paperAudit()] }));
    const r = await readiness(MANAGER);
    assert.deepEqual(r.blockers, []);
    assert.equal(r.requirements.find((q) => q.key === "signed_agreement").met, true);
  });

  for (const [name, over] of [
    ["unverified upload", { documents: [...baseDocs(), paperDoc({ review_status: "uploaded" })], audits: [paperAudit()] }],
    ["rejected", { documents: [...baseDocs(), paperDoc({ review_status: "rejected" })], audits: [paperAudit()] }],
    ["review_status verified but no audit row (e.g. set directly)", { documents: [...baseDocs(), paperDoc()], audits: [] }],
    ["audit by a Coordinator", { documents: [...baseDocs(), paperDoc()], audits: [paperAudit({ actor_role: "coordinator" })] }],
    ["audit for a different file", { documents: [...baseDocs(), paperDoc()], audits: [paperAudit({}, { storage_path: "other.pdf" })] }],
    ["audit for an earlier verification (reviewed_at changed)", { documents: [...baseDocs(), paperDoc({ reviewed_at: "2026-10-21T00:00:00.000Z" })], audits: [paperAudit()] }],
    ["not archived (no stored file)", { documents: [...baseDocs(), paperDoc({ storage_path: null })], audits: [paperAudit({}, { storage_path: null })] }],
    ["not current", { documents: [...baseDocs(), paperDoc({ is_current: false })], audits: [paperAudit()] }],
  ]) {
    await test(`paper: ${name} does not count, and no override satisfies it`, async () => {
      const db = install(world({ agreements: [], ...over }));
      const r = await readiness(MANAGER);
      assert.deepEqual(codes(r.blockers), ["no_signed_agreement"]);
      const res = await activate(MANAGER, { overrideBlockers: true, overrideReason: reason, insuranceExceptionAck: true });
      assert.deepEqual(codes(res.blockers), ["no_signed_agreement"]);
      assert.equal(txCalls(db).length, 0);
    });
  }

  const review = (userId, data) => documents.setDocumentReview({ data, context: { userId, supabase: null } });

  await test("paper: a Coordinator cannot verify; nothing is written", async () => {
    const db = install(world({ agreements: [], documents: [...baseDocs(), paperDoc({ review_status: "uploaded", reviewed_at: null })] }));
    await assert.rejects(review(COORD, { documentId: PAPER, status: "verified" }), /Forbidden/);
    assert.equal(db.calls.inserts.length + db.calls.updates.length, 0);
    assert.equal(db.tables.documents.find((d) => d.id === PAPER).review_status, "uploaded");
  });

  await test("paper: a Manager's verification writes the audit fields first, then the document, and then counts", async () => {
    const db = install(world({ agreements: [], documents: [...baseDocs(), paperDoc({ review_status: "uploaded", reviewed_at: null, content_sha256: "ab".repeat(32), label: "Paper Agreement" })] }));
    await review(MANAGER, { documentId: PAPER, status: "verified", note: "Wet-signed at pickup desk" });
    const ins = db.calls.inserts.find((i) => i.table === "audit_log");
    assert.ok(ins, "audit row inserted");
    const m = ins.row.metadata;
    assert.equal(ins.row.action, "document.verified");
    assert.equal(ins.row.actor_user_id, MANAGER);
    assert.equal(ins.row.actor_role, "team");
    assert.equal(ins.row.entity_id, APP);
    for (const k of ["documentId", "storage_bucket", "storage_path", "content_sha256", "reviewed_at", "reviewed_at_ms", "verifier_user_id", "verifier_role", "agreement_version", "document_label"]) assert.ok(k in m, k);
    assert.equal(m.paper_agreement, true);
    assert.equal(m.documentId, PAPER);
    assert.equal(m.storage_path, `${APP}/signed-paper.pdf`);
    assert.equal(m.content_sha256, "ab".repeat(32));
    assert.equal(m.verifier_user_id, MANAGER);
    const d = db.tables.documents.find((x) => x.id === PAPER);
    assert.equal(d.review_status, "verified");
    assert.equal(d.reviewed_at, m.reviewed_at);
    assert.equal(db.calls.updates.length, 1, "one document update, after the audit insert");
    const r = await readiness(MANAGER);
    assert.deepEqual(r.blockers, [], "the audited verification satisfies the agreement check");
  });

  await test("paper: if the audit row cannot be written, the document is not verified", async () => {
    const db = install(world({ agreements: [], documents: [...baseDocs(), paperDoc({ review_status: "uploaded", reviewed_at: null })] }));
    globalThis.__failInsert = "audit_log";
    await assert.rejects(review(MANAGER, { documentId: PAPER, status: "verified" }), /not verified/);
    assert.equal(db.tables.documents.find((d) => d.id === PAPER).review_status, "uploaded");
    assert.equal(db.calls.updates.length, 0);
  });

  await test("paper: an agreement document without a stored file cannot be verified", async () => {
    install(world({ agreements: [], documents: [...baseDocs(), paperDoc({ review_status: "uploaded", reviewed_at: null, storage_path: null })] }));
    await assert.rejects(review(MANAGER, { documentId: PAPER, status: "verified" }), /Upload the signed agreement file/);
  });

  // ------------------------------------------------------ soft blockers
  for (const [name, over, code] of [
    ["no passed inspection", { inspections: [] }, "no_passed_inspection"],
    ["interview not complete", { screenings: [{ lead_id: APP, interview_completed_at: null, insurance_verified: true }] }, "no_interview"],
  ]) {
    await test(`soft: ${name} needs an acknowledged override and a written reason`, async () => {
      let db = install(world(over));
      let res = await activate(MANAGER, {});
      assert.equal(res.ok, false);
      assert.deepEqual(codes(res.blockers), [code]);
      res = await activate(MANAGER, { overrideBlockers: true });
      assert.deepEqual(codes(res.blockers), ["override_reason_required"]);
      res = await activate(MANAGER, { overrideBlockers: true, overrideReason: "ok  " });
      assert.deepEqual(codes(res.blockers), ["override_reason_required"], "under five characters after trimming");
      res = await activate(MANAGER, { overrideReason: "A real written reason" });
      assert.equal(res.ok, false, "a reason without the acknowledgement is not an override");
      res = await activate(MANAGER, { insuranceExceptionAck: true });
      assert.equal(res.ok, false, "the insurance acknowledgement is not a soft-blocker override");
      assert.equal(txCalls(db).length, 0);

      db = install(world(over));
      res = await activate(MANAGER, { overrideBlockers: true, overrideReason: "Checked in person by the owner" });
      assert.equal(res.ok, true);
      assert.equal(txCalls(db).length, 1);
      const entry = globalThis.__audit.find((a) => a.entry.action === "rental.activated");
      assert.ok(entry, "audit entry written");
      assert.equal(entry.actor.userId, MANAGER);
      assert.equal(entry.entry.metadata.vehicle_id, VEH);
      assert.equal(entry.entry.metadata.driver_id, DRIVER);
      assert.equal(entry.entry.metadata.overrides.reason, "Checked in person by the owner");
      assert.deepEqual(entry.entry.metadata.overrides.blockers.map((b) => b.code), [code]);
      assert.equal(entry.entry.metadata.overrides.by, MANAGER);
      assert.ok(entry.entry.metadata.overrides.at);
    });
  }

  await test("a ready applicant activates through the checked wrapper exactly once", async () => {
    const db = install(world());
    const res = await activate(MANAGER, {});
    assert.equal(res.ok, true);
    assert.equal(res.rentalId, RENTAL);
    const tx = db.calls.rpc.filter((c) => c.name === "activate_rental_checked_tx");
    assert.equal(tx.length, 1);
    assert.equal(tx[0].args._application_id, APP);
    assert.equal(tx[0].args._vehicle_id, VEH);
    assert.equal(tx[0].args._actor, MANAGER);
    assert.equal(db.calls.rpc.some((c) => c.name === "activate_rental_tx"), false);
  });

  await test("an Owner may activate", async () => {
    install(world());
    assert.equal((await activate(OWNER, {})).ok, true);
  });

  await test("the existing hard blockers stay hard", async () => {
    const db = install(world({ rentals: [{ vehicle_id: VEH, driver_id: "someone-else", status: "active" }] }));
    const res = await activate(MANAGER, { overrideBlockers: true, overrideReason: "Please let me through" });
    assert.deepEqual(codes(res.blockers), ["vehicle_busy"]);
    assert.equal(txCalls(db).length, 0);
  });

  await test("a busy approval lock (M2 approval_serialize, 40001) returns a retryable blocker, not a crash", async () => {
    install(world(), { activate_rental_checked_tx: async () => ({ data: null, error: { code: "40001", message: "approval_write_busy_retry" } }) });
    const res = await activate(MANAGER, {});
    assert.equal(res.ok, false);
    assert.deepEqual(codes(res.blockers), ["write_busy_retry"]);
    assert.equal(rules.isHardBlocker("write_busy_retry"), true);
    assert.equal(globalThis.__audit.length, 0);
  });

  await test("a failed readiness read refuses instead of reading as complete", async () => {
    install(world());
    const real = globalThis.__fake.from;
    globalThis.__fake.from = (t) => {
      const q = real(t);
      if (t !== "agreements") return q;
      const wrap = { ...q, eq: () => wrap, select: () => wrap, then: (res) => res({ data: null, error: { message: "boom" } }) };
      return wrap;
    };
    await assert.rejects(readiness(MANAGER), /Could not check activation readiness/);
  });

  await test("an unreadable setting reads OFF", async () => {
    install(world({ ...unverified, settings: settingOn }));
    const real = globalThis.__fake.from;
    globalThis.__fake.from = (t) => (t === "app_settings" ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) } : real(t));
    const r = await readiness(MANAGER);
    assert.deepEqual([r.insurance.exceptionAllowed, r.insurance.settingReadable], [false, false]);
    assert.deepEqual(codes(r.blockers), ["insurance_not_verified"]);
  });

  // ------------------------------------------------------ the Owner setting
  const setSetting = (userId, allow, rpc) =>
    settingsFns.setAllowActivationWithoutInsuranceVerification({ data: { allow }, context: { userId, supabase: { rpc } } });
  await test("setting: a Manager and a Coordinator are refused before any database call", async () => {
    install(world());
    let called = 0;
    const rpc = async () => (called++, { data: null, error: null });
    await assert.rejects(setSetting(MANAGER, true, rpc), /Forbidden/);
    await assert.rejects(setSetting(COORD, true, rpc), /Forbidden/);
    await assert.rejects(settingsFns.getRentalActivationSettings({ context: { userId: MANAGER } }), /Forbidden/);
    assert.equal(called, 0);
  });

  await test("setting: the Owner changes it through the audited database function with the Owner's own session", async () => {
    install(world());
    const calls = [];
    const r = await setSetting(OWNER, true, async (name, args) => (calls.push([name, args]), { data: { from: false, to: true, changed_at: "2026-10-25T00:00:00Z", audit_id: "x" }, error: null }));
    assert.deepEqual(calls, [["set_rental_activation_insurance_exception", { _allow: true }]]);
    assert.deepEqual([r.from, r.to], [false, true]);
  });

  await test("setting: not installed (PGRST202) or refused by the database is reported, nothing assumed", async () => {
    install(world());
    await assert.rejects(setSetting(OWNER, true, async () => ({ data: null, error: { code: "PGRST202", message: "x" } })), /database update/);
    await assert.rejects(setSetting(OWNER, true, async () => ({ data: null, error: { code: "42501", message: "owner_required" } })), /Only the Owner/);
  });

  await test("setting: the Owner reads it; a missing row is OFF", async () => {
    install(world({ settings: [] }));
    const s = await settingsFns.getRentalActivationSettings({ context: { userId: OWNER } });
    assert.deepEqual(s, { allowWithoutInsuranceVerification: false, present: false, readable: true });
  });

  // ------------------------------------------------------ pure rules
  await test("decideActivation: unknown codes fail closed as hard", async () => {
    const insurance = { status: "verified", exceptionAllowed: false, settingPresent: true, settingReadable: true };
    const d = rules.decideActivation({ blockers: [{ code: "something_new", message: "x" }], insurance }, { overrideBlockers: true, overrideReason: "long enough" });
    assert.equal(d.ok, false);
    assert.deepEqual([...rules.SOFT_ACTIVATION_BLOCKERS].sort(), ["no_interview", "no_passed_inspection"]);
  });

  await test("insuranceStatus precedence: expired > verified > missing > unverified", async () => {
    const t = "2026-10-25";
    const ins = (extra = {}) => ({ category: "insurance", is_current: true, review_status: "uploaded", ...extra });
    assert.equal(rules.insuranceStatus({ verified: true, documents: [ins()], applicationExpiresOn: "2026-10-24", today: t }), "expired");
    assert.equal(rules.insuranceStatus({ verified: true, documents: [ins({ expires_at: "2026-01-01" })], applicationExpiresOn: null, today: t }), "expired");
    assert.equal(rules.insuranceStatus({ verified: true, documents: [ins({ expires_at: "2026-10-25" })], applicationExpiresOn: "2026-10-25", today: t }), "verified");
    assert.equal(rules.insuranceStatus({ verified: false, documents: [], applicationExpiresOn: null, today: t }), "missing");
    assert.equal(rules.insuranceStatus({ verified: false, documents: [ins({ review_status: "rejected" })], applicationExpiresOn: null, today: t }), "missing");
    assert.equal(rules.insuranceStatus({ verified: null, documents: [ins()], applicationExpiresOn: null, today: t }), "unverified");
  });

  await test("missingRequiredCategories uses the shared four-category list", async () => {
    const shared = readFileSync("src/lib/required-docs.ts", "utf8");
    assert.match(shared, /export const REQUIRED_VAULT_CATEGORIES = \["license_front", "license_back", "insurance", "gig_profile"\] as const;/);
    const ui = readFileSync("src/components/admin/ApplicantDocuments.tsx", "utf8");
    assert.match(ui, /export \{ REQUIRED_VAULT_CATEGORIES \} from "@\/lib\/required-docs";/);
    assert.deepEqual(rules.missingRequiredCategories([]), ["license_front", "license_back", "insurance", "gig_profile"]);
  });

  // ------------------------------------------------------ UI visibility
  await test("Rental tab entry: enabled for Manager+, disabled for a Coordinator, hidden while a rental runs", async () => {
    assert.equal(rules.activationEntryState({ isManager: true, rentalActive: false }), "enabled");
    assert.equal(rules.activationEntryState({ isManager: false, rentalActive: false }), "manager_only");
    assert.equal(rules.activationEntryState({ isManager: true, rentalActive: true }), "rental_active");
    assert.equal(rules.activationEntryState({ isManager: false, rentalActive: true }), "rental_active");
  });

  await test("header next step never offers Activate Rental to a Coordinator", async () => {
    const ready = { screeningDone: true, docsComplete: true, insuranceOk: true, approved: true, rentalActive: false };
    assert.equal(rules.primaryStep({ ...ready, isManager: true }), "activate");
    assert.equal(rules.primaryStep({ ...ready, isManager: false }), "view_rental");
    assert.equal(rules.primaryStep({ ...ready, rentalActive: true, isManager: true }), "view_rental");
    assert.equal(rules.primaryStep({ ...ready, screeningDone: false, isManager: true }), "interview");
  });

  await test("UI wiring: one dialog; separate insurance acknowledgement; Owner-only setting in Rental Terms; Title Case", async () => {
    const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    assert.match(panel, /<StartRentalCard[\s\S]{0,300}onActivate=\{\(\) => setActivateOpen\(true\)\}/);
    assert.match(panel, /A driver becomes Active only when a rental starts\./);
    assert.equal((panel.match(/<ActivateRentalDialog/g) ?? []).length, 1, "one dialog, not a second activation path");
    const dialog = readFileSync("src/components/admin/ActivateRentalDialog.tsx", "utf8");
    assert.match(dialog, /isHardBlocker\(b\.code\)/);
    assert.match(dialog, /insuranceExceptionAck: insuranceNeedsAck && insuranceAck/);
    assert.match(dialog, /\(!insuranceNeedsAck \|\| insuranceAck\)/);
    assert.doesNotMatch(dialog, /\buppercase\b/);
    const ws = readFileSync("src/components/admin/SettingsWorkspace.tsx", "utf8");
    assert.match(ws, /current\.id === "rental_terms" \? <RentalActivationSettingsPanel \/>/);
    const nav = readFileSync("src/components/admin/nav-config.ts", "utf8");
    assert.match(nav, /\{ id: "rental_terms", label: "Rental Terms", group: "RENTALS", minTier: "owner" \}/);
    for (const f of ["src/components/admin/ActivationRequirementList.tsx", "src/components/admin/RentalActivationSettingsPanel.tsx"])
      assert.doesNotMatch(readFileSync(f, "utf8"), /\buppercase\b|text-transform/);
    const docs = readFileSync("src/components/admin/ApplicantDocuments.tsx", "utf8");
    assert.match(docs, /Not Verified With Uber, Lyft Or Any Platform\./);
  });

  await test("the rental transaction stays the only start path", async () => {
    const src = readFileSync("src/lib/rentals.functions.ts", "utf8");
    assert.equal((src.match(/rpc\("activate_rental_tx"/g) ?? []).length, 1, "only the fail-closed fallback");
    assert.equal((src.match(/rpc\("activate_rental_checked_tx"/g) ?? []).length, 1);
    assert.doesNotMatch(src, /from\("rentals"\)\s*\.insert/);
    assert.doesNotMatch(src, /insurance_verified:\s*true/);
  });
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
