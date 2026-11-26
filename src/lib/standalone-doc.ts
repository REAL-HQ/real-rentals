// Pure rules for a third-party PDF sent for signature. Client and server safe.
// Coordinates are PDF points. The origin is the bottom-left of the page, the
// same origin pdf-lib stamps with, so a box placed in the preview is the box
// drawn on the signed file.
import { z } from "zod";
import { type Mark } from "@/lib/signature-adoption";

export const TEAM_CC = "team@drivereal.com";
export const SOURCE_URL_TTL_SECONDS = 300;
export const STANDALONE_BUCKET = "rental-agreements";

export const STANDALONE_FIELD_TYPES = ["signature", "date", "name"] as const;
export type StandaloneFieldType = (typeof STANDALONE_FIELD_TYPES)[number];

export const StandaloneFieldSchema = z.object({
  type: z.enum(STANDALONE_FIELD_TYPES),
  page: z.number().int().min(1).max(50),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive().max(800),
  h: z.number().finite().positive().max(400),
});
export type StandaloneField = z.infer<typeof StandaloneFieldSchema>;

export type PageSize = { width: number; height: number };

export type SourcePdfClient = {
  url: string;
  pages: number;
  fields: StandaloneField[];
  fallback: boolean;
  page_sizes: PageSize[];
};

export type DeliverTo = {
  insurer_email: string;
  cc: string[];
  copy_renter: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(e) || e.length > 254) return null;
  return e;
}

