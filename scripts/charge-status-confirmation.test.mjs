// Charge Card says "Paid" only when Stripe reports the charge succeeded, and a failed charge never
// invites a blind retry.
//
// Runs the real chargeCardOnRental (src/lib/rental-payments.functions.ts) with the real collectRows
// (src/lib/payment-collection.server.ts), bundled with esbuild, against an in-memory fake of the
// Supabase admin client and a fake Stripe client. Nothing reaches a network.
import { build } from "esbuild";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-charge-status-"));
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
  "@tanstack/react-start/server": `export const getRequest = () => ({ headers: new Map() });`,
  "@/integrations/supabase/client.server": `export const supabaseAdmin = new Proxy({}, { get: (_t, k) => globalThis.__fake[k] });`,
  "@/lib/stripe.server": `export const createStripeClient = () => globalThis.__stripe; export const getStripeErrorMessage = (e) => (e && e.message) || String(e);`,
};
const stubPlugin = {
  name: "stubs",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => (STUBS[args.path] != null ? { path: args.path, namespace: "stub" } : null));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js" }));
  },
};

/** Supports the chains chargeCardOnRental and collectRows use: select/eq/in/neq/lt/limit/maybeSingle, update().select(), insert().select().single(). */
function fakeDb(tables) {
  let seq = 0;
  function query(table) {
    const filters = [];
    let patch = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (c, v) => (filters.push((r) => r[c] === v), q),
      neq: (c, v) => (filters.push((r) => r[c] !== v), q),
      in: (c, vs) => (filters.push((r) => vs.includes(r[c])), q),
      lt: (c, v) => (filters.push((r) => r[c] < v), q),
      limit: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      update: (p) => ((patch = p), q),
      then: (res, rej) => Promise.resolve((() => {
        const hit = rows();
        if (patch) for (const r of hit) Object.assign(r, patch);
        return { data: patch ? hit.map((r) => ({ id: r.id })) : hit, error: null };
      })()).then(res, rej),
      insert: (row) => {
        const saved = { id: `pay-${++seq}`, attempt_count: 0, ...row };
        (tables[table] ??= []).push(saved);
        return { select: () => ({ single: async () => ({ data: saved, error: null }) }) };
      },
    };
    return q;
  }
  return { tables, from: (t) => query(t), auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@test" } } }) } } };
}

