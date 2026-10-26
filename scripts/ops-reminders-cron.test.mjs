/**
 * Daily ops-reminders cron: who is emailed (unchanged), and the new protections:
 * claim-before-send, release rules, the 10-per-run and 10-per-24h driver cap, digests at
 * most once a day, fail-closed reads, and a report that separates outcomes.
 *
 * The route itself runs (bearer check included) against an in-memory database that
 * evaluates the PostgREST filters it is given; the senders are fakes. No network, no
 * database, no email provider.
 *
 * Eligibility parity: the route as released (a3df8545, frozen byte for byte in
 * scripts/fixtures/ops-reminders.route.before.ts.txt, sha256 asserted) and this route run
 * on the same rows; the people emailed, the email arguments and the log rows must match.
 *
 * OPS_ROUTE=before runs every check against the released route instead, to show which
 * protections it lacks (those checks fail there; the process exits 1).
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const BEFORE_FIXTURE = "scripts/fixtures/ops-reminders.route.before.ts.txt";
const BEFORE_SHA = "be7cb06af0ba6c6272f2bda8483432f6c07ffd2ea1c1405047686f297642f016";
const TARGET = process.env.OPS_ROUTE === "before" ? "before" : "after";
assert.equal(createHash("sha256").update(readFileSync(BEFORE_FIXTURE)).digest("hex"), BEFORE_SHA, "released-route fixture changed");

const out = mkdtempSync(join(tmpdir(), "rr-ops-reminders-"));
const stubs = {
  "@tanstack/react-router": "export const createFileRoute = () => (options) => ({ options });",
  "@/integrations/supabase/client.server":
    "export const supabaseAdmin = new Proxy({}, { get: (_, k) => globalThis.__ops.admin[k] });",
  "@/lib/email.server": `
    const s = () => globalThis.__ops.senders;
    export const sendEmail = (a) => s().sendEmail(a);
    export const sendPastDueReminderEmail = (a) => s().sendPastDueReminderEmail(a);
    export const sendLicenseExpiringEmail = (a) => s().sendLicenseExpiringEmail(a);
    export const sendServiceDigestEmail = (a) => s().sendServiceDigestEmail(a);`,
};
const boundary = {
  name: "boundaries",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => (stubs[a.path] ? { path: a.path, namespace: "fixture" } : undefined));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: stubs[a.path], loader: "js" }));
  },
};
async function bundle(entry, name) {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(out, name),
    alias: { "@": resolve("src") },
    loader: { ".txt": "ts" },
    logLevel: "silent",
    plugins: [boundary],
  });
  return import(pathToFileURL(join(out, name)).href);
}
globalThis.__ops = { admin: null, senders: null };
const beforeRoute = (await bundle(BEFORE_FIXTURE, "before.mjs")).Route;
const afterRoute = (await bundle("src/routes/api/public/cron/ops-reminders.ts", "after.mjs")).Route;
const lib = await bundle("src/lib/ops-reminders.server.ts", "lib.mjs");
const route = TARGET === "before" ? beforeRoute : afterRoute;

const DAY = 86400000;
const now = () => Date.now();
const iso = (ms) => new Date(ms).toISOString();
const dateOnly = (ms) => iso(ms).slice(0, 10);
const daysFromNow = (d) => dateOnly(now() + d * DAY);
const daysAgoIso = (d) => iso(now() - d * DAY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ fake db
let idSeq = 0;
const nextId = (p) => `${p}-${String(++idSeq).padStart(6, "0")}`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** In-memory PostgREST: filters use SQL semantics (NULL never matches a comparison). */
function createDb(tables, { jitter = 0, failOn = () => null } = {}) {
  const t = (name) => (tables[name] ??= []);
  const from = (table) => {
    const st = { op: "select", values: null, filters: [], calls: [], limit: null, one: null, head: false, count: false, returning: false };
    const f = (name, args, pred) => {
      st.calls.push([name, ...args]);
      if (pred) st.filters.push(pred);
      return q;
    };
    const run = async () => {
      if (jitter) await sleep(Math.random() * jitter);
      const injected = failOn({ table, ...st });
      if (injected) return { data: null, count: null, error: injected };
      const rows = t(table);
      let result;
      if (st.op === "insert") {
        const list = (Array.isArray(st.values) ? st.values : [st.values]).map((v) => ({
          id: nextId(table),
          created_at: iso(Date.now()),
          ...v,
        }));
        for (const r of list) {
          if (table === "outbound_messages") {
            assert.ok(["queued", "sent", "failed", "skipped"].includes(r.status ?? "queued"), `bad status ${r.status}`);
            assert.ok(r.body != null && r.to_address != null, "outbound_messages NOT NULL");
            r.status ??= "queued";
          }
          rows.push(r);
        }
        result = list;
      } else {
        let matched = rows.filter((r) => st.filters.every((p) => p(r)));
        if (st.op === "update") for (const r of matched) Object.assign(r, st.values);
        if (st.op === "delete") tables[table] = rows.filter((r) => !matched.includes(r));
        if (st.limit != null) matched = matched.slice(0, st.limit);
        result = matched;
      }
      const data = result.map((r) => ({ ...r }));
      if (jitter) await sleep(Math.random() * jitter);
      if (st.head) return { data: null, count: data.length, error: null };
      if (st.op !== "select" && !st.returning) return { data: null, error: null };
      if (st.one === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "not single" } };
      if (st.one === "maybe") return { data: data[0] ?? null, error: null };
      return { data, count: st.count ? data.length : null, error: null };
    };
    const val = (r, k) => (r[k] === undefined ? null : r[k]);
    const q = {
      select: (cols, opts) => {
        if (st.op !== "select") st.returning = true;
        if (opts?.head) st.head = true;
        if (opts?.count) st.count = true;
        return f("select", [cols, opts]);
      },
      insert: (v) => ((st.op = "insert"), (st.values = v), q),
      update: (v) => ((st.op = "update"), (st.values = v), q),
      delete: () => ((st.op = "delete"), q),
      eq: (k, v) => f("eq", [k, v], (r) => val(r, k) !== null && val(r, k) === v),
      neq: (k, v) => f("neq", [k, v], (r) => val(r, k) !== null && val(r, k) !== v),
      lt: (k, v) => f("lt", [k, v], (r) => val(r, k) !== null && cmp(val(r, k), v) < 0),
      lte: (k, v) => f("lte", [k, v], (r) => val(r, k) !== null && cmp(val(r, k), v) <= 0),
      gt: (k, v) => f("gt", [k, v], (r) => val(r, k) !== null && cmp(val(r, k), v) > 0),
      gte: (k, v) => f("gte", [k, v], (r) => val(r, k) !== null && cmp(val(r, k), v) >= 0),
      in: (k, v) => f("in", [k, v], (r) => val(r, k) !== null && v.includes(val(r, k))),
      is: (k, v) => f("is", [k, v], (r) => val(r, k) === v),
      not: (k, op, v) => {
        assert.ok(op === "is" && v === null, `unsupported not ${op}`);
        return f("not", [k, op, v], (r) => val(r, k) !== null);
      },
      limit: (n) => ((st.limit = n), q),
      maybeSingle: () => ((st.one = "maybe"), q),
      single: () => ((st.one = "single"), q),
      then: (ok, fail) => run().then(ok, fail),
    };
    return q;
  };
  return {
    tables,
    from,
    rpc: async (name, args) => {
      assert.equal(name, "get_cron_token");
      assert.equal(args._name, "ops-reminders");
      return { data: "tok-ops", error: null };
    },
  };
}

