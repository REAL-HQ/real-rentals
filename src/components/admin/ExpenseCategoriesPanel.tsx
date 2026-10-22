import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PieChart } from "lucide-react";
import { getExpenseCategories } from "@/lib/expense-categories.functions";
import {
  EXPENSE_PERIODS,
  expenseCategoriesToCsv,
  type ExpenseCategorySummary,
  type ExpensePeriod,
} from "@/lib/expense-categories";

/**
 * Mounted only while FINANCE_EXPENSE_CATEGORIES_ENABLED is true.
 * Download CSV is built in the browser from the rows on screen.
 */

type Load =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "ready"; summary: ExpenseCategorySummary };

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

export function ExpenseCategoriesPanel() {
  const read = useServerFn(getExpenseCategories);
  const readRef = useRef(read);
  readRef.current = read;
  const [period, setPeriod] = useState<ExpensePeriod>("this_month");
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void readRef
      .current({ data: { period } })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ready") setLoad({ kind: "ready", summary: result.summary });
        else if (result.status === "disabled")
          setLoad({ kind: "unavailable", reason: "Expense Categories Are Off" });
        else setLoad({ kind: "unavailable", reason: result.reason });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoad({
          kind: "unavailable",
          reason: error instanceof Error ? error.message : "Expense Categories could not be loaded",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const summary = load.kind === "ready" ? load.summary : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold mr-2">Expense Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vehicle expenses for one Eastern Time period, grouped by category. Each expense is
            counted once. This screen does not change a record.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXPENSE_PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPeriod(item.id)}
              className={`rounded-md border px-3 py-1.5 text-sm ${period === item.id ? "bg-muted font-medium" : ""}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {load.kind === "loading" && (
        <p className="text-sm text-muted-foreground">Loading Expense Categories</p>
      )}
      {load.kind === "unavailable" && (
        <div className="rounded-lg border p-6 text-center">
          <PieChart className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 font-medium">Expense Categories</p>
          <p className="mt-1 text-sm text-muted-foreground">{load.reason}</p>
        </div>
      )}
      {summary && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {summary.from} Through {summary.through}
              {summary.coverage === "complete" ? " · Complete" : " · Unavailable"}
            </p>
            {summary.complete && (
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => downloadCsv(summary)}
              >
                Download CSV
              </button>
            )}
          </div>
          {summary.complete && summary.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Expenses In This Period</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Count</th>
                    <th className="px-3 py-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.lines.map((line) => (
                    <tr key={line.category} className="border-b">
                      <td className="px-3 py-2">{line.label}</td>
                      <td className="px-3 py-2">{line.count}</td>
                      <td className="px-3 py-2">{money(line.cents)}</td>
                    </tr>
                  ))}
                </tbody>
                {summary.totalCents !== null && summary.count !== null && (
                  <tfoot>
                    <tr>
                      <td className="px-3 py-2 font-medium">Total</td>
                      <td className="px-3 py-2 font-medium">{summary.count}</td>
                      <td className="px-3 py-2 font-medium">{money(summary.totalCents)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          <ul className="space-y-1 text-sm text-muted-foreground">
            {summary.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function downloadCsv(summary: ExpenseCategorySummary) {
  const blob = new Blob([expenseCategoriesToCsv(summary)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `expense-categories-${summary.from}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
