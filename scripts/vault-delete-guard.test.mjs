/**
 * The document vault cannot delete signed-agreement evidence.
 *
 * deleteDocument (Owner-only) removed the storage object and then the row for
 * ANY document, signed rental agreements included — and agreements.document_id
 * is ON DELETE SET NULL, so the agreement also lost its archive pointer
 * without a trace. These run the real handler against a fake Supabase and
 * check the refusal comes before storage is touched.
 *
 * Offline: the module is bundled with the server-fn factory, the auth
 * middleware, the service client and the role checks stubbed. No network.
 * Run: node scripts/vault-delete-guard.test.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OWNER = "30000000-0000-4000-8000-000000000001";
const MANAGER = "30000000-0000-4000-8000-000000000002";
const DRIVER = "40000000-0000-4000-8000-000000000001";
const id = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let log;
let db;
/** Tables whose reads fail, to prove the guard fails closed. */
let failing;

function query(table) {
  const q = { op: "select", filters: [] };
  const hits = () =>
    (db[table] ?? []).filter((r) =>
      q.filters.every(([kind, col, val]) =>
        kind === "eq" ? r[col] === val : kind === "notin" ? !val.includes(r[col]) : true,
      ),
    );
  const exec = (single) => {
    log.push({ table, op: q.op, filters: q.filters.map((f) => f.slice()) });
    if (q.op === "select" && failing.has(table)) {
      return { data: null, error: { message: `${table} unavailable` } };
    }
    const rows = hits();
    if (q.op === "delete") db[table] = (db[table] ?? []).filter((r) => !rows.includes(r));
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  };
  const b = {
    select: () => b,
    eq: (c, v) => (q.filters.push(["eq", c, v]), b),
    not: (c, op, list) => (q.filters.push(["notin", c, String(list).slice(1, -1).split(",")]), b),
    limit: () => b,
    order: () => b,
    delete: () => ((q.op = "delete"), b),
    update: () => ((q.op = "update"), b),
    insert: () => ((q.op = "insert"), b),
    maybeSingle: async () => exec(true),
    single: async () => exec(true),
    then: (res, rej) => Promise.resolve(exec(false)).then(res, rej),
  };
  return b;
}

const fakeAdmin = {
  from: (t) => query(t),
  storage: {
    from: (bucket) => ({
      remove: async (paths) => (log.push({ op: "storage.remove", bucket, paths }), { error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: "https://signed.invalid" }, error: null }),
      list: async () => ({ data: [], error: null }),
    }),
  },
};

/** The caller's own client: only user_roles matters, for isAdmin. */
const userClient = {
  from: () => {
    const f = {};
    const b = {
      select: () => b,
      eq: (c, v) => ((f[c] = v), b),
      maybeSingle: async () => ({
        data: f.role === "admin" && f.user_id === OWNER ? { role: "admin" } : null,
        error: null,
      }),
    };
    return b;
  },
};

const stubs = {
  "@tanstack/react-start/server": "export const getRequest=()=>({headers:new Map()});",
  "@tanstack/react-start": `export const createServerFn=()=>{let validate=x=>x,auth=false;const api={middleware:()=>{auth=true;return api},inputValidator:v=>{validate=v;return api},handler:fn=>async args=>{if(auth&&!args.context?.userId)throw Error('Unauthorized');return fn({...args,data:validate(args.data)})}};return api};`,
  "@/integrations/supabase/auth-middleware": "export const requireSupabaseAuth={};",
  "@/integrations/supabase/client.server":
    "export const supabaseAdmin=new Proxy({}, {get:(_,p)=>globalThis.__vault.admin[p]});",
  "@/lib/roles.server":
    "export const requireManager=async()=>{}; export const requireOwner=async()=>{}; export const requireStaff=async()=>{};",
};

globalThis.fetch = () => {
  throw new Error("network refused in vault-delete-guard test");
};
globalThis.__vault = { admin: fakeAdmin };

const dir = mkdtempSync(join(tmpdir(), "rr-vault-delete-"));
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

