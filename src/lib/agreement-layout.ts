// Layout markup for designed agreements (v1.6). Client-safe.
//
// A body whose first line is "%%LAYOUT 1%%" is laid out by the ONE canonical
// PDF renderer (esign-pdf.server.ts) for preview, send and the signed copy.
// The markup is part of the stored body, so the SHA-256 covers layout too.
// Bodies without the marker (legacy plain text) are untouched.
//
//   # Title            #- Subtitle         ## Section heading (red accent)
//   ### Sub-heading    ~ Italic note       > Indented quotation
//   - Bullet           **Lead.** Paragraph with a bold lead-in
//   |#45 Head A | Head B   table header; 45 = first column width in percent
//   | Label | Value        table row (label column shaded when no header)
//   |i Text                acknowledgment row: Initial cell + text
//   %%PAGE%%               page break
//   %%SIGNATURES <agreement number>%%   the signature block, placed here

export const LAYOUT_MARKER = "%%LAYOUT 1%%";

export function isStructured(body: string): boolean {
  return body.trimStart().startsWith(LAYOUT_MARKER);
}

export type Row = { cells: [string, string]; initial?: boolean };
export type Block =
  | { k: "title" | "subtitle" | "h2" | "h3" | "note" | "quote" | "bullet"; t: string }
  | { k: "p"; t: string; lead?: string }
  | { k: "table"; frac: number; header?: [string, string]; rows: Row[] }
  | { k: "sig"; agreementNumber: string }
  | { k: "page" }
  | { k: "gap" };

function cells(s: string): [string, string] {
  const parts = s.split("|");
  const a = (parts.shift() ?? "").trim();
  return [a, parts.join("/").trim()];
}

export function parseLayout(body: string): Block[] {
  const out: Block[] = [];
  let table: Extract<Block, { k: "table" }> | null = null;
  const lines = body.replace(/\r/g, "").split("\n");
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const t = line.trim();
    const isRow = t.startsWith("|");
    if (!isRow) table = null;
    if (t === LAYOUT_MARKER) continue;
    if (!t) { if (out.length && out[out.length - 1].k !== "gap") out.push({ k: "gap" }); continue; }
    if (t === "%%PAGE%%") { out.push({ k: "page" }); continue; }
    const sig = t.match(/^%%SIGNATURES\s*(.*?)%%$/);
    if (sig) { out.push({ k: "sig", agreementNumber: sig[1].trim() }); continue; }
    if (isRow) {
      const head = t.match(/^\|#(\d{1,2})?\s*(.*)$/);
      if (head) {
        table = { k: "table", frac: head[1] ? Number(head[1]) / 100 : 0.35, header: cells(head[2]), rows: [] };
        out.push(table);
        continue;
      }
      if (!table) { table = { k: "table", frac: 0.35, rows: [] }; out.push(table); }
      if (t.startsWith("|i ")) table.rows.push({ cells: ["", t.slice(3).trim()], initial: true });
      else table.rows.push({ cells: cells(t.slice(1)) });
      continue;
    }
    if (t.startsWith("#- ")) { out.push({ k: "subtitle", t: t.slice(3) }); continue; }
    if (t.startsWith("### ")) { out.push({ k: "h3", t: t.slice(4) }); continue; }
    if (t.startsWith("## ")) { out.push({ k: "h2", t: t.slice(3) }); continue; }
    if (t.startsWith("# ")) { out.push({ k: "title", t: t.slice(2) }); continue; }
    if (t.startsWith("~ ")) { out.push({ k: "note", t: t.slice(2) }); continue; }
    if (t.startsWith("> ")) { out.push({ k: "quote", t: t.slice(2) }); continue; }
    if (t.startsWith("- ")) { out.push({ k: "bullet", t: t.slice(2) }); continue; }
    const lead = t.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (lead) { out.push({ k: "p", lead: lead[1], t: lead[2] }); continue; }
    out.push({ k: "p", t });
  }
  return out;
}

/** Merge values must not alter the layout (a "|" would split a table cell). */
export function layoutSafeValue(v: string): string {
  return v.replace(/[|\r\n]+/g, " / ").replace(/%%/g, "%");
}

/** Readable text for screens that show the agreement as text (signing page). */
export function layoutToText(body: string): string {
  if (!isStructured(body)) return body;
  const out: string[] = [];
  for (const b of parseLayout(body)) {
    switch (b.k) {
      case "gap": out.push(""); break;
      case "page": break;
      case "title": case "subtitle": case "h3": out.push(b.t); break;
      case "h2": out.push("", b.t.toUpperCase()); break;
      case "note": case "quote": out.push(b.t); break;
      case "bullet": out.push(`  - ${b.t}`); break;
      case "p": out.push(b.lead ? `${b.lead} ${b.t}` : b.t); break;
      case "table":
        if (b.header) out.push(`${b.header[0]} — ${b.header[1]}`);
        for (const r of b.rows) out.push(r.initial ? `[Initial] ${r.cells[1]}` : `${r.cells[0]}: ${r.cells[1] || "—"}`);
        break;
      case "sig":
        out.push("Renter and REAL RENTALS representative signatures, printed names, title, agreement number and date and time are applied in this section when you sign.");
        break;
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Electronic initials derived from the typed legal name (e.g. "Jane Q Doe" → "JQD"). */
export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join("").slice(0, 4);
}
