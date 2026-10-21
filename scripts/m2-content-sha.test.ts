/**
 * The flag-on upload hasher and Postgres extensions.digest must agree on the
 * byte strings the functional proof uses. The proof SQL must not contain a
 * typed 64-hex sha.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DOCUMENT_CONTENT_SHA256_ENABLED,
  applyUploadedContentSha,
  contentSha256Hex,
  resetUploadedContentShaProbe,
} from "../src/lib/document-content-sha";
import { persistConfirmedDocument } from "../src/lib/documents.functions";
import {
  BACKFILL_PAGE_SIZE,
  LICENSE_BACKFILL_SELECT,
  assertServiceRoleKey,
  backfillLicenseContentSha,
  classifyStorageFailure,
  classifyWriteDownloadFailure,
  contentShaBackfillExitCode,
  formatContentShaBackfill,
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

const PII_COLUMNS = ["file_name", "notes", "label", "email", "full_name", "license_number", "phone"];

type PageState = {
  select: string;
  eqs: { col: string; val: unknown }[];
  ins: { col: string; val: unknown[] }[];
  nots: { col: string; op: string; val: unknown }[];
  ordered: boolean;
  ranged: boolean;
  from: number;
  to: number;
};

function assertBackfillSelect(table: string, cols: string): void {
  if (PII_COLUMNS.some((col) => cols.split(",").includes(col))) {
    throw new Error(`backfill select reads ${cols}`);
  }
  if (table === "documents" && cols !== LICENSE_BACKFILL_SELECT) throw new Error(`document select ${cols}`);
  if (table === "applications" && cols !== "id") throw new Error(`application select ${cols}`);
}

function pageBuilder(load: (state: PageState) => unknown[]): any {
  const state: PageState = { select: "", eqs: [], ins: [], nots: [], ordered: false, ranged: false, from: 0, to: 0 };
  const b: any = {
    select(cols: string) { state.select = cols; return b; },
    eq(col: string, val: unknown) { state.eqs.push({ col, val }); return b; },
    in(col: string, val: unknown[]) { state.ins.push({ col, val }); return b; },
    not(col: string, op: string, val: unknown) { state.nots.push({ col, op, val }); return b; },
    order() { state.ordered = true; return b; },
    range(from: number, to: number) { state.ranged = true; state.from = from; state.to = to; return b; },
    then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
      if (!state.ordered) throw new Error("page was not ordered by id");
      return Promise.resolve()
        .then(() => load(state))
        .then((data) => ({ data, error: null }))
        .then(resolve, reject);
    },
  };
  return { state, builder: b };
}

function slicePage<T>(rows: T[], state: PageState, capWhenUnpaged: boolean): T[] {
  const sorted = rows;
  if (!state.ranged) return capWhenUnpaged ? sorted.slice(0, BACKFILL_PAGE_SIZE) : sorted;
  return sorted.filter((_, index) => index >= state.from && index <= state.to);
}

const forged = "ab".repeat(32);
const frontBytes = new TextEncoder().encode("m2-license-front-v1");
const frontDigest = await contentSha256Hex(frontBytes);
if (frontDigest === forged) throw new Error("fixture digest collided with the forged metadata");
const rpcArgs: unknown[] = [];
let downloads = 0;
const backfillRows = [
  {
    id: "license-row",
    driver_id: null as string | null,
    storage_bucket: "driver-docs",
    storage_path: "app/license_front.jpg",
    content_sha256: null as string | null,
    category: "license_front",
    is_current: true,
  },
];
const backfillAdmin = {
  from(table: string) {
    const { builder } = pageBuilder((state) => {
      assertBackfillSelect(table, state.select);
      if (table === "applications") return [];
      if (table !== "documents") throw new Error(`unexpected table ${table}`);
      const matched = backfillRows.filter((row) =>
        state.eqs.every((filter) => (row as Record<string, unknown>)[filter.col] === filter.val)
        && state.ins.every((filter) => filter.val.includes((row as Record<string, unknown>)[filter.col] as never)),
      );
      return slicePage(matched, state, false);
    });
    return builder;
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
  async rpc(_name: string, args: { p_bucket?: string; p_path?: string; p_sha256?: string }) {
    rpcArgs.push(args);
    const row = backfillRows.find((item) => item.storage_bucket === args.p_bucket && item.storage_path === args.p_path);
    if (row) row.content_sha256 = frontDigest;
    return { data: frontDigest, error: null };
  },
};
const dry = await backfillLicenseContentSha(backfillAdmin, { write: false });
if (dry.pending !== 1 || dry.hashed !== 0 || dry.total !== 1 || dry.fingerprinted !== 0 || dry.mismatched !== 0 || downloads !== 0 || rpcArgs.length !== 0) {
  throw new Error(`dry-run touched storage: ${JSON.stringify(dry)} downloads=${downloads}`);
}
const dryLine = formatContentShaBackfill("dry-run", dry);
if (!dryLine.includes("total=1") || !dryLine.includes("fingerprinted=0") || !dryLine.includes("missing_file=0") || !dryLine.includes("mismatched=0")) {
  throw new Error(`dry-run line ${dryLine}`);
}
const wrote = await backfillLicenseContentSha(backfillAdmin, { write: true });
if (wrote.hashed !== 1 || wrote.mismatched !== 0 || wrote.fingerprinted !== 1 || wrote.total !== 1) {
  throw new Error(`write counts ${JSON.stringify(wrote)}`);
}
const wroteAgain = await backfillLicenseContentSha(backfillAdmin, { write: true });
if (wroteAgain.hashed !== 0 || wroteAgain.skipped !== 1 || wroteAgain.fingerprinted !== 1 || wroteAgain.mismatched !== 0 || rpcArgs.length !== 1 || downloads !== 2) {
  throw new Error(`second write was not idempotent: ${JSON.stringify(wroteAgain)} rpc=${rpcArgs.length} downloads=${downloads}`);
}
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
const emptyCounts = { total: 0, fingerprinted: 0, hashed: 0, skipped: 0, missing: 0, mismatched: 0, pending: 0, storageErrors: 0 };
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
  const stored = rows.map((row) => ({
    driver_id: null as string | null,
    storage_bucket: "driver-docs",
    storage_path: `${row.id}.jpg`,
    category: "license_front",
    is_current: true,
    ...row,
  }));
  const admin = {
    from(table: string) {
      const { builder } = pageBuilder((state) => {
        assertBackfillSelect(table, state.select);
        if (table === "applications") return [];
        if (table !== "documents") throw new Error(`unexpected table ${table}`);
        const matched = stored.filter((row) =>
          state.eqs.every((filter) => (row as Record<string, unknown>)[filter.col] === filter.val)
          && state.ins.every((filter) => filter.val.includes((row as Record<string, unknown>)[filter.col] as never)),
        );
        return slicePage(matched, state, false);
      });
      return builder;
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

const deletedApps = Array.from({ length: 1001 }, (_, index) => ({
  id: `app-${String(index).padStart(4, "0")}`,
  deleted_at: "2026-01-01T00:00:00Z",
}));
const pageHash = "cd".repeat(32);
const liveDocs = Array.from({ length: 1001 }, (_, index) => ({
  id: `doc-${String(index + 1).padStart(4, "0")}`,
  driver_id: "app-live",
  storage_bucket: "driver-docs",
  storage_path: `live/${index}.jpg`,
  content_sha256: pageHash,
  category: "license_front",
  is_current: true,
}));
const pageDocs = [
  {
    id: "doc-0000",
    driver_id: "app-1000",
    storage_bucket: "driver-docs",
    storage_path: "deleted.jpg",
    content_sha256: pageHash,
    category: "license_front",
    is_current: true,
  },
  {
    id: "doc-9999",
    driver_id: "app-live",
    storage_bucket: "driver-docs",
    storage_path: "retired.jpg",
    content_sha256: null as string | null,
    category: "license_front",
    is_current: false,
  },
  ...liveDocs,
];
let pageStorageCalls = 0;
const pageAdmin = {
  from(table: string) {
    const { builder } = pageBuilder((state) => {
      assertBackfillSelect(table, state.select);
      if (table === "applications") {
        const filtered = state.nots.some((item) => item.col === "deleted_at" && item.op === "is" && item.val === null);
        if (!filtered) throw new Error("deleted applications were not filtered");
        const ids = [...deletedApps].sort((a, b) => (a.id < b.id ? -1 : 1)).map((row) => ({ id: row.id }));
        return slicePage(ids, state, true);
      }
      if (table !== "documents") throw new Error(`unexpected table ${table}`);
      const matched = pageDocs
        .filter((row) =>
          state.eqs.every((filter) => (row as Record<string, unknown>)[filter.col] === filter.val)
          && state.ins.every((filter) => filter.val.includes((row as Record<string, unknown>)[filter.col] as never)),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      return slicePage(matched, state, true);
    });
    return builder;
  },
  storage: {
    from() {
      return {
        info() {
          pageStorageCalls += 1;
          throw new Error("dry-run read storage");
        },
        download() {
          pageStorageCalls += 1;
          throw new Error("dry-run downloaded");
        },
      };
    },
  },
  async rpc() {
    throw new Error("dry-run called record_uploaded_content_sha");
  },
};
const paged = await backfillLicenseContentSha(pageAdmin, { write: false });
if (
  paged.total !== 1001
  || paged.fingerprinted !== 1001
  || paged.skipped !== 1001
  || paged.pending !== 0
  || paged.missing !== 0
  || paged.mismatched !== 0
  || pageStorageCalls !== 0
) {
  throw new Error(`page cap undercounted: ${JSON.stringify(paged)} storage=${pageStorageCalls}`);
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

function assertLoopbackDatabase(url: string): void {
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "::1") {
    throw new Error("refusing non-local database");
  }
  const name = parsed.pathname.replace(/^\//, "");
  if (name === "m2") throw new Error("refusing to write the shared m2 database");
}

function assertScratchName(name: string): void {
  if (name === "m2" || !/^m2bf[0-9a-f]+$/.test(name)) throw new Error("refusing to write the shared m2 database");
}

function psqlOn(database: string, args: string[], input?: string): string {
  if (database !== "postgres") assertScratchName(database);
  const url = `postgresql://postgres@127.0.0.1:55442/${database}?sslmode=disable`;
  assertLoopbackDatabase(url);
  const result = spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "--no-psqlrc", ...args], {
    input,
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `psql exit ${result.status}`);
  return result.stdout ?? "";
}

let refusedShared = false;
try {
  assertLoopbackDatabase("postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable");
} catch (error) {
  refusedShared = error instanceof Error && error.message.includes("shared m2");
}
if (!refusedShared) throw new Error("a shared m2 url was accepted");
let refusedRemote = false;
try {
  assertLoopbackDatabase("postgresql://postgres@db.example:5432/m2bf00?sslmode=disable");
} catch (error) {
  refusedRemote = error instanceof Error && error.message.includes("non-local");
}
if (!refusedRemote) throw new Error("a remote database url was accepted");

const rehearsalStarted = Date.now();
const rehearsalName = `m2bf${randomBytes(4).toString("hex")}`;
assertScratchName(rehearsalName);
const { default: rehearsalPostgres } = await import("postgres");
let rehearsalUp = false;
try {
  const probe = rehearsalPostgres("postgresql://postgres@127.0.0.1:55442/postgres?sslmode=disable", { max: 1, connect_timeout: 3 });
  await probe`select 1 as ok`;
  await probe.end({ timeout: 1 });
  rehearsalUp = true;
} catch {
  rehearsalUp = false;
}
if (!rehearsalUp) {
  console.log("skip: local postgres on 127.0.0.1:55442 is not accepting connections, so the license backfill rehearsal did not run.");
} else {
  let rehearsalSql: { end: (options?: { timeout?: number }) => Promise<void> } | null = null;
  let created = false;
  try {
    psqlOn("postgres", ["-c", `CREATE DATABASE ${rehearsalName}`]);
    created = true;
    psqlOn(rehearsalName, ["-f", "-"], `
      CREATE SCHEMA IF NOT EXISTS private;
      CREATE SCHEMA IF NOT EXISTS storage;
      CREATE TABLE public.applications (
        id uuid PRIMARY KEY,
        deleted_at timestamptz,
        license_photo_url text,
        insurance_doc_url text,
        profile_screenshot_url text,
        trip_screenshots text[]
      );
      CREATE TABLE public.documents (
        id uuid PRIMARY KEY,
        driver_id uuid,
        category text,
        is_current boolean NOT NULL DEFAULT true,
        storage_bucket text,
        storage_path text,
        content_sha256 text
      );
      CREATE TABLE storage.objects (
        id uuid PRIMARY KEY,
        bucket_id text NOT NULL,
        name text NOT NULL,
        user_metadata jsonb,
        version text,
        updated_at timestamptz
      );
    `);
    psqlOn(rehearsalName, ["-f", "proposed/m2-with-approval-boundary/record-uploaded-content-sha.sql"]);
    const pageBytes = new TextEncoder().encode("m2-license-backfill-page");
    const newBytes = new TextEncoder().encode("m2-license-backfill-new");
    const pageDigest = await contentSha256Hex(pageBytes);
    const newDigest = await contentSha256Hex(newBytes);
    psqlOn(rehearsalName, ["-v", `digest=${pageDigest}`, "-f", "-"], `
      INSERT INTO public.applications (id, deleted_at)
      SELECT ('01000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
             timestamptz '2026-01-01+00'
      FROM generate_series(0, 1000) AS i;
      INSERT INTO public.applications (id)
      VALUES ('02000000-0000-4000-8000-000000000001'::uuid);
      INSERT INTO public.documents (id, driver_id, category, is_current, storage_bucket, storage_path, content_sha256)
      SELECT ('10000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
             '02000000-0000-4000-8000-000000000001'::uuid,
             'license_front', true, 'driver-docs', 'paged/' || i::text, :'digest'
      FROM generate_series(1, 1001) AS i;
      INSERT INTO storage.objects (id, bucket_id, name, user_metadata, version, updated_at)
      SELECT ('11000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
             'driver-docs', 'paged/' || i::text,
             jsonb_build_object('sha256', :'digest'),
             'v1', timestamptz '2026-10-21 00:00:00+00'
      FROM generate_series(1, 1001) AS i;
      INSERT INTO private.uploaded_content_sha (bucket_id, name, object_id, version, updated_at, user_metadata, sha256)
      SELECT 'driver-docs', 'paged/' || i::text,
             ('11000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
             'v1', timestamptz '2026-10-21 00:00:00+00',
             jsonb_build_object('sha256', :'digest'),
             :'digest'
      FROM generate_series(1, 1001) AS i;
      INSERT INTO public.documents (id, driver_id, category, is_current, storage_bucket, storage_path)
      VALUES (
        '00000000-0000-4000-8000-000000000001',
        ('01000000-0000-4000-8000-' || lpad(to_hex(1000), 12, '0'))::uuid,
        'license_front', true, 'driver-docs', 'deleted.jpg'
      );
      INSERT INTO storage.objects (id, bucket_id, name, user_metadata, version, updated_at)
      VALUES (
        '00000000-0000-4000-8000-000000000002',
        'driver-docs', 'deleted.jpg', '{}'::jsonb, 'v1', timestamptz '2026-10-21 00:00:00+00'
      );
      INSERT INTO public.documents (id, driver_id, category, is_current, storage_bucket, storage_path, content_sha256)
      VALUES (
        '30000000-0000-4000-8000-000000000001',
        '02000000-0000-4000-8000-000000000001',
        'license_front', false, 'driver-docs', 'retired.jpg', :'digest'
      );
      INSERT INTO public.documents (id, driver_id, category, is_current, storage_bucket, storage_path)
      VALUES (
        '20000000-0000-4000-8000-000000000001',
        '02000000-0000-4000-8000-000000000001',
        'license_front', true, 'driver-docs', 'new.jpg'
      );
      INSERT INTO storage.objects (id, bucket_id, name, user_metadata, version, updated_at)
      VALUES (
        '20000000-0000-4000-8000-000000000002',
        'driver-docs', 'new.jpg', '{}'::jsonb, 'v1', timestamptz '2026-10-21 00:00:00+00'
      );
    `);
    const files = new Map<string, Uint8Array>();
    for (let index = 1; index <= 1001; index += 1) files.set(`driver-docs/paged/${index}`, pageBytes);
    files.set("driver-docs/new.jpg", newBytes);
    files.set("driver-docs/deleted.jpg", new TextEncoder().encode("m2-license-backfill-deleted"));
    let rehearsalDownloads = 0;
    let rehearsalRpc = 0;
    const rehearsalDb = rehearsalPostgres(`postgresql://postgres@127.0.0.1:55442/${rehearsalName}?sslmode=disable`, { max: 1 });
    rehearsalSql = rehearsalDb;
    const scratchAdmin = {
      from(table: string) {
        const { builder } = pageBuilder((state) => {
          assertBackfillSelect(table, state.select);
          if (table === "applications") {
            const filtered = state.nots.some((item) => item.col === "deleted_at" && item.op === "is" && item.val === null);
            if (!filtered) throw new Error("deleted applications were not filtered");
            return rehearsalDb<{ id: string; deleted_at: string | null }[]>`
              select id::text as id, deleted_at::text as deleted_at
              from public.applications
              order by id
            `.then((rows) => slicePage(rows.filter((row) => row.deleted_at != null).map((row) => ({ id: row.id })), state, true));
          }
          if (table !== "documents") throw new Error(`unexpected table ${table}`);
          return rehearsalDb<{
            id: string;
            driver_id: string | null;
            storage_bucket: string | null;
            storage_path: string | null;
            content_sha256: string | null;
            is_current: boolean;
            category: string;
          }[]>`
            select id::text as id, driver_id::text as driver_id, storage_bucket, storage_path, content_sha256,
                   is_current, category
            from public.documents
            order by id
          `.then((rows) => {
            const matched = rows.filter((row) =>
              state.eqs.every((filter) => (row as Record<string, unknown>)[filter.col] === filter.val)
              && state.ins.every((filter) => filter.val.includes((row as Record<string, unknown>)[filter.col] as never)),
            );
            return slicePage(matched, state, true).map((row) => ({
              id: row.id,
              driver_id: row.driver_id,
              storage_bucket: row.storage_bucket,
              storage_path: row.storage_path,
              content_sha256: row.content_sha256,
            }));
          });
        });
        return builder;
      },
      storage: {
        from(bucket: string) {
          return {
            async info(path: string) {
              const [row] = await rehearsalDb<{ id: string; version: string | null; updated_at: Date | null }[]>`
                select id::text as id, version, updated_at
                from storage.objects
                where bucket_id = ${bucket} and name = ${path}
              `;
              if (!row) return { data: null, error: { message: "Object not found", statusCode: "404" } };
              return { data: { id: row.id, version: row.version, updatedAt: row.updated_at }, error: null };
            },
            async download(path: string) {
              rehearsalDownloads += 1;
              const bytes = files.get(`${bucket}/${path}`);
              if (!bytes) return { data: null, error: { message: "Object not found", statusCode: "404" } };
              return { data: new Blob([bytes]), error: null };
            },
          };
        },
      },
      async rpc(_name: string, args: {
        p_bucket: string;
        p_path: string;
        p_sha256: string;
        p_object_id: string;
        p_version: string | null;
        p_updated_at: string | null;
      }) {
        rehearsalRpc += 1;
        try {
          const [row] = await rehearsalDb<{ sha: string }[]>`
            select public.record_uploaded_content_sha(
              ${args.p_bucket}, ${args.p_path}, ${args.p_sha256},
              ${args.p_object_id}::uuid, ${args.p_version}, ${args.p_updated_at}::timestamptz
            ) as sha
          `;
          return { data: row?.sha ?? null, error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { data: null, error: { message } };
        }
      },
    };
    const scratchDry = await backfillLicenseContentSha(scratchAdmin, { write: false });
    if (
      scratchDry.total !== 1002
      || scratchDry.fingerprinted !== 1001
      || scratchDry.pending !== 1
      || scratchDry.missing !== 0
      || scratchDry.mismatched !== 0
      || rehearsalDownloads !== 0
      || rehearsalRpc !== 0
    ) {
      throw new Error(`scratch dry-run ${JSON.stringify(scratchDry)} downloads=${rehearsalDownloads} rpc=${rehearsalRpc}`);
    }
    const scratchWrite = await backfillLicenseContentSha(scratchAdmin, { write: true });
    if (
      scratchWrite.total !== 1002
      || scratchWrite.hashed !== 1
      || scratchWrite.skipped !== 1001
      || scratchWrite.fingerprinted !== 1002
      || scratchWrite.missing !== 0
      || scratchWrite.mismatched !== 0
      || rehearsalRpc !== 1
      || rehearsalDownloads !== 1002
    ) {
      throw new Error(`scratch write ${JSON.stringify(scratchWrite)} downloads=${rehearsalDownloads} rpc=${rehearsalRpc}`);
    }
    const [storedNew] = await rehearsalDb<{ content_sha256: string | null }[]>`
      select content_sha256 from public.documents where storage_path = 'new.jpg'
    `;
    if (storedNew?.content_sha256 !== newDigest) throw new Error("stored hash is not the downloaded bytes");
    const scratchAgain = await backfillLicenseContentSha(scratchAdmin, { write: true });
    if (
      scratchAgain.hashed !== 0
      || scratchAgain.skipped !== 1002
      || scratchAgain.fingerprinted !== 1002
      || scratchAgain.mismatched !== 0
      || scratchAgain.missing !== 0
      || rehearsalRpc !== 1
      || rehearsalDownloads !== 2004
    ) {
      throw new Error(`scratch second write ${JSON.stringify(scratchAgain)} downloads=${rehearsalDownloads} rpc=${rehearsalRpc}`);
    }
    const report = psqlOn(rehearsalName, ["-f", "proposed/backfill-document-content-sha.sql"]);
    const reportLine = report.split("\n").map((line) => line.trim()).find((line) => line.startsWith("report"));
    const reportCells = reportLine?.split("|").map((cell) => cell.trim()) ?? [];
    if (reportCells[1] !== "0" || reportCells[2] !== "0" || reportCells[3] !== "0") {
      throw new Error(`scratch sql report ${reportLine ?? report}`);
    }
    await rehearsalDb`update public.documents set content_sha256 = null where storage_path = 'new.jpg'`;
    const [bindingLeft] = await rehearsalDb<{ n: number }[]>`
      select count(*)::int as n from private.uploaded_content_sha where name = 'new.jpg'
    `;
    if (Number(bindingLeft?.n) !== 1) throw new Error("clearing the document hash removed the binding");
    let serviceDenied = false;
    try {
      await rehearsalDb.begin(async (tx) => {
        await tx.unsafe("set local role service_role");
        await tx.unsafe("delete from private.uploaded_content_sha");
      });
    } catch (error) {
      serviceDenied = /permission denied/i.test(error instanceof Error ? error.message : String(error));
      if (!serviceDenied) throw error;
    }
    if (!serviceDenied) throw new Error("service_role deleted the binding");
    psqlOn(rehearsalName, ["-f", "proposed/rollback/backfill-content-sha.sql"]);
    const [currentLeft] = await rehearsalDb<{ n: number }[]>`
      select count(*)::int as n from public.documents
      where is_current is true
        and category in ('license_front', 'license_back')
        and content_sha256 is not null
    `;
    const [retiredLeft] = await rehearsalDb<{ n: number }[]>`
      select count(*)::int as n from public.documents
      where storage_path = 'retired.jpg' and content_sha256 is not null
    `;
    const [bindings] = await rehearsalDb<{ n: number }[]>`
      select count(*)::int as n from private.uploaded_content_sha
    `;
    const [deletedLeft] = await rehearsalDb<{ content_sha256: string | null }[]>`
      select content_sha256 from public.documents where storage_path = 'deleted.jpg'
    `;
    if (Number(currentLeft?.n) !== 0 || Number(retiredLeft?.n) !== 1 || Number(bindings?.n) !== 0 || deletedLeft?.content_sha256 != null) {
      throw new Error(`undo left current=${currentLeft?.n} retired=${retiredLeft?.n} bindings=${bindings?.n} deleted=${deletedLeft?.content_sha256}`);
    }
    const seconds = ((Date.now() - rehearsalStarted) / 1000).toFixed(1);
    console.log(formatContentShaBackfill("dry-run", scratchDry));
    console.log(formatContentShaBackfill("write", scratchWrite));
    console.log(formatContentShaBackfill("write", scratchAgain));
    console.log(`license backfill rehearsal ${seconds}s`);
  } finally {
    try {
      if (rehearsalSql) await rehearsalSql.end({ timeout: 5 });
    } finally {
      if (created) psqlOn("postgres", ["-c", `DROP DATABASE IF EXISTS ${rehearsalName} WITH (FORCE)`]);
    }
  }
}
