import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AdminTableScroll } from "./AdminTableScroll";
import { getReceivablesAging } from "@/lib/receivables-aging.functions";
import { RECEIVABLES_AGING_OFF } from "@/lib/receivables-aging-flag";
import { AGE_BUCKET_LABEL, AGE_BUCKETS, receivablesAgingToCsv, type AgingReport } from "@/lib/receivables-aging";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * Mounted only while RECEIVABLES_AGING_ENABLED is true.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: AgingReport };

const money = (cents: number | null) => (cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }));

export function ReceivablesAgingPanel() {
  const read = useServerFn(getReceivablesAging);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
        else setLoad({ kind: "ready", report: result.report });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setLoad({ kind: "unavailable", reason: message === RECEIVABLES_AGING_OFF ? RECEIVABLES_AGING_OFF : "Receivables Aging could not be loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Receivables Aging</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Unpaid and failed rent on active rentals, and on rentals whose end date is within the last 30 days, Eastern Time. Deposits are excluded. This screen does not collect a payment.
          </p>
        </div>
        {load.kind === "ready" && load.report.warnings.length === 0 && load.report.bucketCents && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Receivables Aging…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: AgingReport }) {
  if (report.warnings.length > 0 || !report.bucketCents) {
    return (
      <div className="space-y-2">
        {report.warnings.map((warning) => (
          <p key={warning} className="text-sm text-[#D03020]">{warning}</p>
        ))}
      </div>
    );
  }
  const totals = report.bucketCents;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {AGE_BUCKETS.map((bucket) => (
          <section key={bucket} className="rounded-md border px-4 py-3">
            <h2 className="text-sm font-medium text-muted-foreground">{AGE_BUCKET_LABEL[bucket]}</h2>
            <p className="mt-1 text-2xl font-semibold">{money(totals[bucket])}</p>
          </section>
        ))}
      </div>
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Open Rent Charges.</p>
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["Driver", "Vehicle", "Rental Status", "Amount Owed", "Oldest Unpaid Due Date", "Age Bucket", "Evidence"].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.rentalId} className="border-b align-top">
                  <td className="py-2 pr-3">{row.applicationId ? <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }} className="underline">{row.driver}</Link> : row.driver}</td>
                  <td className="py-2 pr-3">{row.vehicleId ? <Link to="/admin" search={{ tab: "vehicles", id: row.vehicleId }} className="underline">{row.vehicle}</Link> : row.vehicle}</td>
                  <td className="py-2 pr-3">{row.rentalStatus}</td>
                  <td className="py-2 pr-3"><Link to="/admin" search={{ tab: "payments" }} className="underline">{money(row.owedCents)}</Link></td>
                  <td className="py-2 pr-3">{row.oldestDue ?? "—"}</td>
                  <td className="py-2 pr-3">{row.bucket ? AGE_BUCKET_LABEL[row.bucket] : "—"}</td>
                  <td className="py-2 pr-3">{row.evidence.length ? row.evidence.join(" ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
      <section className="space-y-1">
        <h2 className="text-lg font-semibold">Not Included</h2>
        {report.omitted.map((line) => (
          <p key={line} className="text-sm text-muted-foreground">{line}</p>
        ))}
      </section>
    </div>
  );
}

function downloadCsv(report: AgingReport) {
  const blob = new Blob([receivablesAgingToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "receivables-aging.csv";
  link.click();
  URL.revokeObjectURL(url);
}