const RENTAL = "77777777-7777-4777-8777-777777777777";
const OPEN_RENT = "88888888-8888-4888-8888-888888888888";
const OWNER = "55555555-5555-4555-8555-555555555555";
const MANAGER = "33333333-3333-4333-8333-333333333333";
// The Owner check is server-side (roles.server.ts reads user_roles through the service role); the
// authenticated client is never asked, so it refuses every call.
const ownerCtx = { userId: OWNER, supabase: { rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.has_role" } }) } };

function install(piBehaviour) {
  globalThis.__fake = fakeDb({
    rentals: [{ id: RENTAL, application_id: "app-1", vehicle_id: "veh-1", stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_1" }],
    payments: [],
    user_roles: [{ user_id: OWNER, role: "admin" }, { user_id: MANAGER, role: "team" }],
  });
  const calls = [];
  globalThis.__stripe = {
    calls,
    paymentIntents: {
      create: async (params, opts) => {
        calls.push({ params, opts });
        return piBehaviour(params);
      },
    },
  };
  return globalThis.__fake;
}

const charge = (payments) =>
  payments.chargeCardOnRental({ data: { rentalId: RENTAL, amountCents: 32500, reason: "rent", environment: "live" }, context: ownerCtx });

try {
  await build({ entryPoints: ["src/lib/rental-payments.functions.ts"], bundle: true, platform: "node", format: "esm", outfile: join(out, "payments.mjs"), alias: { "@": resolve("src") }, plugins: [stubPlugin], logLevel: "warning" });
  const payments = await import(join(out, "payments.mjs"));
  await build({ entryPoints: ["src/lib/payment-collection.server.ts"], bundle: true, platform: "node", format: "esm", outfile: join(out, "collect.mjs"), alias: { "@": resolve("src") }, plugins: [stubPlugin], logLevel: "warning" });
  const ui = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
  const dialog = ui.slice(ui.indexOf("function ChargeCardDialog"), ui.indexOf("function AutopayActions"));

  await test("a charge Stripe reports succeeded returns status paid and the row is Paid", async () => {
    const db = install(() => ({ id: "pi_ok", status: "succeeded" }));
    const res = await charge(payments);
    assert.equal(res.ok, true);
    assert.equal(res.status, "paid");
    assert.equal(db.tables.payments[0].status, "paid");
  });

  await test("a charge needing authentication returns status pending and the row stays Pending (not Paid)", async () => {
    const db = install(() => ({ id: "pi_auth", status: "requires_action" }));
    const res = await charge(payments);
    assert.equal(res.ok, true);
    assert.equal(res.status, "pending");
    assert.equal(db.tables.payments[0].status, "pending");
  });

  await test("a charge Stripe reports processing returns status pending and the row stays Pending (not Paid)", async () => {
    const db = install(() => ({ id: "pi_proc", status: "processing" }));
    const res = await charge(payments);
    assert.equal(res.status, "pending");
    assert.equal(db.tables.payments[0].status, "pending");
    assert.equal(db.tables.payments[0].stripe_payment_intent_id, "pi_proc");
  });

  await test("each attempt carries a Stripe idempotency key tied to the row and attempt", async () => {
    install(() => ({ id: "pi_ok", status: "succeeded" }));
    await charge(payments);
    assert.match(globalThis.__stripe.calls[0].opts.idempotencyKey, /^payments:pay-1:attempt:1$/);
  });

  await test("a connection error is an unconfirmed outcome: the row stays Processing (pending), never failed, and the message says not to charge again", async () => {
    const err = Object.assign(new Error("An error occurred with our connection to Stripe."), { type: "StripeConnectionError" });
    const db = install(() => { throw err; });
    const res = await charge(payments);
    assert.ok("error" in res);
    assert.match(res.error, /Stripe has not confirmed this charge, so it may have gone through\. It stays Processing until Stripe confirms it\. Don't charge again/);
    assert.doesNotMatch(res.error, /can be retried|recorded as failed/);
    assert.equal(db.tables.payments[0].status, "pending");
  });

  await test("an error with no Stripe type (unknown) is also unconfirmed, never failed", async () => {
    const db = install(() => { throw new Error("socket hang up"); });
    await charge(payments);
    assert.equal(db.tables.payments[0].status, "pending");
  });

  await test("a card decline (Stripe card_error) is a definite failure: failed, still owed, nothing collected", async () => {
    const err = Object.assign(new Error("Your card was declined."), { type: "StripeCardError", statusCode: 402 });
    const db = install(() => { throw err; });
    const res = await charge(payments);
    assert.match(res.error, /^Your card was declined\. — Stripe declined or refused it, so nothing was collected\. It is recorded as failed and still owed\./);
    assert.equal(db.tables.payments[0].status, "failed");
  });

  await test("a 5xx or idempotency conflict from Stripe is unconfirmed even when typed as a Stripe error", async () => {
    for (const e of [
      { type: "StripeAPIError", statusCode: 500 },
      { type: "StripeInvalidRequestError", statusCode: 409 },
      { type: "StripeIdempotencyError", statusCode: 400 },
      // Through the gateway and the client's own retries, a 4xx can follow a first try that charged.
      { type: "StripeInvalidRequestError", statusCode: 400 },
      { type: "StripeAuthenticationError", statusCode: 401 },
      { type: "StripePermissionError", statusCode: 403 },
      { type: "StripeRateLimitError", statusCode: 429 },
      { type: "StripeCardError" }, // a card error without Stripe's 402 is not trusted either
    ]) {
      const db = install(() => { throw Object.assign(new Error("x"), e); });
      await charge(payments);
      assert.equal(db.tables.payments[0].status, "pending", JSON.stringify(e));
    }
  });

  await test("while a charge on the rental is Processing, Charge Card refuses before Stripe is called", async () => {
    const db = install(() => ({ id: "pi_ok", status: "succeeded" }));
    db.tables.payments.push({ id: "pay-x", rental_id: RENTAL, status: "pending", amount: 325, balance_due: 325, attempt_count: 1 });
    const res = await charge(payments);
    assert.match(res.error, /still Processing/);
    assert.equal(globalThis.__stripe.calls.length, 0);
    assert.equal(db.tables.payments.length, 1, "no new charge row");
  });

  await test("one rent debt, one row: Charge Card refuses new rent while a rent charge on the rental is still owed; other reasons are not blocked", async () => {
    const db = install(() => ({ id: "pi_ok", status: "succeeded" }));
    db.tables.payments.push({ id: OPEN_RENT, rental_id: RENTAL, type: "rent", status: "failed", amount: 325, balance_due: 325, attempt_count: 1, due_date: "2026-10-20" });
    const res = await charge(payments);
    assert.match(res.error, /already has an unpaid rent charge \(\$325\.00, due 2026-10-20\)/);
    assert.equal(globalThis.__stripe.calls.length, 0);
    const toll = await payments.chargeCardOnRental({ data: { rentalId: RENTAL, amountCents: 1500, reason: "toll", environment: "live" }, context: ownerCtx });
    assert.equal(toll.ok, true);
    const retry = await payments.chargeCardOnRental({ data: { rentalId: RENTAL, amountCents: 32500, reason: "rent", paymentId: OPEN_RENT, environment: "live" }, context: ownerCtx });
    assert.equal(retry.ok, true, "the existing rent charge can be charged (same row, next attempt)");
    assert.equal(db.tables.payments.find((r) => r.id === OPEN_RENT).status, "paid");
  });

  await test("a combined charge's idempotency key stays within Stripe's 255 characters (hash of the sorted ids)", async () => {
    const { attemptKey } = await import(join(out, "collect.mjs"));
    const ids = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`);
    const k = await attemptKey(ids, 3);
    assert.ok(k.length <= 255, String(k.length));
    assert.equal(k, await attemptKey([...ids].reverse(), 3), "order does not matter");
    assert.notEqual(k, await attemptKey(ids, 4));
    assert.equal(await attemptKey(["abc"], 2), "payments:abc:attempt:2");
  });

  await test("the Owner check works without public.has_role (dropped by migration 20260713042639); a Manager is refused", async () => {
    const db = install(() => ({ id: "pi_ok", status: "succeeded" }));
    const res = await payments.chargeCardOnRental({ data: { rentalId: RENTAL, amountCents: 32500, reason: "rent", environment: "live" }, context: { ...ownerCtx, userId: MANAGER } });
    assert.match(res.error, /Forbidden/);
    assert.equal(db.tables.payments.length, 0);
    assert.equal(globalThis.__stripe.calls.length, 0);
    for (const f of ["src/lib/rental-payments.functions.ts", "src/lib/payments.functions.ts"])
      assert.doesNotMatch(readFileSync(f, "utf8"), /\.rpc\(\s*['"]has_role['"]/, `${f} still calls the dropped public.has_role`);
  });

  await test("UI: 'Paid' only for status paid; anything else is a warning saying not to charge again; no 'Charged' message", () => {
    assert.match(dialog, /if \(res\.status === "paid"\) toast\.success\(`Paid: \$\$\{\(cents \/ 100\)\.toFixed\(2\)\} collected`\);/);
    assert.match(dialog, /toast\.warning\(\s*`Charge of \$\$\{\(cents \/ 100\)\.toFixed\(2\)\} submitted but not confirmed; Payments shows it as Processing\. Don't charge again: check the payment in Stripe\.`/);
    assert.doesNotMatch(dialog, /Charged \$/);
  });
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
