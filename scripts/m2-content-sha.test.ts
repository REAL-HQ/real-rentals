/**
 * The flag-on upload hasher and Postgres extensions.digest must agree on the
 * byte strings the functional proof uses. The proof SQL must not contain a
 * typed 64-hex sha.
 */
import { readFileSync } from "node:fs";
import { DOCUMENT_CONTENT_SHA256_ENABLED, contentSha256Hex } from "../src/lib/document-content-sha";

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
