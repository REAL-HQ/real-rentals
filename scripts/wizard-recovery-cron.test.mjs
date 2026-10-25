/**
 * Hourly application reminder cron (PR 4): who is emailed, and that each
 * reminder is claimed before it is sent. The real runWizardRecovery runs
 * against an in-memory applications table that evaluates the PostgREST
 * filters it is given. No network, no database, no email provider.
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(tmpdir(), "rr-wizard-recovery-"));
const stubs = {
  "@/integrations/supabase/client.server": "export const supabaseAdmin = {};",
};
const boundary = {
  name: "boundaries",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => (stubs[a.path] ? { path: a.path, namespace: "fixture" } : undefined));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: stubs[a.path], loader: "js" }));
  },
};
await build({
  entryPoints: ["src/lib/wizard-recovery.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(out, "cron.mjs"),
  alias: { "@": resolve("src") },
  logLevel: "silent",
  plugins: [boundary],
});
const cron = await import(pathToFileURL(join(out, "cron.mjs")).href);

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

/** Split a PostgREST or() expression on top-level commas. */
function splitTop(expr) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}
const listOf = (v) => String(v).replace(/^\(|\)$/g, "").split(",");
function orClause(part) {
  const m = part.match(/^([a-z_0-9]+)\.(not\.)?(is|in|eq)\.(.*)$/);
  assert.ok(m, `unsupported or() clause ${part}`);
  const [, col, neg, op, raw] = m;
  const test = (r) => {
    if (op === "is") return raw === "null" ? (r[col] ?? null) === null : String(r[col]) === raw;
    if (op === "in") return r[col] != null && listOf(raw).includes(String(r[col]));
    return String(r[col]) === raw;
  };
  return neg ? (r) => r[col] != null && !test(r) : test;
}

function createAdmin(rows, { failClaim = false } = {}) {
  const log = [];
  const from = (table) => {
    const state = { filters: [], op: "read", values: null, one: false, calls: [] };
    const run = () => {
      if (table === "markets") return { data: { name: "Tampa" }, error: null };
      assert.equal(table, "applications");
      log.push({ op: state.op, values: state.values, calls: state.calls });
      if (state.op === "update" && failClaim && state.values && Object.values(state.values).some((v) => v !== null)) {
        return { data: null, error: { code: "XX000", message: "injected failure" } };
      }
      // PostgREST 12 (checked on 12.2.3) re-applies a mutation's or= filter to
      // the RETURNING rows, so every column the or() names must be selected or
      // the request fails with 42703, even when no row matches.
      if (state.op === "update") {
        const sel = state.calls.find((c) => c[0] === "select");
        const cols = sel ? String(sel[1] ?? "*").split(",").map((c) => c.trim()) : [];
        for (const c of state.calls.filter((c) => c[0] === "or")) {
          for (const part of splitTop(c[1])) {
            const col = part.split(".")[0];
            if (sel && !cols.includes("*") && !cols.includes(col)) {
              return { data: null, error: { code: "42703", message: `column applications.${col} does not exist` } };
            }
          }
        }
      }
      const matched = rows.filter((r) => state.filters.every((f) => f(r)));
      // Conditional update: evaluate and apply in one synchronous step, the
      // way one UPDATE ... WHERE ... RETURNING behaves.
      if (state.op === "update") for (const r of matched) Object.assign(r, state.values);
      const data = matched.map((r) => ({ ...r }));
      return { data: state.one ? (data[0] ?? null) : data, error: null };
    };
    const push = (name, args, f) => {
      state.calls.push([name, ...args]);
      if (f) state.filters.push(f);
      return q;
    };
    const q = {
      select: (...a) => push("select", a),
      lt: (k, v) => push("lt", [k, v], (r) => r[k] < v),
      gte: (k, v) => push("gte", [k, v], (r) => r[k] >= v),
      eq: (k, v) => push("eq", [k, v], (r) => r[k] === v),
      is: (k, v) => push("is", [k, v], (r) => (r[k] ?? null) === v),
      not: (k, op, v) =>
        push("not", [k, op, v], (r) => {
          if (op === "is") return (r[k] ?? null) !== v;
          if (op === "in") return r[k] != null && !listOf(v).includes(String(r[k]));
          throw new Error("unsupported not " + op);
        }),
      or: (expr) => {
        const clauses = splitTop(expr).map(orClause);
        return push("or", [expr], (r) => clauses.some((c) => c(r)));
      },
      update: (v) => {
        state.op = "update";
        state.values = v;
        return q;
      },
      maybeSingle: () => {
        state.one = true;
        return q;
      },
      then: (ok, fail) => Promise.resolve().then(run).then(ok, fail),
    };
    return q;
  };
  return { from, log };
}

