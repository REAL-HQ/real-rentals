// Deterministic server-side PDF for completed eSign documents.
// Same inputs -> same bytes (fixed metadata dates, standard fonts).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type CompletedDocInput = {
  id: string;
  title: string;
  body: string;
  bodySha256: string;
  signerName: string;
  signerEmail: string | null;
  signedAt: string;
  createdAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  ip: string | null;
  userAgent: string | null;
  authMethod: string;
  companySignerName: string;
  companySignerTitle: string | null;
};

const W = 612, H = 792, M = 60;

// Standard fonts are WinAnsi only; replace anything outside it.
function clean(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\t/g, "    ")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/ +/)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) <= max) { line = t; continue; }
      if (line) out.push(line);
      let w = word;
      while (font.widthOfTextAtSize(w, size) > max) {
        let i = w.length;
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > max) i--;
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

function fmt(ts: string | null): string {
  if (!ts) return "-";
  return new Date(ts).toUTCString().replace("GMT", "UTC");
}

export async function renderCompletedPdf(d: CompletedDocInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fixed = new Date(d.signedAt);
  pdf.setTitle(clean(d.title));
  pdf.setAuthor("REAL RENTALS");
  pdf.setProducer("REAL RENTALS eSign");
  pdf.setCreator("REAL RENTALS eSign");
  pdf.setCreationDate(fixed);
  pdf.setModificationDate(fixed);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.07, 0.08), muted = rgb(0.45, 0.45, 0.5);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const footer = (p: PDFPage) =>
    p.drawText(clean(`Document ${d.id}`), { x: M, y: 30, size: 8, font, color: muted });
  footer(page);
  const ensure = (h: number) => {
    if (y - h < M) { page = pdf.addPage([W, H]); footer(page); y = H - M; }
  };
  const write = (t: string, size = 10.5, f = font, color = ink, lh = 1.45) => {
    for (const l of wrap(t, f, size, W - 2 * M)) {
      ensure(size * lh);
      page.drawText(l, { x: M, y: y - size, size, font: f, color });
      y -= size * lh;
    }
  };

  write(d.title, 16, bold);
  y -= 8;
  write(d.body);
  y -= 18;
  ensure(140);
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: ink });
  y -= 16;
  write("SIGNATURES", 11, bold);
  y -= 4;
  write(`Renter: /s/ ${d.signerName}`, 12, bold);
  write(`Signed electronically ${fmt(d.signedAt)}`, 9.5, font, muted);
  y -= 6;
  write(`Company: /s/ ${d.companySignerName}${d.companySignerTitle ? `, ${d.companySignerTitle}` : ""}`, 12, bold);
  write("Pre-applied company countersignature", 9.5, font, muted);

  // Certificate of completion
  page = pdf.addPage([W, H]); footer(page); y = H - M;
  write("Certificate of Completion", 18, bold);
  y -= 6;
  const rows: [string, string][] = [
    ["Document ID", d.id],
    ["Document title", d.title],
    ["Created", fmt(d.createdAt)],
    ["Sent", fmt(d.sentAt)],
    ["Viewed", fmt(d.viewedAt)],
    ["Signed", fmt(d.signedAt)],
    ["Signer name", d.signerName],
    ["Signer email", d.signerEmail ?? "-"],
    ["IP address", d.ip ?? "-"],
    ["Browser", d.userAgent ?? "-"],
    ["Authentication", d.authMethod === "portal" ? "Signed-in renter portal session" : "Single-use emailed signing link"],
    ["Signature method", "Typed legal name with explicit consent checkbox"],
    ["Company signer", `${d.companySignerName}${d.companySignerTitle ? `, ${d.companySignerTitle}` : ""}`],
    ["Agreement text SHA-256", d.bodySha256],
  ];
  for (const [k, v] of rows) {
    ensure(30);
    page.drawText(k, { x: M, y: y - 9, size: 9, font: bold, color: muted });
    y -= 13;
    write(v, 10);
    y -= 4;
  }
  y -= 10;
  write(
    "The SHA-256 of this complete PDF file is recorded with the eSign record and can be used to verify the archived file has not changed.",
    8.5, font, muted,
  );
  return pdf.save({ useObjectStreams: false });
}

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const buf = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
