/**
 * The flag-on upload hasher and Postgres extensions.digest must agree on the
 * byte strings the functional proof uses. The proof SQL must not contain a
 * typed 64-hex sha.
 */
import { readFileSync } from "node:fs";
import {
  DOCUMENT_CONTENT_SHA256_ENABLED,
  applyUploadedContentSha,
  contentSha256Hex,
  resetUploadedContentShaProbe,
} from "../src/lib/document-content-sha";
import { persistConfirmedDocument } from "../src/lib/documents.functions";

const PROOF = new URL("./m2-functional-proof.sql", import.meta.url);
const proof = readFileSync(PROOF, "utf8");
const hasher = readFileSync(new URL("../src/lib/document-content-sha.ts", import.meta.url), "utf8");

if (DOCUMENT_CONTENT_SHA256_ENABLED !== false) {
  throw new Error("DOCUMENT_CONTENT_SHA256_ENABLED must stay false");
}
if (hasher.includes(".upload(")) throw new Error("hasher re-uploads the object");
if (hasher.includes('schema("storage")') || hasher.includes("schema('storage')")) {
  throw new Error("hasher updates storage.objects through PostgREST");
}
if (hasher.includes('.from("objects")')) throw new Error("hasher selects storage.objects");
if (!hasher.includes('rpc("record_uploaded_content_sha"')) {
  throw new Error("hasher does not call record_uploaded_content_sha");
}
const missingBranch = hasher.slice(hasher.indexOf("if (uploadedContentShaMissing)"), hasher.indexOf("try {"));
if (missingBranch.includes("console.error")) {
  throw new Error("a missing packet function is logged on every later upload");
}

