// Deterministic server-side PDF for completed eSign documents.
// Same inputs -> same bytes (fixed metadata dates, standard fonts).
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { isStructured, parseLayout, initialsOf, type Block } from "@/lib/agreement-layout";

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

  if (isStructured(d.body)) {
    // Designed agreement: signatures and initials sit where the reviewed
    // document placed them; no second signature block is appended.
    pdf.removePage(0);
    await layoutStructured(pdf, {
      title: d.title, body: d.body, footerText: `Document ${d.id}`,
      companySignerName: d.companySignerName, companySignerTitle: d.companySignerTitle,
      signed: { signerName: d.signerName, signedAt: d.signedAt, sentAt: d.sentAt, initials: initialsOf(d.signerName) },
    });
  } else {
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
  write(`Company: /s/ ${d.companySignerName}`, 12, bold);
  if (d.companySignerTitle) write(d.companySignerTitle, 10.5);
  if (d.companySignerName.trim().toUpperCase() !== "REAL RENTALS") write("REAL RENTALS", 10.5);
  write("Pre-applied company countersignature", 9.5, font, muted);
  }

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

export type PreviewDocInput = {
  title: string;
  body: string;
  fingerprint: string;
  templateLabel: string;
  companySignerName: string;
  companySignerTitle: string | null;
  generatedAt: string;
};

/**
 * Pre-send preview of the exact agreement text a send would freeze.
 * Title and body are laid out with the same fonts, sizes, margins and wrapping
 * as renderCompletedPdf, so pages break identically; the signature block is
 * shown unsigned and every page carries a PREVIEW watermark.
 */
export async function renderPreviewPdf(d: PreviewDocInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fixed = new Date(d.generatedAt);
  pdf.setTitle(clean(`PREVIEW - ${d.title}`));
  pdf.setAuthor("REAL RENTALS");
  pdf.setProducer("REAL RENTALS eSign");
  pdf.setCreator("REAL RENTALS eSign");
  pdf.setCreationDate(fixed);
  pdf.setModificationDate(fixed);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.07, 0.07, 0.08), muted = rgb(0.45, 0.45, 0.5), wm = rgb(0.82, 0.19, 0.13);

  const pages: PDFPage[] = [];
  const footer = (p: PDFPage) =>
    p.drawText(clean(`PREVIEW - NOT SENT - ${d.templateLabel} - Fingerprint ${d.fingerprint.slice(0, 16)}`), { x: M, y: 30, size: 8, font, color: muted });
  const newPage = () => { const p = pdf.addPage([W, H]); pages.push(p); footer(p); return p; };
  let page: PDFPage = newPage();
  let y = H - M;
  const ensure = (h: number) => {
    if (y - h < M) { page = newPage(); y = H - M; }
  };
  const write = (t: string, size = 10.5, f = font, color = ink, lh = 1.45) => {
    for (const l of wrap(t, f, size, W - 2 * M)) {
      ensure(size * lh);
      page.drawText(l, { x: M, y: y - size, size, font: f, color });
      y -= size * lh;
    }
  };
  const field = (label: string) => {
    ensure(40);
    y -= 22;
    page.drawLine({ start: { x: M, y }, end: { x: M + 260, y }, thickness: 0.8, color: ink });
    y -= 12;
    page.drawText(clean(label), { x: M, y, size: 9, font, color: muted });
    y -= 6;
  };

  if (isStructured(d.body)) {
    pdf.removePage(0); pages.length = 0;
    const laid = await layoutStructured(pdf, {
      title: d.title, body: d.body,
      footerText: `PREVIEW - NOT SENT - ${d.templateLabel} - Fingerprint ${d.fingerprint.slice(0, 16)}`,
      companySignerName: d.companySignerName, companySignerTitle: d.companySignerTitle, signed: null,
    });
    for (const p of laid) {
      p.drawText("PREVIEW - NOT SENT", { x: 120, y: 360, size: 46, font: bold, color: wm, opacity: 0.12, rotate: degrees(35) });
    }
    return pdf.save({ useObjectStreams: false });
  }

  // Identical to the completed document from here to the signature block.
  write(d.title, 16, bold);
  y -= 8;
  write(d.body);
  y -= 18;
  ensure(140);
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: ink });
  y -= 16;
  write("SIGNATURES", 11, bold);
  y -= 4;
  write("Renter: (unsigned)", 12, bold);
  field("Renter signature - typed legal name with consent checkbox");
  field("Date signed");
  y -= 6;
  write(`Company: ${d.companySignerName}`, 12, bold);
  if (d.companySignerTitle) write(d.companySignerTitle, 10.5);
  write("Company countersignature is applied when the agreement is sent", 9.5, font, muted);

  for (const p of pages) {
    p.drawText("PREVIEW - NOT SENT", { x: 120, y: 360, size: 46, font: bold, color: wm, opacity: 0.12, rotate: degrees(35) });
  }
  return pdf.save({ useObjectStreams: false });
}

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const buf = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const d = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- designed layout
// One layout routine for preview AND the signed copy, so the signed PDF has
// exactly the structure reviewed before sending. Only the signature/initial
// values differ (blank in preview, filled once signed).

