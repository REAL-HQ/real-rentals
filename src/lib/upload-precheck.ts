/**
 * Browser-only quality check before an applicant upload starts.
 *
 * The flag is duplicated in DocumentCapture and ApplicationWizard so this
 * module is not imported while every copy is false. It does not upload, and
 * it does not choose a storage path.
 *
 * Type and size use the allowlist requestUploadUrl already signs
 * (jpg, jpeg, png, webp, heic, heif, pdf) and the ceilings in
 * image-optimize.ts (15 MB images, 25 MB PDFs). Those are the same numbers
 * uploadApplicantFile applies. Only type and size block. A soft photo is a
 * warning the driver can override.
 */

import { maxMbFor } from "@/lib/image-optimize";

export const UPLOAD_PRECHECK_ENABLED: boolean = false;

/** Short edge below this is hard to read. Warning only. */
export const MIN_SHORT_EDGE = 640;

/** Mean luminance below this looks too dark to read. Warning only. */
export const DARK_BELOW = 40;

/** Laplacian variance below this looks blurry. Warning only. */
export const BLUR_BELOW = 10;

export const PRECHECK_TIP = "Retake in good light, all four corners visible";

export const TYPE_BLOCK_MESSAGE = "This file type isn't accepted. Use a JPEG, PNG, HEIC, or PDF.";

/** Extensions requestUploadUrl will sign. jpeg is accepted and stored as jpg. */
export const ACCEPTED_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"] as const;

const ACCEPTED_EXT = new Set<string>(ACCEPTED_EXTS);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

export function assertUploadPrecheckEnabled(): void {
  if (UPLOAD_PRECHECK_ENABLED !== true) {
    throw new Error("Upload pre-check is not enabled.");
  }
}

export type UploadFileFacts = {
  name: string;
  type: string;
  size: number;
};

export type ImageStats = {
  width: number;
  height: number;
  /** 0–255. */
  meanLuma: number;
  /** Laplacian variance. Low means blurry. */
  sharpness: number;
};

export type PrecheckWarning = {
  code: "resolution" | "dark" | "blur";
  message: string;
};

export type PrecheckResult = {
  blocked: boolean;
  blockReason: "type" | "size" | null;
  blockMessage: string | null;
  warnings: PrecheckWarning[];
  tips: string[];
};

export function recognizedExt(name: string, type: string): string | null {
  const mime = (type || "").toLowerCase().split(";")[0].trim();
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const ext = (name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ACCEPTED_EXT.has(ext)) return null;
  return ext === "jpeg" ? "jpg" : ext;
}

/** Same ceiling uploadApplicantFile uses, once the extension has a real type. */
export function limitMbForExt(ext: string): number {
  return maxMbFor({ type: MIME_BY_EXT[ext] ?? "" } as File);
}

export function sizeBlockMessage(limitMb: number): string {
  return `That file is too big — please keep it under ${limitMb} MB.`;
}

export function meanLuma(gray: readonly number[]): number {
  if (!gray.length) return 0;
  let sum = 0;
  for (const value of gray) sum += value;
  return sum / gray.length;
}

export function laplacianVariance(gray: readonly number[], width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  const values: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      values.push(gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i]);
    }
  }
  if (!values.length) return 0;
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let variance = 0;
  for (const value of values) {
    const d = value - mean;
    variance += d * d;
  }
  return variance / values.length;
}

export function imageWarnings(stats: ImageStats): PrecheckWarning[] {
  const warnings: PrecheckWarning[] = [];
  if (stats.width < MIN_SHORT_EDGE || stats.height < MIN_SHORT_EDGE) {
    warnings.push({
      code: "resolution",
      message: "This photo is too small to read. Move closer so the whole document fills the frame.",
    });
  }
  if (stats.meanLuma < DARK_BELOW) {
    warnings.push({ code: "dark", message: "This photo looks too dark." });
  }
  if (stats.sharpness < BLUR_BELOW) {
    warnings.push({
      code: "blur",
      message: "This photo looks blurry. Hold steady so the text is sharp.",
    });
  }
  return warnings;
}

function clearResult(): PrecheckResult {
  return { blocked: false, blockReason: null, blockMessage: null, warnings: [], tips: [] };
}

export function evaluateUpload(file: UploadFileFacts, image: ImageStats | null): PrecheckResult {
  const ext = recognizedExt(file.name, file.type);
  if (!ext) {
    return {
      blocked: true,
      blockReason: "type",
      blockMessage: TYPE_BLOCK_MESSAGE,
      warnings: [],
      tips: [],
    };
  }
  const limitMb = limitMbForExt(ext);
  if (file.size > limitMb * 1024 * 1024) {
    return {
      blocked: true,
      blockReason: "size",
      blockMessage: sizeBlockMessage(limitMb),
      warnings: [],
      tips: [],
    };
  }
  if (ext === "pdf" || !image) return clearResult();
  const warnings = imageWarnings(image);
  if (!warnings.length) return clearResult();
  return { blocked: false, blockReason: null, blockMessage: null, warnings, tips: [PRECHECK_TIP] };
}

/** Blocked files never upload. Warnings upload only when the driver overrides. */
export function uploadDecision(result: PrecheckResult, override: boolean): "upload" | "stop" {
  if (result.blocked) return "stop";
  if (result.warnings.length > 0 && !override) return "stop";
  return "upload";
}

/**
 * Full-resolution edge for the size warning, and a small sample for blur and
 * darkness. A decoder that cannot open the file (some HEIC) returns null,
 * which warns about nothing — type and size already had their say.
 */
export async function measureImage(file: File): Promise<ImageStats | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const width = bitmap.width;
    const height = bitmap.height;
    const scale = Math.min(1, 64 / Math.max(width, height, 1));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bitmap.close?.();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Array<number>(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return { width, height, meanLuma: meanLuma(gray), sharpness: laplacianVariance(gray, w, h) };
  } catch {
    return null;
  }
}

export async function reviewUpload(file: File): Promise<PrecheckResult> {
  assertUploadPrecheckEnabled();
  const facts = { name: file.name, type: file.type, size: file.size };
  const ext = recognizedExt(file.name, file.type);
  const preliminary = evaluateUpload(facts, null);
  if (preliminary.blocked || ext === "pdf" || ext == null) return preliminary;
  const image = await measureImage(file);
  return evaluateUpload(facts, image);
}
