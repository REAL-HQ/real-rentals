/**
 * SHA-256 of an uploaded file, recorded on the document and on the storage
 * object's user_metadata. Approval reads user_metadata.sha256.
 *
 * Hosted PostgREST exposes public and graphql_public. It does not expose
 * storage, so this path does not select or update storage.objects. Storage
 * API info() and download() read the object. The conditional merge is
 * public.record_uploaded_content_sha, a SECURITY DEFINER function proposed
 * as a packet step. It sets documents.content_sha256 when that row already
 * exists and merges user_metadata.sha256 with jsonb ||, and only when the
 * object's id and version (or updated_at) still match the row that was hashed.
 *
 * false: confirmDocumentUpload and registerDocument keep today's insert and
 * do not read the object. No environment variable can open this.
 * true: those functions hash the stored bytes and call the packet function.
 * A missing object, a changed object, or a failed merge throws, so
 * registerDocument throws instead of returning null. The function is not
 * installed on hosted. Activation is changing this constant and rebuilding,
 * after that packet step is installed.
 */
export const DOCUMENT_CONTENT_SHA256_ENABLED = false;

export async function contentSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The user_metadata key private.approval_object_version reads. */
export function storageShaMetadata(sha256: string): { sha256: string } {
  return { sha256 };
}

/**
 * Flag off: returns null and does not touch storage.
 * Flag on: hashes the downloaded bytes and asks the packet function to merge
 * that sha into user_metadata. The file bytes are not uploaded again.
 * The caller stores the returned hex on documents.content_sha256.
 * Throws when the flag is on and the object or the conditional merge is missing.
 */
export async function recordUploadedContentSha(
  admin: any,
  bucket: string,
  path: string,
): Promise<string | null> {
  if (!DOCUMENT_CONTENT_SHA256_ENABLED) return null;
  return writeUploadedContentSha(admin, bucket, path);
}

/** Flag-on body. Download, hash, then one conditional merge. */
export async function writeUploadedContentSha(admin: any, bucket: string, path: string): Promise<string> {
  const bucketApi = admin.storage.from(bucket);
  const info = await bucketApi.info(path);
  if (info.error || !info.data?.id) throw new Error(info.error?.message || "Uploaded object missing");
  const file = await bucketApi.download(path);
  if (file.error || !file.data) throw new Error(file.error?.message || "Uploaded bytes missing");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const sha256 = await contentSha256Hex(bytes);
  const version = typeof info.data.version === "string" && info.data.version.trim() ? info.data.version : null;
  const updatedAt = info.data.lastModified ?? info.data.last_modified ?? info.data.updated_at ?? null;
  const saved = await admin.rpc("record_uploaded_content_sha", {
    p_bucket: bucket,
    p_path: path,
    p_sha256: sha256,
    p_object_id: info.data.id,
    p_version: version,
    p_updated_at: updatedAt,
  });
  if (saved.error || saved.data !== sha256) throw new Error(saved.error?.message || "Uploaded object changed");
  return sha256;
}
