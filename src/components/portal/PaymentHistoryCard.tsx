import { fmtDate } from "@/lib/date-format";
import type { PaymentHistoryItem, PortalPaymentStatus } from "@/lib/portal-payment-history";

const STATUS_LABEL: Record<PortalPaymentStatus, string> = {
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

function money(amount: number) {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Read-only list. No payment button and no write. */
export function PaymentHistoryCard({ items }: { items: PaymentHistoryItem[] }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <h2 className="font-semibold">Payment History</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No payments yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="text-sm">{item.date ? fmtDate(item.date) : "Date Not Recorded"}</div>
                <div className="text-xs text-muted-foreground">
                  {item.purpose ? `${item.purpose} · ${STATUS_LABEL[item.status]}` : STATUS_LABEL[item.status]}
                </div>
              </div>
              {item.amount != null ? <div className="text-sm font-medium">{money(item.amount)}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
