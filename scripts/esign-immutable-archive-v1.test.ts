// Dark eSign immutable-v1 archive (run: bun scripts/esign-immutable-archive-v1.test.ts).
// Flag off: archiveDocument matches the live eSign byte for byte, aside from
// the flag gate. Flag on: storage and the documents row land at
// rental-agreements/immutable-v1/{docId}/{sha}.pdf before the agreement
// receives sha256 and document_id.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { archiveDocument } from "../src/lib/esign.server";
import { ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED } from "../src/lib/esign-immutable-archive-flag";
import { archiveImmutableV1 } from "../src/lib/esign-immutable-archive-write.server";
import { sha256Hex } from "../src/lib/esign-pdf.server";

const LIVE_ESIGN_SHA256 = "3727c0fca83d9125d55e9b8410b9e04c2a0e9bc0cf7894748c92c08664bf94b6";
const GATE = "  if (ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED) return archiveImmutableV1(admin, ag, actor);\n";
const FLAG_IMPORT = 'import { ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED } from "@/lib/esign-immutable-archive-flag";\n';
const WRITE_IMPORT = 'import { archiveImmutableV1 } from "@/lib/esign-immutable-archive-write.server";\n';

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

type Rec = { op: string; table?: string; path?: string; bucket?: string; payload?: Record<string, unknown>; options?: Record<string, unknown>; bytes?: Uint8Array; at: number };
function recorder(uploadError: string | null = null) {
  const calls: Rec[] = [];
  let n = 0;
  function builder(table: string) {
    const state: { payload: Record<string, unknown> | null } = { payload: null };
    const b: any = {
      select() { return b; },
      eq() { return b; },
      neq() { return b; },
      insert(payload: Record<string, unknown>) {
        state.payload = payload;
        calls.push({ op: "insert", table, payload, at: ++n });
        return b;
      },
      update(payload: Record<string, unknown>) {
        state.payload = payload;
        calls.push({ op: "update", table, payload, at: ++n });
        return b;
      },
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: state.payload?.id ?? "doc-from-db" }, error: null }),
      then(resolve: (v: { error: null; data: null }) => void, reject: (e: unknown) => void) {
        return Promise.resolve({ error: null, data: null }).then(resolve, reject);
      },
    };
    return b;
  }
  const admin = {
    calls,
    from: (table: string) => builder(table),
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, body: Blob, options: Record<string, unknown>) {
            const bytes = new Uint8Array(await body.arrayBuffer());
            calls.push({ op: "upload", bucket, path, options, bytes, at: ++n });
            return uploadError ? { error: { message: uploadError } } : { error: null };
          },
          async download() {
            calls.push({ op: "download", bucket, at: ++n });
            throw new Error("storage was read");
          },
        };
      },
    },
  };
  return admin;
}

const agreement = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  application_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  source: "rental",
  title: "Rental Agreement",
  body: "Driver agrees to the rental terms.\nSecond line.",
  signer_name: "Synthetic Driver",
  signer_email: "driver@example.invalid",
  signed_at: "2026-10-21T12:00:00.000Z",
  created_at: "2026-10-21T11:00:00.000Z",
  sent_at: "2026-10-21T11:10:00.000Z",
  viewed_at: "2026-10-21T11:20:00.000Z",
  signer_ip: "203.0.113.9",
  signer_user_agent: "test",
  auth_method: "email_link",
  company_signer_name: "REAL RENTALS",
  company_signer_title: null,
  metadata: null,
  archive_status: "pending",
  archive_attempts: 0,
  document_id: null,
};

const flagFile = readFileSync("src/lib/esign-immutable-archive-flag.ts", "utf8");
const esign = readFileSync("src/lib/esign.server.ts", "utf8");
const writer = readFileSync("src/lib/esign-immutable-archive-write.server.ts", "utf8");
const livePath = readFileSync("src/lib/record-rental-live-path.ts", "utf8");

ok(ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED === false, "ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED is false");
ok(flagFile.includes("export const ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED = false;"), "the flag is a hard false constant");
ok(!/process\.env/.test(flagFile), "no environment variable can open the flag");
ok(!livePath.includes("ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED"), "the new flag is not the completed-v1 switch");
ok(livePath.includes("export const SIGNED_ARCHIVE_V1_ENABLED = false;"), "SIGNED_ARCHIVE_V1_ENABLED stays false");

const stripped = esign.replace(FLAG_IMPORT, "").replace(WRITE_IMPORT, "").replace(GATE, "");
ok(
  createHash("sha256").update(stripped).digest("hex") === LIVE_ESIGN_SHA256,
  "removing the flag gate leaves esign.server.ts byte-identical to the live file",
);
ok(esign.split("archiveImmutableV1").length - 1 === 2, "the live file names the immutable writer only at the import and the flag gate");
ok(
  esign.includes("if (SIGNED_ARCHIVE_V1_ENABLED) return archiveCompletedV1(admin, ag, actor);\n" + GATE),
  "the immutable gate sits after the completed-v1 gate and before the live archive body",
);

