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
import {
  assertServiceRoleKey,
  backfillLicenseContentSha,
  classifyStorageFailure,
  classifyWriteDownloadFailure,
  contentShaBackfillExitCode,
  isRecordedHash,
  readDotenvAssignment,
  resolveSupabaseUrl,
  targetHost,
} from "./backfill-document-content-sha";

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

const stampFailed = confirmTable([{
  id: "kept-current",
  driver_id: confirmFields.driver_id,
  category: "license_front",
  is_current: true,
}]);
const stampAdmin = {
  from(table: string) {
    const real = stampFailed.admin.from(table);
    const originalUpdate = real.update.bind(real);
    let updates = 0;
    real.update = (next: Record<string, unknown>) => {
      updates += 1;
      if (updates === 1 && "content_sha256" in next) {
        const failed: any = {
          eq() { return failed; },
          then(resolve: (v: unknown) => void) {
            return Promise.resolve({ data: null, error: { message: "hash stamp failed" } }).then(resolve);
          },
        };
        return failed;
      }
      return originalUpdate(next);
    };
    return real;
  },
};
let stampThrew = false;
try {
  await persistConfirmedDocument(stampAdmin, confirmFields, async () => "hashed-token");
} catch (e) {
  stampThrew = e instanceof Error && e.message === "hash stamp failed";
}
if (!stampThrew) throw new Error("a failed hash stamp did not throw");
if (stampFailed.rows.filter((row) => row.is_current === true).length !== 1) {
  throw new Error("a failed hash stamp left two current rows");
}
const failedRow = stampFailed.rows.find((row) => row.id !== "kept-current");
if (!failedRow || failedRow.is_current !== false) {
  throw new Error("a failed hash stamp left the new row current");
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
let undefinedFunctionThrew = false;
try {
  await applyUploadedContentSha(missingAdmin, "driver-docs", "app/license_front.jpg");
} catch (e) {
  undefinedFunctionThrew = e instanceof Error && /does not exist/.test(e.message);
}
if (!undefinedFunctionThrew) throw new Error("42883 was treated as a missing packet function");
if (missingLogs.length !== 0) throw new Error("42883 logged the missing-function notice");
missingAdmin.rpc = async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
await applyUploadedContentSha(missingAdmin, "driver-docs", "app/license_front.jpg");
await applyUploadedContentSha(missingAdmin, "driver-docs", "app/license_front.jpg");
console.error = originalError;
resetUploadedContentShaProbe();
if (missingLogs.length !== 1) throw new Error(`missing function was logged ${missingLogs.length} times`);

const forged = "ab".repeat(32);
const frontBytes = new TextEncoder().encode("m2-license-front-v1");
const frontDigest = await contentSha256Hex(frontBytes);
if (frontDigest === forged) throw new Error("fixture digest collided with the forged metadata");
const rpcArgs: unknown[] = [];
let downloads = 0;
const backfillAdmin = {
  from() {
    const filters: { col: string; val: unknown }[] = [];
    const rows = [
      {
        id: "license-row",
        storage_bucket: "driver-docs",
        storage_path: "app/license_front.jpg",
        content_sha256: null as string | null,
        category: "license_front",
        is_current: true,
      },
    ];
    const b: any = {
      select() { return b; },
      eq(col: string, val: unknown) { filters.push({ col, val }); return b; },
      in() { return b; },
      then(resolve: (v: unknown) => void) {
        const data = rows.filter((row) => filters.every((f) => (row as Record<string, unknown>)[f.col] === f.val));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return b;
  },
  storage: {
    from() {
      return {
        async info() {
          return { data: { id: "11111111-1111-4111-8111-111111111111", version: "v1", updatedAt: "2026-10-21T01:02:03.000Z", metadata: { sha256: forged } }, error: null };
        },
        async download() {
          downloads += 1;
          return { data: new Blob([frontBytes]), error: null };
        },
      };
    },
  },
  async rpc(_name: string, args: unknown) {
    rpcArgs.push(args);
    return { data: frontDigest, error: null };
  },
};
const dry = await backfillLicenseContentSha(backfillAdmin, { write: false });
if (dry.pending !== 1 || dry.hashed !== 0 || downloads !== 0 || rpcArgs.length !== 0) {
  throw new Error(`dry-run touched storage: ${JSON.stringify(dry)} downloads=${downloads}`);
}
const wrote = await backfillLicenseContentSha(backfillAdmin, { write: true });
if (wrote.hashed !== 1 || wrote.mismatched !== 0) throw new Error(`write counts ${JSON.stringify(wrote)}`);
const sent = rpcArgs[0] as { p_sha256?: string };
if (sent.p_sha256 !== frontDigest || sent.p_sha256 === forged) {
  throw new Error("backfill sent the client metadata hash");
}

function jwt(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `header.${payload}.sig`;
}
assertServiceRoleKey(jwt("service_role"));
let managerRefused = false;
try {
  assertServiceRoleKey(jwt("authenticated"));
} catch (error) {
  managerRefused = error instanceof Error && error.message.includes("authenticated");
}
if (!managerRefused) throw new Error("a manager JWT was accepted");

const hosted = "https://hosted.example";
let dotenvRefused = false;
try {
  resolveSupabaseUrl({ argv: ["bun", "script"], envUrl: hosted, committedUrls: [hosted] });
} catch (error) {
  dotenvRefused = error instanceof Error && error.message.includes("committed .env");
}
if (!dotenvRefused) throw new Error("the committed .env URL was accepted");
const flagged = resolveSupabaseUrl({
  argv: ["bun", "script", "--url", "http://127.0.0.1:9"],
  envUrl: hosted,
  committedUrls: [hosted],
});
if (flagged !== "http://127.0.0.1:9" || targetHost(flagged) !== "127.0.0.1:9") {
  throw new Error("the --url flag was ignored");
}
const shellUrl = resolveSupabaseUrl({
  argv: ["bun", "script"],
  envUrl: "http://127.0.0.1:54321",
  committedUrls: [hosted],
});
if (targetHost(shellUrl) !== "127.0.0.1:54321") throw new Error("an explicit shell URL was refused");
if (readDotenvAssignment('SUPABASE_URL="https://hosted.example"\n', "SUPABASE_URL") !== hosted) {
  throw new Error("dotenv quotes were not stripped");
}

const otherHash = "ab".repeat(32);
if (!isRecordedHash(otherHash) || !isRecordedHash(otherHash.toUpperCase()) || isRecordedHash("zz".repeat(32))) {
  throw new Error("isRecordedHash did not normalize 64 hex");
}
if (classifyStorageFailure({ message: "Object not found" }, false) !== "error") {
  throw new Error("a not-found message without status 404 was counted missing");
}
if (classifyStorageFailure({ message: "NoSuchKey", statusCode: "404" }, false) !== "missing") {
  throw new Error("HTTP 404 was not counted missing");
}
if (classifyStorageFailure({ message: "Object not found", status: 400, statusCode: "404" }, false) !== "missing") {
  throw new Error("HTTP 400 with body statusCode 404 was not counted missing");
}
const forbidden = new Error("Forbidden") as Error & { status: number };
forbidden.status = 403;
if (classifyWriteDownloadFailure(forbidden) !== "storage") {
  throw new Error("HTTP 403 was not a storage error");
}
if (classifyWriteDownloadFailure(new Error("")) !== "storage") {
  throw new Error("a download error with no status and no message was not a storage error");
}
if (classifyWriteDownloadFailure(new Error("Uploaded bytes missing")) !== "storage") {
  throw new Error("the empty-download fallback was counted missing");
}
if (classifyWriteDownloadFailure(new Error("socket hang up")) !== "abort") {
  throw new Error("a thrown network error was not left to abort");
}
const emptyCounts = { hashed: 0, skipped: 0, missing: 0, mismatched: 0, pending: 0, storageErrors: 0 };
if (contentShaBackfillExitCode(false, { ...emptyCounts, missing: 1 }) !== 0) {
  throw new Error("dry-run missing exited");
}
if (contentShaBackfillExitCode(true, { ...emptyCounts, missing: 1 }) !== 1) {
  throw new Error("write missing did not exit");
}
if (contentShaBackfillExitCode(true, { ...emptyCounts, mismatched: 1 }) !== 1) {
  throw new Error("write mismatched did not exit");
}
if (contentShaBackfillExitCode(false, { ...emptyCounts, storageErrors: 1 }) !== 1) {
  throw new Error("storage_errors did not exit");
}
type StorageResult = {
  data: Blob | { id: string } | null;
  error: { message: string; statusCode?: string; status?: number } | null;
};
function licenseAdmin(
  rows: { content_sha256: string | null; id: string }[],
  info: StorageResult,
  download?: StorageResult | "throw500" | "network" | "empty" | "forbidden" | Array<StorageResult | "network" | "empty" | "forbidden">,
) {
  let downloads = 0;
  const rpcArgs: unknown[] = [];
  const admin = {
    from() {
      const filters: { col: string; val: unknown }[] = [];
      const stored = rows.map((row) => ({
        storage_bucket: "driver-docs",
        storage_path: `${row.id}.jpg`,
        category: "license_front",
        is_current: true,
        ...row,
      }));
      const b: any = {
        select() { return b; },
        eq(col: string, val: unknown) { filters.push({ col, val }); return b; },
        in() { return b; },
        then(resolve: (v: unknown) => void) {
          const data = stored.filter((row) => filters.every((f) => (row as Record<string, unknown>)[f.col] === f.val));
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return b;
    },
    storage: {
      from() {
        return {
          async info() { return info; },
          async download() {
            downloads += 1;
            const next = Array.isArray(download) ? download[downloads - 1] : download;
            if (next === "throw500") {
              const failure = new Error("Internal Server Error") as Error & { statusCode: string };
              failure.statusCode = "500";
              throw failure;
            }
            if (next === "network") throw new Error("socket hang up");
            if (next === "empty") return { data: null, error: {} };
            if (next === "forbidden") return { data: null, error: { message: "Forbidden", status: 403 } };
            if (next) return next;
            return { data: new Blob([frontBytes]), error: null };
          },
        };
      },
    },
    async rpc(_name: string, args: unknown) {
      rpcArgs.push(args);
      return { data: frontDigest, error: null };
    },
  };
  return { admin, downloads: () => downloads, rpcArgs };
}

const matched = licenseAdmin([{ id: "match", content_sha256: frontDigest }], { data: { id: "obj" }, error: null });
const matchedDry = await backfillLicenseContentSha(matched.admin, { write: false });
if (matchedDry.skipped !== 1 || matchedDry.mismatched !== 0 || matched.downloads() !== 0) {
  throw new Error(`dry-run compared a stored hash: ${JSON.stringify(matchedDry)} downloads=${matched.downloads()}`);
}
const matchedWrite = await backfillLicenseContentSha(matched.admin, { write: true });
if (matchedWrite.skipped !== 1 || matchedWrite.mismatched !== 0 || matched.downloads() !== 1 || matched.rpcArgs.length !== 0) {
  throw new Error(`matching hash was rewritten: ${JSON.stringify(matchedWrite)}`);
}
const differs = licenseAdmin([{ id: "differs", content_sha256: otherHash }], { data: { id: "obj" }, error: null });
const differsWrite = await backfillLicenseContentSha(differs.admin, { write: true });
if (differsWrite.mismatched !== 1 || differsWrite.skipped !== 0 || differs.rpcArgs.length !== 0) {
  throw new Error(`byte mismatch was not counted: ${JSON.stringify(differsWrite)}`);
}
const denied = licenseAdmin(
  [{ id: "denied", content_sha256: null }],
  { data: null, error: { message: "Unauthorized", statusCode: "403" } },
);
const deniedWrite = await backfillLicenseContentSha(denied.admin, { write: true });
if (deniedWrite.storageErrors !== 1 || deniedWrite.missing !== 0) {
  throw new Error(`storage error was counted missing: ${JSON.stringify(deniedWrite)}`);
}
const absent = licenseAdmin(
  [{ id: "absent", content_sha256: null }],
  { data: null, error: { message: "Object not found", statusCode: "404" } },
);
const absentWrite = await backfillLicenseContentSha(absent.admin, { write: true });
if (absentWrite.missing !== 1 || absentWrite.storageErrors !== 0) {
  throw new Error(`missing object was a storage error: ${JSON.stringify(absentWrite)}`);
}
const upper = licenseAdmin([{ id: "upper", content_sha256: frontDigest.toUpperCase() }], { data: { id: "obj" }, error: null });
const upperWrite = await backfillLicenseContentSha(upper.admin, { write: true });
if (upperWrite.skipped !== 1 || upperWrite.mismatched !== 0 || upper.downloads() !== 1 || upper.rpcArgs.length !== 0) {
  throw new Error(`uppercase hash was not a match: ${JSON.stringify(upperWrite)} downloads=${upper.downloads()}`);
}
const serverError = licenseAdmin(
  [{ id: "boom", content_sha256: null }],
  { data: { id: "obj" }, error: null },
  { data: null, error: { message: "Object not found", statusCode: "500" } },
);
let serverThrew = false;
let serverWrite: Awaited<ReturnType<typeof backfillLicenseContentSha>> | null = null;
try {
  serverWrite = await backfillLicenseContentSha(serverError.admin, { write: true });
} catch {
  serverThrew = true;
}
if (serverThrew || !serverWrite || serverWrite.storageErrors !== 1 || serverWrite.missing !== 0 || serverError.rpcArgs.length !== 0) {
  throw new Error(`download 500 threw or was counted missing: threw=${serverThrew} ${JSON.stringify(serverWrite)}`);
}
const thrownServer = licenseAdmin(
  [{ id: "thrown", content_sha256: null }],
  { data: { id: "obj" }, error: null },
  "throw500",
);
let thrownServerError = false;
let thrownWrite: Awaited<ReturnType<typeof backfillLicenseContentSha>> | null = null;
try {
  thrownWrite = await backfillLicenseContentSha(thrownServer.admin, { write: true });
} catch {
  thrownServerError = true;
}
if (thrownServerError || !thrownWrite || thrownWrite.storageErrors !== 1 || thrownWrite.missing !== 0) {
  throw new Error(`thrown download 500 was not a storage error: threw=${thrownServerError} ${JSON.stringify(thrownWrite)}`);
}
const continued = licenseAdmin(
  [{ id: "deny-dl", content_sha256: null }, { id: "after", content_sha256: null }],
  { data: { id: "obj" }, error: null },
  ["forbidden", { data: new Blob([frontBytes]), error: null }],
);
let continuedThrew = false;
let continuedWrite: Awaited<ReturnType<typeof backfillLicenseContentSha>> | null = null;
try {
  continuedWrite = await backfillLicenseContentSha(continued.admin, { write: true });
} catch {
  continuedThrew = true;
}
if (
  continuedThrew
  || !continuedWrite
  || continuedWrite.storageErrors !== 1
  || continuedWrite.hashed !== 1
  || continuedWrite.missing !== 0
  || continued.downloads() !== 2
  || continued.rpcArgs.length !== 1
) {
  throw new Error(`download 403 aborted the run: threw=${continuedThrew} ${JSON.stringify(continuedWrite)} downloads=${continued.downloads()}`);
}
const blank = licenseAdmin(
  [{ id: "blank", content_sha256: null }],
  { data: { id: "obj" }, error: null },
  "empty",
);
let blankThrew = false;
let blankWrite: Awaited<ReturnType<typeof backfillLicenseContentSha>> | null = null;
try {
  blankWrite = await backfillLicenseContentSha(blank.admin, { write: true });
} catch {
  blankThrew = true;
}
if (blankThrew || !blankWrite || blankWrite.storageErrors !== 1 || blankWrite.missing !== 0 || blank.rpcArgs.length !== 0) {
  throw new Error(`empty download error was missing or aborted: threw=${blankThrew} ${JSON.stringify(blankWrite)}`);
}
const network = licenseAdmin(
  [{ id: "net", content_sha256: null }, { id: "later", content_sha256: null }],
  { data: { id: "obj" }, error: null },
  "network",
);
let networkThrew = false;
try {
  await backfillLicenseContentSha(network.admin, { write: true });
} catch (error) {
  networkThrew = error instanceof Error && error.message === "socket hang up";
}
if (!networkThrew || network.downloads() !== 1) {
  throw new Error(`a thrown network error did not abort: threw=${networkThrew} downloads=${network.downloads()}`);
}

if (/[0-9a-f]{64}/i.test(proof)) {
  throw new Error("functional proof contains a 64-hex literal");
}

const samples = ["m2-license-front-v1", "m2-license-back-v1", "m2-signed-agreement-v1", "signed terms"];
const url = process.env.M2_DATABASE_URL;
if (!url) {
  console.log("skip: M2_DATABASE_URL is not set, so the extensions.digest comparison did not run.");
  console.log("usage: M2_DATABASE_URL=postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable bun scripts/m2-content-sha.test.ts");
} else {
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
}
