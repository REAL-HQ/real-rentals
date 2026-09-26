/**
 * Shrink a photo in the browser before it is uploaded.
 *
 * Applicants photograph documents with a phone camera, so a licence arrives as
 * a 12-megapixel, 6 MB JPEG of a card that is legible at a fraction of that.
 * The upload is the slowest part of the flow and the one most likely to fail
 * on a weak connection, and a rejected "file too big" is a lost application.
 *
 * Two details matter more than the compression itself:
 *
 *  - Orientation. Phones record portrait photos as landscape pixels plus an
 *    EXIF rotation flag. Drawing those pixels to a canvas throws the flag away
 *    and the document arrives on its side, which is how staff ended up
 *    tilting their heads at licences. createImageBitmap with
 *    imageOrientation: "from-image" applies the flag first.
 *
 *  - PDFs are never touched. An insurance declaration page is usually a PDF,
 *    re-encoding it as an image would destroy its text, and it is small
 *    anyway. It gets its own, larger size ceiling.
 */

/** Longest edge, in pixels, after resizing. Comfortably readable for a card. */
const MAX_EDGE = 2000;
/** JPEG quality. High enough that policy numbers stay sharp. */
const QUALITY = 0.82;
/** Below this, compressing costs more than it saves. */
const SKIP_UNDER_BYTES = 400 * 1024;

export const MAX_IMAGE_MB = 15;
export const MAX_PDF_MB = 25;

export function isPdf(file: File): boolean {
  return (file.type || "").toLowerCase().includes("pdf");
}

/** The ceiling that applies to this file, in MB. */
export function maxMbFor(file: File): number {
  return isPdf(file) ? MAX_PDF_MB : MAX_IMAGE_MB;
}

/**
 * Returns an optimized JPEG, or the original file when optimizing is not
 * appropriate or not possible.
 *
 * Never throws. A browser without createImageBitmap, a HEIC the decoder will
 * not open, a canvas that comes back blank — all of them fall through to
 * uploading exactly what the applicant chose, which is the behaviour we had
 * before this existed.
 */
export async function optimizeImage(file: File): Promise<File> {
  if (isPdf(file)) return file;
  if (!file.type.startsWith("image/")) return file;
  if (file.size < SKIP_UNDER_BYTES) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // Photographed documents are white paper; a transparent source (rare, but
    // a PNG screenshot can be) would otherwise flatten to black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (!blob || blob.size === 0) return file;
    // If the "optimized" version is bigger, the original was already better.
    if (blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