const flagHits = walk("src").filter((path) => readFileSync(path, "utf8").includes("ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED")).sort();
ok(
  flagHits.join("\n") === ["src/lib/esign-immutable-archive-flag.ts", "src/lib/esign-immutable-archive-write.server.ts", "src/lib/esign.server.ts"].join("\n"),
  "the flag is named only by its constant, the writer comment, and the live gate",
);
console.log("  touched live file: src/lib/esign.server.ts");

const liveColumns = ["driver_id", "kind", "category", "label", "storage_bucket", "storage_path", "visibility", "file_name", "mime_type", "uploaded_by_role"];
const offAdmin = recorder();
const off = await archiveDocument(offAdmin, agreement, null);
const offUpload = offAdmin.calls.find((c) => c.op === "upload");
const offInsert = offAdmin.calls.find((c) => c.op === "insert" && c.table === "documents");
const offUpdate = offAdmin.calls.find((c) => c.op === "update" && c.table === "agreements");
ok(off === true, "flag off archiveDocument returns true");
ok(offAdmin.calls.every((c) => c.op !== "download"), "flag off does not read storage");
ok(offUpload?.bucket === "rental-agreements", "flag off uploads to rental-agreements");
ok(offUpload?.path === `${agreement.application_id}/agreement-${agreement.id}.pdf`, "flag off keeps the live storage path");
ok(
  JSON.stringify(offUpload?.options) === JSON.stringify({ contentType: "application/pdf", upsert: true }),
  "flag off upload options are the live options, with no metadata",
);
ok(JSON.stringify(Object.keys(offInsert?.payload ?? {})) === JSON.stringify(liveColumns), "flag off insert columns are unchanged");
ok(!("content_sha256" in (offInsert?.payload ?? {})), "flag off insert omits content_sha256");
ok(offInsert?.payload?.storage_path === offUpload?.path, "flag off document path is the live path");
ok(offUpdate?.payload?.document_id === "doc-from-db", "flag off agreement document_id is the inserted row");
ok(offUpdate?.payload?.sha256 === (await sha256Hex(offUpload!.bytes!)), "flag off agreement sha256 is the uploaded PDF");
ok(offUpload!.at < offInsert!.at && offInsert!.at < offUpdate!.at, "flag off writes the agreement sha after the document insert");
ok(!offAdmin.calls.some((c) => c.path?.startsWith("immutable-v1/")), "flag off never uses the immutable-v1 path");

const onAdmin = recorder();
const on = await archiveImmutableV1(onAdmin, agreement, null);
const onUpload = onAdmin.calls.find((c) => c.op === "upload");
const onInsert = onAdmin.calls.find((c) => c.op === "insert" && c.table === "documents");
const onUpdate = onAdmin.calls.find((c) => c.op === "update" && c.table === "agreements");
const onSha = await sha256Hex(onUpload!.bytes!);
const onMeta = onUpload?.options?.metadata as { sha256?: string } | undefined;
ok(on === true, "flag on archive writes the immutable object");
ok(onUpload?.bucket === "rental-agreements", "flag on uploads to rental-agreements");
ok(onUpload?.path === `immutable-v1/${onInsert?.payload?.id}/${onSha}.pdf`, "flag on path is immutable-v1/{docId}/{sha}.pdf");
ok(onUpload?.options?.upsert === false, "flag on inserts the storage object");
ok(onMeta?.sha256 === onSha, "flag on metadata.sha256 is the PDF hash");
ok(onInsert?.payload?.content_sha256 === onSha, "flag on content_sha256 is the PDF hash");
ok(onInsert?.payload?.storage_bucket === "rental-agreements", "flag on document bucket is rental-agreements");
ok(onInsert?.payload?.storage_path === onUpload?.path, "flag on document path is the storage path");
ok(onUpdate?.payload?.sha256 === onSha && onUpdate?.payload?.document_id === onInsert?.payload?.id, "flag on agreement sha256 and document_id match the stored document");
ok(onUpload!.at < onInsert!.at && onInsert!.at < onUpdate!.at, "flag on sets agreement sha256 and document_id after the document and storage object");
ok(
  writer.includes("const path = `immutable-v1/${documentId}/${fileSha}.pdf`;")
    && writer.indexOf("content_sha256: fileSha") < writer.indexOf("document_id: documentId,\n        completed_document_id: documentId,\n        sha256: fileSha"),
  "the writer source stores content_sha256 before the agreement sha256",
);

const failed = recorder("simulated outage");
const failedResult = await archiveImmutableV1(failed, agreement, null);
const failedUpdate = failed.calls.find((c) => c.op === "update");
ok(failedResult === false, "flag on upload failure returns false");
ok(!failed.calls.some((c) => c.op === "insert"), "flag on upload failure does not insert a document");
ok(failedUpdate?.payload?.archive_status === "failed" && !("sha256" in (failedUpdate?.payload ?? {})) && !("document_id" in (failedUpdate?.payload ?? {})), "flag on upload failure does not set agreement sha256 or document_id");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall immutable archive checks pass");
process.exit(fails ? 1 : 0);
