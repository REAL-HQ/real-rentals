/**
 * Hash current license_front and license_back objects from their bytes.
 *
 * Dry-run is the default. It does not download and does not call
 * record_uploaded_content_sha. A dry-run mismatched count stays 0 because
 * nothing is compared. That 0 is not evidence. The gate is the SQL report in
 * proposed/backfill-document-content-sha.sql.
 *
 * --write downloads each current license object. A row whose
 * content_sha256 is not 64 hex is hashed through writeUploadedContentSha.
 * A stored hash is compared after lowercasing. A match is skipped, a
 * difference is counted mismatched and is not replaced. Missing is HTTP
 * 404, including HTTP 400 whose body statusCode is 404. Any other HTTP
 * status, including 403 and a 5xx from writeUploadedContentSha's download,
 * is storage_errors and does not abort the run. A download error with no
 * HTTP status and no message is storage_errors, not missing. The writer
 * substitutes "Uploaded object missing" or "Uploaded bytes missing" when
 * the client sent neither, and both of those messages are storage_errors.
 * A thrown network error has a message
 * and no HTTP status, and it still aborts the run. The unhashed write path
 * downloads once, inside writeUploadedContentSha.
 * --write exits nonzero when missing, mismatched, or storage_errors is
 * greater than 0. The printed line includes total, fingerprinted,
 * missing_file, and mismatched. missing_file is the same count as missing.
 * fingerprinted counts a row that already has a 64-hex hash, including a
 * mismatch, and a row this run hashes.
 *
 * Rows are read 1000 at a time, ordered by id, until an empty page or the
 * exact count. A short page is not the end. The select list is id,
 * driver_id, storage_bucket, storage_path, and content_sha256. A document
 * is omitted when is_current is false, and when driver_id is an application
 * whose deleted_at is set. Omitted rows are not in total. Deleted
 * application ids are paged the same way, selecting id only.
 *
 * Clearing documents.content_sha256 does not remove
 * private.uploaded_content_sha or user_metadata.sha256.
 * That table is revoked from service_role and has no policy, so only the
 * table owner can delete the binding row. The owner undo for every current
 * license fingerprint is proposed/rollback/backfill-content-sha.sql. It is
 * not an install step. It also removes user_metadata.sha256 on those
 * objects. It does not put back a client content_sha256 key. After that
 * undo, run --write again.
 *
 * Bun loads the committed .env, which points at hosted. This script refuses
 * to run unless SUPABASE_URL is passed with --url or is a shell value
 * different from that file. It prints the target host. The key's JWT role
 * must be service_role. An HTTP storage failure other than 404 is
 * storage_errors, not missing. A thrown network error still aborts.
 *
 * This does not turn DOCUMENT_CONTENT_SHA256_ENABLED on.
 *
 *   bun scripts/backfill-document-content-sha.ts --url https://project.example
 *   bun scripts/backfill-document-content-sha.ts --url https://project.example --write
 */
import { readFileSync, existsSync } from "node:fs";
import { contentSha256Hex, writeUploadedContentSha } from "../src/lib/document-content-sha";

const ROOT = new URL("..", import.meta.url);
const DOTENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.development.local",
  ".env.production.local",
];

export const BACKFILL_PAGE_SIZE = 1000;
export const LICENSE_BACKFILL_SELECT = "id,driver_id,storage_bucket,storage_path,content_sha256";

export type ContentShaBackfillCounts = {
  total: number;
  fingerprinted: number;
  hashed: number;
  skipped: number;
  missing: number;
  mismatched: number;
  pending: number;
  storageErrors: number;
};

type LicenseRow = {
  id: string;
  driver_id?: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  content_sha256: string | null;
};

type StorageError = { message?: string; status?: number | string; statusCode?: number | string } | null;

export function recordedHashHex(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

export function isRecordedHash(value: string | null | undefined): boolean {
  return recordedHashHex(value) !== null;
}

function statusNumber(value: unknown): number {
  const status = Number(value ?? 0);
  return Number.isFinite(status) ? status : 0;
}

export function storageHttpStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const record = error as { status?: unknown; statusCode?: unknown };
  const http = statusNumber(record.status);
  const body = statusNumber(record.statusCode);
  if (http === 404 || body === 404 || (http === 400 && body === 404)) return 404;
  if (http >= 500 && http <= 599) return http;
  if (body >= 500 && body <= 599) return body;
  if (http > 0) return http;
  return body;
}

