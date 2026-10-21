import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getTaxExport } from "@/lib/tax-export.functions";
import { TAX_EXPORT_OFF } from "@/lib/tax-export-flag";
import { currentTaxYear, taxFileToCsv, type TaxExportReport, type TaxFile } from "@/lib/tax-export";

/**
 * Read-only. Each CSV is built in the browser.
 * Mounted only while TAX_EXPORT_ENABLED is true.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: TaxExportReport };

const LABELS: Record<string, string> = {
  income: "Rental Income",
  deposits: "Deposits Held",
  refunds: "Refunds",
  fees: "Processing Fees",
  expenses: "Vehicle Expenses",
  maintenance: "Maintenance",
};

export function TaxExportPanel() {
  const read = useServerFn(getTaxExport);
  const initial = currentTaxYear(new Date());
  const [year, setYear] = useState(initial ? String(initial) : "");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const yearValid = /^\d{4}$/.test(year);
  useEffect(() => {
    if (!yearValid) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: { year: Number(year) } })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
        else setLoad({ kind: "ready", report: result.report });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setLoad({ kind: "unavailable", reason: message === TAX_EXPORT_OFF ? TAX_EXPORT_OFF : "Tax Year Export could not be loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read, year, yearValid]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tax Year Export</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One calendar year, Eastern Time. Rental income is paid net of refunds, and deposits are excluded. Processing fees stay Unavailable unless a fee is already stored. Each file is built in this browser. This screen does not save anything.
        </p>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Year</span>
        <input type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(event.target.value)} className="w-32 rounded-md border bg-background px-2 py-1.5" />
      </label>
      {!yearValid && <p className="text-sm text-muted-foreground">The tax year is not valid.</p>}
      {yearValid && load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Tax Year Export…</p>}
      {yearValid && load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {yearValid && load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: TaxExportReport }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{report.from} through {report.through}, Eastern Time.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {report.files.map((taxFile) => (
          <section key={taxFile.id} className="flex items-center justify-between gap-3 rounded-md border px-4 py-3">
            <div>
              <h2 className="text-sm font-medium">{LABELS[taxFile.id] ?? taxFile.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{taxFile.total.at(-1)}</p>
            </div>
            <button type="button" onClick={() => downloadCsv(taxFile)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
              Download CSV
            </button>
          </section>
        ))}
      </div>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Gaps</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {report.gaps.map((gap) => <li key={gap}>{gap}</li>)}
        </ul>
      </section>
    </div>
  );
}

function downloadCsv(taxFile: TaxFile) {
  const blob = new Blob([taxFileToCsv(taxFile)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = taxFile.filename;
  link.click();
  URL.revokeObjectURL(url);
}
