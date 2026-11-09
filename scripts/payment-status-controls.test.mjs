// Staff status changes on payments (Change Status, Mark as Paid, Waive, Void) are authorised,
// need a reason, never touch a settled row, refuse a stale screen, and are audited — or undone.
//
// Runs the real changePaymentStatus (src/lib/payment-status.functions.ts) with the real role
// lookup (src/lib/roles.server.ts), bundled with esbuild, against an in-memory fake of the
// Supabase admin client. Nothing reaches a network.
import { build } from "esbuild";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-payment-status-"));
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
};
const stubPlugin = {
  name: "stubs",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => (STUBS[args.path] != null ? { path: args.path, namespace: "stub" } : null));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js" }));
  },
};

/** Supports select/eq/maybeSingle, update().eq().select(), insert(). */
function fakeDb(tables, { auditFails = false } = {}) {
  function query(table) {
    const filters = [];
    let patch = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      const hit = rows();
      if (patch) for (const r of hit) Object.assign(r, patch);
      return { data: patch ? hit.map((r) => ({ id: r.id })) : hit.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select: () => q,
      eq: (c, v) => (filters.push((r) => r[c] === v), q),
      update: (p) => ((patch = p), q),
      maybeSingle: async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: null }),
      insert: async (row) => {
        if (table === "audit_log" && auditFails) return { error: { message: "insert failed" } };
        (tables[table] ??= []).push(row);
        return { error: null };
      },
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  }
  return { tables, from: (t) => query(t), auth: { admin: { getUserById: async (id) => ({ data: { user: { email: `${id}@test` } } }) } } };
}

const OWNER = "55555555-5555-4555-8555-555555555555";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const COORD = "44444444-4444-4444-8444-444444444444";
const PAY = "a0000000-0000-4000-8000-000000000001";

function install(status, extra = {}, opts = {}) {
  globalThis.__fake = fakeDb(
    {
      user_roles: [{ user_id: OWNER, role: "admin" }, { user_id: MANAGER, role: "team" }, { user_id: COORD, role: "coordinator" }],
      payments: [{ id: PAY, status, amount: 325, balance_due: 325, paid_date: null, payment_method: null, notes: null, driver_id: "d1", rental_id: "r1", ...extra }],
      audit_log: [],
    },
    opts,
  );
  return globalThis.__fake.tables;
}