export function classifyStorageFailure(error: StorageError, hasId: boolean): "ok" | "missing" | "error" {
  if (!error && hasId) return "ok";
  if (storageHttpStatus(error) === 404) return "missing";
  return "error";
}

/**
 * How --write treats an error thrown by writeUploadedContentSha.
 * Missing is status 404 only. Any other HTTP status is storage_errors.
 * An empty client error becomes the fallback "Uploaded object missing" or
 * "Uploaded bytes missing" and is storage_errors, not missing.
 * A thrown network error has some other message and no status, and aborts.
 */
export function classifyWriteDownloadFailure(caught: unknown): "missing" | "mismatched" | "storage" | "abort" {
  const status = storageHttpStatus(caught);
  const message = failureMessage(caught);
  if (status === 404) return "missing";
  if (message.includes("content_sha256_mismatch") || message === "Uploaded object changed") return "mismatched";
  if (status >= 400 && status <= 599) return "storage";
  if (message === "" || message === "Uploaded object missing" || message === "Uploaded bytes missing") return "storage";
  return "abort";
}

function failureMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === "string") return caught;
  if (caught && typeof caught === "object" && "message" in caught && typeof caught.message === "string") return caught.message;
  return "";
}

export function contentShaBackfillExitCode(write: boolean, counts: ContentShaBackfillCounts): number {
  if (counts.storageErrors > 0) return 1;
  if (write && (counts.missing > 0 || counts.mismatched > 0)) return 1;
  return 0;
}

export function readDotenvAssignment(text: string, name: string): string | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

export function committedSupabaseUrls(read: (file: string) => string | null = readRepoFile): string[] {
  const urls: string[] = [];
  for (const file of DOTENV_FILES) {
    const text = read(file);
    if (text == null) continue;
    const value = readDotenvAssignment(text, "SUPABASE_URL");
    if (value) urls.push(value);
  }
  return urls;
}

function readRepoFile(file: string): string | null {
  const path = new URL(file, ROOT);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function resolveSupabaseUrl(options: {
  argv: string[];
  envUrl: string | undefined;
  committedUrls: string[];
}): string {
  const flag = options.argv.indexOf("--url");
  if (flag >= 0) {
    const value = options.argv[flag + 1];
    if (!value || value.startsWith("--")) throw new Error("Pass the project URL after --url.");
    return assertHttpUrl(value);
  }
  const envUrl = options.envUrl?.trim() ?? "";
  if (envUrl && !options.committedUrls.includes(envUrl)) return assertHttpUrl(envUrl);
  throw new Error(
    "Refusing to run: SUPABASE_URL is the committed .env value. Bun loads that file automatically. Pass --url or export a different SUPABASE_URL in the shell.",
  );
}

function assertHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL is not a URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("SUPABASE_URL must be http or https.");
  if (!url.host) throw new Error("SUPABASE_URL has no host.");
  return value;
}

export function targetHost(url: string): string {
  return new URL(url).host;
}

export function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function assertServiceRoleKey(token: string): void {
  const role = jwtRole(token);
  if (role !== "service_role") {
    throw new Error(`Refusing to run: key role is ${role ?? "unreadable"}. This backfill requires service_role.`);
  }
}

async function objectSha(admin: any, bucket: string, path: string): Promise<
  { kind: "ok"; sha: string } | { kind: "missing" } | { kind: "error" }
> {
  const bucketApi = admin.storage.from(bucket);
  const info = await bucketApi.info(path);
  const infoKind = classifyStorageFailure(info?.error ?? null, Boolean(info?.data?.id));
  if (infoKind !== "ok") return { kind: infoKind };
  const file = await bucketApi.download(path);
  const downloadKind = classifyStorageFailure(file?.error ?? null, Boolean(file?.data));
  if (downloadKind !== "ok") return { kind: downloadKind };
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  return { kind: "ok", sha: await contentSha256Hex(bytes) };
}

