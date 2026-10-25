/**
 * A resume link cannot edit a decided application.
 *
 * updateApplicationStep resolves an anonymous resume token and writes the
 * fields it is sent. Only the status promotion used to be guarded, so a still
 * live token could rewrite an approved or active application — including the
 * licence and insurance file pointers staff had already reviewed.
 *
 * Offline execution of the real handlers: the module is bundled with the
 * server-fn factory, the service client, the token resolver, the vault sync
 * and the mailer stubbed. No network, no database.
 * Run: node scripts/application-edit-lock.test.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APP = "10000000-0000-4000-8000-0000000000a1";
const TOKEN = "t".repeat(40);
const DECIDED = ["approved", "active", "suspended", "declined", "closed", "duplicate"];
const EDITABLE = ["partial", "new", "complete", "reviewing"];

/** Every call the handler makes, in order. Reads and writes both. */
let log;
let db;
/** Runs after the first read of `applications`, to model a decision landing mid-request. */
let afterFirstRead;

function query(table) {
  const q = { table, op: "select", filters: [], patch: null };
  const hits = () =>
    (db[table] ?? []).filter((r) =>
      q.filters.every(([kind, col, val]) =>
        kind === "eq" ? r[col] === val : kind === "in" ? val.includes(r[col]) : true,
      ),
    );
  const exec = (single) => {
    log.push({ table, op: q.op, filters: q.filters.map((f) => f.slice()), patch: q.patch });
    const rows = hits();
    if (q.op === "update") for (const r of rows) Object.assign(r, q.patch);
    if (q.op === "select" && table === "applications" && afterFirstRead) {
      const fn = afterFirstRead;
      afterFirstRead = null;
      const out = rows.map((r) => ({ ...r }));
      fn();
      return { data: single ? (out[0] ?? null) : out, error: null };
    }
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  };
  const b = {
    select: () => b,
    eq: (c, v) => (q.filters.push(["eq", c, v]), b),
    in: (c, v) => (q.filters.push(["in", c, v]), b),
    limit: () => b,
    order: () => b,
    update: (p) => ((q.op = "update"), (q.patch = p), b),
    insert: (p) => ((q.op = "insert"), (q.patch = p), b),
    upsert: (p) => ((q.op = "upsert"), (q.patch = p), b),
    delete: () => ((q.op = "delete"), b),
    maybeSingle: async () => exec(true),
    single: async () => {
      const r = exec(true);
      return r.data ? r : { data: null, error: { message: "JSON object requested, no rows" } };
    },
    then: (res, rej) => Promise.resolve(exec(false)).then(res, rej),
  };
  return b;
}

const fakeAdmin = {
  from: (t) => query(t),
  rpc: async (name) => (log.push({ rpc: name, op: "rpc" }), { data: null, error: null }),
  storage: {
    from: (bucket) => ({
      remove: async () => (log.push({ op: "storage.remove", bucket }), { error: null }),
      upload: async () => (log.push({ op: "storage.upload", bucket }), { error: null }),
    }),
  },
};

const stubs = {
  "@tanstack/react-start/server": "export const getRequest=()=>({headers:new Map()});",
  "@tanstack/react-start": `export const createServerFn=()=>{let validate=x=>x;const api={middleware:()=>api,inputValidator:v=>{validate=v;return api},handler:fn=>async args=>fn({...args,data:validate(args.data)})};return api};`,
  "@/integrations/supabase/auth-middleware": "export const requireSupabaseAuth={};",
  "@/integrations/supabase/client.server":
    "export const supabaseAdmin=new Proxy({}, {get:(_,p)=>globalThis.__lock.admin[p]});",
  "@/lib/resume-tokens.server":
    "export const resolveResumeToken=async(admin,raw)=>globalThis.__lock.resolve(raw);",
  "@/lib/documents.functions":
    "export const syncApplicationUploads=async(...a)=>globalThis.__lock.sync(...a);",
  "@/lib/email.server":
    "export const sendLeadAlertEmail=async()=>{globalThis.__lock.emails++}; export const sendApplicationResumeEmail=async()=>({ok:true});",
  "@/lib/scoring.functions": "export const runScoring=async()=>{};",
  "@/lib/automations.server": "export const enrollInWorkflows=async()=>{};",
  "@/lib/application-recovery.server":
    "export const applicationResumeAtomicEnabled=()=>false; export const deliverApplicationRecovery=async()=>({outcome:'failed',wait:0});",
};

// Offline means offline: anything that tries the network fails the run.
globalThis.fetch = () => {
  throw new Error("network refused in application-edit-lock test");
};

const dir = mkdtempSync(join(tmpdir(), "rr-edit-lock-"));
let synced = 0;
globalThis.__lock = {
  admin: fakeAdmin,
  resolve: async (raw) => {
    log.push({ op: "token" });
    if (raw !== TOKEN) throw new Error("This link is no longer valid.");
    return APP;
  },
  sync: async () => {
    synced++;
  },
  emails: 0,
};

