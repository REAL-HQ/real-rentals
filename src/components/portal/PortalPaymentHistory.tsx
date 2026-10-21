import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPortalPaymentHistory } from "@/lib/portal-payment-history.functions";
import { PORTAL_PAYMENT_HISTORY_ENABLED } from "@/lib/portal-payment-history-flag";
import { receiptText, type HistoryPayment, type PortalPaymentHistory } from "@/lib/portal-payment-history";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function PortalPaymentHistory() {
  if (PORTAL_PAYMENT_HISTORY_ENABLED !== true) return null;
  return <PortalPaymentHistoryLive />;
}

function PortalPaymentHistoryLive() {
  const load = useServerFn(getPortalPaymentHistory);
  const [history, setHistory] = useState<PortalPaymentHistory | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    load()
      .then((next) => {
        if (live) setHistory(next);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [load]);

  if (error) return <p className="text-sm text-red-700">Payment History Could Not Be Loaded</p>;
  if (!history) return <p className="text-sm text-muted-foreground">Loading Payment History</p>;

  return (
    <section className="rounded-2xl border border-border bg-white p-5" aria-labelledby="portal-payment-history-title">
      <h3 id="portal-payment-history-title" className="font-semibold">Payment History</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Charges on your account, payments from every verified source, and your balance due.
      </p>
      <p className="mt-3 text-sm">
        <span className="text-muted-foreground">Balance Due </span>
        <span className="font-semibold">{history.balanceDue == null ? "Not Checked" : money.format(history.balanceDue)}</span>
      </p>
      {history.truncated ? (
        <p className="mt-2 text-sm text-muted-foreground">Some Charges Were Not Loaded.</p>
      ) : null}
      <HistoryTable title="Charges" empty="No Charges On File" rows={history.charges.map((charge) => ({
        id: charge.id,
        date: charge.dueDate ?? charge.paidDate,
        type: charge.typeLabel,
        detail: charge.statusLabel,
        amount: charge.amount,
      }))} />
      <HistoryTable
        title="Payments"
        empty="No Verified Payments On File"
        rows={history.payments.map((payment) => ({
          id: payment.id,
          date: payment.paidDate,
          type: payment.typeLabel,
          detail: payment.sourceLabel,
          amount: payment.collected,
          receipt: payment,
        }))}
      />
    </section>
  );
}

function HistoryTable({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; date: string | null; type: string; detail: string; amount: number; receipt?: HistoryPayment }>;
}) {
  return (
    <div className="mt-5">
      <h4 className="text-sm font-semibold">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Date</th>
              <th className="font-medium">Type</th>
              <th className="font-medium">Detail</th>
              <th className="text-right font-medium">Amount</th>
              <th className="text-right font-medium">Receipt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={`${title}-${row.id}`}>
                <td className="py-2">{row.date ? row.date.slice(0, 10) : "Not Recorded"}</td>
                <td>{row.type}</td>
                <td>{row.detail}</td>
                <td className="text-right">{money.format(row.amount)}</td>
                <td className="text-right">
                  {row.receipt ? (
                    <button type="button" className="underline" onClick={() => downloadReceipt(row.receipt!)}>
                      Download Receipt
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function downloadReceipt(payment: HistoryPayment) {
  const blob = new Blob([receiptText(payment)], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `receipt-${payment.id}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}
