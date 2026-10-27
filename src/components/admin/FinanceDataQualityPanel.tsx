import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getFinanceDataQuality } from "@/lib/finance-data-quality.functions";
import { financeDataQualityToCsv, type QualityIssue, type QualityReport } from "@/lib/finance-data-quality";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * There is no button that changes a payment, a rental, or a refund.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: QualityReport };

export function FinanceDataQualityPanel() {
  const read = useServerFn(getFinanceDataQuality);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined }).then((result) => {
      if (cancelled) return;
      if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch((error: unknown) => {
      if (cancelled) return;
      const reason = error instanceof Error && error.message ? error.message : "Finance Data Quality could not be loaded";
      setLoad({ kind: "unavailable", reason });
    });
    return () => { cancelled = true; };
  }, [read]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance Data Quality</h1>
          <p className="mt-1 text-sm text-muted-foreground">Payment, rental, deposit, and refund gaps that leave finance totals Partial or Unavailable. This screen does not change a record.</p>
        </div>
        {load.kind === "ready" && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Finance Data Quality…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: QualityReport }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {report.counts.map((count) => (
          <div key={count.id} className="rounded-md border px-3 py-2">
            <p className="text-xs text-muted-foreground">{count.label}</p>
            <p className="text-lg font-semibold">{count.count}</p>
          </div>
        ))}
      </div>
      {report.issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Data Problems.</p>
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["Problem", "Record", "Suggested Fix"].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.issues.map((row) => <Issue key={row.id} row={row} />)}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
    </div>
  );
}

function Issue({ row }: { row: QualityIssue }) {
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">{row.problem}</td>
      <td className="py-2 pr-3">
        <Link to="/admin" search={searchFromHref(row.recordHref)} className="underline">{row.recordLabel}</Link>
      </td>
      <td className="py-2 pr-3">{row.suggestedFix}</td>
    </tr>
  );
}

function searchFromHref(href: string): { tab: string; id?: string } {
  const url = new URL(href, "https://local.invalid");
  const tab = url.searchParams.get("tab") ?? "overview";
  const id = url.searchParams.get("id");
  return id ? { tab, id } : { tab };
}

function downloadCsv(report: QualityReport) {
  const blob = new Blob([financeDataQualityToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "finance-data-quality.csv";
  link.click();
  URL.revokeObjectURL(url);
}