async function load(file) {
  const output = join(dir, file.replaceAll("/", "_") + ".mjs");
  await build({
    entryPoints: [file],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    alias: { "@": resolve("src") },
    plugins: [
      {
        name: "offline",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            stubs[a.path] ? { path: a.path, namespace: "stub" } : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
            contents: stubs[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(pathToFileURL(output));
}

function reset(status) {
  log = [];
  synced = 0;
  afterFirstRead = null;
  globalThis.__lock.emails = 0;
  db = {
    applications: [
      {
        id: APP,
        status,
        full_name: "Fixture Applicant",
        current_step: "documents",
        license_photo_url: `${APP}/reviewed-licence.jpg`,
        insurance_doc_url: `${APP}/reviewed-insurance.pdf`,
        profile_screenshot_url: null,
        trip_screenshots: [],
        full_coverage_insurance: true,
        insurance_expires_on: null,
        insurance_policy_number: null,
      },
    ],
  };
}

const writes = () => log.filter((e) => e.op !== "select" && e.op !== "token");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS", name);
}

try {
  const apps = await load("src/lib/applications.functions.ts");
  const lock = await load("src/lib/application-edit-status.ts");
  const gaps = await load("src/lib/application-doc-gaps.ts");
  const MESSAGE = lock.APPLICATION_LOCKED_MESSAGE;

  await test("the editable set is the codebase's own open-application set", async () => {
    assert.deepEqual([...lock.APPLICANT_EDITABLE_STATUSES], EDITABLE);
    assert.deepEqual([...lock.APPLICANT_EDITABLE_STATUSES], [...gaps.OPEN_APPLICATION_STATUSES]);
    for (const s of DECIDED) assert.equal(lock.isApplicantEditableStatus(s), false, s);
    for (const s of EDITABLE) assert.equal(lock.isApplicantEditableStatus(s), true, s);
    assert.equal(lock.isApplicantEditableStatus(null), false);
    assert.equal(lock.isApplicantEditableStatus(""), false);
    assert.equal(lock.isApplicantEditableStatus("APPROVED"), false);
    assert.match(MESSAGE, /already being processed/);
    assert.match(MESSAGE, /contact us/);
  });

  for (const status of DECIDED) {
    await test(`${status}: a licence-pointer edit is refused before any write`, async () => {
      reset(status);
      await assert.rejects(
        apps.updateApplicationStep({
          data: { token: TOKEN, step: "documents", license_photo_url: `${APP}/swapped.jpg` },
        }),
        (e) => e.message === MESSAGE,
      );
      assert.deepEqual(writes(), [], "no update, insert, rpc or storage call");
      assert.equal(synced, 0, "the vault is not re-synced");
      assert.equal(globalThis.__lock.emails, 0, "no alert is sent");
      assert.equal(db.applications[0].license_photo_url, `${APP}/reviewed-licence.jpg`);
      assert.equal(db.applications[0].status, status, "status is untouched");
      // Token first, then the one status read, then the refusal.
      assert.deepEqual(
        log.map((e) => e.op),
        ["token", "select"],
      );
    });
  }

  await test("decided: insurance pointer, ordinary fields and a replayed submission are refused too", async () => {
    for (const data of [
      { step: "documents", insurance_doc_url: `${APP}/other.pdf` },
      { step: "rental", vehicle_size: "suv", pickup_date: "2026-11-01" },
      { step: "submitted" },
      { step: "documents", trip_screenshots: [`${APP}/t.jpg`], trip_screenshots_keep: [] },
    ]) {
      reset("approved");
      await assert.rejects(
        apps.updateApplicationStep({ data: { token: TOKEN, ...data } }),
        (e) => e.message === MESSAGE,
      );
      assert.deepEqual(writes(), [], JSON.stringify(data));
      assert.equal(db.applications[0].status, "approved");
      assert.equal(db.applications[0].insurance_doc_url, `${APP}/reviewed-insurance.pdf`);
    }
  });

  await test("token checks are unchanged: a bad token is refused before the status is read", async () => {
    reset("partial");
    await assert.rejects(
      apps.updateApplicationStep({ data: { token: "x".repeat(40), step: "rental" } }),
      /no longer valid/,
    );
    assert.deepEqual(
      log.map((e) => e.op),
      ["token"],
    );
  });

  for (const status of EDITABLE) {
    await test(`${status}: a licence-pointer edit still saves`, async () => {
      reset(status);
      const result = await apps.updateApplicationStep({
        data: { token: TOKEN, step: "documents", license_photo_url: `${APP}/new-licence.jpg` },
      });
      assert.deepEqual(result, { ok: true });
      assert.equal(db.applications[0].license_photo_url, `${APP}/new-licence.jpg`);
      const update = writes().filter((e) => e.op === "update");
      assert.equal(update.length, 1);
      // The write itself carries the same condition, so it cannot land on a
      // row decided after the read.
      assert.ok(
        update[0].filters.some(
          ([k, c, v]) => k === "in" && c === "status" && v.join() === EDITABLE.join(),
        ),
        "update is conditioned on an editable status",
      );
      assert.equal(synced, 1, "the vault sync still runs");
    });
  }

  await test("partial -> submitted still promotes to new", async () => {
    reset("partial");
    await apps.updateApplicationStep({ data: { token: TOKEN, step: "submitted" } });
    assert.equal(db.applications[0].status, "new");
  });

  await test("a decision landing between the read and the write still wins", async () => {
    reset("reviewing");
    afterFirstRead = () => {
      db.applications[0].status = "approved";
    };
    await assert.rejects(
      apps.updateApplicationStep({
        data: { token: TOKEN, step: "documents", license_photo_url: `${APP}/late.jpg` },
      }),
      (e) => e.message === MESSAGE,
    );
    assert.equal(db.applications[0].license_photo_url, `${APP}/reviewed-licence.jpg`);
    assert.equal(db.applications[0].status, "approved");
    assert.equal(synced, 0);
  });

  await test("the wizard payload says whether it may edit, never the status itself", async () => {
    for (const status of [...DECIDED, ...EDITABLE]) {
      reset(status);
      const payload = await apps.getApplicationForWizard({ data: { token: TOKEN } });
      assert.equal(payload.editable, EDITABLE.includes(status), status);
      assert.equal("status" in payload, false, "status does not cross the boundary");
    }
  });

  console.log(`\n${passed} passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
