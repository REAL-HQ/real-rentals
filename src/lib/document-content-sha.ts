/**
 * SHA-256 of an uploaded file, recorded on the document and on the storage
 * object's metadata. Approval reads both and refuses when either is missing.
 *
 * false: confirmDocumentUpload and registerDocument keep today's insert and
 * do not read the object. No environment variable can open this.
 * true: those functions hash the stored bytes and write documents.content_sha256
 * plus metadata.sha256. Activation is changing this constant and rebuilding.
 */
export const DOCUMENT_CONTENT_SHA256_ENABLED = false;

export async function contentSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The metadata key private.approval_object_version reads. */
export function storageShaMetadata(sha256: string): { sha256: string } {
  return { sha256 };
}

type StorageDownload = {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
      upload: (
        path: string,
        body: Blob,
        options: { upsert: boolean; contentType?: string; metadata: { sha256: string } },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * Flag off: returns null and does not touch storage.
 * Flag on: hashes the object that was just uploaded and writes metadata.sha256
 * on that same object. The caller stores the returned hex on documents.content_sha256.
 */
export async function recordUploadedContentSha(
  admin: StorageDownload,
  bucket: string,
  path: string,
  contentType?: string | null,
): Promise<string | null> {
  if (!DOCUMENT_CONTENT_SHA256_ENABLED) return null;
  const file = await admin.storage.from(bucket).download(path);
  if (file.error || !file.data) throw new Error(file.error?.message || "Uploaded bytes missing");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const sha256 = await contentSha256Hex(bytes);
  const saved = await admin.storage.from(bucket).upload(path, new Blob([bytes]), {
    upsert: true,
    contentType: contentType ?? undefined,
    metadata: storageShaMetadata(sha256),
  });
  if (saved.error) throw new Error(saved.error.message);
  return sha256;
}
