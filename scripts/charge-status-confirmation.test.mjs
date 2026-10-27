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

/** Supports the chains chargeCardOnRental and collectRows use: select/eq/in/neq/maybeSingle, update, insert().select().single(). */
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
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      update: (p) => ((patch = p), q),
      then: (res, rej) => Promise.resolve((() => {
        if (patch) for (const r of rows()) Object.assign(r, patch);
        return { data: patch ? null : rows(), error: null };
      })()).then(res, rej),
      insert: (row) => {
        const saved = { id: `pay-${++seq}`, attempt_count: 0, ...row };
        (tables[table] ??= []).push(saved);
        return { select: () => ({ single: async () => ({ data: saved, error: null }) }) };
      },
    };
    return q;
  }
  return { tables, from: (t) => query(t) };
}

const RENTAL = "77777777-7777-4777-8777-777777777777";
const OWNER = "55555555-5555-4555-8555-555555555555";
const ownerCtx = { userId: OWNER, supabase: { rpc: async (n, a) => ({ data: n === "has_role" && a._user_id === OWNER, error: null }) } };

function install(piBehaviour) {
  globalThis.__fake = fakeDb({
    rentals: [{ id: RENTAL, application_id: "app-1", vehicle_id: "veh-1", stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_1" }],
    payments: [],
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

  await test("each attempt carries a Stripe idempotency key tied to the row and attempt", async () => {
    install(() => ({ id: "pi_ok", status: "succeeded" }));
    await charge(payments);
    assert.match(globalThis.__stripe.calls[0].opts.idempotencyKey, /^payments:pay-1:attempt:1$/);
  });

  await test("a connection error is recorded as failed and the message says to check Stripe, never 'can be retried'", async () => {
    const db = install(() => { throw new Error("An error occurred with our connection to Stripe."); });
    const res = await charge(payments);
    assert.ok("error" in res);
    assert.match(res.error, /check this payment in Stripe: unless the card was declined, it may still have gone through/);
    assert.doesNotMatch(res.error, /can be retried/);
    assert.equal(db.tables.payments[0].status, "failed");
  });

  await test("a card decline gets the same never-retry-blind wording", async () => {
    install(() => { throw new Error("Your card was declined."); });
    const res = await charge(payments);
    assert.match(res.error, /^Your card was declined\. — recorded as failed\. Before charging again, check this payment in Stripe/);
  });

  await test("UI: 'Paid' only for status paid; anything else is a warning saying not to charge again; no 'Charged' message", () => {
    assert.match(dialog, /if \(res\.status === "paid"\) toast\.success\(`Paid: \$\$\{\(cents \/ 100\)\.toFixed\(2\)\} collected`\);/);
    assert.match(dialog, /toast\.warning\(\s*`Charge of \$\$\{\(cents \/ 100\)\.toFixed\(2\)\} submitted but not confirmed; it shows Pending\. Don't charge again: check the payment in Stripe\.`/);
    assert.doesNotMatch(dialog, /Charged \$/);
  });
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