/** Staff Cc text: commas, semicolons, or spaces. Blanks dropped. */
export function parseEmailList(raw: string): string[] {
  return raw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Insurer is To. team@drivereal.com is always Cc. The renter is a separate
 * copy when copy_renter is on (default), never a second To on the insurer email.
 */
export function deliverTo(args: { insurerEmail: string; cc?: string[]; copyRenter?: boolean }): DeliverTo {
  const insurer = normalizeEmail(args.insurerEmail);
  if (!insurer) throw new Error("Enter a valid insurer email.");
  const cc = new Set<string>([TEAM_CC]);
  for (const raw of args.cc ?? []) {
    const e = normalizeEmail(raw);
    if (!e) throw new Error(`Enter a valid Cc email. "${String(raw).trim()}" is not an email.`);
    if (e !== insurer) cc.add(e);
  }
  cc.delete(insurer);
  return { insurer_email: insurer, cc: [...cc], copy_renter: args.copyRenter !== false };
}

export type RecipientLine = { role: "To" | "Cc" | "Copy"; who: string; email: string };

/** Every address a send will use, in the order the confirmation step shows them. */
export function recipientLines(plan: DeliverTo, renter: { name?: string | null; email?: string | null }): RecipientLine[] {
  const lines: RecipientLine[] = [{ role: "To", who: "Insurer", email: plan.insurer_email }];
  for (const email of plan.cc) lines.push({ role: "Cc", who: email === TEAM_CC ? "REAL RENTALS" : "Cc", email });
  if (plan.copy_renter) {
    const email = normalizeEmail(renter.email) ?? "";
    lines.push({ role: "Copy", who: (renter.name ?? "").trim() || "Renter", email });
  }
  return lines;
}

const BOX: Record<StandaloneFieldType, { w: number; h: number }> = {
  signature: { w: 180, h: 36 },
  date: { w: 120, h: 18 },
  name: { w: 180, h: 18 },
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * A click on the preview (fractions of the page, origin top-left) becomes a
 * box in PDF points (origin bottom-left), kept fully on the page.
 */
export function fieldAtClick(args: {
  type: StandaloneFieldType;
  page: number;
  fx: number;
  fy: number;
  pageWidth: number;
  pageHeight: number;
}): StandaloneField {
  const want = BOX[args.type];
  const w = Math.min(want.w, args.pageWidth);
  const h = Math.min(want.h, args.pageHeight);
  const x = clamp(args.fx * args.pageWidth - w / 2, 0, Math.max(0, args.pageWidth - w));
  const top = clamp(args.fy * args.pageHeight - h / 2, 0, Math.max(0, args.pageHeight - h));
  const y = args.pageHeight - top - h;
  return { type: args.type, page: args.page, x: round(x), y: round(y), w: round(w), h: round(h) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** CSS percentages for a box over a page rendered at its PDF point size. */
export function fieldPercents(field: StandaloneField, page: PageSize): { left: string; top: string; width: string; height: string } {
  const left = (field.x / page.width) * 100;
  const width = (field.w / page.width) * 100;
  const height = (field.h / page.height) * 100;
  const top = ((page.height - field.y - field.h) / page.height) * 100;
  return { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` };
}

export const FIELD_LABEL: Record<StandaloneFieldType, string> = {
  signature: "Signature",
  date: "Date",
  name: "Printed Name",
};

export function validateFields(fields: StandaloneField[], sizes: PageSize[], fallback: boolean): string | null {
  if (fallback) return null;
  if (!sizes.length) return "This PDF has no pages.";
  if (!fields.some((f) => f.type === "signature")) return "Place a Signature box on the document.";
  for (const f of fields) {
    const size = sizes[f.page - 1];
    if (!size) return "A box is on a page that does not exist.";
    if (f.w < 8 || f.h < 8) return "A box is too small.";
    if (f.x < -1 || f.y < -1 || f.x + f.w > size.width + 1 || f.y + f.h > size.height + 1) return "A box sits outside the page.";
  }
  return null;
}

/** A signature is required. Initials are not: a standalone PDF has no initials boxes. */
export function standaloneSignatureProblems(a: { signature?: Mark } | undefined, legalName: string): string[] {
  if (!a?.signature) return ["Adopt a signature before signing this document."];
  const p: string[] = [];
  if (a.signature.method === "typed" && a.signature.text.trim().toLowerCase() !== legalName.trim().toLowerCase()) {
    p.push("Your typed signature must match the full legal name you entered.");
  }
  if (a.signature.method === "drawn") {
    const pts = a.signature.strokes.reduce((n, s) => n + s.length, 0);
    if (pts < 8) p.push("Your drawn signature is too short — please draw it again.");
  }
  return p;
}

export const SIGNING_REQUEST_SUBJECT = "Your Document Is Ready To Sign";

export function renterFirstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "there";
}

/** The sentence in the renter's signing-link email. */
export function signingRequestMessage(renterName: string | null | undefined): string {
  return `Hi ${renterFirstName(renterName)}, a document is ready for your signature. Please review it and sign electronically.`;
}

export function signedDocumentSubject(title: string): string {
  return `Signed Document — ${title.trim() || "Document"}`;
}

/** The sentence in the email that carries the signed PDF. */
export function signedDocumentMessage(args: { title: string; signerName: string; copyFor: "insurer" | "renter" }): string {
  const title = args.title.trim() || "this document";
  const who = args.copyFor === "renter" ? "You signed" : `${(args.signerName || "The renter").trim()} signed`;
  return `${who} ${title}. The signed PDF is attached.`;
}

/** Voided, already signed, and expired links are not a way back into the PDF. */
export function refuseStandaloneLink(row: { status?: string | null; token_expires_at?: string | null }, now = Date.now()): void {
  const status = String(row.status ?? "");
  if (status === "voided") throw new Error("This agreement was cancelled");
  if (status === "signed") throw new Error("This signing link is no longer valid");
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() < now) {
    throw new Error("This signing link has expired — please ask us to resend it");
  }
}

export function sourcePdfAllowed(row: { source?: string | null; status?: string | null; token_expires_at?: string | null }, now = Date.now()): boolean {
  if (row.source !== "standalone") return false;
  const status = String(row.status ?? "");
  if (status !== "sent" && status !== "viewed" && status !== "signing") return false;
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() < now) return false;
  return true;
}

/** Object key inside the rental-agreements bucket. The bucket name is not repeated. */
export function standaloneSourcePath(agreementId: string, sha256: string): string {
  return `standalone-src/${agreementId}/${sha256}.pdf`;
}

export function standaloneSignedPath(agreementId: string, sha256: string): string {
  return `standalone-signed/${agreementId}/${sha256}.pdf`;
}

export function signedDateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Fast client hint. The server's pdf-lib load is the decision that is stored. */
export function pdfLooksEncrypted(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 262144);
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i]);
  return /\/Encrypt\b/.test(s);
}

export function standaloneBody(title: string, sha256: string, pages: number, fallback: boolean): string {
  const where = fallback
    ? "The original PDF could not be edited in place. After you sign, a signature page is added and the original file is kept unchanged."
    : `The original PDF has ${pages} page${pages === 1 ? "" : "s"}. Your signature, printed name and date are placed in the boxes shown on the document.`;
  return [
    title.trim(),
    "",
    "This is an existing document uploaded by REAL RENTALS for your electronic signature. It is not a rental agreement.",
    where,
    `Original file SHA-256: ${sha256}`,
  ].join("\n");
}

/** Resend of a rental agreement still demands the contract merge fields. A standalone document has none of them. */
export function resendSkipsRentalMerge(source: string | null | undefined): boolean {
  return source === "standalone";
}

/** Voiding a cancellation form must not release a pending reservation on the same driver. */
export function voidReleasesReservation(source: string | null | undefined): boolean {
  return source !== "standalone";
}
