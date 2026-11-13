import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getRenterPayments, getUnmatchedRenterPayments } from "@/lib/renter-payments.functions";
import {
  formatPaymentAmount,
  formatPaymentDateEt,
  type RenterPaymentListItem,
} from "@/lib/renter-payments";

type Load =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; payments: RenterPaymentListItem[] };

export function RenterPayments({ driverId }: { driverId: string }) {
  const read = useServerFn(getRenterPayments);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: { driverId } })
      .then((result) => {
        if (!cancelled) setLoad({ kind: "ready", payments: result.payments });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "unavailable", reason: "Payments Could Not Be Loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read, driverId]);

  return (
    <PaymentsCard
      title="Payments"
      description="Successful payments for this renter. Dates are Eastern Time."
      empty="No Payments Yet."
      load={load}
    />
  );
}

export function UnmatchedRenterPayments() {
  const read = useServerFn(getUnmatchedRenterPayments);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: {} })
      .then((result) => {
        if (!cancelled) setLoad({ kind: "ready", payments: result.payments });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "unavailable", reason: "Unmatched Payments Could Not Be Loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  if (load.kind === "ready" && load.payments.length === 0) return null;

  return (
    <PaymentsCard
      title="Unmatched"
      description="Successful payments stored without a renter. They are kept here so they are not dropped."
      empty="No Unmatched Payments."
      load={load}
    />
  );
}

export function PaymentsCard({
  title,
  description,
  empty,
  load,
}: {
  title: string;
  description: string;
  empty: string;
  load: Load;
}) {
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-[#111114]">{title}</h2>
        <p className="mt-1 text-[12px] text-[#9A9AA3]">{description}</p>
      </div>
      <div className="p-4">
        {load.kind === "loading" && <p className="text-[13px] text-[#55555E]">Loading {title}…</p>}
        {load.kind === "unavailable" && <p className="text-[13px] text-[#55555E]">{load.reason}</p>}
        {load.kind === "ready" && load.payments.length === 0 && <p className="text-[13px] text-[#55555E]">{empty}</p>}
        {load.kind === "ready" && load.payments.length > 0 && <PaymentsTable payments={load.payments} />}
      </div>
    </section>
  );
}

export function PaymentsTable({ payments }: { payments: RenterPaymentListItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b text-left text-[#9A9AA3]">
            {["Date", "Amount", "Invoice", "Receipt", "Links"].map((head) => (
              <th key={head} className="py-2 pr-3 font-medium">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payments.map((row) => (
            <tr key={row.id} className="border-b align-top">
              <td className="py-2 pr-3 whitespace-nowrap text-[#111114]">{formatPaymentDateEt(row.paidDate, row.paidAt)}</td>
              <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-[#111114]">{formatPaymentAmount(row.amount)}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-[#111114]">{row.invoiceNumber || "—"}</td>
              <td className="py-2 pr-3 whitespace-nowrap">
                <PaymentLink href={row.receiptUrl} label="Receipt" />
              </td>
              <td className="py-2 whitespace-nowrap">
                <span className="inline-flex flex-wrap gap-3">
                  <PaymentLink href={row.invoiceUrl} label="Invoice" />
                  <PaymentLink href={row.invoicePdfUrl} label="Pdf" />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return <span className="text-[#9A9AA3]">—</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-[#D03020] hover:underline">
      {label}
    </a>
  );
}
