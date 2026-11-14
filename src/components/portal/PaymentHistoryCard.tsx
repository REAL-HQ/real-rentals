import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPortalPaymentHistory } from "@/lib/portal-payment-history.functions";
import {
  PORTAL_PAYMENT_HISTORY_ENABLED,
  formatHistoryCents,
  formatHistoryDate,
  type HistoryPayment,
  type PortalPaymentHistory,
} from "@/lib/portal-payment-history";

/** The only payment-history card, with real due dates and downloadable invoice PDFs. */
export function PaymentHistoryCard({ previewDriverId }: { previewDriverId?: string }) {
  if (PORTAL_PAYMENT_HISTORY_ENABLED !== true) return null;
  return <PaymentHistoryCardLive previewDriverId={previewDriverId} />;
}

function PaymentHistoryCardLive({ previewDriverId }: { previewDriverId?: string }) {
  const load = useServerFn(getPortalPaymentHistory);
  const [history, setHistory] = useState<PortalPaymentHistory | null>(null);
  const [error, setError] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState(false);

  useEffect(() => {
    let live = true;
    setHistory(null);
    setError(false);
    load({ data: previewDriverId ? { previewDriverId } : {} })
      .then((next) => {
        if (live) setHistory(next);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [load, previewDriverId]);

  if (error) return <p className="text-sm text-red-700">Payment History Could Not Be Loaded</p>;
  if (!history) return <p className="text-sm text-muted-foreground">Loading Payment History</p>;

  const payments = new Map(history.payments.map((payment) => [payment.id, payment]));

  async function download(payment: HistoryPayment) {
    setDownloadingId(payment.id);
    setDownloadError(false);
    try {
      await downloadInvoicePdf(payment, history?.driverName ?? null);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-white p-5" aria-labelledby="portal-payment-history-title">
      <h3 id="portal-payment-history-title" className="font-semibold">Payment History</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Actual due dates, paid dates, verified payment sources, and invoice PDFs.
      </p>
      <p className="mt-3 text-sm">
        <span className="text-muted-foreground">Balance Due </span>
        <span className="font-semibold">
          {history.balanceState === "not_checked"
            ? "Not Checked"
            : history.balanceState === "unknown"
              ? "Unknown"
              : formatHistoryCents(history.balanceDueCents)}
        </span>
      </p>
      {history.truncated ? <p className="mt-2 text-sm text-muted-foreground">Some Charges Were Not Loaded.</p> : null}
      {downloadError ? <p className="mt-2 text-sm text-red-700">Invoice PDF Could Not Be Created.</p> : null}

      {history.charges.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No Payment History On File.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Due Date</th>
                <th className="font-medium">Paid Date</th>
                <th className="font-medium">Type</th>
                <th className="font-medium">Status / Source</th>
                <th className="text-right font-medium">Amount</th>
                <th className="text-right font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.charges.map((charge) => {
                const payment = payments.get(charge.id);
                return (
                  <tr key={charge.id}>
                    <td className="py-3">{formatHistoryDate(charge.dueDate)}</td>
                    <td>{formatHistoryDate(charge.paidDate)}</td>
                    <td>{charge.typeLabel}</td>
                    <td>{payment ? `${charge.statusLabel} · ${payment.sourceLabel}` : charge.statusLabel}</td>
                    <td className="text-right">{formatHistoryCents(payment?.collectedCents ?? charge.amountCents)}</td>
                    <td className="text-right">
                      {payment ? (
                        <button
                          type="button"
                          className="min-h-11 font-semibold text-real-red underline disabled:opacity-50"
                          disabled={downloadingId !== null}
                          onClick={() => void download(payment)}
                        >
                          {downloadingId === payment.id ? "Preparing…" : "Invoice PDF"}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function downloadInvoicePdf(payment: HistoryPayment, driverName: string | null) {
  const { createPaymentInvoicePdf } = await import("@/lib/payment-invoice-pdf");
  const bytes = await createPaymentInvoicePdf(payment, driverName);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `invoice-${payment.id}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
