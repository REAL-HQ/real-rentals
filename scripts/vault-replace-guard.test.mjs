/**
 * The document vault cannot replace, supersede or "Needs New" signed-agreement
 * evidence. See docs/esign/SIGNED-AGREEMENT-IMMUTABILITY.md.
 *
 * What Replace did before this guard: createDocumentUploadUrl signed a fresh
 * driver-docs path, then confirmDocumentUpload inserted a new current row in
 * the same category and marked EVERY current row of that category for the
 * driver is_current=false, superseded_by=<new row>. On the "Signed agreement"
 * card that demoted the archived, signed PDF to "Replaced versions" and put
 * whatever file staff (or a driver, calling the endpoint directly) uploaded in
 * its place. Needs New (setDocumentReview "rejected") marked the signed record
 * "Needs Replacement" and is what offered that Replace in the first place.
 *
 * These run the real handlers against a fake Supabase, offline, plus a
 * server render of ApplicantDocuments and the eSign archive retry (legacy
 * layout), which must keep re-uploading the signed PDF.
 *
 * Run: node scripts/vault-replace-guard.test.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OWNER = "30000000-0000-4000-8000-000000000001";
const MANAGER = "30000000-0000-4000-8000-000000000002";
const DRIVER_USER = "30000000-0000-4000-8000-000000000009";
const APP = "40000000-0000-4000-8000-000000000001";
const id = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const REFUSED = /permanent records/;

let log;
let db;
let failing;

function query(table) {
  const q = { op: "select", filters: [], payload: null, returning: false };
  const match = (r) =>
    q.filters.every(([kind, col, val]) => {
      if (kind === "eq") return r[col] === val;
      if (kind === "neq") return r[col] !== val;
      if (kind === "in") return val.includes(r[col]);
      if (kind === "is") return (r[col] ?? null) === val;
      if (kind === "lt") return r[col] != null && r[col] < val;
      if (kind === "notin") return !val.includes(r[col]);
      return true;
    });
  const exec = (single) => {
    log.push({ table, op: q.op, filters: q.filters.map((f) => f.slice()), payload: q.payload });
    if (failing.has(`${table}.${q.op}`) || (q.op === "select" && failing.has(table))) {
      return { data: null, error: { message: `${table} unavailable` } };
    }
    db[table] ??= [];
    if (q.op === "insert") {
      const row = { id: q.payload.id ?? id(1000 + db[table].length), ...q.payload };
      db[table].push(row);
      return { data: single ? { ...row } : [{ ...row }], error: null };
    }
    const rows = db[table].filter(match);
    if (q.op === "update") for (const r of rows) Object.assign(r, q.payload);
    if (q.op === "delete") db[table] = db[table].filter((r) => !rows.includes(r));
    if (q.op === "update" && !q.returning) return { data: null, error: null };
    // Copies, like PostgREST: a later write must not change what was read.
    const out = rows.map((r) => structuredClone(r));
    return { data: single ? (out[0] ?? null) : out, error: null };
  };
  const b = {
    select: () => ((q.returning = true), b),
    eq: (c, v) => (q.filters.push(["eq", c, v]), b),
    neq: (c, v) => (q.filters.push(["neq", c, v]), b),
    in: (c, v) => (q.filters.push(["in", c, v]), b),
    is: (c, v) => (q.filters.push(["is", c, v]), b),
    lt: (c, v) => (q.filters.push(["lt", c, v]), b),
    not: (c, op, list) => (q.filters.push(["notin", c, String(list).slice(1, -1).split(",")]), b),
    limit: () => b,
    order: () => b,
    delete: () => ((q.op = "delete"), b),
    update: (p) => ((q.op = "update"), (q.payload = { ...p }), b),
    insert: (p) => ((q.op = "insert"), (q.payload = { ...p }), b),
    maybeSingle: async () => exec(true),
    single: async () => exec(true),
    then: (res, rej) => Promise.resolve(exec(false)).then(res, rej),
  };
  return b;
}

const fakeAdmin = {
  from: (t) => query(t),
  rpc: async (name) => (log.push({ op: "rpc", name }), { data: null, error: { message: "no rpc" } }),
  storage: {
    from: (bucket) => ({
      createSignedUploadUrl: async (path) => (
        log.push({ op: "storage.signUpload", bucket, path }),
        { data: { path, token: "t" }, error: null }
      ),
      upload: async (path, _body, options) => (
        log.push({ op: "storage.upload", bucket, path, options }),
        { data: { path }, error: null }
      ),
      remove: async (paths) => (log.push({ op: "storage.remove", bucket, paths }), { error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: "https://signed.invalid" }, error: null }),
      list: async () => ({ data: [], error: null }),
    }),
  },
};

/** The caller's own client: user_roles for isAdmin, applications for drivers. */
function userClient(userId) {
  return {
    from: (table) => {
      const f = {};
      const b = {
        select: () => b,
        eq: (c, v) => ((f[c] = v), b),
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          if (table === "user_roles") {
            return { data: f.role === "admin" && userId === OWNER ? { role: "admin" } : null, error: null };
          }
          if (table === "applications") {
            const own = userId === DRIVER_USER && (f.id === undefined || f.id === APP);
            return { data: own ? { id: APP } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return b;
    },
  };
}

const ROLES = `
const tier = (u) => u === "${OWNER}" ? "owner" : u === "${MANAGER}" ? "manager" : null;
const rank = { coordinator: 1, manager: 2, owner: 3 };
const need = (min) => async (u) => {
  const t = tier(u);
  if (!t || rank[t] < rank[min]) throw new Error("Forbidden");
  return { userId: u, tier: t, role: t };
};
export const getActor = async (u) => (tier(u) ? { userId: u, tier: tier(u), role: tier(u) } : null);
export const requireStaff = need("coordinator");
export const requireManager = need("manager");
export const requireOwner = need("owner");
`;

const stubs = {
  "@tanstack/react-start/server": "export const getRequest=()=>({headers:new Map()});",
  "@tanstack/react-start": `export const createServerFn=()=>{let validate=x=>x,auth=false;const api={middleware:()=>{auth=true;return api},inputValidator:v=>{validate=v;return api},handler:fn=>{const call=async args=>{if(auth&&!args.context?.userId)throw Error('Unauthorized');return fn({...args,data:validate(args.data)})};return call}};return api};
export const useServerFn=(fn)=>fn;`,
  "@/integrations/supabase/auth-middleware": "export const requireSupabaseAuth={};",
  "@/integrations/supabase/client.server":
    "export const supabaseAdmin=new Proxy({}, {get:(_,p)=>globalThis.__vault.admin[p]});",
  "@/integrations/supabase/client": "export const supabase={};",
  "@/lib/roles.server": ROLES,
  "@/lib/audit.server":
    "export const logAudit=async(actor,entry)=>{globalThis.__vault.audit.push(entry)};",
  "@/lib/identity-verification.functions": "export const verifyApprovalIdentity=async()=>({});",
  sonner: "export const toast={success(){},error(){}};",
};

globalThis.fetch = () => {
  throw new Error("network refused in vault-replace-guard test");
};
globalThis.__vault = { admin: fakeAdmin, audit: [] };

const dir = mkdtempSync(join(tmpdir(), "rr-vault-replace-"));
async function load(file, source) {
  const output = join(dir, file.replaceAll("/", "_") + ".mjs");
  await build({
    ...(source
      ? { stdin: { contents: source, resolveDir: resolve("."), sourcefile: file, loader: "tsx" } }
      : { entryPoints: [file] }),
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    jsx: "automatic",
    // react-dom/server's CommonJS build requires node built-ins.
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
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
  driver_id: APP,
  kind: "license_front",
  category: "license_front",
  storage_bucket: "driver-docs",
  storage_path: `${APP}/file-${n}.jpg`,
  label: null,
  file_name: `file-${n}.jpg`,
  is_current: true,
  superseded_by: null,
  visibility: ["driver", "admin"],
  review_status: "uploaded",
  review_note: null,
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

/** What the eSign archive writes (esign.server.ts, legacy layout). */
const signed = (n, over = {}) =>
  doc(n, {
    kind: "rental_agreement",
    category: "agreement",
    storage_bucket: "rental-agreements",
    storage_path: `${APP}/agreement-${id(900 + n)}.pdf`,
    file_name: `signed-agreement-${n}.pdf`,
    mime_type: "application/pdf",
    uploaded_by_role: "system",
    ...over,
  });

function reset(docs, agreements = []) {
  log = [];
  failing = new Set();
  globalThis.__vault.audit = [];
  db = { documents: docs.map((d) => ({ ...d })), agreements: agreements.map((a) => ({ ...a })) };
}

const writes = () => log.filter((e) => ["insert", "update", "delete"].includes(e.op));
const storage = () => log.filter((e) => e.op.startsWith("storage."));
const row = (docId) => db.documents.find((d) => d.id === docId);

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS", name);
  } catch (e) {
    failed++;
    console.log("FAIL", name, "\n    ", String(e?.message ?? e).split("\n")[0]);
  }
}

try {
  const docs = await load("src/lib/documents.functions.ts");
  const ctx = (userId) => ({ userId, supabase: userClient(userId) });
  const startUpload = (userId, category, applicationId = APP) =>
    docs.createDocumentUploadUrl({
      data: { applicationId, category, fileName: "new.pdf", mimeType: "application/pdf" },
      context: ctx(userId),
    });
  const confirm = (userId, category, n = 77) =>
    docs.confirmDocumentUpload({
      data: { applicationId: APP, category, path: `${APP}/${category}-${id(n)}.pdf`, fileName: "new.pdf" },
      context: ctx(userId),
    });
  const review = (userId, documentId, status, note = null) =>
    docs.setDocumentReview({ data: { documentId, status, note }, context: ctx(userId) });

  /** Replace = upload URL, bytes, confirm. Both server steps must refuse. */
  async function replaceRefused(seed, category, userId, agreements = []) {
    const target = seed[0];
    reset(seed, agreements);
    await assert.rejects(startUpload(userId, category), REFUSED, "upload URL refused");
    await assert.rejects(confirm(userId, category), REFUSED, "confirm refused");
    assert.deepEqual(storage(), [], "no upload URL was signed, no object touched");
    assert.deepEqual(writes(), [], "no documents row inserted, superseded or changed");
    assert.equal(row(target.id).is_current, true, "signed row still current");
    assert.equal(row(target.id).superseded_by, null, "signed row not superseded");
  }

  // ---------------------------------------------------------------- Replace

  await test("Replace on the Signed agreement card is refused (Owner): nothing signed, inserted or superseded", async () => {
    await replaceRefused([signed(1)], "agreement", OWNER);
  });

  await test("Replace on the Signed agreement card is refused (Manager)", async () => {
    await replaceRefused([signed(2)], "agreement", MANAGER);
  });

  await test("a completed-v1 archive row is refused too", async () => {
    await replaceRefused(
      [signed(3, { storage_path: `completed-v1/${id(3)}/${"a".repeat(64)}.pdf` })],
      "agreement",
      OWNER,
    );
  });

  await test("an ordinary-looking row an agreement points at cannot be superseded through its category", async () => {
    const d = doc(4, { kind: "other", category: "other", visibility: ["admin"] });
    await replaceRefused([d], "other", OWNER, [
      { id: id(904), document_id: d.id, completed_document_id: null },
    ]);
    const e = doc(5, { kind: "other", category: "other", visibility: ["admin"] });
    await replaceRefused([e], "other", OWNER, [
      { id: id(905), document_id: null, completed_document_id: e.id },
    ]);
  });

  await test("an agreements lookup that fails refuses the upload (fail closed)", async () => {
    reset([doc(6, { category: "other", kind: "other" })]);
    failing.add("agreements");
    await assert.rejects(startUpload(OWNER, "other"), /Nothing was uploaded/);
    await assert.rejects(confirm(OWNER, "other"), /Nothing was uploaded/);
    assert.deepEqual(storage(), []);
    assert.deepEqual(writes(), []);
  });

  await test("a documents lookup that fails refuses the upload (fail closed)", async () => {
    reset([signed(7)]);
    failing.add("documents");
    await assert.rejects(startUpload(OWNER, "agreement"), /Nothing was uploaded/);
    await assert.rejects(confirm(OWNER, "agreement"), /Nothing was uploaded/);
    assert.deepEqual(storage(), []);
    assert.deepEqual(writes(), []);
  });

  await test("a driver cannot upload into the Signed agreement category at all (portal path)", async () => {
    // With a signed agreement on file: would have superseded it.
    reset([signed(8)]);
    await assert.rejects(startUpload(DRIVER_USER, "agreement"), /eSign/);
    await assert.rejects(confirm(DRIVER_USER, "agreement"), /eSign/);
    assert.deepEqual(storage(), []);
    assert.deepEqual(writes(), []);
    assert.equal(row(id(8)).is_current, true);
    // Without one: would have planted a driver file as the "Signed agreement".
    reset([]);
    await assert.rejects(startUpload(DRIVER_USER, "agreement"), /eSign/);
    await assert.rejects(confirm(DRIVER_USER, "agreement"), /eSign/);
    assert.deepEqual(writes(), []);
  });

  // --------------------------------------------------------------- Needs New

  await test("Needs New on a signed agreement is refused: no review change, no audit", async () => {
    reset([signed(10)]);
    await assert.rejects(review(MANAGER, id(10), "rejected", "wrong car"), REFUSED);
    assert.deepEqual(writes(), []);
    assert.equal(row(id(10)).review_status, "uploaded");
    assert.deepEqual(globalThis.__vault.audit, []);
  });

  await test("Needs New on an ordinary-looking row an agreement points at is refused", async () => {
    const d = doc(11, { category: "other", kind: "other" });
    reset([d], [{ id: id(911), document_id: d.id, completed_document_id: d.id }]);
    await assert.rejects(review(OWNER, d.id, "rejected"), REFUSED);
    assert.deepEqual(writes(), []);
  });

  await test("a stale Needs Replacement on a signed agreement can still be cleared or verified", async () => {
    reset([signed(12, { review_status: "rejected", review_note: "old" })]);
    assert.deepEqual(await review(MANAGER, id(12), "uploaded"), { ok: true });
    assert.equal(row(id(12)).review_status, "uploaded");
    assert.deepEqual(await review(MANAGER, id(12), "verified"), { ok: true });
    assert.equal(row(id(12)).review_status, "verified");
  });

  // -------------------------------------------------------- ordinary documents

  await test("ordinary Replace still works: new current row, old licence superseded (staff)", async () => {
    const old = doc(20);
    reset([old, signed(21)]);
    const up = await startUpload(OWNER, "license_front");
    assert.equal(up.bucket, "driver-docs");
    assert.ok(up.path.startsWith(`${APP}/license_front-`));
    const res = await confirm(OWNER, "license_front");
    assert.equal(res.ok, true);
    assert.equal(row(old.id).is_current, false);
    assert.equal(row(old.id).superseded_by, res.id);
    assert.equal(row(res.id).is_current, true);
    assert.equal(row(id(21)).is_current, true, "the signed agreement is untouched");
  });

  await test("ordinary Replace still works for the driver on their own application", async () => {
    const old = doc(22, { category: "insurance", kind: "insurance" });
    reset([old]);
    const up = await startUpload(DRIVER_USER, "insurance", undefined);
    assert.equal(up.applicationId, APP);
    const res = await confirm(DRIVER_USER, "insurance");
    assert.equal(row(old.id).superseded_by, res.id);
  });

  await test("staff can still file a first agreement into an empty Signed agreement slot", async () => {
    reset([doc(23)]);
    await startUpload(OWNER, "agreement");
    const res = await confirm(OWNER, "agreement");
    assert.equal(row(res.id).category, "agreement");
    assert.equal(row(id(23)).is_current, true, "other categories untouched");
  });

  await test("Needs New still works on an ordinary document, audited", async () => {
    reset([doc(24)]);
    assert.deepEqual(await review(MANAGER, id(24), "rejected", "blurry"), { ok: true });
    assert.equal(row(id(24)).review_status, "rejected");
    assert.equal(globalThis.__vault.audit.length, 1);
  });

  // -------------------------------------------------------------------- UI

  await test("ApplicantDocuments renders no Replace and no Needs New on a signed agreement card", async () => {
    // One bundle holds the component AND the renderer, so there is one React.
    const ui = await load(
      "ApplicantDocuments.render.tsx",
      `import { renderToStaticMarkup } from "react-dom/server";
       import { ApplicantDocuments } from "@/components/admin/ApplicantDocuments";
       export const render = (props) => renderToStaticMarkup(<ApplicantDocuments {...props} />);`,
    );
    const vault = (d) => ({
      id: d.id,
      category: d.category,
      label: d.label,
      file_name: d.file_name,
      mime_type: d.mime_type ?? null,
      size_bytes: null,
      expires_at: null,
      is_current: true,
      visibility: d.visibility,
      uploaded_by_role: null,
      created_at: d.created_at,
      url: "https://signed.invalid",
      review_status: d.review_status,
      review_note: null,
      reviewed_at: null,
      signed_agreement: d.category === "agreement" || d.kind === "rental_agreement",
    });
    const html = ui.render({
      applicationId: APP,
      docs: [vault(signed(30)), vault(doc(31))],
      loading: false,
      onRefresh: () => {},
    });
    const cards = html.split('class="rounded-xl border border-[#EDEDF0] bg-white overflow-hidden flex flex-col"').slice(1);
    const card = (title) => {
      const hit = cards.find((c) => c.includes(`>${title}</span>`));
      assert.ok(hit, `card ${title} rendered`);
      return hit;
    };
    const agreement = card("Signed agreement");
    assert.doesNotMatch(agreement, />Replace</, "no Replace on the signed agreement");
    assert.doesNotMatch(agreement, /Needs New/, "no Needs New on the signed agreement");
    assert.doesNotMatch(agreement, /title="Delete"/, "no Delete on the signed agreement");
    assert.match(agreement, /Permanent Record/);
    const licence = card("Driver&#x27;s license (front)");
    assert.match(licence, />Replace</, "ordinary documents keep Replace");
    assert.match(licence, /Needs New/, "ordinary documents keep Needs New");
    // An empty card still offers Upload (staff filing a first paper agreement).
    assert.match(card("Insurance card"), />Upload</);
  });

  await test("DocumentVault gates Replace on the same rule", async () => {
    const vault = readFileSync("src/components/admin/DocumentVault.tsx", "utf8");
    assert.match(vault, /signedAgreementLocked\(current, cat\.key\)/);
    assert.equal((vault.match(/<FileUploader/g) ?? []).length, 2, "per-category uploader + team-only upload");
    const ev = await load("src/lib/signed-agreement-evidence.ts");
    const rows = [
      { category: "agreement", signed_agreement: true, is_current: true },
      { category: "other", signed_agreement: false, is_current: true },
      { category: "insurance", signed_agreement: true, is_current: false },
    ];
    assert.equal(ev.signedAgreementLocked(rows, "agreement"), true);
    assert.equal(ev.signedAgreementLocked(rows, "other"), false);
    assert.equal(ev.signedAgreementLocked(rows, "insurance"), false, "history rows do not lock");
    assert.equal(ev.signedAgreementLocked(rows, "license_front"), false);
  });

  // ------------------------------------------------------- archive retry path

  await test("eSign archive retry (cron/staff retry) still re-archives a signed agreement's PDF", async () => {
    const esign = await load("src/lib/esign.server.ts");
    const agId = id(940);
    const existing = signed(40, { storage_path: `${APP}/agreement-${agId}.pdf` });
    reset(
      [existing],
      [
        {
          id: agId,
          application_id: APP,
          vehicle_id: null,
          source: "application",
          title: "Rental Agreement",
          body: "The renter agrees to the terms.",
          status: "signed",
          signer_name: "Pat Driver",
          signer_email: "pat@example.invalid",
          signed_at: "2026-10-20T15:00:00Z",
          sent_at: "2026-10-20T14:00:00Z",
          viewed_at: "2026-10-20T14:30:00Z",
          created_at: "2026-10-20T13:00:00Z",
          auth_method: "email_link",
          metadata: {},
          archive_status: "failed",
          archive_attempts: 1,
          archive_last_attempt_at: null,
          document_id: existing.id,
        },
      ],
    );
    // The server-side archive retry never goes through the vault endpoints,
    // so the vault guard cannot stop it re-uploading the signed PDF.
    assert.equal(await esign.retryArchive(fakeAdmin, agId, null), true);
    const uploads = storage().filter((e) => e.op === "storage.upload");
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].bucket, "rental-agreements");
    assert.equal(uploads[0].path, existing.storage_path);
    const ag = db.agreements[0];
    assert.equal(ag.archive_status, "archived");
    assert.equal(ag.document_id, existing.id, "agreement still points at its signed record");
    assert.match(ag.sha256, /^[0-9a-f]{64}$/);
    assert.equal(db.documents.length, 1, "no second documents row");
    assert.equal(row(existing.id).is_current, true);
    assert.ok(
      globalThis.__vault.audit.some((a) => a.action === "document.archive_recovered"),
      "recovery audited",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
