import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { assignUnmatchedPaymentQueue, dismissUnmatchedPaymentQueue, listUnmatchedPaymentQueue } from "@/lib/unmatched-payments.functions";
import { formatUnmatchedAmount, unmatchedWhyLabel, type UnmatchedPaymentRow } from "@/lib/unmatched-payments";

/**
 * Payments queue for Stripe money that arrived without a single active rental.
 * Staff assign it to a rental or dismiss it. Phone numbers are not shown.
 */
export function UnmatchedPaymentsQueue() {
  const load = useServerFn(listUnmatchedPaymentQueue);
  const assign = useServerFn(assignUnmatchedPaymentQueue);
  const dismiss = useServerFn(dismissUnmatchedPaymentQueue);
  const [rows, setRows] = useState<UnmatchedPaymentRow[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rentalId, setRentalId] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});

  const refresh = () => {
    load({ data: {} })
      .then((result) => {
        setRows(result.rows);
        setHidden(false);
      })
      .catch(() => setHidden(true));
  };

  useEffect(() => {
    refresh();
    // The queue is loaded once per visit; Assign and Dismiss refresh it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hidden || rows === null) return null;
  return (
    <section aria-label="Unmatched Payments" className="mb-6 rounded-md border border-[#E4E4E7] bg-white p-4" data-testid="unmatched-payments">
      <h2 className="text-base font-semibold text-[#111114]">Unmatched Payments</h2>
      <p className="mt-1 text-xs text-[#6B6B75]">Stripe payments that could not be tied to one active rental. Assign a rental or dismiss a charge that is not rent.</p>
      {error ? <p role="alert" className="mt-3 text-xs text-[#D03020]">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-[#6B6B75]">No Unmatched Payments</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[#6B6B75]">
              <tr>
                {["Amount", "Renter", "Email", "Why", "Reference", "Assign"].map((heading) => (
                  <th key={heading} className="whitespace-nowrap py-2 pr-3 font-medium">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const ref = row.stripePaymentIntentId || row.stripeInvoiceId || row.stripeChargeId || "—";
                return (
                  <tr key={row.id} className="border-t border-[#EDEDF0]" data-testid="unmatched-payment-row">
                    <td className="whitespace-nowrap py-3 pr-3 tabular-nums">{formatUnmatchedAmount(row.amountCents, row.currency)}</td>
                    <td className="py-3 pr-3">{row.renterName || "—"}</td>
                    <td className="py-3 pr-3">{row.email || "—"}</td>
                    <td className="whitespace-nowrap py-3 pr-3">{unmatchedWhyLabel(row.why)}</td>
                    <td className="whitespace-nowrap py-3 pr-3">{ref}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          aria-label={`Rental ID For ${ref}`}
                          value={rentalId[row.id] ?? ""}
                          onChange={(e) => setRentalId((cur) => ({ ...cur, [row.id]: e.target.value }))}
                          placeholder="Rental ID"
                          className="h-8 w-40 rounded-md border border-[#D6D6DB] px-2"
                        />
                        <button
                          type="button"
                          disabled={busy === row.id}
                          className="h-8 rounded-md bg-[#111114] px-2.5 font-medium text-white disabled:opacity-50"
                          onClick={() => {
                            setError(null);
                            setBusy(row.id);
                            assign({ data: { id: row.id, rentalId: (rentalId[row.id] ?? "").trim() } })
                              .then(() => refresh())
                              .catch((err: Error) => setError(err.message || "Could not assign that payment."))
                              .finally(() => setBusy(null));
                          }}
                        >
                          Assign
                        </button>
                        <input
                          aria-label={`Dismiss Reason For ${ref}`}
                          value={note[row.id] ?? ""}
                          onChange={(e) => setNote((cur) => ({ ...cur, [row.id]: e.target.value }))}
                          placeholder="Dismiss Reason"
                          className="h-8 w-40 rounded-md border border-[#D6D6DB] px-2"
                        />
                        <button
                          type="button"
                          disabled={busy === row.id}
                          className="h-8 rounded-md border border-[#D6D6DB] bg-white px-2.5 font-medium disabled:opacity-50"
                          onClick={() => {
                            setError(null);
                            setBusy(row.id);
                            dismiss({ data: { id: row.id, note: (note[row.id] ?? "").trim() } })
                              .then(() => refresh())
                              .catch((err: Error) => setError(err.message || "Could not dismiss that payment."))
                              .finally(() => setBusy(null));
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
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
