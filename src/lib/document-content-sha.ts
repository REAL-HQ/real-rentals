/**
 * SHA-256 of an uploaded file, recorded on the document and on the storage
 * object's user_metadata. Approval reads user_metadata.sha256.
 *
 * supabase-js stores the upload `metadata` option in user_metadata (storage
 * migration 0025). The metadata column is system data: size, mimetype,
 * cacheControl, eTag. This path does not upload the object again. A second
 * upload rewrites the bytes, drops the Blob content type, and resets
 * cache-control.
 *
 * false: confirmDocumentUpload and registerDocument keep today's insert and
 * do not read the object. No environment variable can open this.
 * true: those functions hash the stored bytes, set user_metadata.sha256, and
 * write documents.content_sha256. A missing object or a failed metadata write
 * throws, so registerDocument throws instead of returning null. Activation is
 * changing this constant and rebuilding.
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
 * Flag on: hashes the object that was just uploaded and sets user_metadata.sha256
 * on that same row. The file bytes, MIME type, and cache-control stay as uploaded.
 * The caller stores the returned hex on documents.content_sha256.
 * Throws when the flag is on and the object or the metadata write is missing.
 *
 * `admin` is the service-role client. Its schema() generic only accepts the
 * public schema in the generated Database type, while this write targets
 * storage.objects, so the parameter stays untyped.
 */
export async function recordUploadedContentSha(
  admin: any,
  bucket: string,
  path: string,
): Promise<string | null> {
  if (!DOCUMENT_CONTENT_SHA256_ENABLED) return null;
  return writeUploadedContentSha(admin, bucket, path);
}

/** Flag-on body. Hashes the stored bytes and writes user_metadata.sha256 only. */
export async function writeUploadedContentSha(admin: any, bucket: string, path: string): Promise<string> {
  const file = await admin.storage.from(bucket).download(path);
  if (file.error || !file.data) throw new Error(file.error?.message || "Uploaded bytes missing");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const sha256 = await contentSha256Hex(bytes);
  const objects = admin.schema("storage").from("objects");
  const current = await objects.select("user_metadata").eq("bucket_id", bucket).eq("name", path).maybeSingle();
  if (current.error || !current.data) throw new Error(current.error?.message || "Uploaded object missing");
  const userMetadata = { ...(current.data.user_metadata ?? {}), ...storageShaMetadata(sha256) };
  const saved = await objects.update({ user_metadata: userMetadata }).eq("bucket_id", bucket).eq("name", path);
  if (saved.error) throw new Error(saved.error.message);
  return sha256;
}