/** "Already sent" long ago: non-null, and outside the hourly budget window. */
const ALREADY_SENT = hoursAgo(200);

function app(overrides) {
  return {
    id: overrides.id,
    full_name: "Fixture Person",
    email: `${overrides.id}@example.invalid`,
    current_step: "rental",
    status: "partial",
    created_at: hoursAgo(25),
    deleted_at: null,
    purged_at: null,
    recovery_email_sent_24h: null,
    recovery_email_sent_72h: null,
    recovery_sent_at: ALREADY_SENT,
    market_id: null,
    city: "Tampa",
    pickup_date: null,
    ...overrides,
  };
}

function senders({ result = { ok: true }, delay = 0, throws = false } = {}) {
  const sent = [];
  const order = [];
  const make = (kind) => async (args) => {
    order.push(`send:${kind}:${args.applicationId}`);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (throws) throw new Error("token mint failed");
    sent.push({ kind, ...args });
    return typeof result === "function" ? result(args) : result;
  };
  return {
    sent,
    order,
    deps: {
      sendWizardRecoveryEmail: (a) => make(a.variant)(a),
      sendAbandonedRecoveryEmail: make("abandoned"),
      now: () => NOW,
      log: () => {},
    },
  };
}

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log("PASS", name);
};

// ------------------------------------------------------------------ filtering
{
  assert.deepEqual(
    cron.CLOSED_STATUS_FILTER,
    "(approved,active,suspended,declined,closed,duplicate,complete)",
  );
  assert.ok(!cron.CLOSED_STATUS_FILTER.includes("rejected"));
  ok("closed statuses are the real list (no phantom 'rejected')");
}

{
  const rows = [
    app({ id: "open-partial" }),
    app({ id: "open-new", status: "new" }),
    app({ id: "open-reviewing", status: "reviewing" }),
    app({ id: "null-step", current_step: null }),
    app({ id: "deleted", deleted_at: hoursAgo(1) }),
    app({ id: "purged", purged_at: hoursAgo(1) }),
    ...["declined", "closed", "duplicate", "approved", "active", "suspended", "complete"].map((status) =>
      app({ id: `decided-${status}`, status }),
    ),
    app({ id: "submitted-step", current_step: "submitted", status: "new" }),
    app({ id: "too-old", created_at: hoursAgo(30) }),
    app({ id: "already-24", recovery_email_sent_24h: hoursAgo(1) }),
    app({ id: "no-email", email: null }),
  ];
  const admin = createAdmin(rows);
  const s = senders();
  const report = await cron.runWizardRecovery(admin, s.deps);
  assert.deepEqual(
    s.sent.map((x) => x.applicationId).sort(),
    ["null-step", "open-new", "open-partial", "open-reviewing"],
  );
  assert.equal(report.sent_24h, 4);
  for (const id of ["deleted", "purged", "decided-declined", "decided-closed", "decided-duplicate", "decided-suspended"]) {
    assert.equal(rows.find((r) => r.id === id).recovery_email_sent_24h, null, `${id} was stamped`);
  }
  // The read itself filters deleted/purged/closed, not just the loop.
  const read24 = admin.log.find((l) => l.op === "read" && l.calls.some((c) => c[0] === "is" && c[1] === "recovery_email_sent_24h"));
  assert.ok(read24.calls.some((c) => c[0] === "is" && c[1] === "deleted_at" && c[2] === null));
  assert.ok(read24.calls.some((c) => c[0] === "is" && c[1] === "purged_at" && c[2] === null));
  assert.ok(read24.calls.some((c) => c[0] === "not" && c[1] === "status" && c[2] === "in" && c[3] === cron.CLOSED_STATUS_FILTER));
  ok("24h: deleted, purged and decided applications are excluded in the query and never emailed");
}

{
  const rows = [
    app({ id: "a72", created_at: hoursAgo(80), recovery_email_sent_24h: hoursAgo(56) }),
    app({ id: "a72-declined", created_at: hoursAgo(80), recovery_email_sent_24h: hoursAgo(56), status: "declined" }),
    app({ id: "a72-deleted", created_at: hoursAgo(80), recovery_email_sent_24h: hoursAgo(56), deleted_at: hoursAgo(2) }),
    app({ id: "a72-no24", created_at: hoursAgo(80) }),
    app({ id: "ab", created_at: hoursAgo(5), recovery_sent_at: null }),
    app({ id: "ab-purged", created_at: hoursAgo(5), recovery_sent_at: null, purged_at: hoursAgo(1) }),
    app({ id: "ab-new", created_at: hoursAgo(5), recovery_sent_at: null, status: "new" }),
  ];
  const s = senders();
  const report = await cron.runWizardRecovery(createAdmin(rows), s.deps);
  assert.deepEqual(s.sent.map((x) => `${x.kind}:${x.applicationId}`).sort(), ["72h:a72", "abandoned:ab"]);
  assert.equal(report.sent_72h, 1);
  assert.equal(report.sent_abandoned, 1);
  ok("72h and abandoned reminders apply the same open-draft filter");
}