export type SignedValues = {
  signerName: string;
  signedAt: string;
  sentAt: string | null;
  initials: string;
};

type LayoutOpts = {
  title: string;
  body: string;
  footerText: string;
  companySignerName: string;
  companySignerTitle: string | null;
  signed: SignedValues | null;
};

const SM = 48; // designed-layout margin

export async function layoutStructured(pdf: PDFDocument, o: LayoutOpts): Promise<PDFPage[]> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const ink = rgb(0.07, 0.07, 0.08), muted = rgb(0.42, 0.42, 0.46), red = rgb(0.80, 0.11, 0.11);
  const grid = rgb(0.25, 0.25, 0.27), shade = rgb(0.93, 0.93, 0.94), dark = rgb(0.22, 0.22, 0.24), white = rgb(1, 1, 1);
  const CW = W - 2 * SM;
  const BS = 9; // body size
  const pages: PDFPage[] = [];
  const newPage = () => {
    const p = pdf.addPage([W, H]);
    pages.push(p);
    p.drawText(clean(o.footerText), { x: SM, y: 26, size: 7.5, font, color: muted });
    return p;
  };
  let page = newPage();
  let y = H - SM;
  const fresh = () => y >= H - SM - 0.5;
  const ensure = (h: number) => { if (y - h < SM) { page = newPage(); y = H - SM; } };
  const text = (t: string, x: number, max: number, size: number, f: PDFFont, color = ink, lh = 1.4) => {
    for (const l of wrap(t, f, size, max)) {
      ensure(size * lh);
      page.drawText(l, { x, y: y - size, size, font: f, color });
      y -= size * lh;
    }
  };
  // Paragraph with an optional bold lead-in, wrapped as one flow.
  const rich = (lead: string | undefined, t: string, x: number, max: number, size: number, f: PDFFont) => {
    const words: { w: string; f: PDFFont }[] = [
      ...(lead ? clean(lead).split(/ +/).map((w) => ({ w, f: bold })) : []),
      ...clean(t).split(/ +/).filter(Boolean).map((w) => ({ w, f })),
    ];
    const space = font.widthOfTextAtSize(" ", size);
    let line: typeof words = [], width = 0;
    const flush = () => {
      ensure(size * 1.4);
      let cx = x;
      for (const it of line) { page.drawText(it.w, { x: cx, y: y - size, size, font: it.f, color: ink }); cx += it.f.widthOfTextAtSize(it.w, size) + space; }
      y -= size * 1.4; line = []; width = 0;
    };
    for (const it of words) {
      const ww = it.f.widthOfTextAtSize(it.w, size);
      if (line.length && width + space + ww > max) flush();
      width += (line.length ? space : 0) + ww; line.push(it);
    }
    if (line.length) flush();
  };
  const cellLines = (t: string, f: PDFFont, size: number, w: number) => (t ? wrap(t, f, size, w) : [""]);

  const drawTable = (b: Extract<Block, { k: "table" }>) => {
    const c1 = Math.round(CW * b.frac), c2 = CW - c1, pad = 3.5, size = 8.5, lh = size * 1.32;
    const ack = b.rows.some((r) => r.initial);
    const header = () => {
      if (!b.header) return;
      const h = lh + pad * 2;
      ensure(h + lh * 2);
      page.drawRectangle({ x: SM, y: y - h, width: CW, height: h, color: dark, borderColor: grid, borderWidth: 0.6 });
      page.drawText(clean(b.header[0]), { x: SM + pad, y: y - pad - size, size, font: bold, color: white });
      page.drawText(clean(b.header[1]), { x: SM + c1 + pad, y: y - pad - size, size, font: b.header[1] && ack ? ital : bold, color: white });
      y -= h;
    };
    header();
    b.rows.forEach((r, i) => {
      const lf = b.header ? font : bold;
      const L = cellLines(r.cells[0], lf, size, c1 - pad * 2);
      const R = cellLines(r.cells[1], font, size, c2 - pad * 2);
      const minH = ack ? 26 : lh + pad * 2;
      const h = Math.max(minH, Math.max(L.length, R.length) * lh + pad * 2);
      if (y - h < SM) { page = newPage(); y = H - SM; header(); }
      const top = y;
      const fill = !b.header ? shade : ack ? white : i % 2 ? rgb(0.975, 0.975, 0.98) : white;
      page.drawRectangle({ x: SM, y: top - h, width: c1, height: h, color: b.header ? fill : shade, borderColor: grid, borderWidth: 0.6 });
      page.drawRectangle({ x: SM + c1, y: top - h, width: c2, height: h, color: fill, borderColor: grid, borderWidth: 0.6 });
      L.forEach((l, j) => page.drawText(l, { x: SM + pad, y: top - pad - size - j * lh, size, font: lf, color: ink }));
      R.forEach((l, j) => page.drawText(l, { x: SM + c1 + pad, y: top - pad - size - j * lh, size, font, color: ink }));
      if (r.initial && o.signed) {
        const it = clean(`/s/ ${o.signed.initials}`);
        page.drawText(it, { x: SM + pad + 2, y: top - h / 2 - 4, size: 10, font: bold, color: ink });
      }
      y = top - h;
    });
    y -= 4;
  };

  const drawSig = (agreementNumber: string) => {
    const s = o.signed;
    const fmtT = (ts: string | null) => (ts ? new Date(ts).toUTCString().replace("GMT", "UTC") : "");
    const colA = Math.round(CW * 0.6), gap = 18, colB = CW - colA - gap;
    const rows: [[string, string, boolean], [string, string, boolean]][] = [
      [[s ? `/s/ ${s.signerName}` : "", "Renter Signature", true], [s ? fmtT(s.signedAt) : "", "Date & Time", false]],
      [[s ? s.signerName : "", "Renter Printed Name", false], [agreementNumber, "Agreement Number", false]],
      [[s ? `/s/ ${o.companySignerName}` : "", "REAL RENTALS Representative Signature", true], [s ? fmtT(s.sentAt) : "", "Date & Time", false]],
      [[o.companySignerName, "Representative Printed Name", false], [o.companySignerTitle ?? "", "Title", false]],
    ];
    ensure(rows.length * 40 + 30);
    for (const pair of rows) {
      y -= 24;
      pair.forEach(([val, label, isSig], i) => {
        const x = i ? SM + colA + gap : SM, w = i ? colB : colA;
        if (val) page.drawText(clean(val).slice(0, 90), { x: x + 2, y: y + 4, size: isSig ? 11 : 9, font: isSig ? bold : font, color: ink });
        page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.7, color: ink });
        page.drawText(clean(label), { x: x + 2, y: y - 9, size: 7, font, color: muted });
      });
      y -= 14;
    }
    y -= 4;
    text(
      s
        ? "Renter signed electronically by typed legal name with explicit consent; initials above are the renter's electronic initials. Company countersignature pre-applied when the agreement was sent."
        : "PREVIEW - renter signature, initials and date are applied when the renter signs electronically. Company countersignature is applied when the agreement is sent.",
      SM, CW, 7.5, ital, muted,
    );
    y -= 6;
  };

  const blocks = parseLayout(o.body);
  let sigDone = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    switch (b.k) {
      case "gap": y -= 4; break;
      case "page": if (!fresh()) { page = newPage(); y = H - SM; } break;
      case "title": text(b.t, SM, CW, 20, bold); break;
      case "subtitle": text(b.t, SM, CW, 10, font, muted); y -= 4; break;
      case "h2": {
        if (!fresh()) y -= 8;
        ensure(60);
        page.drawRectangle({ x: SM, y: y - 13, width: 2.6, height: 14, color: red });
        page.drawText(clean(b.t), { x: SM + 9, y: y - 11, size: 11.5, font: bold, color: ink });
        y -= 20;
        break;
      }
      case "h3": y -= 4; ensure(40); text(b.t, SM, CW, 9.5, bold); y -= 2; break;
      case "note": text(b.t, SM, CW, 8.5, ital, muted); y -= 2; break;
      case "quote": text(b.t, SM + 20, CW - 40, BS, ital); break;
      case "bullet": {
        ensure(BS * 1.4);
        page.drawCircle({ x: SM + 9, y: y - BS * 0.62, size: 1.3, color: ink });
        text(b.t, SM + 16, CW - 16, BS, font);
        break;
      }
      case "p": rich(b.lead, b.t, SM, CW, BS, font); y -= 2; break;
      case "table": drawTable(b); break;
      case "sig": drawSig(b.agreementNumber); sigDone = true; break;
    }
  }
  if (!sigDone) drawSig("");
  void o.title;
  return pages;
}
