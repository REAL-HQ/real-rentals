// Text extraction for Smart Agreement Upload. Runs in the browser (and in
// tests under Bun). PDF via pdfjs (text layer only — scanned images yield no
// text and are flagged); DOCX via its document.xml (paragraphs + tables).
// Column gaps become "\t" so the analyzer can rebuild two-column tables.
import type { Extracted } from "@/lib/agreement-import";

export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
export const TEMPLATE_ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function kindOf(name: string, bytes: Uint8Array): "pdf" | "docx" | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf"; // %PDF
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && /\.docx$/i.test(name)) return "docx"; // PK zip
  return null;
}

export async function extractPdf(bytes: Uint8Array, pdfjs?: any): Promise<Extracted> {
  const lib: any = pdfjs ?? (await import("pdfjs-dist/legacy/build/pdf.mjs"));
  if (!pdfjs && typeof window !== "undefined")
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await lib.getDocument({ data: bytes.slice() }).promise;
  const pages: Extracted["pages"] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows: { y: number; items: { x: number; w: number; s: string }[] }[] = [];
    for (const it of tc.items as any[]) {
      if (!("str" in it) || !it.str) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width ?? 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    const lines: string[] = [];
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let line = "", end = -1;
      for (const it of r.items) {
        if (!it.s.trim()) continue; // pdfjs emits spacer items; real gaps come from positions
        if (end >= 0) line += it.x - end > 10 ? "\t" : it.x - end > 1 && !line.endsWith(" ") && !it.s.startsWith(" ") ? " " : "";
        line += it.s; end = it.x + it.w;
      }
      // A line that starts in the right-hand column is a table value (or its
      // wrapped continuation): mark it with a leading tab.
      const width = page.view?.[2] ?? 612;
      if (line.trim()) lines.push((r.items[0].x > width * 0.38 ? "\t" : "") + line.replace(/ {2,}/g, " "));
    }
    pages.push({ lines });
  }
  return { kind: "pdf", pages };
}

/** Minimal ZIP reader (central directory) + DecompressionStream for deflate. */
async function unzipEntry(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(off, true) !== 0x02014b50) return null;
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    const local = dv.getUint32(off + 42, true);
    const fname = dec.decode(bytes.subarray(off + 46, off + 46 + nlen));
    if (fname === name) {
      const lnl = dv.getUint16(local + 26, true), lxl = dv.getUint16(local + 28, true);
      const data = bytes.subarray(local + 30 + lnl + lxl, local + 30 + lnl + lxl + csize);
      if (method === 0) return data.slice();
      if (method !== 8) return null;
      const ds = new Blob([data.slice() as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    }
    off += 46 + nlen + xlen + clen;
  }
  return null;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function paraText(p: string): string {
  return decode([...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>/g)].map((m) => (m[1] === undefined ? " " : m[1])).join(""));
}

export async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  const xml = await unzipEntry(bytes, "word/document.xml");
  if (!xml) throw new Error("This file is not a readable Word (.docx) document.");
  const body = new TextDecoder().decode(xml);
  const lines: string[] = [];
  const pages: Extracted["pages"] = [];
  // Walk top-level paragraphs and tables in order.
  for (const m of body.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>|<w:p[ >]([\s\S]*?)<\/w:p>/g)) {
    if (m[1] !== undefined) {
      for (const tr of m[1].matchAll(/<w:tr[ >]([\s\S]*?)<\/w:tr>/g)) {
        const cells = [...tr[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((tc) =>
          [...tc[1].matchAll(/<w:p[ >]([\s\S]*?)<\/w:p>/g)].map((p) => paraText(p[1])).join(" ").trim());
        if (cells.some(Boolean)) lines.push(cells.length > 1 ? `| ${cells.join(" | ")}` : cells[0]);
      }
    } else {
      const p = m[2] ?? "";
      if (/<w:br w:type="page"\/>/.test(p) || /<w:pageBreakBefore\/>/.test(p)) { pages.push({ lines: lines.splice(0) }); }
      const t = paraText(p).trim();
      if (t) lines.push(t);
    }
  }
  pages.push({ lines });
  return { kind: "docx", pages };
}
