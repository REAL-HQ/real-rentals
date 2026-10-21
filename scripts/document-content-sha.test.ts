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
ok(flagFile.includes('schema("storage")') && flagFile.includes("user_metadata"), "the flag-on path writes storage.objects.user_metadata");
ok(!flagFile.includes("metadata: storageShaMetadata"), "the flag-on path does not pass metadata to upload");

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
const updates: Record<string, unknown>[] = [];
let uploads = 0;
let downloads = 0;
const sha = await writeUploadedContentSha(
  {
    storage: {
      from() {
        return {
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
    schema(name: string) {
      ok(name === "storage", "the metadata write uses the storage schema");
      return {
        from(table: string) {
          ok(table === "objects", "the metadata write targets storage.objects");
          const filters: string[] = [];
          const b: any = {
            select() { return b; },
            eq(column: string, value: string) {
              filters.push(`${column}=${value}`);
              return b;
            },
            maybeSingle: async () => ({ data: { user_metadata: { source: "client" } }, error: null }),
            update(values: { user_metadata: Record<string, unknown> }) {
              updates.push(values.user_metadata);
              ok(!("metadata" in values), "the update does not replace system metadata");
              return b;
            },
            then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
              ok(filters.includes("bucket_id=driver-docs") && filters.includes("name=app/license_front.jpg"), "the update names the uploaded object");
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return b;
        },
      };
    },
  },
  "driver-docs",
  "app/license_front.jpg",
);
ok(downloads === 1, "flag on downloads the stored bytes once");
ok(uploads === 0, "flag on does not upload or overwrite the object");
ok(sha === (await contentSha256Hex(sample)), "flag on returns the hash of the downloaded bytes");
ok(updates.length === 1 && updates[0]?.sha256 === sha && updates[0]?.source === "client", "flag on merges sha256 into the existing user_metadata");
ok(storageShaMetadata(sha).sha256 === sha, "storage user_metadata uses the sha256 key");

let missingWrites = 0;
try {
  await writeUploadedContentSha(
    {
      storage: {
        from() {
          return { download: async () => ({ data: new Blob([sample]), error: null }) };
        },
      },
      schema() {
        return {
          from() {
            const b: any = {
              select() { return b; },
              eq() { return b; },
              maybeSingle: async () => ({ data: null, error: null }),
              update() {
                missingWrites += 1;
                return b;
              },
            };
            return b;
          },
        };
      },
    },
    "driver-docs",
    "missing.jpg",
  );
  ok(false, "a missing object throws");
} catch (e) {
  ok(e instanceof Error && e.message === "Uploaded object missing", "a missing object throws instead of returning null");
}
ok(missingWrites === 0, "a missing object does not write user_metadata");

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