// ---------------------------------------------------------- claim before send
{
  const rows = [app({ id: "one" }), app({ id: "two" })];
  const admin = createAdmin(rows);
  const s = senders({ delay: 5 });
  await cron.runWizardRecovery(admin, s.deps);
  const claimIdx = admin.log.findIndex((l) => l.op === "update" && l.values.recovery_email_sent_24h);
  assert.ok(claimIdx >= 0);
  // Claim is conditional: stamp IS NULL, not deleted/purged/closed, not applied.
  const claim = admin.log[claimIdx].calls;
  assert.ok(claim.some((c) => c[0] === "is" && c[1] === "recovery_email_sent_24h" && c[2] === null));
  assert.ok(claim.some((c) => c[0] === "is" && c[1] === "deleted_at"));
  assert.ok(claim.some((c) => c[0] === "is" && c[1] === "purged_at"));
  assert.ok(claim.some((c) => c[0] === "not" && c[1] === "status"));
  assert.ok(claim.some((c) => c[0] === "or" && /current_step\.is\.null/.test(c[1])));
  assert.ok(claim.some((c) => c[0] === "select"), "claim must RETURN rows so the result can be checked");
  ok("the claim is a conditional update (stamp IS NULL + open-draft conditions) that returns rows");
}

{
  const rows = [app({ id: "one" }), app({ id: "two" }), app({ id: "three" })];
  const admin = createAdmin(rows);
  const s = senders({ delay: 10 });
  const [r1, r2] = await Promise.all([
    cron.runWizardRecovery(admin, s.deps),
    cron.runWizardRecovery(admin, s.deps),
  ]);
  const ids = s.sent.map((x) => x.applicationId).sort();
  assert.deepEqual(ids, ["one", "three", "two"], `double send: ${ids}`);
  assert.equal(r1.sent_24h + r2.sent_24h, 3);
  assert.equal(r1.skipped_claimed + r2.skipped_claimed, 3);
  ok("two overlapping runs send each reminder exactly once");
}

{
  const rows = [app({ id: "one" })];
  const admin = createAdmin(rows);
  const s = senders();
  // A row that changes between the read and the claim is not emailed.
  const originalFrom = admin.from;
  let reads = 0;
  admin.from = (t) => {
    const q = originalFrom(t);
    const then = q.then;
    q.then = (a, b) => {
      reads++;
      if (reads === 3) rows[0].current_step = "submitted"; // after all three batch reads
      return then(a, b);
    };
    return q;
  };
  await cron.runWizardRecovery(admin, s.deps);
  assert.equal(s.sent.length, 0);
  assert.equal(rows[0].recovery_email_sent_24h, null);
  ok("an applicant who submits between the read and the claim is not told they didn't finish");
}

{
  const rows = [app({ id: "one" })];
  const s = senders();
  const report = await cron.runWizardRecovery(createAdmin(rows, { failClaim: true }), s.deps);
  assert.equal(s.sent.length, 0, "sent without a successful stamp");
  assert.equal(report.failed, 1);
  ok("a failed stamp means no email (the stamp result is checked)");
}

{
  const rows = [app({ id: "refused" }), app({ id: "uncertain" }), app({ id: "threw" })];
  const s = senders({
    result: (a) =>
      a.applicationId === "refused"
        ? { ok: false, error: "Resend rejected the send (422)" }
        : a.applicationId === "uncertain"
          ? { ok: false, uncertain: true, error: "timeout" }
          : { ok: true },
  });
  const deps = {
    ...s.deps,
    sendWizardRecoveryEmail: async (a) => {
      if (a.applicationId === "threw") throw new Error("token mint failed");
      return s.deps.sendWizardRecoveryEmail(a);
    },
  };
  const report = await cron.runWizardRecovery(createAdmin(rows), deps);
  assert.equal(report.sent_24h, 0);
  assert.equal(report.failed, 3);
  assert.equal(rows.find((r) => r.id === "refused").recovery_email_sent_24h, null, "definite refusal is released for a later run");
  assert.equal(rows.find((r) => r.id === "threw").recovery_email_sent_24h, null, "a throw before sending is released");
  assert.ok(rows.find((r) => r.id === "uncertain").recovery_email_sent_24h, "uncertain outcome keeps the claim (at most once)");
  ok("definite failures release the claim; uncertain ones keep it so nobody gets two emails");
}

