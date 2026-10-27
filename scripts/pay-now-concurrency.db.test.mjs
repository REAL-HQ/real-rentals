// Duplicate-charge protection under real concurrency, on a private disposable stack only:
// Postgres 17 at 127.0.0.1:55482 (database pnc_test cloned from the production-order baseline
// rr_tpl) behind a local PostgREST on 127.0.0.1:55484. The real server functions (Pay Now,
// Charge Card, Owner release) and the real payments webhook run against it through PostgREST,
// so the row locking that serialises concurrent claims is Postgres's own. Stripe is a fake that
// models idempotency keys, delays and unknown outcomes. Nothing reaches Stripe or a hosted backend.
// Run: node scripts/pay-now-concurrency.db.test.mjs   (needs /tmp/pgrst/postgrest or PGRST_BIN)
import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { PostgrestClient } from "@supabase/postgrest-js";

const ADMIN = "postgresql://postgres@127.0.0.1:55482/postgres?sslmode=disable";
const DBNAME = "pnc_test";
const DB = `postgresql://postgres@127.0.0.1:55482/${DBNAME}?sslmode=disable`;
const REST = "http://127.0.0.1:55484";
const SECRET = "pay-now-concurrency-local-jwt-secret-not-real-000000";
const PGRST_BIN = process.env.PGRST_BIN ?? "/tmp/pgrst/postgrest";
for (const u of [ADMIN, DB, REST]) if (!/\/\/(postgres@)?127\.0\.0\.1:5548[24]\//.test(u + "/")) throw new Error(`refusing non-local target ${u}`);

const psql = (sql) => execFileSync("psql", [DB, "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
const failures = [];
async function test(name, fn) {
  if (process.env.PNC_ONLY && !name.includes(process.env.PNC_ONLY)) return;
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

function jwt(claims) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b({ alg: "HS256", typ: "JWT" })}.${b({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
// Harness-only shim: the local PostgREST 12.2.3 re-applies a mutation's `or=` filter to the rows it
// returns, so `PATCH ...&or=(x...)&select=id` fails with 42703 unless `x` is selected. Asking for
// `select=*` keeps the update itself identical (same WHERE). Production runs PostgREST 14.5; its
// behaviour for these webhook queries is not verified here.
const shimFetch = (u, init) => {
  const url = new URL(String(u));
  if (init?.method === "PATCH" && url.searchParams.has("or") && url.searchParams.has("select")) url.searchParams.set("select", "*");
  return fetch(url, init);
};
const client = (token) => new PostgrestClient(REST, { headers: { Authorization: `Bearer ${token}`, apikey: token }, fetch: shimFetch });

const OWNER = randomUUID(), MANAGER = randomUUID(), DRIVER = randomUUID();
const APP = randomUUID(), VEH = randomUUID(), RENTAL = randomUUID();

// ------------------------------------------------------------------ fake Stripe
// Same idempotency key -> same stored result (as Stripe does for 24 h). `plan` decides each new
// request: { delay, outcome: 'succeeded'|'processing'|'decline'|'lost'|'charged_then_timeout' }.
function fakeStripe() {
  const byKey = new Map();
  const inProgress = new Set();
  const intents = [];
  const calls = [];
  let plan = () => ({ delay: 0, outcome: "succeeded" });
  const self = {
    calls,
    intents,
    setPlan: (p) => (plan = p),
    paymentIntents: {
      create: async (params, opts) => {
        calls.push({ params, key: opts?.idempotencyKey });
        if (byKey.has(opts.idempotencyKey)) return byKey.get(opts.idempotencyKey)();
        // Stripe answers a concurrent request with the same key 409 idempotency_key_in_use.
        if (inProgress.has(opts.idempotencyKey))
          throw Object.assign(new Error("There is currently another in-progress request using this Stripe token (idempotency key)."), { type: "StripeIdempotencyError", statusCode: 409, code: "idempotency_key_in_use" });
        inProgress.add(opts.idempotencyKey);
        const p = plan(params);
        await sleep(p.delay ?? 0);
        inProgress.delete(opts.idempotencyKey);
        const pi = { id: `pi_${intents.length + 1}`, customer: params.customer, amount: params.amount, created: Math.floor(Date.now() / 1000), metadata: params.metadata };
        let result;
        if (p.outcome === "lost") {
          result = () => { throw Object.assign(new Error("An error occurred with our connection to Stripe."), { type: "StripeConnectionError" }); };
        } else {
          pi.status = p.outcome === "decline" ? "requires_payment_method" : p.outcome === "processing" ? "processing" : "succeeded";
          pi.amount_received = pi.status === "succeeded" ? params.amount : 0;
          intents.push(pi);
          if (p.outcome === "decline") result = () => { throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", statusCode: 402, raw: { payment_intent: pi } }); };
          else if (p.outcome === "charged_then_timeout") result = () => { throw Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" }); };
          else result = () => ({ ...pi });
        }
        byKey.set(opts.idempotencyKey, result);
        return result();
      },
      // Account-wide, newest first, paginated like Stripe's list (the release must not rely on a customer filter).
      list: async ({ customer, created, limit = 10, starting_after }) => {
        let all = intents.filter((pi) => (!customer || pi.customer === customer) && pi.created >= created.gte && (created.lte == null || pi.created <= created.lte)).reverse();
        if (starting_after) all = all.slice(all.findIndex((pi) => pi.id === starting_after) + 1);
        return { data: all.slice(0, limit).map((pi) => ({ ...pi })), has_more: all.length > limit };
      },
      retrieve: async (id) => {
        const pi = intents.find((x) => x.id === id);
        if (!pi) throw Object.assign(new Error("No such payment_intent"), { statusCode: 404 });
        return { ...pi };
      },
    },
  };
  return self;
}

const STUBS = {
  "@tanstack/react-start": `export const createServerFn = () => { const api = { middleware: () => api, inputValidator: (v) => { api._v = v; return api; }, handler: (fn) => (arg = {}) => fn({ ...arg, data: api._v ? api._v(arg.data) : arg.data }) }; return api; };`,
  "@tanstack/react-start/server": `export const getRequest = () => ({ headers: new Map() });`,
  "@tanstack/react-router": `export const createFileRoute = () => (o) => o;`,
  "@supabase/supabase-js": `export const createClient = () => { throw new Error("no hosted client in tests"); };`,
  "@/integrations/supabase/auth-middleware": `export const requireSupabaseAuth = {};`,
  "@/integrations/supabase/client.server": `export const supabaseAdmin = new Proxy({}, { get: (_t, k) => globalThis.__admin[k] });`,
  "@/lib/stripe.server": `export const createStripeClient = () => globalThis.__stripe; export const verifyWebhook = async () => { throw new Error("not used"); }; export const getStripeErrorMessage = (e) => (e && (e.raw?.message ?? e.message)) || "Stripe request failed";`,
  "@/lib/driver-preview.server": `export const refuseStaffPortalWrite = async () => {}; export const portalScope = async (c) => ({ supabase: c.supabase, userId: c.userId });`,
  "@/lib/email.server": `export const sendPaymentReceiptEmail = async () => {}; export const sendPaymentFailedEmail = async () => {}; export const sendCardExpiringEmail = async () => {};`,
};
const stubPlugin = {
  name: "stubs",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => (STUBS[args.path] != null ? { path: args.path, namespace: "stub" } : null));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: STUBS[args.path], loader: "js" }));
  },
};

const out = mkdtempSync(join(tmpdir(), "rr-pnc-"));
let pgrst = null;
execFileSync("psql", [ADMIN, "-qAtX", "-c", `DROP DATABASE IF EXISTS ${DBNAME}`]);
execFileSync("psql", [ADMIN, "-qAtX", "-c", `CREATE DATABASE ${DBNAME} TEMPLATE rr_tpl`]);
try {
  psql(`SET session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${OWNER}', 'owner@test'), ('${MANAGER}', 'manager@test'), ('${DRIVER}', 'driver@test');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${OWNER}', 'admin'), ('${MANAGER}', 'team');
    INSERT INTO public.applications (id, full_name, email, phone, status, user_id) VALUES ('${APP}', 'Syn Driver', 'driver@test', '0000000', 'approved', '${DRIVER}');
    INSERT INTO public.vehicles (id, make, model, year) VALUES ('${VEH}', 'Toyota', 'Camry', 2022);
    INSERT INTO public.rentals (id, driver_id, application_id, vehicle_id, status, weekly_rate, stripe_customer_id, stripe_payment_method_id)
      VALUES ('${RENTAL}', '${DRIVER}', '${APP}', '${VEH}', 'active', 325, 'cus_syn', 'pm_syn');`);

  const conf = join(out, "pgrst.conf");
  writeFileSync(conf, `db-uri = "postgresql://authenticator:harness-authenticator@127.0.0.1:55482/${DBNAME}?sslmode=disable"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${SECRET}"\nserver-host = "127.0.0.1"\nserver-port = 55484\ndb-pool = 10\n`);
  if (!existsSync(PGRST_BIN)) throw new Error(`PostgREST not found at ${PGRST_BIN}`);
  pgrst = spawn(PGRST_BIN, [conf], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    try { up = (await fetch(`${REST}/`)).status < 500; } catch {}
    if (!up) await sleep(250);
  }
  if (!up) throw new Error("local PostgREST did not start");

  const service = client(jwt({ role: "service_role" }));
  globalThis.__admin = {
    from: (t) => service.from(t),
    rpc: (...a) => service.rpc(...a),
    auth: { admin: { getUserById: async (id) => ({ data: { user: { email: `${id.slice(0, 8)}@test` } } }) } },
  };
  const ctx = (userId) => ({ userId, supabase: client(jwt({ role: "authenticated", sub: userId })) });

  const bundle = async (entry, name) => {
    await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: join(out, name), alias: { "@": resolve("src") }, plugins: [stubPlugin], logLevel: "error" });
    return import(join(out, name));
  };
  const pay = await bundle("src/lib/rental-payments.functions.ts", "pay.mjs");
  const rel = await bundle("src/lib/payment-unconfirmed.functions.ts", "rel.mjs");
  const hook = await bundle("src/routes/api/public/payments/webhook.ts", "hook.mjs");

  const rows = () => JSON.parse(psql(`SELECT coalesce(json_agg(json_build_object('id', id, 'status', status, 'attempt', attempt_count, 'amount', amount) ORDER BY created_at, id), '[]') FROM public.payments WHERE rental_id = '${RENTAL}'`));
  const reset = (status = "failed", attempt = 1) => {
    psql(`SET session_replication_role = replica; DELETE FROM public.payments WHERE rental_id = '${RENTAL}'; DELETE FROM public.audit_log WHERE entity_type = 'payment';
      INSERT INTO public.payments (id, rental_id, driver_id, vehicle_id, amount, balance_due, type, reason, status, due_date, attempt_count, last_attempt_at)
      VALUES ('${randomUUID()}', '${RENTAL}', '${APP}', '${VEH}', 325, 325, 'rent', 'rent', '${status}', current_date, ${attempt}, now() - interval '1 day');`);
    return rows()[0].id;
  };
  const payNow = () => pay.payRentalBalance({ data: { rentalId: RENTAL, amountCents: 32500, environment: "live" }, context: ctx(DRIVER) });
  const chargeCard = (extra = {}) => pay.chargeCardOnRental({ data: { rentalId: RENTAL, amountCents: 32500, reason: "rent", environment: "live", ...extra }, context: ctx(OWNER) });
  const webhook = (type, pi) => hook.postVerifiedPaymentWebhook({ type, data: { object: pi } }, globalThis.__admin, "live");

  await test("10 concurrent Pay Now presses on one failed charge: exactly one Stripe charge; the row ends Paid", async () => {
    const stripe = (globalThis.__stripe = fakeStripe());
    stripe.setPlan(() => ({ delay: 300, outcome: "succeeded" }));
    const id = reset("failed", 1);
    const res = await Promise.all(Array.from({ length: 10 }, payNow));
    const keys = new Set(stripe.calls.map((c) => c.key));
    assert.equal(stripe.calls.length, 1, `Stripe calls: ${stripe.calls.length}, distinct idempotency keys: ${keys.size}, charges created: ${stripe.intents.length}`);
    assert.equal(res.filter((r) => r.ok).length, 1);
    assert.deepEqual(rows().map((r) => [r.id, r.status, r.attempt]), [[id, "paid", 2]]);
  });

  await test("Pay Now presses racing triple-clicked Owner Charge Cards on the same rental (10 rounds): never two charges in flight; leftover new charges are voided and audited, not owed", async () => {
    let chargeCardsReachedCollection = 0;
    for (let round = 0; round < 10; round++) {
      const stripe = (globalThis.__stripe = fakeStripe());
      stripe.setPlan(() => ({ delay: 150, outcome: "succeeded" }));
      reset("failed", 1);
      const id = rows()[0].id;
      // A separate toll charge triple-clicked, and the Owner retrying the same rent row, racing Pay Now.
      const toll = () => chargeCard({ reason: "toll", amountCents: 1500 });
      const res = await Promise.all([payNow(), toll(), payNow(), toll(), chargeCard({ paymentId: id }), toll(), payNow(), payNow()]);
      const cc = [res[1], res[3], res[4], res[5]];
      assert.ok(cc.every((r) => !/Forbidden/.test(r.error ?? "")), "Charge Card must pass the Owner check");
      chargeCardsReachedCollection += cc.filter((r) => r.ok || /already in progress|picked up this new charge|still Processing/.test(r.error ?? "")).length;
      assert.ok(stripe.calls.length <= 1, `round ${round}: Stripe calls ${stripe.calls.length}`);
      const after = rows();
      assert.equal(after.filter((r) => r.status === "current" || r.status === "pending").length, 0, JSON.stringify(after));
      const voided = after.filter((r) => r.status === "void").length;
      assert.equal(Number(psql("SELECT count(*) FROM public.audit_log WHERE action = 'payment.void' AND entity_type = 'payment'")), voided);
      assert.equal(after.filter((r) => r.status === "paid").length, stripe.calls.length);
    }
    assert.ok(chargeCardsReachedCollection > 0, "no Charge Card request reached collection");
  });

  await test("a timeout after Stripe actually charged: the row stays Processing; concurrent Pay Now and Charge Card are all refused; the delayed webhook settles it Paid; nothing charged twice", async () => {
    const stripe = (globalThis.__stripe = fakeStripe());
    stripe.setPlan(() => ({ delay: 50, outcome: "charged_then_timeout" }));
    const id = reset("failed", 1);
    const first = await payNow();
    assert.match(first.error, /could not confirm your payment/);
    assert.deepEqual(rows().map((r) => r.status), ["pending"]);
    stripe.setPlan(() => ({ delay: 0, outcome: "succeeded" }));
    const again = await Promise.all([payNow(), payNow(), payNow(), chargeCard(), chargeCard({ paymentId: id })]);
    assert.ok(again.every((r) => "error" in r), JSON.stringify(again));
    assert.equal(stripe.calls.length, 1, "no second Stripe request");
    assert.equal(rows().length, 1, "no new charge rows");
    // The webhook arrives late (Stripe retries deliveries), twice.
    const pi = stripe.intents[0];
    for (let i = 0; i < 2; i++) assert.equal((await webhook("payment_intent.succeeded", pi)).status, 200);
    assert.deepEqual(rows().map((r) => [r.status, r.attempt]), [["paid", 2]]);
    assert.match((await payNow()).error, /Nothing is owed/);
    assert.equal(stripe.calls.length, 1);
  });

  await test("a request that never reached Stripe: stays Processing until the Owner's Stripe-verified release; then one new attempt is allowed", async () => {
    const stripe = (globalThis.__stripe = fakeStripe());
    stripe.setPlan(() => ({ delay: 0, outcome: "lost" }));
    const id = reset("failed", 1);
    await payNow();
    assert.deepEqual(rows().map((r) => r.status), ["pending"]);
    const relArgs = (who) => ({ data: { paymentId: id, reason: "timed out, never settled" }, context: { userId: who } });
    assert.match((await rel.releaseUnconfirmedPayment(relArgs(MANAGER))).error, /Only the Owner/);
    assert.match((await rel.releaseUnconfirmedPayment(relArgs(OWNER))).error, /Wait until/);
    psql(`UPDATE public.payments SET last_attempt_at = now() - interval '11 minutes' WHERE id = '${id}'`);
    const ok = await rel.releaseUnconfirmedPayment(relArgs(OWNER));
    assert.ok(ok.ok, JSON.stringify(ok));
    assert.deepEqual(rows().map((r) => [r.status, r.attempt]), [["failed", 2]]);
    const audit = JSON.parse(psql(`SELECT json_build_object('a', actor_user_id, 'm', metadata) FROM public.audit_log WHERE action = 'payment.unconfirmed_released' AND entity_id = '${id}'`));
    assert.equal(audit.a, OWNER);
    assert.deepEqual(audit.m.accounts_checked, ["live", "sandbox"]);
    assert.deepEqual(audit.m.matching_intents, []);
    stripe.setPlan(() => ({ delay: 0, outcome: "succeeded" }));
    assert.ok((await payNow()).ok);
    assert.deepEqual(rows().map((r) => [r.status, r.attempt]), [["paid", 3]]);
    assert.equal(stripe.calls.length, 2);
    assert.notEqual(stripe.calls[0].key, stripe.calls[1].key);
  });

  await test("the Owner release refuses while Stripe shows the charge collected or still processing, and when Stripe can't be reached", async () => {
    for (const outcome of ["charged_then_timeout", "processing"]) {
      const stripe = (globalThis.__stripe = fakeStripe());
      stripe.setPlan(() => ({ delay: 0, outcome }));
      const id = reset("failed", 1);
      await payNow();
      psql(`UPDATE public.payments SET last_attempt_at = now() - interval '11 minutes' WHERE id = '${id}'`);
      // The rental's Stripe customer changes after the attempt (new card set up): still found.
      psql(`SET session_replication_role = replica; UPDATE public.rentals SET stripe_customer_id = 'cus_new' WHERE id = '${RENTAL}'`);
      const res = await rel.releaseUnconfirmedPayment({ data: { paymentId: id, reason: "check" }, context: { userId: OWNER } });
      assert.match(res.error, outcome === "processing" ? /still processing/ : /Stripe collected this charge/, outcome);
      assert.deepEqual(rows().map((r) => r.status), ["pending"], outcome);
      psql(`SET session_replication_role = replica; UPDATE public.rentals SET stripe_customer_id = 'cus_syn' WHERE id = '${RENTAL}'`);
    }
    const stripe = (globalThis.__stripe = fakeStripe());
    stripe.setPlan(() => ({ delay: 0, outcome: "lost" }));
    const id = reset("failed", 1);
    await payNow();
    psql(`UPDATE public.payments SET last_attempt_at = now() - interval '11 minutes' WHERE id = '${id}'`);
    stripe.paymentIntents.list = async () => { throw new Error("network down"); };
    assert.match((await rel.releaseUnconfirmedPayment({ data: { paymentId: id, reason: "check" }, context: { userId: OWNER } })).error, /Could not reach Stripe/);
    assert.deepEqual(rows().map((r) => r.status), ["pending"]);
  });

  await test("the Owner release writes its audit row first: if that fails, nothing is released (row stays Processing)", async () => {
    const stripe = (globalThis.__stripe = fakeStripe());
    stripe.setPlan(() => ({ delay: 0, outcome: "lost" }));
    const id = reset("failed", 1);
    await payNow();
    psql(`UPDATE public.payments SET last_attempt_at = now() - interval '11 minutes' WHERE id = '${id}'`);
    psql("REVOKE INSERT ON public.audit_log FROM service_role");
    try {
      const res = await rel.releaseUnconfirmedPayment({ data: { paymentId: id, reason: "check" }, context: { userId: OWNER } });
      assert.match(res.error, /Could not record the release in the audit log\. Nothing was changed\./);
    } finally {
      psql("GRANT INSERT ON public.audit_log TO service_role");
    }
    assert.deepEqual(rows().map((r) => r.status), ["pending"]);
  });

  await test("a duplicate, delayed failure webhook for an earlier attempt never fails the newer attempt in flight (no third charge)", async () => {
    const stripe = (globalThis.__stripe = fakeStripe());
    stripe.setPlan(() => ({ delay: 0, outcome: "decline" }));
    reset("failed", 1);
    await payNow();
    const declined = stripe.intents[0];
    assert.equal((await webhook("payment_intent.payment_failed", { ...declined, last_payment_error: { message: "Your card was declined." } })).status, 200);
    assert.deepEqual(rows().map((r) => [r.status, r.attempt]), [["failed", 2]]);
    stripe.setPlan(() => ({ delay: 400, outcome: "succeeded" }));
    const inFlight = payNow();
    await sleep(100);
    assert.deepEqual(rows().map((r) => [r.status, r.attempt]), [["pending", 3]]);
    // Stripe re-delivers attempt 2's failure while attempt 3 is in flight.
    await webhook("payment_intent.payment_failed", { ...declined, last_payment_error: { message: "Your card was declined." } });
    assert.deepEqual(rows().map((r) => r.status), ["pending"], "the late failure must not touch attempt 3");
    assert.match((await payNow()).error, /still being confirmed/);
    assert.ok((await inFlight).ok);
    assert.deepEqual(rows().map((r) => [r.status, r.attempt]), [["paid", 3]]);
    assert.equal(stripe.calls.length, 2);
  });

  await test("a fast webhook that settles the charge before the request returns is not overwritten", async () => {
    const stripe = (globalThis.__stripe = fakeStripe());
    const id = reset("failed", 1);
    stripe.setPlan(() => ({ delay: 300, outcome: "processing" }));
    const p = payNow();
    await sleep(100);
    // Stripe finishes and its webhook lands before our own post-create update.
    await webhook("payment_intent.succeeded", { id: "pi_1", amount: 32500, status: "succeeded", metadata: { rentalId: RENTAL, reason: "rent", paymentIds: id, attempt: "2" } });
    await p;
    assert.deepEqual(rows().map((r) => r.status), ["paid"]);
  });

  await test("a definite decline is Failed (still owed) and allows exactly one retry, with a new idempotency key", async () => {
    const stripe = (globalThis.__stripe = fakeStripe());
    stripe.setPlan(() => ({ delay: 0, outcome: "decline" }));
    reset("failed", 1);
    const r1 = await payNow();
    assert.match(r1.error, /declined/);
    assert.deepEqual(rows().map((r) => r.status), ["failed"]);
    stripe.setPlan(() => ({ delay: 200, outcome: "succeeded" }));
    const res = await Promise.all([payNow(), payNow(), payNow()]);
    assert.equal(res.filter((r) => r.ok).length, 1);
    assert.equal(stripe.calls.length, 2);
    assert.notEqual(stripe.calls[0].key, stripe.calls[1].key);
  });

  await test("a legacy pending row that never had an attempt (no attempt time) blocks new attempts until the Owner's Stripe check releases it (created_at fallback)", async () => {
    const stripe = (globalThis.__stripe = fakeStripe());
    const id = reset("pending", 0);
    psql(`UPDATE public.payments SET last_attempt_at = NULL, created_at = now() WHERE id = '${id}'`);
    assert.match((await payNow()).error, /still being confirmed/);
    assert.match((await rel.releaseUnconfirmedPayment({ data: { paymentId: id, reason: "old rebill row" }, context: { userId: OWNER } })).error, /Wait until/);
    psql(`UPDATE public.payments SET created_at = now() - interval '11 minutes' WHERE id = '${id}'`);
    assert.ok((await rel.releaseUnconfirmedPayment({ data: { paymentId: id, reason: "old rebill row" }, context: { userId: OWNER } })).ok);
    stripe.setPlan(() => ({ delay: 0, outcome: "succeeded" }));
    assert.ok((await payNow()).ok);
    assert.equal(stripe.calls.length, 1);
  });

  await test("the late-fee cron never touches a Processing charge (it can't reopen it as owed), and still charges an owed one", async () => {
    const fees = await bundle("src/lib/late-fees.server.ts", "fees.mjs");
    globalThis.__stripe = fakeStripe();
    const pend = reset("failed", 1);
    psql(`SET session_replication_role = replica; UPDATE public.payments SET status = 'pending', attempt_count = 2, last_attempt_at = now(), due_date = current_date - 10 WHERE id = '${pend}';
      INSERT INTO public.payments (rental_id, driver_id, amount, balance_due, type, status, due_date) VALUES ('${RENTAL}', '${APP}', 100, 100, 'toll', 'failed', current_date - 10);
      INSERT INTO public.app_settings (key, value) VALUES ('late_fee_policy', '{"enabled": true, "grace_days": 0, "flat_fee": 50, "daily_fee": 0, "max_fee": 50}') ON CONFLICT (key) DO UPDATE SET value = excluded.value;`);
    try {
      await fees.applyLateFees();
    } finally {
      psql("DELETE FROM public.app_settings WHERE key = 'late_fee_policy'");
    }
    const after = JSON.parse(psql(`SELECT json_agg(json_build_object('id', id, 's', status, 'b', balance_due) ORDER BY amount DESC) FROM public.payments WHERE rental_id = '${RENTAL}'`));
    assert.deepEqual([after[0].s, Number(after[0].b)], ["pending", 325], "the Processing charge is untouched");
    assert.deepEqual([after[1].s, Number(after[1].b)], ["overdue", 150], "the owed charge gets its late fee");
  });
} finally {
  if (pgrst) pgrst.kill();
  rmSync(out, { recursive: true, force: true });
  try { execFileSync("psql", [ADMIN, "-qAtX", "-c", `DROP DATABASE IF EXISTS ${DBNAME} WITH (FORCE)`]); } catch {}
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
