import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AdminTableScroll } from "./AdminTableScroll";
import { getStripePayoutRecon } from "@/lib/stripe-payout-recon.functions";
import { STRIPE_PAYOUT_RECON_OFF } from "@/lib/stripe-payout-recon-flag";
import {
  DIRECTORY_INCOMPLETE,
  STRIPE_CHECK_CAPPED,
  STRIPE_CHECK_UNAVAILABLE,
  formatCents,
  payoutReconToCsv,
  type MoneyRow,
  type PayoutReconPayout,
  type PayoutReconReport,
} from "@/lib/stripe-payout-recon";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * Mounted only while STRIPE_PAYOUT_RECON_ENABLED is true.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: PayoutReconReport };

export function StripePayoutReconPanel() {
  const read = useServerFn(getStripePayoutRecon);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined })
      .then((result) => {
        if (!cancelled) {
          if (result.status === "disabled") setLoad({ kind: "unavailable", reason: STRIPE_PAYOUT_RECON_OFF });
          else setLoad({ kind: "ready", report: result.report });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setLoad({ kind: "unavailable", reason: message === STRIPE_PAYOUT_RECON_OFF ? STRIPE_PAYOUT_RECON_OFF : "Stripe Payout Reconciliation could not be loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  const downloadable = load.kind === "ready" && load.report.stripeCheck === "ready" && load.report.directory === "ready";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stripe Payout Reconciliation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Payouts that arrive in the last 60 days, Eastern Time. Gross, fees, refunds, and net come from each payout&apos;s balance transactions. An app payment matches when its Stripe payment intent or its Stripe invoice id is on the charge. Fleet Link uses the same rental and application match as unmatched invoices. This screen does not move a payout or a refund.
          </p>
        </div>
        {downloadable && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Stripe Payout Reconciliation…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: PayoutReconReport }) {
  if (report.stripeCheck === "capped") return <p className="text-sm text-[#D03020]">{STRIPE_CHECK_CAPPED}</p>;
  if (report.stripeCheck === "unavailable") return <p className="text-sm text-[#D03020]">{STRIPE_CHECK_UNAVAILABLE}</p>;
  if (report.directory === "unavailable") return <p className="text-sm text-[#D03020]">{DIRECTORY_INCOMPLETE}</p>;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Arrival dates {report.from} through {report.through}, Eastern Time.</p>
      {report.payouts.length === 0 ? <p className="text-sm text-muted-foreground">No Payouts.</p> : report.payouts.map((payout) => <Payout key={payout.id} payout={payout} />)}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Paid In Stripe, Not In A Payout</h2>
        {report.paidNotInPayout.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <MoneyTable rows={report.paidNotInPayout} charge={false} />
        )}
      </section>
    </div>
  );
}

function Payout({ payout }: { payout: PayoutReconPayout }) {
  return (
    <section className="space-y-3 rounded-md border px-4 py-3">
      <h2 className="text-lg font-semibold">{payout.arrivalEt || "Arrival Date Missing"}</h2>
      <p className="text-sm text-muted-foreground">{payout.status} · {payout.id}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Figure label="Amount" cents={payout.amountCents} />
        <Figure label="Gross" cents={payout.grossCents} />
        <Figure label="Fees" cents={payout.feesCents} />
        <Figure label="Refunds" cents={payout.refundsCents} />
        <Figure label="Net" cents={payout.netCents} />
      </div>
      <h3 className="text-sm font-medium">Matched Payments</h3>
      {payout.matched.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <MoneyTable rows={payout.matched} charge={false} />}
      <h3 className="text-sm font-medium">Unmatched Charges</h3>
      {payout.unmatchedCharges.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <MoneyTable rows={payout.unmatchedCharges} charge />}
    </section>
  );
}

function Figure({ label, cents }: { label: string; cents: number | null }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{formatCents(cents) || "—"}</p>
    </div>
  );
}

function MoneyTable({ rows, charge }: { rows: MoneyRow[]; charge: boolean }) {
  return (
    <AdminTableScroll>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {(charge ? ["Charge", "Payment Intent", "Amount", "Fleet Link"] : ["Driver", "Payment Intent", "Amount", "Status", "Payments", "Fleet Link"]).map((head) => (
              <th key={head} className="py-2 pr-3 font-medium">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b align-top">
              <td className="py-2 pr-3">
                {charge ? row.id : row.applicationId ? <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }} className="underline">{row.driverName ?? "Driver"}</Link> : "—"}
              </td>
              <td className="py-2 pr-3">{row.paymentIntentId ?? "—"}</td>
              <td className="py-2 pr-3">{formatCents(row.amountCents) || "—"}</td>
              {charge ? null : <td className="py-2 pr-3">{row.status ?? "—"}</td>}
              {charge ? null : (
                <td className="py-2 pr-3"><Link to="/admin" search={{ tab: "payments" }} className="underline">Payments</Link></td>
              )}
              <td className="py-2 pr-3">{row.fleetLink}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTableScroll>
  );
}

function downloadCsv(report: PayoutReconReport) {
  const blob = new Blob([payoutReconToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "stripe-payout-reconciliation.csv";
  link.click();
  URL.revokeObjectURL(url);
}
