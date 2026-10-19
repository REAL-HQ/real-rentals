// Pure rules for wet-signed paper agreement originals (client + server safe).
// Server re-runs every check on the actual bytes; the browser check is only UX.

export const PAPER_MAX_BYTES = 20 * 1024 * 1024;
export const PAPER_BUCKET = "rental-agreements";

export type PaperCheck = { ok: true } | { ok: false; reason: string };

/** Validates the actual bytes: non-empty, size cap, PDF header and EOF marker. */
export function checkPaperPdf(bytes: Uint8Array): PaperCheck {
  if (!bytes.length) return { ok: false, reason: "The file is empty." };
  if (bytes.length > PAPER_MAX_BYTES)
    return { ok: false, reason: "The file is larger than 20 MB." };
  const head = String.fromCharCode(...bytes.subarray(0, 5));
  if (head !== "%PDF-") return { ok: false, reason: "Only complete PDF files are accepted." };
  const tail = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 1024)));
  if (!tail.includes("%%EOF")) return { ok: false, reason: "The PDF appears incomplete." };
  return { ok: true };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Unique, never-reused path; the bucket upload also refuses overwrites. */
export function paperStoragePath(applicationId: string, id: string): string {
  return `paper/${applicationId}/${id}.pdf`;
}

export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^\w.\- ()]+/g, "_")
    .slice(0, 116)
    .trim();
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned || "agreement"}.pdf`;
}

export const PAPER_TYPES = ["original", "addendum", "extension"] as const;
export type PaperType = (typeof PAPER_TYPES)[number];
export const PAPER_TYPE_LABEL = {
  original: "Original",
  addendum: "Addendum",
  extension: "Extension",
};
export function validSignedOn(value: string | null, today: string): boolean {
  if (!value) return true;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value &&
    value <= today
  );
}
