// Billing launch safety: weekly autopay off, Stop Autopay never hides a failed cancel, and End
// Rental refuses while a Stripe subscription is attached.
//
// Runs the real startRentalAutopay / stopRentalAutopay (src/lib/rental-payments.functions.ts) and
// endRental (src/lib/rentals.functions.ts), bundled with esbuild, against an in-memory fake of the
// Supabase clients and a fake Stripe client that records every call. Nothing reaches a network.
import { build } from "esbuild";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const out = mkdtempSync(join(tmpdir(), "rr-billing-safety-"));
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
  "@/lib/audit.server": `export async function logAudit(actor, entry) { globalThis.__audit.push({ actor, entry }); }`,
  "@/lib/stripe.server": `export const createStripeClient = (env) => { globalThis.__stripeEnv.push(env); return globalThis.__stripe; }; export const getStripeErrorMessage = (e) => (e && e.message) || String(e);`,
  "@/lib/renter-lifecycle-notices.server": `export async function enrollRenterLifecycleNotice() {}`,
};
const stubPlugin = (extra = {}) => ({
  name: "stubs",
  setup(b) {
    const all = { ...STUBS, ...extra };
    b.onResolve({ filter: /.*/ }, (args) => (all[args.path] != null ? { path: args.path, namespace: "stub" } : null));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: all[args.path], loader: "js" }));
  },
});

function fakeDb(tables, rpcs = {}) {
  const calls = { rpc: [], updates: [] };
  function query(table) {
    const filters = [];
    let patch = null;
    const rows = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
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
      in: (c, vs) => (filters.push((r) => vs.includes(r[c])), q),
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
      update: (p) => ((patch = p), q),
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
  };
}

/** Records every Stripe call. cancel/retrieve behaviour is set per test. */
function fakeStripe({ cancel, retrieve } = {}) {
  const calls = [];
  const rec = (name, fn) => async (...args) => {
    calls.push([name, ...args]);
    return fn ? fn(...args) : { id: "x" };
  };
  return {
    calls,
    customers: { update: rec("customers.update"), create: rec("customers.create") },
    prices: { create: rec("prices.create") },
    subscriptions: {
      create: rec("subscriptions.create", () => ({ id: "sub_new", status: "active" })),
      cancel: rec("subscriptions.cancel", cancel ?? (() => ({ id: "sub_1", status: "canceled" }))),
      retrieve: rec("subscriptions.retrieve", retrieve ?? (() => ({ id: "sub_1", status: "active" }))),
    },
  };
}

const RENTAL = "77777777-7777-4777-8777-777777777777";
const APP = "11111111-1111-4111-8111-111111111111";
const OWNER = "55555555-5555-4555-8555-555555555555";
const MANAGER = "33333333-3333-4333-8333-333333333333";

function rentalRow(over = {}) {
  return {
    id: RENTAL, application_id: APP, driver_id: "99999999-9999-4999-8999-999999999999", vehicle_id: "22222222-2222-4222-8222-222222222222",
    status: "active", weekly_rate: 325, start_date: "2026-10-27", autopay_active: false, stripe_subscription_id: null,
    stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_1", ...over,
  };
}

