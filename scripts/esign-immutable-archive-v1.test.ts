// Dark eSign immutable-v1 archive (run: bun scripts/esign-immutable-archive-v1.test.ts).
// Flag off: archiveDocument matches the live eSign byte for byte, aside from
// the flag gate. Flag on: one storage object, one documents row, and a
// conditional agreement update. Retries and losing racers reuse that row.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { archiveDocument } from "../src/lib/esign.server";
import { ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED } from "../src/lib/esign-immutable-archive-flag";
import { archiveImmutableV1, immutableArchiveDocumentId } from "../src/lib/esign-immutable-archive-write.server";
import { sha256Hex } from "../src/lib/esign-pdf.server";

if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = "http://127.0.0.1:9";
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";

const LIVE_ESIGN_SHA256 = "3727c0fca83d9125d55e9b8410b9e04c2a0e9bc0cf7894748c92c08664bf94b6";
const GATE = "  if (ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED) return archiveImmutableV1(admin, ag, actor);\n";
const FLAG_IMPORT = 'import { ESIGN_IMMUTABLE_ARCHIVE_V1_ENABLED } from "@/lib/esign-immutable-archive-flag";\n';
const WRITE_IMPORT = 'import { archiveImmutableV1 } from "@/lib/esign-immutable-archive-write.server";\n';
const SIGNED_GATE = "  if (SIGNED_ARCHIVE_V1_ENABLED) return archiveCompletedV1(admin, ag, actor);\n";

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
      is() { return b; },
      delete() { return b; },
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
          async remove() {
            calls.push({ op: "remove", bucket, at: ++n });
            return { error: null };
          },
        };
      },
    },
  };
  return admin;
}

type Filter = { kind: "eq" | "neq" | "is"; col: string; val: unknown };
type Call = {
  op: string;
  table?: string;
  path?: string;
  payload?: Record<string, unknown>;
  options?: Record<string, unknown>;
  filters: Filter[];
  error?: string | null;
};
type Doc = Record<string, unknown> & { id: string };
type Faults = {
  upload?: string;
  insert?: string;
  finalize?: string;
  /** B commits A's archived payload, and the update returns no row. */
  loseToConcurrent?: boolean;
  /** The next N agreement reads still look pending. */
  staleAgreementReads?: number;
};

function match(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((f) => {
    const cur = row[f.col] ?? null;
    if (f.kind === "eq") return cur === f.val;
    if (f.kind === "neq") return cur !== f.val;
    return f.val === null ? cur == null : cur === f.val;
  });
}

