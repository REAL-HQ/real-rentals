// Pure rules for wet-signed paper agreement originals (client + server safe).
// Server re-runs every check on the actual bytes; the browser check is only UX.

export const PAPER_MAX_BYTES = 20 * 1024 * 1024;
export const PAPER_BUCKET = "rental-agreements";

export type PaperCheck = { ok: true } | { ok: false; reason: string };

/** Validates the actual bytes: non-empty, size cap, PDF header and EOF marker. */
export function checkPaperPdf(bytes: Uint8Array): PaperCheck {
  if (!bytes.length) return { ok: false, reason: "The file is empty." };
  if (bytes.length > PAPER_MAX_BYTES) return { ok: false, reason: "The file is larger than 20 MB." };
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (head !== "%PDF-") return { ok: false, reason: "Only complete PDF files are accepted." };
  const tail = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 1024)));
  if (!tail.includes("%%EOF")) return { ok: false, reason: "The PDF appears incomplete." };
  return { ok: true };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Unique, never-reused path; the bucket upload also refuses overwrites. */
export function paperStoragePath(applicationId: string, id: string): string {
  return `paper/${applicationId}/${id}.pdf`;
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120).trim();
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned || "agreement"}.pdf`;
}

/**
 * Paper metadata lives in documents.notes as one stable, versioned, machine-
 * readable line (no schema change). The same values are written to the
 * append-only audit log at upload, which is authoritative on read: if notes
 * are later edited and disagree, the record is flagged instead of trusted.
 */
export const PAPER_TYPES = ["original", "addendum", "extension"] as const;
export type PaperType = (typeof PAPER_TYPES)[number];
export const PAPER_TYPE_LABEL: Record<PaperType, string> = { original: "Original", addendum: "Addendum", extension: "Extension" };
export type PaperMeta = { signed_on: string | null; type: PaperType };
const META_PREFIX = "[paper-agreement v1] ";

export function encodePaperMeta(meta: PaperMeta): string {
  return META_PREFIX + JSON.stringify({ signed_on: meta.signed_on, type: meta.type });
}
export function decodePaperMeta(notes: string | null | undefined): PaperMeta | null {
  const line = notes?.split("\n").find((l) => l.startsWith(META_PREFIX));
  if (!line) return null;
  try {
    const v = JSON.parse(line.slice(META_PREFIX.length));
    const signed = typeof v.signed_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.signed_on) ? v.signed_on : null;
    if (!PAPER_TYPES.includes(v.type)) return null;
    return { signed_on: signed, type: v.type };
  } catch { return null; }
}
/** Audit value wins; notes that disagree are reported, never silently used. */
export function resolvePaperMeta(audit: PaperMeta | null, notes: PaperMeta | null): { meta: PaperMeta | null; mismatch: boolean } {
  if (audit) return { meta: audit, mismatch: !!notes && (notes.signed_on !== audit.signed_on || notes.type !== audit.type) };
  return { meta: notes, mismatch: false };
}
export function validSignedOn(date: string | null | undefined, today: string): boolean {
  if (!date) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return false;
  return date <= today && date >= "2020-01-01";
}