function install(rental, { stripe, rpcs } = {}) {
  globalThis.__fake = fakeDb({
    rentals: [rental],
    user_roles: [{ user_id: OWNER, role: "admin" }, { user_id: MANAGER, role: "team" }],
    applications: [{ id: APP, stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_1" }],
  }, { end_rental_tx: async () => ({ data: "closed", error: null }), ...rpcs });
  globalThis.__stripe = stripe ?? fakeStripe();
  globalThis.__stripeEnv = [];
  globalThis.__audit = [];
  return globalThis.__fake;
}

/** The authenticated client assertAdmin uses: has_role('admin') is true only for the Owner. */
const ownerCtx = { userId: OWNER, supabase: { rpc: async (n, a) => ({ data: n === "has_role" && a._user_id === OWNER && a._role === "admin", error: null }) } };
const managerCtx = { userId: MANAGER, supabase: null };

try {
  const bundle = (entry, name, extra) =>
    build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: join(out, name), alias: { "@": resolve("src") }, plugins: [stubPlugin(extra)], logLevel: "warning" });
  await bundle("src/lib/rental-payments.functions.ts", "payments.mjs");
  // The same code with the launch switch turned on, to prove what the start path checks next.
  await bundle("src/lib/rental-payments.functions.ts", "payments-on.mjs", {
    "@/lib/rental-autopay-flag": `export const RENTAL_AUTOPAY_START_ENABLED = true; export const AUTOPAY_START_OFF_MESSAGE = "off";`,
  });
  await bundle("src/lib/rentals.functions.ts", "rentals.mjs");
  const payments = await import(join(out, "payments.mjs"));
  const paymentsOn = await import(join(out, "payments-on.mjs"));
  const rentals = await import(join(out, "rentals.mjs"));
  const flag = readFileSync("src/lib/rental-autopay-flag.ts", "utf8");

  // --------------------------------------------------------------- start autopay
  await test("the launch switch is a hard false in its only declaration", () => {
    assert.match(flag, /export const RENTAL_AUTOPAY_START_ENABLED: boolean = false as boolean;/);
  });

  await test("start autopay is refused for the Owner: no Stripe call, no rental change", async () => {
    const db = install(rentalRow());
    const res = await payments.startRentalAutopay({ data: { rentalId: RENTAL, environment: "live" }, context: ownerCtx });
    assert.deepEqual(res, { error: "Weekly autopay is turned off for now. Charge the card each week with Charge Card." });
    assert.equal(globalThis.__stripe.calls.length, 0);
    assert.equal(globalThis.__stripeEnv.length, 0);
    assert.equal(db.calls.updates.length, 0);
    assert.equal(db.tables.rentals[0].stripe_subscription_id, null);
  });

  await test("start autopay is refused before the coordination path or any role lookup", async () => {
    const db = install(rentalRow());
    const res = await payments.startRentalAutopay({ data: { rentalId: RENTAL, environment: "live" }, context: { userId: MANAGER, supabase: null } });
    assert.ok("error" in res);
    assert.equal(db.calls.rpc.length, 0);
    assert.equal(globalThis.__stripe.calls.length, 0);
  });

  await test("with the switch on, a closed rental is still refused before Stripe", async () => {
    const db = install(rentalRow({ status: "closed" }));
    const res = await paymentsOn.startRentalAutopay({ data: { rentalId: RENTAL, environment: "live" }, context: ownerCtx });
    assert.deepEqual(res, { error: "Autopay can only start on an active rental" });
    assert.equal(globalThis.__stripe.calls.length, 0);
    assert.equal(db.calls.updates.length, 0);
  });

  // --------------------------------------------------------------- stop autopay
  const withSub = () => rentalRow({ autopay_active: true, stripe_subscription_id: "sub_1" });

  await test("stop autopay: Stripe confirms canceled, so the subscription is cleared", async () => {
    const db = install(withSub());
    const res = await payments.stopRentalAutopay({ data: { rentalId: RENTAL, environment: "live" }, context: ownerCtx });
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(db.tables.rentals[0].stripe_subscription_id, null);
    assert.equal(db.tables.rentals[0].autopay_active, false);
  });

  await test("stop autopay: a failed cancel is reported and autopay stays on (the subscription id is kept)", async () => {
    const stripe = fakeStripe({ cancel: () => { throw new Error("Your card network is down"); } });
    const db = install(withSub(), { stripe });
    const res = await payments.stopRentalAutopay({ data: { rentalId: RENTAL, environment: "live" }, context: ownerCtx });
    assert.ok("error" in res && /Could not cancel weekly autopay in Stripe: Your card network is down/.test(res.error), JSON.stringify(res));
    assert.match(res.error, /Autopay is still on; nothing was changed/);
    assert.equal(db.tables.rentals[0].stripe_subscription_id, "sub_1");
    assert.equal(db.tables.rentals[0].autopay_active, true);
    assert.equal(db.calls.updates.length, 0);
  });

  await test("stop autopay: a cancel that returns a live status is not treated as canceled", async () => {
    const stripe = fakeStripe({ cancel: () => ({ id: "sub_1", status: "active" }) });
    const db = install(withSub(), { stripe });
    const res = await payments.stopRentalAutopay({ data: { rentalId: RENTAL, environment: "live" }, context: ownerCtx });
    assert.ok("error" in res && /reported the subscription as active/.test(res.error));
    assert.equal(db.tables.rentals[0].stripe_subscription_id, "sub_1");
  });

  await test("stop autopay: an already-canceled subscription (cancel errors, retrieve says canceled) is cleared", async () => {
    const stripe = fakeStripe({ cancel: () => { throw new Error("already canceled"); }, retrieve: () => ({ id: "sub_1", status: "canceled" }) });
    const db = install(withSub(), { stripe });
    const res = await payments.stopRentalAutopay({ data: { rentalId: RENTAL, environment: "live" }, context: ownerCtx });
    assert.deepEqual(res, { ok: true });
    assert.equal(db.tables.rentals[0].stripe_subscription_id, null);
  });

  await test("stop autopay: 'no such subscription' (e.g. the wrong Stripe mode) is never treated as ended", async () => {
    const missing = () => { const e = new Error("No such subscription: 'sub_1'"); e.code = "resource_missing"; throw e; };
    const stripe = fakeStripe({ cancel: missing, retrieve: missing });
    const db = install(withSub(), { stripe });
    const res = await payments.stopRentalAutopay({ data: { rentalId: RENTAL, environment: "sandbox" }, context: ownerCtx });
    assert.ok("error" in res && /No such subscription/.test(res.error));
    assert.equal(db.tables.rentals[0].stripe_subscription_id, "sub_1");
    assert.equal(db.tables.rentals[0].autopay_active, true);
  });

  await test("stop autopay still requires the Owner", async () => {
    install(withSub());
    const res = await payments.stopRentalAutopay({ data: { rentalId: RENTAL, environment: "live" }, context: { userId: MANAGER, supabase: { rpc: async () => ({ data: false, error: null }) } } });
    assert.ok("error" in res);
    assert.equal(globalThis.__stripe.calls.length, 0);
  });

  // --------------------------------------------------------------- end rental
  await test("end rental is refused while a Stripe subscription is attached; nothing is ended", async () => {
    const db = install(withSub());
    const res = await rentals.endRental({ data: { rentalId: RENTAL }, context: managerCtx });
    assert.equal(res.ok, false);
    assert.match(res.error, /Stop weekly autopay before ending this rental/);
    assert.equal(db.calls.rpc.length, 0);
    assert.equal(db.tables.rentals[0].status, "active");
    assert.equal(globalThis.__audit.length, 0);
  });

  await test("end rental is refused while autopay is marked on, even without a stored subscription id", async () => {
    const db = install(rentalRow({ autopay_active: true }));
    const res = await rentals.endRental({ data: { rentalId: RENTAL }, context: managerCtx });
    assert.equal(res.ok, false);
    assert.equal(db.calls.rpc.length, 0);
  });

  await test("end rental without autopay runs end_rental_tx once and audits it, as today", async () => {
    const db = install(rentalRow());
    const res = await rentals.endRental({ data: { rentalId: RENTAL, returnMileage: 1200 }, context: managerCtx });
    assert.equal(res.ok, true);
    assert.deepEqual(db.calls.rpc.map((c) => c.name), ["end_rental_tx"]);
    assert.equal(globalThis.__audit.length, 1);
    assert.equal(globalThis.__audit[0].entry.action, "rental.ended");
  });

  await test("end rental on an already-closed rental is unchanged (already closed, no refusal)", async () => {
    const db = install(rentalRow({ status: "closed", stripe_subscription_id: "sub_1" }));
    const res = await rentals.endRental({ data: { rentalId: RENTAL }, context: managerCtx });
    assert.deepEqual(res, { ok: true, alreadyClosed: true });
    assert.equal(db.calls.rpc.length, 0);
  });

  // --------------------------------------------------------------- UI wiring
  await test("UI: the autopay control never offers Start while the switch is off or on a closed rental, and always offers Stop", () => {
    const ui = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    const block = ui.slice(ui.indexOf("function AutopayActions"), ui.indexOf("function CardOnFileCard"));
    assert.match(block, /\.select\("id, status, autopay_active, stripe_subscription_id, weekly_rate"\)/);
    assert.match(block, /const active = rental\.autopay_active \|\| !!rental\.stripe_subscription_id;/);
    assert.match(block, /if \(!active && rental\.status !== "active"\) return null;/);
    assert.match(block, /if \(!active && !RENTAL_AUTOPAY_START_ENABLED\)/);
    assert.match(block, /Autopay Off · Charge Weekly/);
    assert.doesNotMatch(block, /text-transform|uppercase/);
  });
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