const doc = (n, over = {}) => ({
  id: id(n),
  driver_id: DRIVER,
  kind: "upload",
  category: "other",
  storage_bucket: "driver-docs",
  storage_path: `${DRIVER}/file-${n}.pdf`,
  label: null,
  file_name: `file-${n}.pdf`,
  is_current: true,
  visibility: ["admin"],
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

function reset(docs, agreements = []) {
  log = [];
  failing = new Set();
  db = { documents: docs.map((d) => ({ ...d })), agreements: agreements.map((a) => ({ ...a })) };
}

const removes = () => log.filter((e) => e.op === "storage.remove");
const rowDeletes = () => log.filter((e) => e.op === "delete");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS", name);
}

try {
  const docs = await load("src/lib/documents.functions.ts");
  const evidence = await load("src/lib/signed-agreement-evidence.ts");
  const REFUSED = evidence.SIGNED_AGREEMENT_DELETE_REFUSED;
  const del = (documentId, userId = OWNER) =>
    docs.deleteDocument({ data: { documentId }, context: { userId, supabase: userClient } });

  async function refused(target, label, { docsSeed, agreements = [], message = REFUSED } = {}) {
    reset(docsSeed ?? [target], agreements);
    await assert.rejects(
      del(target.id),
      (e) => (message instanceof RegExp ? message.test(e.message) : e.message === message),
      label,
    );
    assert.deepEqual(removes(), [], `${label}: storage remove never called`);
    assert.deepEqual(rowDeletes(), [], `${label}: row never deleted`);
    assert.ok(
      db.documents.some((d) => d.id === target.id),
      `${label}: row still there`,
    );
  }

  await test("kind=rental_agreement is refused, nothing removed", async () => {
    await refused(doc(1, { kind: "rental_agreement" }), "kind");
  });

  await test("category=agreement is refused, nothing removed", async () => {
    await refused(doc(2, { category: "agreement" }), "category");
  });

  await test("any row in the rental-agreements bucket is refused (paper originals too)", async () => {
    await refused(
      doc(3, { storage_bucket: "rental-agreements", storage_path: `paper/${DRIVER}/x.pdf` }),
      "bucket",
    );
  });

  await test("a content-addressed signed archive path is refused wherever it is filed", async () => {
    await refused(
      doc(4, { storage_path: `completed-v1/${id(4)}/${"a".repeat(64)}.pdf` }),
      "completed-v1",
    );
    await refused(
      doc(5, { storage_path: `immutable-v1/${id(5)}/${"b".repeat(64)}.pdf` }),
      "immutable-v1",
    );
  });

  await test("an ordinary-looking document named by agreements.document_id is refused", async () => {
    const d = doc(6);
    await refused(d, "document_id", {
      agreements: [{ id: id(900), document_id: d.id, completed_document_id: null }],
    });
  });

  await test("an ordinary-looking document named by agreements.completed_document_id is refused", async () => {
    const d = doc(7);
    await refused(d, "completed_document_id", {
      agreements: [{ id: id(901), document_id: null, completed_document_id: d.id }],
    });
  });

  await test("an agreements lookup that fails refuses (fail closed)", async () => {
    const d = doc(8);
    reset([d]);
    failing.add("agreements");
    await assert.rejects(del(d.id), /Nothing was deleted/);
    assert.deepEqual(removes(), []);
    assert.deepEqual(rowDeletes(), []);
  });

  await test("a documents read that fails refuses (fail closed)", async () => {
    const d = doc(9);
    reset([d]);
    failing.add("documents");
    await assert.rejects(del(d.id), /documents unavailable/);
    assert.deepEqual(removes(), []);
    assert.deepEqual(rowDeletes(), []);
  });

  await test("an Owner can still delete an ordinary document: object, then row", async () => {
    const d = doc(10);
    const other = doc(11);
    reset([d, other], [{ id: id(902), document_id: other.id, completed_document_id: other.id }]);
    assert.deepEqual(await del(d.id), { ok: true });
    assert.deepEqual(removes(), [
      { op: "storage.remove", bucket: "driver-docs", paths: [d.storage_path] },
    ]);
    assert.equal(rowDeletes().length, 1);
    assert.deepEqual(
      db.documents.map((r) => r.id),
      [other.id],
      "only the target row is gone",
    );
    const ops = log.map((e) => e.op);
    assert.ok(
      ops.indexOf("storage.remove") > ops.lastIndexOf("select"),
      "every check ran before storage",
    );
  });

  await test("a Manager still cannot delete anything (Owner-only unchanged)", async () => {
    const d = doc(12);
    reset([d]);
    await assert.rejects(del(d.id, MANAGER), /Forbidden/);
    assert.deepEqual(log, [], "no service-role call at all");
  });

  await test("a missing document is still a no-op", async () => {
    reset([]);
    assert.deepEqual(await del(id(999)), { ok: true });
    assert.deepEqual(removes(), []);
  });

  await test("the vault list marks signed-agreement rows so the UI can hide Delete", async () => {
    reset([
      doc(20, {
        kind: "rental_agreement",
        category: "agreement",
        storage_bucket: "rental-agreements",
      }),
      doc(21, { storage_bucket: "rental-agreements", category: "agreement", kind: "upload" }),
      doc(22),
    ]);
    const list = await docs.adminListDriverDocuments({
      data: { applicationId: DRIVER },
      context: { userId: OWNER, supabase: userClient },
    });
    const by = Object.fromEntries(list.map((d) => [d.id, d.signed_agreement]));
    assert.deepEqual(by, { [id(20)]: true, [id(21)]: true, [id(22)]: false });
  });

  await test("both vault UIs hide Delete for signed agreements", async () => {
    const vault = readFileSync("src/components/admin/DocumentVault.tsx", "utf8");
    assert.match(
      vault,
      /mode === "admin" && doc && cat\.key !== "agreement" && !doc\.signed_agreement \?/,
    );
    const applicant = readFileSync("src/components/admin/ApplicantDocuments.tsx", "utf8");
    assert.match(applicant, /\{d && key !== "agreement" && !d\.signed_agreement && \(/);
    // Exactly one Delete entry point in each, and it is the guarded one.
    assert.equal((vault.match(/removeDoc\(/g) ?? []).length, 1);
    assert.equal((applicant.match(/void drop\(/g) ?? []).length, 1);
  });

  console.log(`\n${passed} passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
