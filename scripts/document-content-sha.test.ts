// Dark upload hasher (run: bun scripts/document-content-sha.test.ts).
// Flag off: registerDocument's real insert omits content_sha256 and storage
// is not read. Flag on: writeUploadedContentSha hashes the downloaded bytes,
// sets user_metadata.sha256, and does not upload again. The hash matches
// extensions.digest. Local Postgres only.
import { readFileSync } from "node:fs";
import {
  DOCUMENT_CONTENT_SHA256_ENABLED,
  contentSha256Hex,
  recordUploadedContentSha,
  storageShaMetadata,
  writeUploadedContentSha,
} from "../src/lib/document-content-sha";
import { registerDocument } from "../src/lib/documents.functions";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flagFile = readFileSync("src/lib/document-content-sha.ts", "utf8");
const documents = readFileSync("src/lib/documents.functions.ts", "utf8");
const liveColumns = [
  "driver_id",
  "kind",
  "category",
  "label",
  "storage_bucket",
  "storage_path",
  "visibility",
  "file_name",
  "mime_type",
  "size_bytes",
  "expires_at",
  "is_current",
  "uploaded_by",
  "uploaded_by_role",
];

ok(DOCUMENT_CONTENT_SHA256_ENABLED === false, "DOCUMENT_CONTENT_SHA256_ENABLED is false");
ok(flagFile.includes("export const DOCUMENT_CONTENT_SHA256_ENABLED = false;"), "the flag is a hard false constant");
ok(!/process\.env/.test(flagFile), "no environment variable can open the flag");
ok(!flagFile.includes(".upload("), "the hasher does not upload the object again");
ok(!flagFile.includes('schema("storage")') && !flagFile.includes('.from("objects")'), "the hasher does not use PostgREST on storage.objects");
ok(flagFile.includes('rpc("record_uploaded_content_sha"'), "the flag-on path calls the public packet function");
ok(flagFile.includes(".info(") && flagFile.includes(".download("), "the flag-on path uses the Storage API to read the object");
const packetSql = readFileSync("proposed/record-uploaded-content-sha.sql", "utf8");
ok(packetSql.includes("SECURITY DEFINER"), "the packet function is security definer");
ok(packetSql.includes("COALESCE(user_metadata, '{}'::jsonb) || jsonb_build_object('sha256'"), "the merge keeps concurrent user_metadata keys");
ok(packetSql.includes("version IS NOT DISTINCT FROM"), "the write matches the hashed object's version");
ok(packetSql.includes("updated_at IS NOT DISTINCT FROM"), "the write can match updated_at when version is absent");
ok(packetSql.includes("SET content_sha256 = p_sha256"), "the function sets documents.content_sha256 when the row exists");
ok(packetSql.includes("GRANT EXECUTE ON FUNCTION public.record_uploaded_content_sha(text, text, text, uuid, text, timestamptz) TO service_role"), "service_role can call the function");
ok(!packetSql.includes("schema(\"storage\")"), "the packet step is a public function");

let storageCalls = 0;
const off = await recordUploadedContentSha(
  {
    storage: {
      from() {
        storageCalls += 1;
        throw new Error("storage was read while the flag is off");
      },
    },
    schema() {
      storageCalls += 1;
      throw new Error("storage was read while the flag is off");
    },
  },
  "driver-docs",
  "app/license_front.jpg",
);
ok(off === null, "flag off returns null");
ok(storageCalls === 0, "flag off does not read or write storage");

const inserted: Record<string, unknown>[] = [];
function chain(table: string) {
  const state: { payload: Record<string, unknown> | null } = { payload: null };
  const b: any = {
    select() { return b; },
    eq() { return b; },
    is() { return b; },
    neq() { return b; },
    update() { return b; },
    insert(payload: Record<string, unknown>) {
      state.payload = payload;
      if (table === "documents") inserted.push(payload);
      return b;
    },
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: { id: "doc-real-1" }, error: null }),
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      return Promise.resolve({ error: null, data: null }).then(resolve, reject);
    },
  };
  return b;
}
const registered = await registerDocument(
  {
    from: chain,
    storage: {
      from() {
        throw new Error("registerDocument read storage while the flag is off");
      },
    },
  },
  {
    applicationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    category: "license_front",
    bucket: "driver-docs",
    path: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/license_front.jpg",
    fileName: "license_front.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 12,
    label: "Driver's license (front)",
    uploadedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    uploadedByRole: "driver",
  },
);
ok(registered?.id === "doc-real-1", "registerDocument returns the inserted id");
ok(inserted.length === 1, "registerDocument performs one insert");
ok(JSON.stringify(Object.keys(inserted[0] ?? {})) === JSON.stringify(liveColumns), "the real insert columns are unchanged");
ok(!("content_sha256" in (inserted[0] ?? {})), "the real insert omits content_sha256 while the flag is off");
ok(
  documents.includes("...(contentSha ? { content_sha256: contentSha } : {})"),
  "confirmDocumentUpload uses the same conditional content_sha256 spread",
);
ok((documents.match(/content_sha256/g) ?? []).length === 2, "content_sha256 appears only in the two real inserts");

