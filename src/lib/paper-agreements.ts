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

/** Signed date lives in documents.notes as a tagged line (no schema change). */
const SIGNED_TAG = "Signed On: ";
export function encodeSignedOn(date: string | null): string | null {
  return date ? `${SIGNED_TAG}${date}` : null;
}
export function decodeSignedOn(notes: string | null | undefined): string | null {
  const m = notes?.match(/Signed On: (\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
export function validSignedOn(date: string | null | undefined, today: string): boolean {
  if (!date) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return false;
  return date <= today && date >= "2020-01-01";
}
