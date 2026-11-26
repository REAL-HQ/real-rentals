import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildApplicationSummary, type ApplicationRecord } from "@/lib/application-summary";

const clean = (v: string) =>
  v.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/·/g, "|").replace(/[^\x20-\x7E]/g, "");

/** The submitted application as a PDF, drawn from the stored record only. */
export async function createApplicationSummaryPdf(a: ApplicationRecord): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("REAL RENTALS Rental Application");
  pdf.setAuthor("REAL RENTALS");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.08, 0.08, 0.09);
  const muted = rgb(0.35, 0.35, 0.38);
  let page = pdf.addPage([612, 792]);
  let y = 740;
  page.drawText("REAL RENTALS", { x: 56, y, size: 20, font: bold, color: dark });
  y -= 24;
  page.drawText("Rental Application (Submitted Record)", { x: 56, y, size: 13, font: regular, color: muted });
  y -= 34;
  for (const s of buildApplicationSummary(a)) {
    if (y < 120) {
      page = pdf.addPage([612, 792]);
      y = 740;
    }
    page.drawText(clean(s.title), { x: 56, y, size: 12, font: bold, color: dark });
    y -= 6;
    page.drawLine({ start: { x: 56, y }, end: { x: 556, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.88) });
    y -= 18;
    for (const r of s.rows) {
      if (y < 60) {
        page = pdf.addPage([612, 792]);
        y = 740;
      }
      page.drawText(clean(r.label), { x: 56, y, size: 10, font: bold, color: muted });
      const value = clean(r.value);
      // Wrap long values (addresses) at ~70 characters.
      const lines = value.match(/.{1,70}(\s|$)|\S+/g) ?? [value];
      for (const line of lines) {
        page.drawText(line.trim(), { x: 190, y, size: 10, font: regular, color: dark });
        y -= 15;
      }
      y -= 3;
    }
    y -= 10;
  }
  return pdf.save();
}