const registerFn = documents.slice(documents.indexOf("export async function registerDocument"), documents.indexOf("export const APPLICATION_UPLOAD_FIELDS"));
ok(!registerFn.includes("try {"), "registerDocument does not catch the hasher, so a flag-on failure throws");
ok(documents.includes('console.error("[documents] registration refused"'), "syncApplicationUploads catches a thrown registration and continues");
const confirmFn = documents.slice(documents.indexOf("export const confirmDocumentUpload"), documents.indexOf("export const updateDocumentMeta"));
ok(confirmFn.includes("await recordUploadedContentSha(supabaseAdmin, DOC_BUCKET, data.path);"), "confirmDocumentUpload awaits the hasher");
ok(!confirmFn.includes("catch"), "confirmDocumentUpload lets a flag-on hasher failure refuse the confirm");

const sample = new TextEncoder().encode("m2-license-front-v1");
const stored = {
  id: "11111111-1111-4111-8111-111111111111",
  version: "v1",
  lastModified: "2026-10-21T00:00:00.000Z",
  user_metadata: { source: "client" } as Record<string, unknown>,
};
let uploads = 0;
let downloads = 0;
let infos = 0;
const rpcArgs: Record<string, unknown>[] = [];
const sha = await writeUploadedContentSha(
  {
    storage: {
      from(bucket: string) {
        ok(bucket === "driver-docs", "the Storage API call names the upload bucket");
        return {
          async info(objectPath: string) {
            infos += 1;
            ok(objectPath === "app/license_front.jpg", "info names the uploaded object");
            return { data: { id: stored.id, version: stored.version, lastModified: stored.lastModified }, error: null };
          },
          async download() {
            downloads += 1;
            return { data: new Blob([sample]), error: null };
          },
          async upload() {
            uploads += 1;
            throw new Error("upload rewrote the object");
          },
        };
      },
    },
    schema() {
      throw new Error("PostgREST storage schema is not exposed");
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      ok(fn === "record_uploaded_content_sha", "the client calls the public function");
      ok(!("user_metadata" in args), "the client does not send a replacement metadata object");
      rpcArgs.push(args);
      if (args.p_object_id !== stored.id || args.p_version !== stored.version) {
        return { data: null, error: { message: "content_sha256_object_changed" } };
      }
      stored.user_metadata = { ...stored.user_metadata, reviewed: true, sha256: args.p_sha256 };
      return { data: args.p_sha256, error: null };
    },
  },
  "driver-docs",
  "app/license_front.jpg",
);
ok(infos === 1, "flag on reads the object id and version once");
ok(downloads === 1, "flag on downloads the stored bytes once");
ok(uploads === 0, "flag on does not upload or overwrite the object");
ok(sha === (await contentSha256Hex(sample)), "flag on returns the hash of the downloaded bytes");
ok(rpcArgs.length === 1 && rpcArgs[0]?.p_sha256 === sha && rpcArgs[0]?.p_version === "v1", "the conditional write sends the hash and the version that was read");
ok(stored.user_metadata.sha256 === sha && stored.user_metadata.source === "client" && stored.user_metadata.reviewed === true, "the merge keeps concurrent user_metadata keys");
ok(storageShaMetadata(sha).sha256 === sha, "storage user_metadata uses the sha256 key");

try {
  await writeUploadedContentSha(
    {
      storage: {
        from() {
          return {
            info: async () => ({ data: null, error: null }),
            download: async () => ({ data: new Blob([sample]), error: null }),
          };
        },
      },
      rpc() {
        throw new Error("rpc ran for a missing object");
      },
    },
    "driver-docs",
    "missing.jpg",
  );
  ok(false, "a missing object throws");
} catch (e) {
  ok(e instanceof Error && e.message === "Uploaded object missing", "a missing object throws instead of returning null");
}

const replaced = { version: "v1", user_metadata: { source: "client" } as Record<string, unknown> };
try {
  await writeUploadedContentSha(
    {
      storage: {
        from() {
          return {
            async info() {
              return { data: { id: stored.id, version: "v1", lastModified: stored.lastModified }, error: null };
            },
            async download() {
              replaced.version = "v2";
              return { data: new Blob([sample]), error: null };
            },
          };
        },
      },
      async rpc(_fn: string, args: Record<string, unknown>) {
        if (args.p_version !== replaced.version) return { data: null, error: { message: "content_sha256_object_changed" } };
        replaced.user_metadata = { ...replaced.user_metadata, sha256: args.p_sha256 };
        return { data: args.p_sha256, error: null };
      },
    },
    "driver-docs",
    "app/license_front.jpg",
  );
  ok(false, "a replaced object throws");
} catch (e) {
  ok(e instanceof Error && e.message === "content_sha256_object_changed", "a concurrent replace fails the conditional write");
}
ok(!("sha256" in replaced.user_metadata) && replaced.version === "v2", "a concurrent replace does not write the old hash");

const url = process.env.DOCUMENT_SHA_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable";
ok(url.includes("127.0.0.1") || url.includes("localhost"), "the digest comparison stays on local Postgres");
if (!(url.includes("127.0.0.1") || url.includes("localhost"))) {
  console.log(`\n${fails} FAILURE(S)`);
  process.exit(1);
}
const samples = ["m2-license-front-v1", "m2-license-back-v1", "m2-signed-agreement-v1", "signed terms"];
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1 });
try {
  for (const text of samples) {
    const app = await contentSha256Hex(new TextEncoder().encode(text));
    const [row] = await sql<{ digest: string }[]>`
      select encode(extensions.digest(convert_to(${text}, 'UTF8'), 'sha256'), 'hex') as digest
    `;
    ok(app === row.digest && /^[0-9a-f]{64}$/.test(app), `flag-on hash matches extensions.digest for ${JSON.stringify(text)}`);
  }
} finally {
  await sql.end();
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall content sha checks pass");
process.exit(fails ? 1 : 0);
