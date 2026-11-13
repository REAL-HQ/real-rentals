import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { describe, it } from "node:test";
import {
  formatPaymentAmount,
  formatPaymentDateEt,
  toRenterPaymentListItem,
  type RenterPaymentListItem,
} from "../src/lib/renter-payments.ts";

function renderPaymentsHtml(title: string, payments: RenterPaymentListItem[]): string {
  const rows = payments.map((row) => {
    const receipt = row.receiptUrl ? `<a href="${row.receiptUrl}">Receipt</a>` : "—";
    const invoice = row.invoiceUrl ? `<a href="${row.invoiceUrl}">Invoice</a>` : "—";
    const pdf = row.invoicePdfUrl ? `<a href="${row.invoicePdfUrl}">Pdf</a>` : "—";
    return `<tr>
      <td>${formatPaymentDateEt(row.paidDate, row.paidAt)}</td>
      <td>${formatPaymentAmount(row.amount)}</td>
      <td>${row.invoiceNumber || "—"}</td>
      <td>${receipt}</td>
      <td>${invoice} ${pdf}</td>
    </tr>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<body style="background:#ffffff;color:#111114;font-family:Inter,Arial,sans-serif;">
  <section style="border:1px solid #EDEDF0;background:#ffffff;">
    <h2>${title}</h2>
    <table>
      <thead><tr><th>Date</th><th>Amount</th><th>Invoice</th><th>Receipt</th><th>Links</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>
</body>
</html>`;
}

describe("renter Payments UI", () => {
  it("adds a Payments section to the renter profile tab", () => {
    const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
    const ui = readFileSync("src/components/admin/RenterPayments.tsx", "utf8");
    assert.match(panel, /<TabsContent value="payments"/);
    assert.match(panel, /<RenterPayments driverId=\{driver\.id\} \/>/);
    assert.match(ui, /title="Payments"/);
    assert.match(ui, /"Date"/);
    assert.match(ui, /"Amount"/);
    assert.match(ui, /"Invoice"/);
    assert.match(ui, /label="Receipt"/);
    assert.match(ui, /label="Invoice"/);
    assert.match(ui, /label="Pdf"/);
    assert.match(ui, /formatPaymentDateEt/);
    assert.match(ui, /formatPaymentAmount/);
    assert.doesNotMatch(ui, /gradient|from-\[|to-\[|bg-gradient/);
    assert.match(ui, /bg-white/);
    assert.match(readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8"), /<UnmatchedRenterPayments \/>/);
  });

  it("renders date, amount, invoice number, and receipt links in a local HTML preview", () => {
    const payments = [toRenterPaymentListItem({
      id: "p1",
      paid_date: "2026-11-12",
      stripe_paid_at: "2026-11-12T15:23:43.000Z",
      amount: 350,
      status: "paid",
      stripe_invoice_number: "M5F0G0N6-0001",
      stripe_receipt_url: "https://pay.stripe.com/receipts/invoices/example",
      stripe_hosted_invoice_url: "https://invoice.stripe.com/i/example",
      stripe_invoice_pdf_url: "https://pay.stripe.com/invoice/example/pdf",
      rental_id: null,
      driver_id: "baa6dacd-fcfe-47b7-84a1-04952903f514",
    })];
    const html = renderPaymentsHtml("Payments", payments);
    assert.match(html, />Payments</);
    assert.match(html, /Nov 12, 2026/);
    assert.match(html, /\$350\.00/);
    assert.match(html, /M5F0G0N6-0001/);
    assert.match(html, />Receipt</);
    assert.match(html, />Invoice</);
    assert.match(html, />Pdf</);
    assert.doesNotMatch(html, /gradient/);
    mkdirSync("/tmp/renter-payments-preview", { recursive: true });
    writeFileSync("/tmp/renter-payments-preview/payments.html", html);
  });
});