type DocRow = Record<string, unknown> & { id: string };
function confirmTable(seed: DocRow[]) {
  const rows: DocRow[] = seed.map((row) => ({ ...row }));
  function from(table: string) {
    const filters: { op: "eq" | "neq"; col: string; val: unknown }[] = [];
    let payload: Record<string, unknown> | null = null;
    let mode: "insert" | "update" | "select" = "select";
    const b: any = {
      select() { return b; },
      eq(col: string, val: unknown) { filters.push({ op: "eq", col, val }); return b; },
      neq(col: string, val: unknown) { filters.push({ op: "neq", col, val }); return b; },
      insert(next: Record<string, unknown>) { mode = "insert"; payload = { ...next }; return b; },
      update(next: Record<string, unknown>) { mode = "update"; payload = { ...next }; return b; },
      delete() { throw new Error("confirm deleted a document row"); },
      single() { return exec(); },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return exec().then(resolve, reject); },
    };
    function matches(row: DocRow) {
      return filters.every((f) => (f.op === "eq" ? row[f.col] === f.val : row[f.col] !== f.val));
    }
    function exec() {
      if (table !== "documents") return Promise.resolve({ data: null, error: { message: "unexpected table" } });
      if (mode === "insert") {
        const id = `new-${rows.length}`;
        rows.push({ ...(payload as DocRow), id });
        return Promise.resolve({ data: { id }, error: null });
      }
      if (mode === "update") {
        for (const row of rows) if (matches(row)) Object.assign(row, payload);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: rows.filter(matches), error: null });
    }
    return b;
  }
  return { rows, admin: { from } };
}
const confirmFields = {
  driver_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "license_front",
  category: "license_front",
  label: null,
  storage_bucket: "driver-docs",
  storage_path: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/license_front.jpg",
  visibility: ["driver", "admin"],
  file_name: null,
  mime_type: null,
  size_bytes: null,
  expires_at: null,
  uploaded_by: null,
  uploaded_by_role: "driver",
};
const thrown = confirmTable([{
  id: "old-current",
  driver_id: confirmFields.driver_id,
  category: "license_front",
  is_current: true,
}]);
let hashThrew = false;
try {
  await persistConfirmedDocument(thrown.admin, confirmFields, async () => {
    throw new Error("object changed");
  });
} catch (e) {
  hashThrew = e instanceof Error && e.message === "object changed";
}
if (!hashThrew) throw new Error("hash throws after insert did not throw");
if (thrown.rows.filter((row) => row.is_current === true).length !== 1) {
  throw new Error("hash throws after insert left more than one current row");
}
await persistConfirmedDocument(
  thrown.admin,
  { ...confirmFields, storage_path: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/retry.jpg" },
  async () => {
    throw new Error("object changed");
  },
).catch((e: Error) => {
  if (e.message !== "object changed") throw e;
});
if (thrown.rows.filter((row) => row.is_current === true).length !== 1) {
  throw new Error("a retry left more than one current row");
}
if (thrown.rows.length !== 3) throw new Error("a retry deleted an unhashed row");

const stamped = confirmTable([]);
const stampedSaved = await persistConfirmedDocument(
  stamped.admin,
  { ...confirmFields, storage_path: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/hashed.jpg" },
  async () => "hashed-token",
);
const stampedRow = stamped.rows.find((row) => row.id === stampedSaved.id);
if (!stampedRow || stampedRow.content_sha256 !== "hashed-token") {
  throw new Error("confirm path did not record the returned content hash");
}

resetUploadedContentShaProbe();
const missingLogs: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  missingLogs.push(args.map(String).join(" "));
};
const missingAdmin = {
  storage: {
    from() {
      return {
        async info() {
          return { data: { id: "11111111-1111-4111-8111-111111111111", version: "v1", updatedAt: "2026-10-21T01:02:03.000Z" }, error: null };
        },
        async download() {
          return { data: new Blob(["m2-license-front-v1"]), error: null };
        },
      };
    },
  },
  async rpc() {
    return { data: null, error: { code: "42883", message: "function public.record_uploaded_content_sha(text, text, text, uuid, text, timestamptz) does not exist" } };
  },
};
await applyUploadedContentSha(missingAdmin, "driver-docs", "app/license_front.jpg");
await applyUploadedContentSha(missingAdmin, "driver-docs", "app/license_front.jpg");
console.error = originalError;
resetUploadedContentShaProbe();
if (missingLogs.length !== 1) throw new Error(`missing function was logged ${missingLogs.length} times`);

if (/[0-9a-f]{64}/i.test(proof)) {
  throw new Error("functional proof contains a 64-hex literal");
}

const samples = ["m2-license-front-v1", "m2-license-back-v1", "m2-signed-agreement-v1", "signed terms"];
const url = process.env.M2_DATABASE_URL;
if (!url) throw new Error("M2_DATABASE_URL is required");

const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1 });
try {
  for (const sample of samples) {
    const app = await contentSha256Hex(new TextEncoder().encode(sample));
    const [row] = await sql<{ digest: string }[]>`
      select encode(extensions.digest(convert_to(${sample}, 'UTF8'), 'sha256'), 'hex') as digest
    `;
    if (app !== row.digest) {
      throw new Error(`hash mismatch for ${JSON.stringify(sample)}: app ${app} postgres ${row.digest}`);
    }
    if (!/^[0-9a-f]{64}$/.test(app)) throw new Error(`digest is not 64 hex for ${sample}`);
  }
  const [front] = await sql<{ digest: string }[]>`
    select encode(extensions.digest(convert_to('m2-license-front-v1', 'UTF8'), 'sha256'), 'hex') as digest
  `;
  const [back] = await sql<{ digest: string }[]>`
    select encode(extensions.digest(convert_to('m2-license-back-v1', 'UTF8'), 'sha256'), 'hex') as digest
  `;
  if (front.digest === back.digest) throw new Error("front and back digests must differ");
  console.log("content sha matches extensions.digest");
  console.log(`front ${front.digest}`);
  console.log(`back ${back.digest}`);
} finally {
  await sql.end();
}