/** Fake senders. `result(kind, args)` decides each outcome; every call is recorded. */
function createSenders({ result = () => ({ ok: true, id: "re_fixture" }), delay = 0, onSend = () => {} } = {}) {
  const sent = [];
  const make = (kind) => async (args) => {
    onSend(kind, args);
    if (delay) await sleep(Math.random() * delay);
    const r = typeof result === "function" ? result(kind, args) : result;
    if (r instanceof Error) throw r;
    sent.push({ kind, ...args });
    return r;
  };
  return {
    sent,
    senders: {
      sendEmail: make("agreement"),
      sendPastDueReminderEmail: make("past_due"),
      sendLicenseExpiringEmail: make("license"),
      sendServiceDigestEmail: make("digest"),
    },
  };
}

async function callRoute(r, db, senders, token = "tok-ops") {
  globalThis.__ops.admin = db;
  globalThis.__ops.senders = senders;
  const res = await r.options.server.handlers.GET({
    request: new Request("https://drivereal.com/api/public/cron/ops-reminders", { headers: { authorization: `Bearer ${token}` } }),
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
}
/** Several overlapping invocations share one database but each has its own senders, as separate workers would. */
async function overlapping(r, db, sendersList) {
  globalThis.__ops.admin = db;
  // Each invocation reads its senders when it calls them; route them by an async-local tag.
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const als = new AsyncLocalStorage();
  globalThis.__ops.senders = new Proxy({}, { get: (_, k) => als.getStore()[k] });
  return Promise.all(
    sendersList.map((s) =>
      als.run(s, async () => {
        const res = await r.options.server.handlers.GET({
          request: new Request("https://drivereal.com/api/public/cron/ops-reminders", { headers: { authorization: "Bearer tok-ops" } }),
        });
        return res.json();
      }),
    ),
  );
}

// ------------------------------------------------------------------ fixtures
const app = (id, o = {}) => ({ id, full_name: `Driver ${id}`, email: `${id}@example.invalid`, user_id: null, status: "approved", license_expiration: null, ...o });
const pay = (driver_id, o = {}) => ({ id: nextId("pay"), driver_id, amount: 100, balance_due: null, due_date: daysFromNow(-5), status: "pending", ...o });
const sentLog = (application_id, kind, daysAgo) => ({
  id: nextId("om"), channel: "email", to_address: "x@example.invalid", body: "old", status: "sent", kind, application_id, created_at: daysAgoIso(daysAgo),
});

/** One row per eligibility edge in every category. */
function parityTables() {
  return {
    applications: [
      app("pd-1", { user_id: "user-pd-1" }),
      app("pd-backlog"),
      app("pd-zero"),
      app("pd-today"),
      app("pd-paid"),
      app("pd-recent"),
      app("pd-no-email", { email: null }),
      app("pd-week-ago"),
      app("lic-soon", { license_expiration: daysFromNow(10), user_id: "user-lic" }),
      app("lic-expired-long-ago", { status: "active", license_expiration: daysFromNow(-300) }),
      app("lic-pending-status", { status: "pending", license_expiration: daysFromNow(10) }),
      app("lic-far", { license_expiration: daysFromNow(45) }),
      app("lic-edge-30", { license_expiration: daysFromNow(30) }),
      app("lic-no-email", { email: "", license_expiration: daysFromNow(5) }),
      app("lic-recent", { license_expiration: daysFromNow(5) }),
      app("lic-7days", { license_expiration: daysFromNow(5) }),
      app("ag-1", { status: "new" }),
      app("ag-2", { status: "new", email: "ag-2-app@example.invalid" }),
      app("ag-twice", { status: "new" }),
      app("ag-recent", { status: "new" }),
      app("ag-young", { status: "new" }),
      app("ag-expired", { status: "new" }),
      app("ag-signed", { status: "new" }),
      app("doc-driver", { status: "active" }),
    ],
    payments: [
      pay("pd-1", { amount: 100, due_date: daysFromNow(-5) }),
      pay("pd-1", { amount: 999, balance_due: 50, status: "late", due_date: daysFromNow(-10) }),
      pay("pd-backlog", { status: "overdue", due_date: daysFromNow(-400) }),
      pay("pd-zero", { status: "failed", amount: 0, balance_due: 0 }),
      pay("pd-today", { due_date: daysFromNow(0) }),
      pay("pd-paid", { status: "paid" }),
      pay(null, { status: "pending" }),
      pay("pd-recent", { status: "unpaid" }),
      pay("pd-no-email", { status: "past_due" }),
      pay("pd-week-ago", { status: "late" }),
    ],
    agreements: [
      { id: "g1", title: "A", application_id: "ag-1", signer_email: "ag-1-signer@example.invalid", sent_at: daysAgoIso(5), status: "sent", token_expires_at: iso(now() + 10 * DAY) },
      { id: "g2", title: "A", application_id: "ag-2", signer_email: null, sent_at: daysAgoIso(4), status: "viewed", token_expires_at: iso(now() + 3 * DAY) },
      { id: "g3a", title: "A", application_id: "ag-twice", signer_email: null, sent_at: daysAgoIso(6), status: "sent", token_expires_at: iso(now() + 3 * DAY) },
      { id: "g3b", title: "B", application_id: "ag-twice", signer_email: null, sent_at: daysAgoIso(5), status: "sent", token_expires_at: iso(now() + 3 * DAY) },
      { id: "g4", title: "A", application_id: "ag-recent", signer_email: null, sent_at: daysAgoIso(5), status: "sent", token_expires_at: iso(now() + 3 * DAY) },
      { id: "g5", title: "A", application_id: "ag-young", signer_email: null, sent_at: daysAgoIso(2), status: "sent", token_expires_at: iso(now() + 3 * DAY) },
      { id: "g6", title: "A", application_id: "ag-expired", signer_email: null, sent_at: daysAgoIso(9), status: "sent", token_expires_at: iso(now() - DAY) },
      { id: "g7", title: "A", application_id: "ag-signed", signer_email: null, sent_at: daysAgoIso(9), status: "signed", token_expires_at: iso(now() + DAY) },
    ],
    vehicles: [
      { id: "v1", year: 2020, make: "Toyota", model: "Camry", current_odometer: 50000, last_oil_change_miles: 44000, oil_interval_miles: 5000, last_tire_date: null, last_brake_inspection_date: null, status: "available" },
      { id: "v2", year: 2019, make: "Honda", model: "Civic", current_odometer: 90000, last_oil_change_miles: 10000, oil_interval_miles: 5000, last_tire_date: null, last_brake_inspection_date: null, status: "retired" },
      { id: "v3", year: 2021, make: "Kia", model: "K5", current_odometer: null, last_oil_change_miles: null, oil_interval_miles: null, last_tire_date: daysFromNow(-250), last_brake_inspection_date: daysFromNow(-400), status: "rented" },
      { id: "v4", year: 2022, make: "Ford", model: "Escape", current_odometer: 1000, last_oil_change_miles: 900, oil_interval_miles: 5000, last_tire_date: daysFromNow(-10), last_brake_inspection_date: null, status: "available" },
    ],
    documents: [
      { id: "d1", category: "insurance_card", label: null, expires_at: daysFromNow(10), driver_id: "doc-driver", is_current: true },
      { id: "d2", category: "licence", label: "Driver_License", expires_at: daysFromNow(5), driver_id: "doc-driver", is_current: false },
      { id: "d3", category: "registration", label: null, expires_at: daysFromNow(60), driver_id: "doc-driver", is_current: true },
    ],
    outbound_messages: [
      sentLog("pd-recent", "past_due", 2),
      sentLog("pd-week-ago", "past_due", 7),
      sentLog("lic-recent", "license_expiring", 5),
      sentLog("lic-7days", "license_expiring", 7),
      sentLog("ag-recent", "agreement_reminder", 1),
    ],
    notifications: [],
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

/** A comparable view of what one run sent and logged. */
function summary(sent, tables) {
  const emails = sent.map((s) => {
    const { kind, ...args } = s;
    if (kind === "agreement") {
      const { track, ...rest } = args; // the released route sent agreement reminders untracked
      return `agreement|${JSON.stringify(rest)}`;
    }
    return `${kind}|${JSON.stringify(args)}`;
  }).sort();
  const driverLog = tables.outbound_messages
    .filter((r) => r.body !== "old" && lib.DRIVER_REMINDER_KINDS.includes(r.kind))
    .map((r) => `${r.kind}|${r.application_id}|${r.to_address}|${r.subject}|${r.body}|${r.status}|${r.channel}|${r.provider}`)
    .sort();
  const notes = tables.notifications.map((n) => `${n.driver_id}|${n.kind}|${n.title}|${n.body}|${n.channels}`).sort();
  return { emails, driverLog, notes };
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("PASS", name);
  } catch (err) {
    results.push({ name, ok: false });
    console.log("FAIL", name, "-", String(err?.message ?? err).split("\n")[0]);
  }
}

// ------------------------------------------------------------------ parity
await check("eligibility parity: the released route and this route email the same people with the same arguments and log the same rows", async () => {
  const base = parityTables();
  const a = createSenders();
  const ta = clone(base);
  await callRoute(beforeRoute, createDb(ta), a.senders);
  const b = createSenders();
  const tb = clone(base);
  const rb = await callRoute(route, createDb(tb), b.senders);
  assert.equal(rb.status, 200);
  const sa = summary(a.sent, ta);
  const sb = summary(b.sent, tb);
  assert.deepEqual(sb.emails, sa.emails);
  assert.deepEqual(sb.driverLog, sa.driverLog);
  assert.deepEqual(sb.notes, sa.notes);
  // The expected set, spelled out, so parity cannot pass by both being empty.
  const people = sa.emails.map((e) => e.split("|")[0] + ":" + (JSON.parse(e.slice(e.indexOf("|") + 1)).to ?? "")).sort();
  assert.deepEqual(people, [
    "agreement:ag-1-signer@example.invalid",
    "agreement:ag-2-app@example.invalid",
    "agreement:ag-twice@example.invalid",
    "digest:team@drivereal.com",
    "digest:team@drivereal.com",
    "license:lic-7days@example.invalid",
    "license:lic-edge-30@example.invalid",
    "license:lic-expired-long-ago@example.invalid",
    "license:lic-soon@example.invalid",
    "past_due:pd-1@example.invalid",
    "past_due:pd-backlog@example.invalid",
    "past_due:pd-week-ago@example.invalid",
  ]);
  const pd1 = a.sent.find((s) => s.to === "pd-1@example.invalid");
  assert.equal(pd1.amount, 150, "balance_due wins over amount; amounts sum per driver");
  assert.equal(pd1.dueDate, daysFromNow(-10), "earliest due date");
  const svc = a.sent.find((s) => s.kind === "digest" && s.items.some((i) => /Oil/.test(i.reason)));
  assert.deepEqual(svc.items.map((i) => i.vehicle), ["2020 Toyota Camry", "2021 Kia K5"]);
  const docs = a.sent.find((s) => s.kind === "digest" && s.items.some((i) => /expires/.test(i.reason)));
  assert.deepEqual(docs.items, [{ vehicle: "Driver doc-driver", reason: `insurance card expires ${daysFromNow(10)}` }]);
});

await check("parity holds at the cap boundary too: exactly 10 eligible drivers are all emailed by both routes", async () => {
  const tables = { applications: [], payments: [], agreements: [], vehicles: [], documents: [], outbound_messages: [], notifications: [] };
  for (let i = 0; i < 10; i++) {
    tables.applications.push(app(`b-${i}`));
    tables.payments.push(pay(`b-${i}`));
  }
  const a = createSenders();
  const ta = clone(tables);
  await callRoute(beforeRoute, createDb(ta), a.senders);
  const b = createSenders();
  const tb = clone(tables);
  await callRoute(route, createDb(tb), b.senders);
  assert.equal(a.sent.length, 10);
  assert.deepEqual(summary(b.sent, tb).emails, summary(a.sent, ta).emails);
});

await check("the route keeps its bearer check (401 without the token, nothing read or sent)", async () => {
  const s = createSenders();
  const r = await callRoute(route, createDb(parityTables()), s.senders, "wrong");
  assert.equal(r.status, 401);
  assert.equal(s.sent.length, 0);
});

// --------------------------------------------------------- claim before send
function manyDrivers(n, prefix = "m") {
  const tables = { applications: [], payments: [], agreements: [], vehicles: [], documents: [], outbound_messages: [], notifications: [] };
  for (let i = 0; i < n; i++) {
    const id = `${prefix}-${String(i).padStart(2, "0")}`;
    tables.applications.push(app(id));
    tables.payments.push(pay(id));
  }
  return tables;
}

await check("claim before send: the dedupe row exists before each driver email goes out", async () => {
  const tables = parityTables();
  const db = createDb(tables);
  const missing = [];
  const s = createSenders({
    onSend: (kind, args) => {
      if (kind === "digest") return;
      const k = { past_due: "past_due", license: "license_expiring", agreement: "agreement_reminder" }[kind];
      const appId = tables.applications.find((a) => a.email === args.to)?.id ?? tables.agreements.find((g) => g.signer_email === args.to)?.application_id;
      if (!tables.outbound_messages.some((r) => r.kind === k && r.application_id === appId && r.body !== "old")) missing.push(`${k}:${appId}`);
    },
  });
  await callRoute(route, db, s.senders);
  assert.ok(s.sent.length >= 9);
  assert.deepEqual(missing, [], `sent before any claim existed: ${missing}`);
});

await check("two overlapping runs email each driver at most once", async () => {
  const tables = manyDrivers(6, "o");
  const db = createDb(tables, { jitter: 2 });
  const a = createSenders({ delay: 5 });
  const b = createSenders({ delay: 5 });
  await overlapping(route, db, [a.senders, b.senders]);
  const to = [...a.sent, ...b.sent].map((x) => x.to);
  assert.equal(new Set(to).size, to.length, `double send: ${to.sort()}`);
  const rows = tables.outbound_messages.filter((r) => r.kind === "past_due");
  assert.equal(rows.length, to.length, "one log row per email sent, no leftover claims");
});

await check("five overlapping runs on 30 drivers: never more than 10 emails, nobody twice, rows equal sends", async () => {
  for (let trial = 0; trial < 5; trial++) {
    const tables = manyDrivers(30, `t${trial}`);
    const db = createDb(tables, { jitter: 3 });
    const runs = Array.from({ length: 5 }, () => createSenders({ delay: 4 }));
    await overlapping(route, db, runs.map((r) => r.senders));
    const all = runs.flatMap((r) => r.sent).filter((x) => x.kind !== "digest");
    assert.ok(all.length <= 10, `trial ${trial}: ${all.length} sends`);
    assert.equal(new Set(all.map((x) => x.to)).size, all.length, "someone emailed twice");
    assert.equal(tables.outbound_messages.filter((r) => r.kind === "past_due").length, all.length, "claims left behind without a send");
  }
});

// ------------------------------------------------------------- release rules
await check("release rules: a refusal or a throw releases the claim (retried next run); an uncertain outcome keeps it", async () => {
  const tables = manyDrivers(3, "r");
  const db = createDb(tables);
  const s = createSenders({
    result: (kind, a) =>
      a.to.startsWith("r-00") ? { ok: false, error: "Resend rejected the send (422)" }
        : a.to.startsWith("r-01") ? new Error("render failed before reaching the provider")
          : { ok: false, uncertain: true, error: "timeout" },
  });
  const r = await callRoute(route, db, s.senders);
  const rows = (id) => tables.outbound_messages.filter((m) => m.application_id === id && m.kind === "past_due");
  assert.equal(rows("r-00").length, 0, "definite refusal must be released");
  assert.equal(rows("r-01").length, 0, "a throw must be released");
  assert.equal(rows("r-02").length, 1, "uncertain keeps the claim (at most once)");
  assert.match(rows("r-02")[0].error ?? "", /uncertain/);
  assert.equal(r.body.past_due.failed, 3);
  assert.equal(r.body.past_due.sent, 0);
  const again = createSenders();
  await callRoute(route, db, again.senders);
  assert.deepEqual(again.sent.filter((x) => x.kind === "past_due").map((x) => x.to).sort(), ["r-00@example.invalid", "r-01@example.invalid"]);
});

await check("a sent email marks its claim sent, with the provider id", async () => {
  const tables = manyDrivers(1, "ok");
  const s = createSenders({ result: () => ({ ok: true, id: "re_123" }) });
  await callRoute(route, createDb(tables), s.senders);
  const row = tables.outbound_messages.find((m) => m.kind === "past_due");
  assert.equal(row.status, "sent");
  assert.equal(row.provider_message_id, "re_123");
  assert.ok(row.sent_at);
});

// ------------------------------------------------------------------ the caps
await check("one run sends at most 10 driver emails; the rest are reported as capped and left unclaimed", async () => {
  const tables = manyDrivers(15, "c");
  const s = createSenders();
  const r = await callRoute(route, createDb(tables), s.senders);
  assert.equal(s.sent.filter((x) => x.kind !== "digest").length, 10);
  assert.equal(r.body.past_due.sent, 10);
  assert.equal(r.body.past_due.capped, 5);
  assert.equal(r.body.max_driver_emails_per_run, 10);
  assert.equal(tables.outbound_messages.filter((m) => m.kind === "past_due").length, 10, "capped drivers have no claim row");
});

await check("the cap is shared across kinds (past-due + licence + agreements together <= 10)", async () => {
  const tables = manyDrivers(6, "k");
  for (let i = 0; i < 6; i++) tables.applications.push(app(`kl-${i}`, { license_expiration: daysFromNow(3) }));
  for (let i = 0; i < 6; i++) {
    tables.applications.push(app(`ka-${i}`, { status: "new" }));
    tables.agreements.push({ id: `ka-g${i}`, application_id: `ka-${i}`, signer_email: null, sent_at: daysAgoIso(5), status: "sent", token_expires_at: iso(now() + DAY) });
  }
  const s = createSenders();
  const r = await callRoute(route, createDb(tables), s.senders);
  assert.equal(s.sent.filter((x) => x.kind !== "digest").length, 10);
  assert.equal(r.body.past_due.capped + r.body.license_expiring.capped + r.body.agreement_reminder.capped, 8);
});

await check("rolling 24h budget: a retry or second run within 24h sends nothing; after 24h the rest go out, once each", async () => {
  const tables = manyDrivers(15, "w");
  const db = createDb(tables);
  const first = createSenders();
  await callRoute(route, db, first.senders);
  const second = createSenders();
  const r2 = await callRoute(route, db, second.senders);
  assert.equal(second.sent.filter((x) => x.kind !== "digest").length, 0, "second run within 24h sent");
  assert.ok(r2.body.budget_reached);
  assert.equal(tables.outbound_messages.filter((m) => m.kind === "past_due").length, 10, "the budget check released its own claim");
  for (const m of tables.outbound_messages) m.created_at = iso(Date.now() - 25 * 3600 * 1000);
  const third = createSenders();
  await callRoute(route, db, third.senders);
  const drivers = (x) => x.sent.filter((y) => y.kind !== "digest").map((y) => y.to);
  assert.equal(drivers(third).length, 5);
  assert.equal(new Set([...drivers(first), ...drivers(third)]).size, 15, "nobody twice");
});

await check("team digests go out at most once per UTC day, across runs", async () => {
  const tables = parityTables();
  const db = createDb(tables);
  const a = createSenders();
  await callRoute(route, db, a.senders);
  const b = createSenders();
  const r2 = await callRoute(route, db, b.senders);
  assert.equal(a.sent.filter((x) => x.kind === "digest").length, 2);
  assert.equal(b.sent.filter((x) => x.kind === "digest").length, 0, "digest repeated the same day");
  assert.equal(r2.body.service_digest.skipped_today, 1);
  assert.equal(r2.body.documents_digest.skipped_today, 1);
  // Yesterday's digest rows do not block today's.
  for (const m of tables.outbound_messages) if (m.kind?.startsWith("ops_")) m.created_at = iso(Date.parse(`${dateOnly(now())}T00:00:00.000Z`) - 1000);
  const c = createSenders();
  await callRoute(route, db, c.senders);
  assert.equal(c.sent.filter((x) => x.kind === "digest").length, 2);
});

await check("overlapping runs send each digest once", async () => {
  const tables = parityTables();
  tables.payments = [];
  tables.agreements = [];
  for (const a of tables.applications) a.license_expiration = null;
  const db = createDb(tables, { jitter: 2 });
  const runs = Array.from({ length: 4 }, () => createSenders({ delay: 3 }));
  await overlapping(route, db, runs.map((r) => r.senders));
  const digests = runs.flatMap((r) => r.sent).filter((x) => x.kind === "digest");
  assert.ok(digests.length <= 2, `${digests.length} digests`);
});

// ------------------------------------------------------------ fail closed
await check("fail closed: an unreadable 24h count releases the claim unsent and stops driver emails", async () => {
  const tables = manyDrivers(3, "fc");
  const db = createDb(tables, { failOn: (st) => (st.table === "outbound_messages" && st.head ? { message: "count failed" } : null) });
  const s = createSenders();
  const r = await callRoute(route, db, s.senders);
  assert.equal(s.sent.filter((x) => x.kind !== "digest").length, 0);
  assert.equal(tables.outbound_messages.filter((m) => m.kind === "past_due").length, 0, "claim released");
  assert.ok(r.body.budget_reached);
});

await check("fail closed: an unreadable claim read-back (or spacing read) sends nothing", async () => {
  const tables = manyDrivers(2, "rb");
  let reads = 0;
  const db = createDb(tables, {
    failOn: (st) => (st.table === "outbound_messages" && st.op === "select" && !st.head && st.calls.some((c) => c[0] === "neq") && ++reads ? { message: "read-back failed" } : null),
  });
  const s = createSenders();
  const r = await callRoute(route, db, s.senders);
  assert.equal(s.sent.length, 0);
  assert.equal(tables.outbound_messages.length, 0, "claims released");
  assert.equal(r.body.past_due.failed, 2);
  const t2 = manyDrivers(2, "sp");
  const db2 = createDb(t2, { failOn: (st) => (st.table === "outbound_messages" && st.op === "select" && !st.head && !st.calls.some((c) => c[0] === "neq") ? { message: "spacing read failed" } : null) });
  const s2 = createSenders();
  await callRoute(route, db2, s2.senders);
  assert.equal(s2.sent.filter((x) => x.kind !== "digest").length, 0, "the released route treated an unreadable spacing log as 'not notified' and sent");
});

await check("a claim insert that fails means no email", async () => {
  const tables = manyDrivers(2, "ci");
  const db = createDb(tables, { failOn: (st) => (st.table === "outbound_messages" && st.op === "insert" ? { message: "insert failed" } : null) });
  const s = createSenders();
  await callRoute(route, db, s.senders);
  assert.equal(s.sent.length, 0);
});

// ------------------------------------------------------------------ report
await check("the report separates considered / sent / failed / capped per category", async () => {
  const s = createSenders();
  const r = await callRoute(route, createDb(parityTables()), s.senders);
  for (const k of ["past_due", "license_expiring", "agreement_reminder"]) {
    for (const f of ["considered", "sent", "failed", "capped", "skipped_recent", "skipped_claimed", "skipped_no_email"]) {
      assert.equal(typeof r.body[k][f], "number", `${k}.${f}`);
    }
  }
  assert.deepEqual(Object.keys(r.body).slice(0, 2), ["ok", "past_due"], "verify-after matches the report by its first keys");
  assert.equal(r.body.past_due.considered, 5);
  assert.equal(r.body.past_due.sent, 3);
  assert.equal(r.body.past_due.skipped_recent, 1);
  assert.equal(r.body.past_due.skipped_no_email, 1);
  assert.equal(r.body.license_expiring.sent, 4);
  assert.equal(r.body.agreement_reminder.sent, 3);
  assert.equal(r.body.agreement_reminder.skipped_recent + r.body.agreement_reminder.skipped_claimed, 2);
  assert.equal(r.body.service_digest.sent, 1);
  assert.equal(r.body.documents_digest.items, 1);
  assert.equal(r.body.past_due_sent, 3, "legacy field kept");
});

await check("agreement reminders are tracked in email_deliveries (workflow esign_signing_reminder)", async () => {
  const s = createSenders();
  await callRoute(route, createDb(parityTables()), s.senders);
  const ag = s.sent.filter((x) => x.kind === "agreement");
  assert.ok(ag.length > 0);
  for (const a of ag) assert.deepEqual(a.track, { workflow: "esign_signing_reminder" });
});

// ---------------------------------------------- the real senders return results
await check("email.server: the reminder senders return the send result and keep their tracking workflow", async () => {
  const deliveries = [];
  const emailStubs = {
    "@/integrations/supabase/client.server": `
      export const supabaseAdmin = {
        from(table) {
          const q = {
            insert(v) { globalThis.__deliveries.push({ table, ...v }); return q; },
            update() { return q; }, select() { return q; }, eq() { return q; },
            single: async () => ({ data: { id: "del-" + globalThis.__deliveries.length }, error: null }),
            then(ok, fail) { return Promise.resolve({ data: [], error: null }).then(ok, fail); },
          };
          return q;
        },
        rpc: async () => ({ error: null }),
      };`,
    "@/lib/company.server": "export const getBusinessPhone=async()=>({tel:'tel:000',display:'Fixture phone'});",
  };
  globalThis.__deliveries = deliveries;
  await build({
    entryPoints: ["src/lib/email.server.ts"], outfile: join(out, "email.mjs"), bundle: true, platform: "node", format: "esm",
    alias: { "@": resolve("src") }, logLevel: "silent",
    plugins: [{ name: "b", setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => (emailStubs[a.path] ? { path: a.path, namespace: "fixture" } : undefined));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: emailStubs[a.path], loader: "js" }));
    } }],
  });
  const email = await import(pathToFileURL(join(out, "email.mjs")).href);
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "synthetic-not-a-secret";
  let status = 200;
  globalThis.fetch = async (url) => {
    assert.equal(url, "https://api.resend.com/emails");
    return status === 200 ? new Response(JSON.stringify({ id: "re_ok" }), { status }) : new Response("no", { status });
  };
  try {
    const r1 = await email.sendPastDueReminderEmail({ to: "a@example.invalid", firstName: "A", amount: 10, dueDate: "2026-10-01", daysLate: 3 });
    const r2 = await email.sendLicenseExpiringEmail({ to: "b@example.invalid", firstName: "B", expiration: "2026-11-01", daysLeft: 5 });
    const r3 = await email.sendServiceDigestEmail({ to: "team@drivereal.com", items: [{ vehicle: "V", reason: "R" }] });
    assert.deepEqual([r1.ok, r1.id, r2.ok, r3.ok], [true, "re_ok", true, true]);
    status = 422;
    const refused = await email.sendPastDueReminderEmail({ to: "a@example.invalid", firstName: "A", amount: 10, dueDate: null, daysLate: 1 });
    assert.equal(refused.ok, false);
    assert.notEqual(refused.uncertain, true, "a 422 is a definite refusal");
    status = 503;
    const unsure = await email.sendLicenseExpiringEmail({ to: "b@example.invalid", firstName: "B", expiration: "2026-11-01", daysLeft: 5 });
    assert.equal(unsure.uncertain, true, "a 5xx is uncertain");
    const workflows = deliveries.filter((d) => d.table === "email_deliveries").map((d) => d.workflow);
    assert.deepEqual([...new Set(workflows)].sort(), ["license_expiring", "payment_past_due", "service_digest"]);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  }
});

await check("constants: 10 per run, 24h window, 6-day spacing, unchanged statuses", async () => {
  assert.equal(lib.MAX_DRIVER_EMAILS_PER_RUN, 10);
  assert.equal(lib.DRIVER_BUDGET_WINDOW_HOURS, 24);
  assert.equal(lib.REMINDER_SPACING_DAYS, 6);
  assert.deepEqual([...lib.PAST_DUE_STATUSES], ["pending", "failed", "overdue", "past_due", "unpaid", "late"]);
  assert.deepEqual([...lib.LICENSE_STATUSES], ["approved", "active"]);
  assert.deepEqual([...lib.AGREEMENT_OPEN_STATUSES], ["sent", "viewed"]);
});

rmSync(out, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n[${TARGET}] ${results.length - failed.length}/${results.length} ops-reminders cron checks passed`);
if (failed.length) process.exit(1);
