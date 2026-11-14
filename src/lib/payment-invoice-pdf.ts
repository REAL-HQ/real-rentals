import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatHistoryCents, formatHistoryDate, type HistoryPayment } from "@/lib/portal-payment-history";

function pdfText(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, "");
}

/** A real PDF built only from the authorized, stored payment record. */
export async function createPaymentInvoicePdf(payment: HistoryPayment, driverName: string | null): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`REAL RENTALS Invoice ${payment.id}`);
  pdf.setAuthor("REAL RENTALS");
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.08, 0.08, 0.09);
  const muted = rgb(0.35, 0.35, 0.38);

  page.drawText("REAL RENTALS", { x: 56, y: 724, size: 22, font: bold, color: dark });
  page.drawText("Payment Invoice", { x: 56, y: 692, size: 15, font: regular, color: muted });

  const rows = [
    ["Invoice", payment.id],
    ["Driver", driverName || "Not Recorded"],
    ["Type", payment.typeLabel],
    ["Status", payment.statusLabel],
    ["Source", payment.sourceLabel],
    ["Amount", formatHistoryCents(payment.amountCents)],
    ["Collected", formatHistoryCents(payment.collectedCents)],
    ["Refunded", formatHistoryCents(payment.refundedCents)],
    ["Due Date", formatHistoryDate(payment.dueDate)],
    ["Paid Date", formatHistoryDate(payment.paidDate)],
  ];
  let y = 636;
  for (const [label, value] of rows) {
    page.drawText(pdfText(label), { x: 56, y, size: 11, font: bold, color: muted });
    page.drawText(pdfText(value), { x: 190, y, size: 11, font: regular, color: dark });
    y -= 32;
  }

  return pdf.save();
}
