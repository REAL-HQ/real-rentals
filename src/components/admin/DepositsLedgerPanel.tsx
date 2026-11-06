import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getDepositsLedger } from "@/lib/deposits-ledger.functions";
import { PERIOD_LABELS, type DepositPeriod, type DepositsLedgerReport, type LedgerMatch } from "@/lib/deposits-ledger";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. Period buttons only reload this report. There is no settle,
 * refund, or other control that writes.
 */

type Load = { kind: "loading" } | { kind: "disabled" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: DepositsLedgerReport };
const PERIODS: DepositPeriod[] = ["this_month", "last_month", "last_90"];

const money = (cents: number | null, currency = "usd") => {
  if (cents === null) return "—";
  if (currency === "usd") return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`;
};

export function DepositsLedgerPanel() {
  const read = useServerFn(getDepositsLedger);
  const [period, setPeriod] = useState<DepositPeriod>("this_month");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: { period } }).then((result) => {
      if (cancelled) return;
      if (result.status === "disabled") setLoad({ kind: "disabled" });
      else if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch(() => { if (!cancelled) setLoad({ kind: "unavailable", reason: "Deposits & Refunds Ledger could not be loaded" }); });
    return () => { cancelled = true; };
  }, [read, period]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deposits & Refunds Ledger</h1>
        <p className="mt-1 text-sm text-muted-foreground">Stripe refunds for the selected Eastern Time period, deposits currently held in the app, and the period net. This screen does not settle a deposit or issue a refund.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((id) => (
          <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)} className={`rounded-md border px-3 py-1.5 text-sm ${period === id ? "border-foreground font-medium" : "text-muted-foreground"}`}>
            {PERIOD_LABELS[id]}
          </button>
        ))}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Deposits & Refunds Ledger…</p>}
      {load.kind === "disabled" && <p className="text-sm text-muted-foreground">Deposits & Refunds Ledger Is Off.</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && (
        <div className="space-y-8">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Totals</h2>
            <p className="text-sm text-muted-foreground">{load.report.from} through {load.report.through}, Eastern Time. The refund total counts succeeded refunds.</p>
            {load.report.totals ? (
              <dl className="grid gap-3 sm:grid-cols-3">
                <Total label="Gross Collected" value={money(load.report.totals.grossCents)} />
                <Total label="Refunds" value={money(load.report.totals.refundCents)} />
                <Total label="Net" value={money(load.report.totals.netCents)} />
              </dl>
            ) : <p className="text-sm text-muted-foreground">Totals are withheld. This period includes a non-USD amount.</p>}
          </section>
          <Section title="Refunds" empty="No refunds in this period." count={load.report.refunds.length}>
            <Table heads={["Amount", "Reason", "Status", "Charge Date", "Driver", "Phone"]}>
              {load.report.refunds.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="py-2 pr-3">{money(row.amountCents, row.currency)}</td>
                  <td className="py-2 pr-3">{row.reason ?? "—"}</td>
                  <td className="py-2 pr-3">{row.status}</td>
                  <td className="py-2 pr-3">{row.chargeDate ?? "—"}</td>
                  <Driver match={row.match} />
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Deposits Held" empty="No deposit records" count={load.report.deposits.length}>
            <p className="text-sm text-muted-foreground">Current app records. This list is not limited to the selected period.</p>
            <Table heads={["Amount", "Driver", "Phone", "Vehicle", "Collected", "Status"]}>
              {load.report.deposits.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="py-2 pr-3">{money(row.amountCents)}</td>
                  <td className="py-2 pr-3">{row.driverId ? <Link to="/admin" search={{ tab: "drivers", id: row.driverId }} className="underline">{row.driverName ?? "Driver"}</Link> : "—"}</td>
                  <td className="py-2 pr-3">{row.phone ? <a href={`tel:${row.phone}`} className="underline">{row.phone}</a> : "No Phone"}</td>
                  <td className="py-2 pr-3">{row.vehicle ?? "—"}</td>
                  <td className="py-2 pr-3">{row.collectedDate ?? "—"}</td>
                  <td className="py-2">{row.status}</td>
                </tr>
              ))}
            </Table>
          </Section>
        </div>
      )}
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}
function Section({ title, empty, count, children }: { title: string; empty: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {count === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : children}
    </section>
  );
}
function Table({ heads, children }: { heads: string[]; children: ReactNode }) {
  return (
    <AdminTableScroll>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-muted-foreground">{heads.map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </AdminTableScroll>
  );
}
function Driver({ match }: { match: LedgerMatch }) {
  return (
    <>
      <td className="py-2 pr-3">
        {match.driverId ? <Link to="/admin" search={{ tab: "drivers", id: match.driverId }} className="underline">{match.driverName ?? "Driver"}</Link> : "—"}
        <div className="text-muted-foreground">{match.confidence ? `${match.confidence === "high" ? "High" : match.confidence === "medium" ? "Medium" : "Low"} · ${match.reason}` : match.reason}</div>
      </td>
      <td className="py-2">{match.phone ? <a href={`tel:${match.phone}`} className="underline">{match.phone}</a> : "No Phone"}</td>
    </>
  );
}