// ------------------------------------------------------------- route + email
{
  const route = readFileSync("src/routes/api/public/cron/wizard-recovery.ts", "utf8");
  assert.match(route, /runWizardRecovery\(supabaseAdmin/);
  assert.match(route, /get_cron_token/);
  assert.doesNotMatch(route, /rejected/);
  assert.doesNotMatch(route, /\.update\(/, "the route must not stamp outside the claim");
  ok("the cron route keeps its bearer check and delegates to the claimed runner");
}

{
  // The reminder emails mint 30-minute single-use recovery links, not 14-day sessions.
  const inserts = [];
  const emailStubs = {
    "@/integrations/supabase/client.server": `
      export const supabaseAdmin = {
        from(table) {
          const q = {
            _op: null, _v: null,
            insert(v) { q._op = "insert"; q._v = v; globalThis.__inserts.push({ table, ...v }); return q; },
            update() { q._op = "update"; return q; },
            select() { return q; }, eq() { return q; }, is() { return q; }, gt() { return q; },
            order() { return q; }, in() { return q; },
            single: async () => ({ data: { id: "row-" + globalThis.__inserts.length }, error: null }),
            maybeSingle: async () => ({ data: null, error: null }),
            then(ok, fail) { return Promise.resolve({ data: [], error: null }).then(ok, fail); },
          };
          return q;
        },
        rpc: async () => ({ error: null }),
      };`,
    "@/lib/company.server": `export const getBusinessPhone=async()=>({tel:'tel:000',display:'Fixture phone'});`,
  };
  globalThis.__inserts = inserts;
  await build({
    entryPoints: ["src/lib/email.server.ts"],
    outfile: join(out, "email.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    alias: { "@": resolve("src") },
    logLevel: "silent",
    plugins: [
      {
        name: "boundaries",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => (emailStubs[a.path] ? { path: a.path, namespace: "fixture" } : undefined));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({ contents: emailStubs[a.path], loader: "js" }));
        },
      },
    ],
  });
  const email = await import(pathToFileURL(join(out, "email.mjs")).href);
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.RESEND_API_KEY;
  const bodies = [];
  process.env.RESEND_API_KEY = "synthetic-not-a-secret";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "fixture" }), { status: 200 });
  };
  try {
    const before = Date.now();
    const r1 = await email.sendWizardRecoveryEmail({ to: "a@example.invalid", firstName: "A", applicationId: "app-1", variant: "24h" });
    const r2 = await email.sendAbandonedRecoveryEmail({ to: "b@example.invalid", firstName: "B", applicationId: "app-2", market: null, pickupDate: null });
    assert.equal(r1.ok, true, "sendWizardRecoveryEmail returns the send result");
    assert.equal(r2.ok, true, "sendAbandonedRecoveryEmail returns the send result");
    const tokenRows = inserts.filter((i) => i.table === "application_resume_tokens");
    assert.equal(tokenRows.length, 2);
    for (const row of tokenRows) {
      const ttl = Date.parse(row.expires_at) - before;
      assert.ok(ttl > 0 && ttl <= 31 * 60_000, `reminder minted a ${Math.round(ttl / 60000)}-minute token`);
    }
    for (const b of bodies) {
      assert.match(b.html, /works once and expires 30 minutes/);
      assert.match(b.html, /drivereal\.com\/thank-you\?t=/);
    }
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  }
  ok("24h/72h/abandoned reminders mint 30-minute single-use recovery links and say so");
}

