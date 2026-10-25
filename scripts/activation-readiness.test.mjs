// Driver activation readiness (PR 2).
//
// Runs the real getActivationReadiness / activateRental handlers from
// src/lib/rentals.functions.ts, bundled with esbuild, against an in-memory
// fake of the service-role client. Nothing here reaches a network: the
// Supabase client, email, SMS, audit and account provisioning are stubbed,
// and the real requireManager (roles.server.ts) runs against the fake
// user_roles table, so the Coordinator refusal is the production check.
//
// Also covers the pure rules in src/lib/activation-readiness.ts and the
// visibility logic the drawer uses.
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
  "@tanstack/react-start": `export const createServerFn = () => { const api = { middleware: () => api, inputValidator: (v) => { api._v = v; return api; }, handler: (fn) => (arg) => fn({ ...arg, data: api._v(arg.data) }) }; return api; };`,
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
  const calls = { rpc: [], inserts: [] };
  function query(table) {
    const filters = [];
    let limitN = null;
    let order = null;
    const rows = () => {
      let r = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      if (order) r = [...r].sort((a, b) => (a[order.col] > b[order.col] ? 1 : -1) * (order.asc ? 1 : -1));
      if (limitN != null) r = r.slice(0, limitN);
      return r;
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
      then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
      insert: (row) => {
        calls.inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "ins" }, error: null }) }), then: (res) => res({ error: null }) };
      },
    };
    return q;
  }
  return {
    calls,
    from: (t) => query(t),
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      const fn = rpcs[name];
      return fn ? fn(args) : { data: null, error: null };
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

const doc = (category, extra = {}) => ({ driver_id: APP, category, is_current: true, review_status: "uploaded", ...extra });

/** A fully ready applicant; each test removes exactly one thing. */
function world(over = {}) {
  return {
    applications: [{ id: APP, full_name: "Dana Driver", email: "dana@example.test", phone: "+15555550100", status: "approved", vehicle_id: VEH, weekly_rent: 325, user_id: DRIVER, insurance_status: "declared", sms_consent: true, ...(over.app ?? {}) }],
    documents: over.documents ?? [doc("license_front"), doc("license_back"), doc("insurance"), doc("gig_profile")],
    driver_screenings: over.screenings ?? [{ lead_id: APP, interview_completed_at: "2026-10-01T10:00:00Z", insurance_verified: true }],
    agreements: over.agreements ?? [{ application_id: APP, source: "rental", status: "signed", signed_at: "2026-10-02T10:00:00Z", voided_at: null, rental_id: null }],
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

function install(tables, rpcs) {
  globalThis.__fake = fakeDb(tables, {
    vehicle_rental_ready_missing: async () => ({ data: [], error: null }),
    activate_rental_tx: async () => ({ data: RENTAL, error: null }),
    ...rpcs,
  });
  globalThis.__audit = [];
  globalThis.__sent = [];
  globalThis.__provisioned = [];
  globalThis.__provision = undefined;
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
  await build({
    entryPoints: ["src/lib/activation-readiness.ts"],
    bundle: true, platform: "node", format: "esm", outfile: join(out, "rules.mjs"),
    alias: { "@": resolve("src") }, logLevel: "warning",
  });
  await build({
    entryPoints: ["src/lib/rentals.functions.ts"],
    bundle: true, platform: "node", format: "esm", outfile: join(out, "rentals.mjs"),
    alias: { "@": resolve("src") }, plugins: [stubPlugin], logLevel: "warning",
  });
  const rules = await import(join(out, "rules.mjs"));
  const rentals = await import(join(out, "rentals.mjs"));
  const readiness = (userId, data = { applicationId: APP, vehicleId: VEH }) =>
    rentals.getActivationReadiness({ data, context: { userId, supabase: null } });
  const activate = (userId, data) => rentals.activateRental({ data: activateInput(data), context: { userId, supabase: null } });
  const codes = (bs) => (bs ?? []).map((b) => b.code).sort();

  // ------------------------------------------------------------ readiness
  await test("a fully ready applicant has no blockers and every requirement met", async () => {
    install(world());
    const r = await readiness(MANAGER);
    assert.deepEqual(r.blockers, []);
    assert.equal(r.ready, true);
    assert.ok(r.requirements.every((q) => q.met === true), JSON.stringify(r.requirements));
  });

  await test("the readiness payload lists incomplete requirements with their enforcement", async () => {
    install(world({ app: { status: "reviewing" }, documents: [doc("license_front")], screenings: [], agreements: [], inspections: [] }));
    const r = await readiness(MANAGER);
    const byKey = Object.fromEntries(r.requirements.map((q) => [q.key, q]));
    assert.deepEqual(
      r.requirements.map((q) => q.key),
      ["approved", "license_documents", "signed_agreement", "interview", "inspection", "insurance_verified", "insurance_document", "gig_profile"],
    );
    for (const k of Object.keys(byKey)) assert.equal(byKey[k].met, false, k);
    assert.equal(byKey.approved.enforcement, "hard");
    assert.equal(byKey.license_documents.enforcement, "hard");
    assert.equal(byKey.signed_agreement.enforcement, "hard");
    assert.equal(byKey.interview.enforcement, "soft");
    assert.equal(byKey.inspection.enforcement, "soft");
    assert.equal(byKey.insurance_verified.enforcement, "advisory");
    assert.equal(byKey.insurance_document.enforcement, "advisory");
    assert.equal(byKey.gig_profile.enforcement, "advisory");
    assert.deepEqual(codes(r.blockers), ["missing_documents", "no_interview", "no_passed_inspection", "no_signed_agreement", "not_approved"]);
    assert.match(r.blockers.find((b) => b.code === "missing_documents").message, /License \(Back\)/);
  });

  await test("inspection is not judged before a vehicle is chosen", async () => {
    install(world({ app: { vehicle_id: null } }));
    const r = await readiness(MANAGER, { applicationId: APP, vehicleId: null });
    assert.equal(r.requirements.find((q) => q.key === "inspection").met, null);
    assert.deepEqual(codes(r.blockers), ["no_vehicle"]);
  });

  await test("a Coordinator is refused readiness and activation by the server", async () => {
    install(world());
    await assert.rejects(readiness(COORD), /Forbidden/);
    await assert.rejects(activate(COORD, {}), /Forbidden/);
    assert.equal(globalThis.__fake.calls.rpc.some((c) => c.name === "activate_rental_tx"), false);
  });

  await test("a caller with no staff role is refused", async () => {
    install(world());
    await assert.rejects(activate(DRIVER, {}), /Forbidden/);
  });

  // ------------------------------------------------------ hard blockers
  const HARD_CASES = [
    ["not approved", { app: { status: "reviewing" } }, "not_approved"],
    ["no agreement at all", { agreements: [] }, "no_signed_agreement"],
    ["agreement only sent", { agreements: [{ application_id: APP, source: "rental", status: "sent", signed_at: null, voided_at: null, rental_id: null }] }, "no_signed_agreement"],
    ["agreement voided", { agreements: [{ application_id: APP, source: "rental", status: "voided", signed_at: null, voided_at: "2026-10-02T00:00:00Z", rental_id: null }] }, "no_signed_agreement"],
    ["signed agreement already used by an earlier rental", { agreements: [{ application_id: APP, source: "rental", status: "signed", signed_at: "2025-01-01T00:00:00Z", voided_at: null, rental_id: RENTAL }] }, "no_signed_agreement"],
    ["licence back missing", { documents: [doc("license_front"), doc("insurance"), doc("gig_profile")] }, "missing_documents"],
    ["licence front rejected", { documents: [doc("license_front", { review_status: "rejected" }), doc("license_back"), doc("insurance"), doc("gig_profile")] }, "missing_documents"],
  ];
  for (const [name, over, code] of HARD_CASES) {
    await test(`hard: ${name} → ${code} is refused even with an override and a reason`, async () => {
      const db = install(world(over));
      const r = await readiness(MANAGER);
      assert.deepEqual(codes(r.blockers), [code]);
      assert.equal(rules.isHardBlocker(code), true);
      const res = await activate(MANAGER, { overrideBlockers: true, overrideReason: "Owner said it is fine to proceed" });
      assert.equal(res.ok, false);
      assert.deepEqual(codes(res.blockers), [code]);
      assert.equal(db.calls.rpc.some((c) => c.name === "activate_rental_tx"), false, "no rental transaction");
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

  await test("a Manager-verified signed agreement in the Document Vault satisfies the agreement check", async () => {
    install(world({ agreements: [], documents: [doc("license_front"), doc("license_back"), doc("insurance"), doc("gig_profile"), doc("agreement", { review_status: "verified" })] }));
    const r = await readiness(MANAGER);
    assert.deepEqual(r.blockers, []);
    install(world({ agreements: [], documents: [doc("license_front"), doc("license_back"), doc("insurance"), doc("gig_profile"), doc("agreement")] }));
    assert.deepEqual(codes((await readiness(MANAGER)).blockers), ["no_signed_agreement"], "an unverified upload does not count");
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
      assert.equal(db.calls.rpc.some((c) => c.name === "activate_rental_tx"), false);

      db = install(world(over));
      res = await activate(MANAGER, { overrideBlockers: true, overrideReason: "Checked in person by the owner" });
      assert.equal(res.ok, true);
      assert.equal(db.calls.rpc.filter((c) => c.name === "activate_rental_tx").length, 1);
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

  await test("insurance and gig profile are advisory: listed as incomplete, never blocking", async () => {
    const db = install(world({ documents: [doc("license_front"), doc("license_back")], screenings: [{ lead_id: APP, interview_completed_at: "2026-10-01T10:00:00Z", insurance_verified: false }] }));
    const r = await readiness(MANAGER);
    assert.deepEqual(r.blockers, []);
    const unmet = r.requirements.filter((q) => q.met === false).map((q) => q.key).sort();
    assert.deepEqual(unmet, ["gig_profile", "insurance_document", "insurance_verified"]);
    const res = await activate(MANAGER, {});
    assert.equal(res.ok, true);
    assert.equal(db.calls.rpc.filter((c) => c.name === "activate_rental_tx").length, 1);
    assert.equal(globalThis.__audit.find((a) => a.entry.action === "rental.activated").entry.metadata.overrides, null);
  });

  await test("a ready applicant activates through activate_rental_tx exactly once, with no override recorded", async () => {
    const db = install(world());
    const res = await activate(MANAGER, {});
    assert.equal(res.ok, true);
    assert.equal(res.rentalId, RENTAL);
    const tx = db.calls.rpc.filter((c) => c.name === "activate_rental_tx");
    assert.equal(tx.length, 1);
    assert.equal(tx[0].args._application_id, APP);
    assert.equal(tx[0].args._vehicle_id, VEH);
    assert.equal(tx[0].args._actor, MANAGER);
  });

  await test("an Owner may activate", async () => {
    install(world());
    assert.equal((await activate(OWNER, {})).ok, true);
  });

  await test("the existing hard blockers stay hard", async () => {
    const db = install(world({ rentals: [{ vehicle_id: VEH, driver_id: "someone-else", status: "active" }] }));
    const res = await activate(MANAGER, { overrideBlockers: true, overrideReason: "Please let me through" });
    assert.deepEqual(codes(res.blockers), ["vehicle_busy"]);
    assert.equal(db.calls.rpc.some((c) => c.name === "activate_rental_tx"), false);
  });

  await test("a busy approval lock (M2 approval_serialize, 40001) returns a retryable blocker, not a crash", async () => {
    install(world(), { activate_rental_tx: async () => ({ data: null, error: { code: "40001", message: "approval_write_busy_retry" } }) });
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

  // ------------------------------------------------------ pure rules
  await test("decideActivation: unknown codes fail closed as hard", async () => {
    const d = rules.decideActivation([{ code: "something_new", message: "x" }], { overrideBlockers: true, overrideReason: "long enough" });
    assert.equal(d.ok, false);
    assert.deepEqual([...rules.SOFT_ACTIVATION_BLOCKERS].sort(), ["no_interview", "no_passed_inspection"]);
  });

  await test("missingRequiredCategories uses the shared four-category list", async () => {
    const shared = readFileSync("src/lib/required-docs.ts", "utf8");
    assert.match(shared, /export const REQUIRED_VAULT_CATEGORIES = \["license_front", "license_back", "insurance", "gig_profile"\] as const;/);
    const ui = readFileSync("src/components/admin/ApplicantDocuments.tsx", "utf8");
    assert.match(ui, /export \{ REQUIRED_VAULT_CATEGORIES \} from "@\/lib\/required-docs";/);
    assert.deepEqual(rules.missingRequiredCategories([]), ["license_front", "license_back", "insurance", "gig_profile"]);
    assert.deepEqual(
      rules.missingRequiredCategories([
        { category: "license_front", is_current: true, review_status: "verified" },
        { category: "license_back", is_current: false },
        { category: "insurance", is_current: true, review_status: "rejected" },
        { category: "gig_profile", is_current: true },
      ]),
      ["license_back", "insurance"],
    );
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
    assert.equal(rules.primaryStep({ ...ready, docsComplete: false, isManager: true }), "documents");
    assert.equal(rules.primaryStep({ ...ready, insuranceOk: false, isManager: true }), "insurance");
    assert.equal(rules.primaryStep({ ...ready, approved: false, isManager: true }), "approve");
  });

  await test("the Rental tab opens the existing dialog; the dialog uses the shared hard/soft rule", async () => {
    const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    assert.match(panel, /<StartRentalCard[\s\S]{0,300}onActivate=\{\(\) => setActivateOpen\(true\)\}/);
    assert.match(panel, /A driver becomes Active only when a rental starts\./);
    assert.match(panel, /activationEntryState\(\{ isManager, rentalActive \}\)/);
    assert.equal((panel.match(/<ActivateRentalDialog/g) ?? []).length, 1, "one dialog, not a second activation path");
    const dialog = readFileSync("src/components/admin/ActivateRentalDialog.tsx", "utf8");
    assert.match(dialog, /isHardBlocker\(b\.code\)/);
    assert.doesNotMatch(dialog, /const HARD = new Set/);
    assert.doesNotMatch(dialog, /\buppercase\b/);
    const list = readFileSync("src/components/admin/ActivationRequirementList.tsx", "utf8");
    assert.doesNotMatch(list, /\buppercase\b|text-transform/);
  });

  await test("the rental transaction stays the only start path", async () => {
    const src = readFileSync("src/lib/rentals.functions.ts", "utf8");
    assert.equal((src.match(/rpc\("activate_rental_tx"/g) ?? []).length, 1);
    assert.doesNotMatch(src, /from\("rentals"\)\s*\.insert/);
    assert.doesNotMatch(src, /status: "active"/);
  });
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
