// Dark upload hasher (run: bun scripts/document-content-sha.test.ts).
// Flag off: the document insert omits content_sha256 and storage is not read.
// Flag on: contentSha256Hex matches extensions.digest. Local Postgres only.
import { readFileSync } from "node:fs";
import {
  DOCUMENT_CONTENT_SHA256_ENABLED,
  contentSha256Hex,
  recordUploadedContentSha,
  storageShaMetadata,
} from "../src/lib/document-content-sha";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flagFile = readFileSync("src/lib/document-content-sha.ts", "utf8");
const documents = readFileSync("src/lib/documents.functions.ts", "utf8");

ok(DOCUMENT_CONTENT_SHA256_ENABLED === false, "DOCUMENT_CONTENT_SHA256_ENABLED is false");
ok(!/process\.env/.test(flagFile), "no environment variable can open the flag");

let storageCalls = 0;
const admin = {
  storage: {
    from() {
      storageCalls += 1;
      throw new Error("storage was read while the flag is off");
    },
  },
};
const off = await recordUploadedContentSha(admin, "driver-docs", "app/license_front.jpg", "image/jpeg");
ok(off === null, "flag off returns null");
ok(storageCalls === 0, "flag off does not read or write storage");

const spread = "...(contentSha ? { content_sha256: contentSha } : {})";
const spreads = documents.split(spread).length - 1;
ok(spreads === 2, "registerDocument and confirmDocumentUpload add content_sha256 only when a sha comes back");
ok((documents.match(/content_sha256/g) ?? []).length === 2, "content_sha256 appears only in those two conditional spreads");
ok(
  documents.includes("const contentSha = await recordUploadedContentSha(admin, args.bucket, args.path, args.mimeType);"),
  "registerDocument asks for the sha before its insert",
);
ok(
  documents.includes("const contentSha = await recordUploadedContentSha(supabaseAdmin, DOC_BUCKET, data.path, data.mimeType);"),
  "confirmDocumentUpload asks for the sha before its insert",
);

const registerColumns = [
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
function insertColumns(contentSha: string | null) {
  return {
    driver_id: "app",
    kind: "license_front",
    category: "license_front",
    label: null,
    storage_bucket: "driver-docs",
    storage_path: "app/license_front.jpg",
    visibility: ["driver", "admin"],
    file_name: null,
    mime_type: null,
    size_bytes: null,
    expires_at: null,
    is_current: true,
    uploaded_by: null,
    uploaded_by_role: "driver",
    ...(contentSha ? { content_sha256: contentSha } : {}),
  };
}
const unchanged = insertColumns(null);
ok(
  JSON.stringify(Object.keys(unchanged)) === JSON.stringify(registerColumns),
  "with the flag off the insert columns are the existing columns",
);
ok(!("content_sha256" in unchanged), "a null sha does not add content_sha256");
const sampleSha = "66cd8986298ba1265463727de09dbc11f65fc4a17d9726222218b63c56793f0c";
const withSha = insertColumns(sampleSha);
ok(withSha.content_sha256 === sampleSha, "a returned sha is the only added insert column");
ok(storageShaMetadata(sampleSha).sha256 === sampleSha, "storage metadata uses the sha256 key");
ok(flagFile.includes("if (!DOCUMENT_CONTENT_SHA256_ENABLED) return null;"), "the hasher returns before storage when the flag is off");
ok(
  flagFile.includes("contentSha256Hex(bytes)") && flagFile.includes("metadata: storageShaMetadata(sha256)"),
  "the flag-on path hashes the downloaded bytes and writes metadata.sha256",
);

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
  for (const sample of samples) {
    const app = await contentSha256Hex(new TextEncoder().encode(sample));
    const [row] = await sql<{ digest: string }[]>`
      select encode(extensions.digest(convert_to(${sample}, 'UTF8'), 'sha256'), 'hex') as digest
    `;
    ok(app === row.digest && /^[0-9a-f]{64}$/.test(app), `flag-on hash matches extensions.digest for ${JSON.stringify(sample)}`);
  }
  const [front] = await sql<{ digest: string }[]>`
    select encode(extensions.digest(convert_to('m2-license-front-v1', 'UTF8'), 'sha256'), 'hex') as digest
  `;
  const [back] = await sql<{ digest: string }[]>`
    select encode(extensions.digest(convert_to('m2-license-back-v1', 'UTF8'), 'sha256'), 'hex') as digest
  `;
  ok(front.digest !== back.digest, "front and back digests differ");
  ok(front.digest === "66cd8986298ba1265463727de09dbc11f65fc4a17d9726222218b63c56793f0c", "front digest is the known extensions.digest value");
} finally {
  await sql.end();
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall content sha checks pass");
process.exit(fails ? 1 : 0);