function openArchive(seed: Record<string, unknown>, faults: Faults = {}) {
  const agreement: Record<string, unknown> = {
    document_id: null,
    sha256: null,
    archive_error: null,
    archive_attempts: 0,
    ...seed,
  };
  const docs = new Map<string, Doc>();
  const objects = new Map<string, { bytes: Uint8Array; options: Record<string, unknown> }>();
  const calls: Call[] = [];

  function builder(table: string) {
    const filters: Filter[] = [];
    let op: "insert" | "update" | "delete" | "select" = "select";
    let payload: Record<string, unknown> | null = null;
    const b: any = {
      select() { return b; },
      eq(col: string, val: unknown) { filters.push({ kind: "eq", col, val }); return b; },
      neq(col: string, val: unknown) { filters.push({ kind: "neq", col, val }); return b; },
      is(col: string, val: unknown) { filters.push({ kind: "is", col, val }); return b; },
      insert(next: Record<string, unknown>) { op = "insert"; payload = { ...next }; return b; },
      update(next: Record<string, unknown>) { op = "update"; payload = { ...next }; return b; },
      delete() { op = "delete"; return b; },
      maybeSingle: () => exec(true),
      single: () => exec(false),
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        return exec(true).then(resolve, reject);
      },
    };
    function exec(many: boolean): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
      const recorded: Call = { op, table, payload: payload ? { ...payload } : undefined, filters: filters.map((f) => ({ ...f })) };
      calls.push(recorded);
      if (op === "insert" && table === "documents") {
        if (faults.insert) return Promise.resolve({ data: null, error: { message: faults.insert } });
        const id = String(payload?.id);
        if (docs.has(id)) return Promise.resolve({ data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } });
        docs.set(id, { ...(payload as Doc), id });
        return Promise.resolve({ data: { id }, error: null });
      }
      if (op === "update" && table === "agreements") {
        if (payload?.archive_status === "archived" && faults.loseToConcurrent) {
          Object.assign(agreement, payload);
          return Promise.resolve({ data: null, error: null });
        }
        if (payload?.archive_status === "archived" && faults.finalize) {
          recorded.error = faults.finalize;
          return Promise.resolve({ data: null, error: { message: faults.finalize } });
        }
        if (!match(agreement, filters)) return Promise.resolve({ data: null, error: null });
        Object.assign(agreement, payload);
        return Promise.resolve({ data: many ? { ...agreement } : null, error: null });
      }
      if (op === "update" && table === "documents") {
        const hits = [...docs.values()].filter((row) => match(row, filters));
        if (!hits.length) return Promise.resolve({ data: null, error: { message: "missing document" } });
        for (const row of hits) Object.assign(row, payload);
        return Promise.resolve({ data: null, error: null });
      }
      if (op === "delete" && table === "documents") {
        for (const [id, row] of docs) if (match(row, filters)) docs.delete(id);
        return Promise.resolve({ data: null, error: null });
      }
      if (op === "select" && table === "agreements") {
        if ((faults.staleAgreementReads ?? 0) > 0) {
          faults.staleAgreementReads = (faults.staleAgreementReads ?? 0) - 1;
          const stale = { ...agreement, archive_status: "pending", document_id: null, sha256: null, completed_document_id: null };
          return Promise.resolve({ data: match(stale, filters) ? stale : null, error: null });
        }
        return Promise.resolve({ data: match(agreement, filters) ? { ...agreement } : null, error: null });
      }
      if (op === "select" && table === "documents") {
        const hit = [...docs.values()].find((row) => match(row, filters)) ?? null;
        return Promise.resolve({ data: hit ? { ...hit } : null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unhandled ${op} ${table}` } });
    }
    return b;
  }

  const admin = {
    from: (table: string) => builder(table),
    storage: {
      from() {
        return {
          async upload(path: string, body: Blob, options: Record<string, unknown>) {
            const bytes = new Uint8Array(await body.arrayBuffer());
            calls.push({ op: "upload", path, options, payload: undefined, filters: [] });
            if (faults.upload) return { error: { message: faults.upload } };
            if (objects.has(path)) return { error: { message: "The resource already exists", statusCode: "409" } };
            objects.set(path, { bytes, options });
            return { error: null };
          },
          async download(path: string) {
            calls.push({ op: "download", path, filters: [] });
            const hit = objects.get(path);
            if (!hit) return { data: null, error: { message: "not found" } };
            return { data: new Blob([hit.bytes as BlobPart]), error: null };
          },
          async remove(paths: string[]) {
            calls.push({ op: "remove", path: paths.join(","), filters: [] });
            for (const path of paths) objects.delete(path);
            return { error: null };
          },
        };
      },
    },
  };
  return { admin, agreement, docs, objects, calls };
}

function hasFilter(call: Call | undefined, kind: Filter["kind"], col: string, val: unknown): boolean {
  return !!call?.filters.some((f) => f.kind === kind && f.col === col && f.val === val);
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
ok(
  flagFile.includes("SIGNED_ARCHIVE_V1_ENABLED must stay false when immutable-v1 is on"),
  "the flag file says SIGNED_ARCHIVE_V1_ENABLED must stay false when immutable-v1 is on",
);

const stripped = esign.replace(FLAG_IMPORT, "").replace(WRITE_IMPORT, "").replace(GATE, "");
ok(
  createHash("sha256").update(stripped).digest("hex") === LIVE_ESIGN_SHA256,
  "removing the flag gate leaves esign.server.ts byte-identical to the live file",
);
ok(esign.split("archiveImmutableV1").length - 1 === 2, "the live file names the immutable writer only at the import and the flag gate");
ok(
  esign.includes(SIGNED_GATE + GATE),
  "SIGNED_ARCHIVE_V1_ENABLED takes precedence when both flags are on",
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

ok(writer.includes("path = `immutable-v1/${documentId}/${fileSha}.pdf`;"), "the writer keeps the immutable-v1 path");
ok(!writer.includes("randomUUID"), "the writer does not mint a fresh document id");
ok(writer.includes("user_metadata"), "the writer records that the upload metadata option lands in user_metadata");
ok(writer.includes('.is("document_id", null)'), "the success update requires document_id IS NULL");
ok(writer.includes('.neq("archive_status", "archived")'), "the writer guards archived agreements");
ok(!writer.includes(".delete(") && !writer.includes(".remove("), "a failed attempt does not delete the document or the object");
ok(
  writer.indexOf("content_sha256: fileSha") < writer.indexOf("document_id: documentId,\n        completed_document_id: documentId,\n        sha256: fileSha"),
  "the writer source stores content_sha256 before the agreement sha256",
);
ok(writer.indexOf('visibility: ["admin"]') < writer.indexOf('.is("document_id", null)'), "the inserted document is hidden until the agreement update");

const happy = openArchive(agreement);
const on = await archiveImmutableV1(happy.admin, agreement, null);
const onUpload = happy.calls.find((c) => c.op === "upload");
const onInsert = happy.calls.find((c) => c.op === "insert" && c.table === "documents");
const onUpdate = happy.calls.filter((c) => c.op === "update" && c.table === "agreements");
const onSha = await sha256Hex(onUpload ? new Uint8Array(happy.objects.values().next().value!.bytes) : new Uint8Array());
const derivedId = await immutableArchiveDocumentId(agreement.id, onSha);
const success = onUpdate.find((c) => c.payload?.archive_status === "archived");
const reveal = happy.calls.find((c) => c.op === "update" && c.table === "documents");
ok(on === true, "flag on archive writes the immutable object");
ok(happy.objects.size === 1, "flag on uploads the PDF once");
ok(onUpload?.options?.upsert === false, "flag on does not overwrite the object");
ok(JSON.stringify(onUpload?.options?.metadata) === JSON.stringify({ sha256: onSha }), "flag on upload metadata.sha256 is the PDF hash the client stores in user_metadata");
ok(onInsert?.payload?.id === derivedId, "flag on document id is derived from the agreement and the PDF hash");
ok(onInsert?.payload?.content_sha256 === onSha, "flag on content_sha256 is the PDF hash");
ok(JSON.stringify(onInsert?.payload?.visibility) === JSON.stringify(["admin"]), "flag on insert hides the document from the driver");
ok(onInsert?.payload?.storage_path === `immutable-v1/${derivedId}/${onSha}.pdf`, "flag on path is immutable-v1/{docId}/{sha}.pdf");
ok(hasFilter(success, "is", "document_id", null), "flag on success update filters document_id IS NULL");
ok(hasFilter(success, "neq", "archive_status", "archived"), "flag on success update filters archive_status <> archived");
ok(happy.agreement.document_id === derivedId && happy.agreement.sha256 === onSha && happy.agreement.archive_status === "archived", "flag on agreement sha256 and document_id match the stored document");
ok(JSON.stringify(reveal?.payload?.visibility) === JSON.stringify(["driver", "admin"]), "flag on reveals the document after the agreement update");
ok(happy.docs.get(derivedId)?.visibility && JSON.stringify(happy.docs.get(derivedId)?.visibility) === JSON.stringify(["driver", "admin"]), "the stored document is visible to the driver after success");
const uploadAt = happy.calls.findIndex((c) => c.op === "upload");
const insertAt = happy.calls.findIndex((c) => c.op === "insert");
const agreeAt = happy.calls.findIndex((c) => c.op === "update" && c.table === "agreements");
ok(uploadAt < insertAt && insertAt < agreeAt, "flag on sets agreement sha256 and document_id after the document and storage object");

const retry = openArchive(agreement);
ok(await archiveImmutableV1(retry.admin, agreement, null) === true, "retry setup archives once");
const retryId = String(retry.agreement.document_id);
const retryBytes = retry.objects.values().next().value!.bytes;
ok(await archiveImmutableV1(retry.admin, { ...agreement, archive_status: "pending", document_id: null }, null) === true, "a second attempt reuses an archive that already committed");
ok(retry.docs.size === 1 && retry.objects.size === 1, "a committed retry does not create a second document or object");
ok(retry.agreement.document_id === retryId, "a committed retry keeps the same document id");
retry.agreement.document_id = null;
retry.agreement.archive_status = "failed";
retry.agreement.sha256 = null;
retry.agreement.completed_document_id = null;
ok(await archiveImmutableV1(retry.admin, { ...agreement, archive_status: "failed", document_id: null }, null) === true, "a failed agreement retries against the existing path");
ok(retry.docs.size === 1 && retry.objects.size === 1, "a path retry does not duplicate the document or the object");
ok(retry.agreement.document_id === retryId && retry.agreement.archive_status === "archived", "a path retry reuses the existing row and archives the agreement");
ok(Buffer.from(retry.objects.values().next().value!.bytes).equals(Buffer.from(retryBytes)), "a retry does not rewrite the stored PDF");
ok(retry.calls.filter((c) => c.op === "insert").length === 1, "a retry does not insert another documents row");

const fixedId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const reused = openArchive(agreement);
ok(await archiveImmutableV1(reused.admin, { ...agreement, document_id: fixedId }, null) === true, "an agreement that already has a document id archives");
ok(reused.agreement.document_id === fixedId, "the writer reuses ag.document_id");
ok(!reused.docs.has(derivedId), "reusing ag.document_id does not also insert the derived id");

const race = openArchive(agreement);
const [first, second] = await Promise.all([
  archiveImmutableV1(race.admin, agreement, null),
  archiveImmutableV1(race.admin, agreement, null),
]);
ok(first === true && second === true, "concurrent attempts both succeed");
ok(race.docs.size === 1 && race.objects.size === 1, "concurrent attempts leave one document and one object");
ok(race.agreement.archive_status === "archived" && race.agreement.document_id === derivedId, "concurrent attempts archive the derived document");
ok(race.calls.filter((c) => c.op === "delete").length === 0, "the losing attempt does not delete the winner");
ok(JSON.stringify(race.docs.get(derivedId)?.visibility) === JSON.stringify(["driver", "admin"]), "the winner reveals the document to the driver");

const uploadFail = openArchive(agreement, { upload: "simulated outage" });
ok(await archiveImmutableV1(uploadFail.admin, agreement, null) === false, "upload failure returns false");
ok(uploadFail.docs.size === 0 && uploadFail.objects.size === 0, "upload failure leaves no document and no object");
ok(uploadFail.agreement.archive_status === "failed" && uploadFail.agreement.document_id == null && uploadFail.agreement.sha256 == null, "upload failure does not set agreement sha256 or document_id");
const uploadFailUpdate = uploadFail.calls.find((c) => c.op === "update" && c.table === "agreements" && c.payload?.archive_status === "failed");
ok(hasFilter(uploadFailUpdate, "neq", "archive_status", "archived"), "upload failure update guards archive_status <> archived");

const insertFail = openArchive(agreement, { insert: "insert refused" });
ok(await archiveImmutableV1(insertFail.admin, agreement, null) === false, "insert failure returns false");
ok(insertFail.docs.size === 0 && insertFail.objects.size === 1, "insert failure leaves the uploaded object");
ok(!insertFail.calls.some((c) => c.op === "remove") && !insertFail.calls.some((c) => c.op === "delete"), "insert failure does not delete the object");
ok(insertFail.agreement.archive_status === "failed" && insertFail.agreement.document_id == null, "insert failure does not keep a document id on the agreement");

const finalizeFail = openArchive(agreement, { finalize: "finalize down" });
ok(await archiveImmutableV1(finalizeFail.admin, agreement, null) === false, "agreement update failure returns false");
ok(finalizeFail.docs.size === 1 && finalizeFail.objects.size === 1, "agreement update failure keeps the row and the object created this attempt");
ok(!finalizeFail.calls.some((c) => c.op === "delete") && !finalizeFail.calls.some((c) => c.op === "remove"), "agreement update failure does not delete the document or the storage object");
const finalizeFailUpdate = finalizeFail.calls.find((c) => c.op === "update" && c.payload?.archive_status === "failed");
ok(hasFilter(finalizeFailUpdate, "neq", "archive_status", "archived"), "agreement update failure guards archive_status <> archived");
ok(finalizeFail.agreement.archive_status === "failed" && finalizeFail.agreement.sha256 == null, "agreement update failure does not record a sha256");
ok(finalizeFail.agreement.document_id == null, "agreement update failure does not point the agreement at the hidden document");

const lost = openArchive(agreement, { loseToConcurrent: true, staleAgreementReads: 1 });
ok(await archiveImmutableV1(lost.admin, agreement, null) === true, "A fails its finalize read and B's archived row is kept");
ok(lost.agreement.archive_status === "archived" && typeof lost.agreement.document_id === "string" && lost.agreement.document_id.length > 0, "A-fails / B-wins leaves a valid document_id");
ok(typeof lost.agreement.sha256 === "string" && /^[0-9a-f]{64}$/.test(String(lost.agreement.sha256)), "A-fails / B-wins keeps the archived sha256");
ok(lost.docs.size === 1 && lost.docs.has(String(lost.agreement.document_id)), "A-fails / B-wins keeps the document row");
ok(lost.objects.size === 1, "A-fails / B-wins keeps the storage object");
ok(!lost.calls.some((c) => c.op === "delete") && !lost.calls.some((c) => c.op === "remove"), "A-fails / B-wins does not delete the document or the object");

const lostLate = openArchive(agreement, { loseToConcurrent: true, staleAgreementReads: 2 });
ok(await archiveImmutableV1(lostLate.admin, agreement, null) === true, "a stale catch re-read still adopts B after the guarded failure update misses");
ok(lostLate.agreement.archive_status === "archived" && lostLate.docs.size === 1 && lostLate.objects.size === 1, "the late re-check leaves the archived document and object");
ok(!lostLate.calls.some((c) => c.op === "delete") && !lostLate.calls.some((c) => c.op === "remove"), "the late re-check does not delete");

const protectedId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const protectedSha = "ab".repeat(32);
const kept = openArchive({
  ...agreement,
  archive_status: "archived",
  document_id: protectedId,
  sha256: protectedSha,
});
kept.docs.set(protectedId, {
  id: protectedId,
  content_sha256: "cd".repeat(32),
  driver_id: agreement.application_id,
  storage_path: "immutable-v1/kept.pdf",
  visibility: ["driver", "admin"],
});
ok(await archiveImmutableV1(kept.admin, { ...agreement, archive_status: "archived", document_id: protectedId, sha256: protectedSha }, null) === false, "an archived agreement with mismatched evidence returns false");
ok(kept.agreement.archive_status === "archived" && kept.agreement.sha256 === protectedSha && kept.agreement.document_id === protectedId, "the failure update does not rewrite an archived agreement");
ok(kept.docs.has(protectedId) && kept.objects.size === 0, "a mismatched archived agreement is not deleted");

const hiddenId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const shown = openArchive({
  ...agreement,
  archive_status: "archived",
  document_id: hiddenId,
  sha256: onSha,
});
shown.docs.set(hiddenId, {
  id: hiddenId,
  content_sha256: onSha,
  driver_id: agreement.application_id,
  storage_bucket: "rental-agreements",
  storage_path: `immutable-v1/${hiddenId}/${onSha}.pdf`,
  visibility: ["admin"],
});
ok(await archiveImmutableV1(shown.admin, { ...agreement, archive_status: "archived", document_id: hiddenId, sha256: onSha }, null) === true, "an archived agreement reveals a hidden document");
ok(JSON.stringify(shown.docs.get(hiddenId)?.visibility) === JSON.stringify(["driver", "admin"]), "the archived short-circuit shows the document to the driver");
ok(shown.calls.every((c) => c.op !== "upload"), "the archived short-circuit does not upload again");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall immutable archive checks pass");
process.exit(fails ? 1 : 0);
