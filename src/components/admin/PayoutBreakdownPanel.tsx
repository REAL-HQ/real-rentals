import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { AdminTableScroll } from "./AdminTableScroll";
import { getPayoutBreakdown } from "@/lib/payout-breakdown.functions";
import { defaultPayoutRange, payoutBreakdownCsv, type PayoutReport, type PayoutRow } from "@/lib/payout-breakdown";
import type { PayoutBreakdownResponse } from "@/lib/payout-breakdown.server";

/**
 * Owner screen for Stripe payouts in an Eastern Time range. Mounted only
 * while PAYOUT_BREAKDOWN_ENABLED is true. The CSV is built in the browser.
 */

function money(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function download(report: PayoutReport) {
  const blob = new Blob([payoutBreakdownCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `payout-breakdown-${report.from}-to-${report.through}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const GROUPS: { key: "chargesCents" | "refundsCents" | "feesCents" | "disputesCents" | "otherCents"; label: string }[] = [
  { key: "chargesCents", label: "Charges" },
  { key: "refundsCents", label: "Refunds" },
  { key: "feesCents", label: "Stripe Fees" },
  { key: "disputesCents", label: "Disputes Or Adjustments" },
  { key: "otherCents", label: "Other" },
];

export function PayoutBreakdownPanel() {
  const read = useServerFn(getPayoutBreakdown);
  const initial = defaultPayoutRange(new Date()) ?? { from: "", through: "" };
  const [from, setFrom] = useState(initial.from);
  const [through, setThrough] = useState(initial.through);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [response, setResponse] = useState<PayoutBreakdownResponse | null>(null);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through)) return;
    let cancelled = false;
    setLoading(true);
    setProblem(null);
    read({ data: { from, through } })
      .then((result) => { if (!cancelled) setResponse(result); })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "Payout breakdown unavailable");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [read, from, through]);

  const report = response?.status === "ready" ? response.report : null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Payout Breakdown</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Payouts created in this Eastern Time range. Each one is split into charges, refunds, Stripe fees, disputes or adjustments, and other. A row is flagged when those parts do not sum to the payout.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" aria-label="From" value={from} max={through || undefined} onChange={(event) => setFrom(event.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm" />
          <input type="date" aria-label="Through" value={through} min={from || undefined} onChange={(event) => setThrough(event.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm" />
          <button type="button" disabled={!report} onClick={() => report && download(report)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:opacity-50">
            <Download className="w-4 h-4" strokeWidth={1.75} />
            Download CSV
          </button>
        </div>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {problem && <p className="text-sm text-[#D03020]">{problem}</p>}
      {response?.status === "disabled" && <p className="text-sm text-muted-foreground">Payout Breakdown Is Off</p>}
      {response?.status === "unavailable" && <p className="text-sm text-[#D03020]">{response.reason}</p>}
      {report && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{report.from} – {report.through}</p>
          {report.warnings.map((warning) => <p key={warning} className="text-sm text-[#D03020]">{warning}</p>)}
          {report.payouts.length === 0 && report.warnings.length === 0 && <p className="text-sm text-muted-foreground">No payouts in this range.</p>}
          {report.payouts.map((payout) => <PayoutCard key={payout.id} payout={payout} />)}
        </div>
      )}
    </div>
  );
}

function PayoutCard({ payout }: { payout: PayoutRow }) {
  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold">{payout.created || "Payout"} · {money(payout.amountCents)}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{payout.status} · Arrival Date {payout.arrivalDate || "—"}</p>
        </div>
        <p className={`text-sm font-medium ${payout.sumsToPayout ? "text-muted-foreground" : "text-[#D03020]"}`}>
          {payout.sumsToPayout ? "Sums To The Payout" : "Mismatch"}
        </p>
      </div>
      <AdminTableScroll className="rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-[#FAFAFB] text-left">
            <tr>
              {GROUPS.map((group) => <th key={group.key} className="px-4 py-2.5 font-medium text-right whitespace-nowrap">{group.label}</th>)}
              <th className="px-4 py-2.5 font-medium text-right">Sum</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              {GROUPS.map((group) => <td key={group.key} className="px-4 py-3 text-right tabular-nums">{money(payout.groups?.[group.key] ?? null)}</td>)}
              <td className="px-4 py-3 text-right tabular-nums">{money(payout.sumCents)}</td>
            </tr>
          </tbody>
        </table>
      </AdminTableScroll>
      {payout.charges.length > 0 && (
        <AdminTableScroll className="rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-left">
              <tr>
                <th className="px-4 py-2.5 font-medium">Charge</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                <th className="px-4 py-2.5 font-medium">Renter</th>
                <th className="px-4 py-2.5 font-medium">Vehicle</th>
                <th className="px-4 py-2.5 font-medium">Match</th>
              </tr>
            </thead>
            <tbody>
              {payout.charges.map((charge) => (
                <tr key={charge.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{charge.id}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(charge.amountCents)}</td>
                  <td className="px-4 py-3">{charge.driverName ?? "—"}</td>
                  <td className="px-4 py-3">{charge.vehicleLabel ?? "—"}</td>
                  <td className="px-4 py-3">{charge.rentalExists ? `${charge.matchReason} · Rental` : charge.matchReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
    </section>
  );
}