try {
  await build({ entryPoints: ["src/lib/payment-status.functions.ts"], bundle: true, platform: "node", format: "esm", outfile: join(out, "ps.mjs"), alias: { "@": resolve("src") }, plugins: [stubPlugin], logLevel: "warning" });
  const { changePaymentStatus } = await import(join(out, "ps.mjs"));
  const call = (userId, data) => changePaymentStatus({ data: { reason: "entered twice", ...data, paymentId: PAY }, context: { userId } });
  const SETTLED = ["paid", "refunded", "waived", "void"];
  const ACTIONS = [["void"], ["waive"], ["mark_paid", "Cash"], ["set_open_status", null, "current"]];

  await test("Void (Manager): an open row becomes void, keeps amount and balance, reason in notes, audited with actor and before/after", async () => {
    const t = install("failed");
    const res = await call(MANAGER, { action: "void", expectedStatus: "failed" });
    assert.deepEqual(res, { ok: true, status: "void" });
    const row = t.payments[0];
    assert.equal(row.status, "void");
    assert.equal(row.amount, 325);
    assert.equal(row.balance_due, 325);
    assert.equal(row.notes, "Voided: entered twice");
    assert.equal(t.audit_log.length, 1);
    const a = t.audit_log[0];
    assert.equal(a.action, "payment.void");
    assert.equal(a.entity_id, PAY);
    assert.equal(a.actor_user_id, MANAGER);
    assert.equal(a.actor_role, "team");
    assert.deepEqual([a.metadata.from, a.metadata.to, a.metadata.reason], ["failed", "void", "entered twice"]);
  });

  await test("Waive forgives a legitimate debt: Owner only; a Manager is refused and nothing changes", async () => {
    let t = install("overdue");
    assert.match((await call(MANAGER, { action: "waive", expectedStatus: "overdue" })).error, /Only the Owner/);
    assert.equal(t.payments[0].status, "overdue");
    assert.equal(t.audit_log.length, 0);
    t = install("overdue");
    assert.deepEqual(await call(OWNER, { action: "waive", expectedStatus: "overdue", reason: "hardship, agreed by Owner" }), { ok: true, status: "waived" });
    assert.equal(t.audit_log[0].action, "payment.waive");
  });

  await test("a settled row (paid, refunded, waived, void) never changes, whoever asks and whatever the action", async () => {
    for (const s of SETTLED) {
      for (const [action, method, toStatus] of ACTIONS) {
        const t = install(s, s === "paid" ? { balance_due: 0, paid_date: "2026-10-20" } : {});
        const res = await call(OWNER, { action, expectedStatus: s, method, toStatus });
        assert.ok("error" in res, `${s} ${action} was allowed`);
        assert.equal(t.payments[0].status, s);
        assert.equal(t.audit_log.length, 0);
      }
    }
  });

  await test("Change Status moves only between open statuses: never to paid, refunded, waived, void or pending", async () => {
    for (const to of [...SETTLED, "pending"]) {
      const t = install("current");
      assert.ok("error" in (await call(OWNER, { action: "set_open_status", expectedStatus: "current", toStatus: to })), to);
      assert.equal(t.payments[0].status, "current");
    }
    const t = install("current");
    assert.deepEqual(await call(MANAGER, { action: "set_open_status", expectedStatus: "current", toStatus: "overdue", reason: "due Monday, unpaid" }), { ok: true, status: "overdue" });
    assert.equal(t.audit_log[0].action, "payment.set_open_status");
  });

  await test("Mark as Paid (money received outside Stripe): needs the method; sets paid, balance 0, paid date and method; audited", async () => {
    let t = install("failed");
    assert.match((await call(MANAGER, { action: "mark_paid", expectedStatus: "failed", reason: "receipt 12" })).error, /how the money was received/);
    assert.equal(t.payments[0].status, "failed");
    t = install("failed");
    assert.deepEqual(await call(MANAGER, { action: "mark_paid", expectedStatus: "failed", method: "Cash", reason: "receipt 12" }), { ok: true, status: "paid" });
    const row = t.payments[0];
    assert.deepEqual([row.status, row.balance_due, row.payment_method, row.notes], ["paid", 0, "Cash", "Marked paid (Cash): receipt 12"]);
    assert.match(row.paid_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(t.audit_log[0].metadata.method, "Cash");
  });

  await test("a Processing (pending) charge may still be collected by Stripe: no Void, Waive or status change; Mark as Paid by the Owner only", async () => {
    for (const [action, method, toStatus] of ACTIONS) {
      const t = install("pending");
      assert.ok("error" in (await call(MANAGER, { action, expectedStatus: "pending", method, toStatus })), action);
      assert.equal(t.payments[0].status, "pending");
    }
    const t = install("pending");
    assert.deepEqual(await call(OWNER, { action: "mark_paid", expectedStatus: "pending", method: "Stripe (webhook missed)", reason: "pi_123 succeeded in Stripe" }), { ok: true, status: "paid" });
  });

  await test("a stale screen is refused: the row has changed since the list loaded", async () => {
    const t = install("paid", { balance_due: 0 });
    const res = await call(MANAGER, { action: "void", expectedStatus: "failed" });
    assert.match(res.error, /changed since the list loaded/);
    assert.equal(t.payments[0].status, "paid");
    assert.equal(t.audit_log.length, 0);
  });

  await test("if the audit row can't be written, the change is undone and reported", async () => {
    const t = install("failed", {}, { auditFails: true });
    const res = await call(MANAGER, { action: "void", expectedStatus: "failed" });
    assert.match(res.error, /audit log, so it was undone/);
    const row = t.payments[0];
    assert.deepEqual([row.status, row.notes, row.balance_due], ["failed", null, 325]);
  });

  await test("a Coordinator or a non-staff user can't change a payment", async () => {
    for (const who of [COORD, "66666666-6666-4666-8666-666666666666"]) {
      const t = install("failed");
      assert.ok("error" in (await call(who, { action: "void", expectedStatus: "failed" })));
      assert.equal(t.payments[0].status, "failed");
    }
  });

  await test("a reason is required (at least 3 characters)", async () => {
    install("failed");
    await assert.rejects(async () => call(MANAGER, { action: "void", expectedStatus: "failed", reason: "  " }));
    await assert.rejects(async () => changePaymentStatus({ data: { paymentId: PAY, action: "void", expectedStatus: "failed" }, context: { userId: MANAGER } }));
  });

  await test("UI: the Payments screen never writes a payment status itself, and a new charge can only start owed", () => {
    const panel = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");
    assert.doesNotMatch(panel, /from\("payments"\)\s*\.update\(/, "PaymentsPanel updates payments directly");
    const add = panel.slice(panel.indexOf("function AddPayment"));
    assert.match(add, /\{OPEN_STATUSES\.map\(\(s\) => \(/);
    assert.doesNotMatch(add, /\{STATUSES\.map/, "Add Payment offers paid, refunded or waived");
    assert.match(readFileSync("src/routes/admin.tsx", "utf8"), /<PaymentsPanel [^>]*tier=\{tier\}/);
  });
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