async function eachPage<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null; count?: number | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  let expected: number | null = null;
  for (;;) {
    const to = from + BACKFILL_PAGE_SIZE - 1;
    const { data, error, count } = await load(from, to);
    if (error) throw new Error(error.message || "Could not read a page");
    if (typeof count === "number") expected = count;
    const page = data ?? [];
    rows.push(...page);
    if (page.length === 0) break;
    from += page.length;
    if (expected != null && from >= expected) break;
  }
  return rows;
}

async function deletedApplicationIds(admin: any): Promise<Set<string>> {
  const rows = await eachPage<{ id?: string | null }>((from, to) => admin
    .from("applications")
    .select("id", { count: "exact" })
    .not("deleted_at", "is", null)
    .order("id", { ascending: true })
    .range(from, to));
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row.id === "string" && row.id) ids.add(row.id);
  }
  return ids;
}

export async function backfillLicenseContentSha(
  admin: any,
  options: { write: boolean },
): Promise<ContentShaBackfillCounts> {
  const counts: ContentShaBackfillCounts = {
    total: 0,
    fingerprinted: 0,
    hashed: 0,
    skipped: 0,
    missing: 0,
    mismatched: 0,
    pending: 0,
    storageErrors: 0,
  };
  const deleted = await deletedApplicationIds(admin);
  const pages = await eachPage<LicenseRow>((from, to) => admin
    .from("documents")
    .select(LICENSE_BACKFILL_SELECT, { count: "exact" })
    .eq("is_current", true)
    .in("category", ["license_front", "license_back"])
    .order("id", { ascending: true })
    .range(from, to));
  for (const row of pages) {
      if (typeof row.driver_id === "string" && deleted.has(row.driver_id)) continue;
      counts.total += 1;
      const bucket = row.storage_bucket?.trim() ?? "";
      const path = row.storage_path?.trim() ?? "";
      if (!bucket || !path) {
        counts.skipped += 1;
        continue;
      }
      const recorded = recordedHashHex(row.content_sha256);
      if (recorded) counts.fingerprinted += 1;
      if (recorded) {
        if (!options.write) {
          counts.skipped += 1;
          continue;
        }
        const hashed = await objectSha(admin, bucket, path);
        if (hashed.kind === "missing") counts.missing += 1;
        else if (hashed.kind === "error") counts.storageErrors += 1;
        else if (hashed.sha === recorded) counts.skipped += 1;
        else counts.mismatched += 1;
        continue;
      }
      const info = await admin.storage.from(bucket).info(path);
      const infoKind = classifyStorageFailure(info?.error ?? null, Boolean(info?.data?.id));
      if (infoKind === "missing") {
        counts.missing += 1;
        continue;
      }
      if (infoKind === "error") {
        counts.storageErrors += 1;
        continue;
      }
      if (!options.write) {
        counts.pending += 1;
        continue;
      }
      try {
        await writeUploadedContentSha(admin, bucket, path, row.id);
        counts.hashed += 1;
        counts.fingerprinted += 1;
      } catch (caught) {
        const kind = classifyWriteDownloadFailure(caught);
        if (kind === "missing") counts.missing += 1;
        else if (kind === "mismatched") counts.mismatched += 1;
        else if (kind === "storage") counts.storageErrors += 1;
        else throw caught;
      }
    }
  return counts;
}

export function formatContentShaBackfill(mode: "dry-run" | "write", counts: ContentShaBackfillCounts): string {
  return `mode=${mode} total=${counts.total} fingerprinted=${counts.fingerprinted} missing_file=${counts.missing} hashed=${counts.hashed} skipped=${counts.skipped} missing=${counts.missing} mismatched=${counts.mismatched} pending=${counts.pending} storage_errors=${counts.storageErrors}`;
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  const url = resolveSupabaseUrl({
    argv: process.argv,
    envUrl: process.env.SUPABASE_URL,
    committedUrls: committedSupabaseUrls(),
  });
  process.env.SUPABASE_URL = url;
  console.log(`target host=${targetHost(url)}`);
  assertServiceRoleKey(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  const { supabaseAdmin } = await import("../src/integrations/supabase/client.server");
  const counts = await backfillLicenseContentSha(supabaseAdmin, { write });
  console.log(formatContentShaBackfill(write ? "write" : "dry-run", counts));
  if (contentShaBackfillExitCode(write, counts) !== 0) process.exit(1);
}