// ------------------------------------------------------------- per-run cap
{
  assert.equal(cron.MAX_REMINDER_CLAIMS_PER_RUN, 10);
  // 15 open drafts in the 24h window plus 3 abandoned partials: 18 candidates.
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => app({ id: `ab-${i}`, created_at: hoursAgo(5), recovery_sent_at: null })),
    ...Array.from({ length: 15 }, (_, i) => app({ id: `h24-${String(i).padStart(2, "0")}` })),
  ];
  const admin = createAdmin(rows);
  const s = senders();
  const report = await cron.runWizardRecovery(admin, s.deps);
  assert.equal(s.sent.length, 10, `sent ${s.sent.length}`);
  assert.equal(report.sent_abandoned + report.sent_24h + report.sent_72h, 10);
  assert.equal(report.capped, 8);
  assert.equal(report.max_claims_per_run, 10);
  const stamped = rows.filter((r) => r.recovery_email_sent_24h || (r.recovery_sent_at && r.recovery_sent_at !== ALREADY_SENT));
  assert.equal(stamped.length, 10, "only the sent rows are stamped");
  // Rows past the cap were never claimed, so no claim update was issued for them.
  const claimUpdates = admin.log.filter((l) => l.op === "update" && l.values && Object.values(l.values).some((v) => v !== null));
  assert.equal(claimUpdates.length, 10);
  ok("a run claims and sends at most 10 reminders; the rest stay unstamped and are reported as capped");

  // A retry or second run within the hour sends nothing: the hourly budget is spent.
  const s2 = senders();
  const report2 = await cron.runWizardRecovery(admin, s2.deps);
  assert.equal(s2.sent.length, 0, `second run in the hour sent ${s2.sent.length}`);
  assert.ok(report2.capped >= 1);
  assert.equal(rows.filter((r) => r.recovery_email_sent_24h || (r.recovery_sent_at && r.recovery_sent_at !== ALREADY_SENT)).length, 10,
    "the budget check released its own claim, so nothing new stays stamped");
  ok("a retry or second run within the hour sends nothing (hourly budget across runs)");

  // An hour later (the stamps age out of the window), the remainder goes out, once each.
  const aged = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  for (const r of rows) {
    if (r.recovery_email_sent_24h) r.recovery_email_sent_24h = aged;
    if (r.recovery_sent_at && r.recovery_sent_at !== ALREADY_SENT) r.recovery_sent_at = aged;
  }
  const s3 = senders();
  await cron.runWizardRecovery(admin, s3.deps);
  assert.equal(s3.sent.length, 8);
  assert.equal(new Set([...s.sent, ...s3.sent].map((x) => `${x.kind}:${x.applicationId}`)).size, 18, "nobody emailed twice");
  ok("the next hour sends the remainder once each; no duplicates across runs");
}

{
  // Overlapping runs (a retry, a manual call, a slow run) share one hourly budget of 10.
  const rows = Array.from({ length: 30 }, (_, i) => app({ id: `c-${String(i).padStart(2, "0")}` }));
  const admin = createAdmin(rows);
  const a = senders({ delay: 3 });
  const b = senders({ delay: 2 });
  const c = senders({ delay: 1 });
  await Promise.all([cron.runWizardRecovery(admin, a.deps), cron.runWizardRecovery(admin, b.deps), cron.runWizardRecovery(admin, c.deps)]);
  const all = [...a.sent, ...b.sent, ...c.sent];
  assert.ok(all.length <= 10, `three overlapping runs sent ${all.length}`);
  assert.ok(all.length >= 1);
  assert.equal(new Set(all.map((x) => x.applicationId)).size, all.length, "nobody emailed twice");
  const stamped = rows.filter((r) => r.recovery_email_sent_24h).length;
  assert.equal(stamped, all.length, "only rows actually emailed keep a stamp");
  ok(`three overlapping runs send ${all.length} in total (never more than 10), each person once`);
}

{
  // The budget read fails closed: the claim is released unsent and the run stops.
  const rows = Array.from({ length: 3 }, (_, i) => app({ id: `e-${i}` }));
  const admin = createAdmin(rows);
  const failingAdmin = { ...admin, from: (t) => {
    const q = admin.from(t);
    const select = q.select;
    q.select = (...args) => (args[1]?.head ? { gte: () => Promise.resolve({ data: null, count: null, error: { message: "read failed" } }) } : select(...args));
    return q;
  } };
  const s = senders();
  const report = await cron.runWizardRecovery(failingAdmin, s.deps);
  assert.equal(s.sent.length, 0);
  assert.equal(rows.filter((r) => r.recovery_email_sent_24h).length, 0, "claim released");
  assert.ok(report.capped >= 1);
  ok("an unreadable hourly count releases the claim unsent and stops the run");
}

{
  // A claim whose send is refused and released still counts toward the cap,
  // so failures can only lower a run's emails.
  const rows = Array.from({ length: 12 }, (_, i) => app({ id: `f-${String(i).padStart(2, "0")}` }));
  const admin = createAdmin(rows);
  const s = senders({ result: (a) => (a.applicationId === "f-00" ? { ok: false, error: "rejected", status: 422 } : { ok: true }) });
  const report = await cron.runWizardRecovery(admin, s.deps);
  assert.equal(s.sent.length, 10, "10 claims made (one of them refused by the provider)");
  assert.equal(report.sent_24h, 9);
  assert.equal(report.capped, 2);
  ok("a refused send still counts as a claim toward the cap");
}

rmSync(out, { recursive: true, force: true });
console.log(`${passed} wizard-recovery cron checks passed`);
