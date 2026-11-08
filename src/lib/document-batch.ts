/**
 * Planning for the staff batch upload on an applicant's Documents tab.
 *
 * The batch only ever writes the multi-file "other" category, so nothing in
 * it can replace a licence, insurance card or signed agreement. Files are
 * sent exactly as picked: no resize or re-encode, so the original bytes and
 * the camera EXIF stay intact.
 */
export const BATCH_CATEGORY = "other" as const;
export const BATCH_MAX_FILES = 40;
export const BATCH_MAX_BYTES = 15 * 1024 * 1024;
export const LABEL_MAX = 140;

export type BatchFileLike = { name: string; size: number; lastModified: number; type: string };
export type ExistingDocLike = {
  file_name: string | null;
  size_bytes: number | null;
  is_current: boolean;
};

export type BatchStatus = "ready" | "uploading" | "saved" | "failed" | "skipped";

export type BatchItem<F extends BatchFileLike = BatchFileLike> = {
  key: string;
  file: F;
  label: string;
  status: BatchStatus;
  note?: string;
};

export function fileKey(f: BatchFileLike): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

/** Short default title from a file name: "IMG_1234.JPG" -> "IMG 1234". */
export function defaultLabel(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return (base || "Photo").slice(0, LABEL_MAX);
}

function accepted(f: BatchFileLike): boolean {
  return f.type.startsWith("image/") || f.type === "application/pdf";
}

/**
 * Add picked files to the queue. Skips (with a reason, never silently):
 * exact repeats within the batch, files already on the applicant's profile
 * with the same name and size, wrong types, oversize files, and anything
 * past the batch cap.
 */
export function planBatch<F extends BatchFileLike>(
  queue: BatchItem<F>[],
  picked: F[],
  existing: ExistingDocLike[],
): BatchItem<F>[] {
  const out = [...queue];
  const seen = new Set(queue.map((q) => q.key));
  for (const file of picked) {
    const key = fileKey(file);
    const base: BatchItem<F> = { key, file, label: defaultLabel(file.name), status: "ready" };
    if (seen.has(key)) continue;
    seen.add(key);
    let note: string | undefined;
    if (!accepted(file)) note = "Not an image or PDF";
    else if (file.size > BATCH_MAX_BYTES) note = "Over 15 MB";
    else if (
      existing.some((d) => d.is_current && d.file_name === file.name && d.size_bytes === file.size)
    )
      note = "Already on file";
    else if (out.filter((q) => q.status !== "skipped").length >= BATCH_MAX_FILES)
      note = `Over ${BATCH_MAX_FILES} files`;
    out.push(note ? { ...base, status: "skipped", note } : base);
  }
  return out;
}

export function cleanLabel(label: string, fileName: string): string {
  const t = label.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  return t || defaultLabel(fileName);
}

/** Items a "Upload" press will send: ready ones only. Failed ones wait for a person. */
export function sendable<F extends BatchFileLike>(queue: BatchItem<F>[]): BatchItem<F>[] {
  return queue.filter((q) => q.status === "ready");
}
