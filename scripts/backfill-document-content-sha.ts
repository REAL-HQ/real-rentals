/**
 * Hash current license_front and license_back objects from their bytes.
 *
 * Dry-run is the default. It does not download and does not call
 * record_uploaded_content_sha. A dry-run mismatched count stays 0 because
 * nothing is compared. That 0 is not evidence. The gate is the SQL report in
 * proposed/backfill-document-content-sha.sql.
 *
 * --write downloads each current license object. A row with no 64-hex
 * content_sha256 is hashed through writeUploadedContentSha. A row that
 * already has one is downloaded and compared: a match is skipped, a
 * difference is counted mismatched and is not replaced. Clearing
 * documents.content_sha256 does not remove private.uploaded_content_sha.
 * That table is revoked from service_role and has no policy, so only the
 * table owner can delete the binding row. After that delete, set the
 * document hash back to null and run --write again.
 *
 * Bun loads the committed .env, which points at hosted. This script refuses
 * to run unless SUPABASE_URL is passed with --url or is a shell value
 * different from that file. It prints the target host. The key's JWT role
 * must be service_role. A storage failure is storage_errors, not missing.
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

export type ContentShaBackfillCounts = {
  hashed: number;
  skipped: number;
  missing: number;
  mismatched: number;
  pending: number;
  storageErrors: number;
};

type LicenseRow = {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  content_sha256: string | null;
};

type StorageError = { message?: string; status?: number | string; statusCode?: number | string } | null;

export function isRecordedHash(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function classifyStorageFailure(error: StorageError, hasId: boolean): "ok" | "missing" | "error" {
  if (!error && hasId) return "ok";
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  const message = String(error?.message ?? "");
  if (status === 404 || /not found/i.test(message)) return "missing";
  return "error";
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

export async function backfillLicenseContentSha(
  admin: any,
  options: { write: boolean },
): Promise<ContentShaBackfillCounts> {
  const counts: ContentShaBackfillCounts = {
    hashed: 0,
    skipped: 0,
    missing: 0,
    mismatched: 0,
    pending: 0,
    storageErrors: 0,
  };
  const { data, error } = await admin
    .from("documents")
    .select("id,storage_bucket,storage_path,content_sha256")
    .eq("is_current", true)
    .in("category", ["license_front", "license_back"]);
  if (error) throw new Error(error.message || "Could not list license documents");
  for (const row of (data ?? []) as LicenseRow[]) {
    const bucket = row.storage_bucket?.trim() ?? "";
    const path = row.storage_path?.trim() ?? "";
    if (!bucket || !path) {
      counts.skipped += 1;
      continue;
    }
    if (isRecordedHash(row.content_sha256)) {
      if (!options.write) {
        counts.skipped += 1;
        continue;
      }
      const hashed = await objectSha(admin, bucket, path);
      if (hashed.kind === "missing") counts.missing += 1;
      else if (hashed.kind === "error") counts.storageErrors += 1;
      else if (hashed.sha === row.content_sha256) counts.skipped += 1;
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
      await writeUploadedContentSha(admin, bucket, path);
      counts.hashed += 1;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message === "Uploaded object missing" || message === "Uploaded bytes missing" || /not found/i.test(message)) {
        counts.missing += 1;
      } else if (message.includes("content_sha256_mismatch") || message === "Uploaded object changed") {
        counts.mismatched += 1;
      } else {
        throw caught;
      }
    }
  }
  return counts;
}

export function formatContentShaBackfill(mode: "dry-run" | "write", counts: ContentShaBackfillCounts): string {
  return `mode=${mode} hashed=${counts.hashed} skipped=${counts.skipped} missing=${counts.missing} mismatched=${counts.mismatched} pending=${counts.pending} storage_errors=${counts.storageErrors}`;
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
  if (counts.storageErrors > 0) process.exit(1);
}
