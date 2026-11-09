import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getWeeklyCashFlow } from "@/lib/weekly-cash-flow.functions";
import type { CashWeek, WeeklyCashFlowReport } from "@/lib/weekly-cash-flow";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. There is no button that writes an expense, charge, or refund.
 */

type Load = { kind: "loading" } | { kind: "disabled" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: WeeklyCashFlowReport };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const money = (cents: number | null) => cents === null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const short = (ymd: string) => {
  const [year, month, day] = ymd.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${day}, ${year}`;
};

export function WeeklyCashFlowPanel() {
  const read = useServerFn(getWeeklyCashFlow);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined }).then((result) => {
      if (cancelled) return;
      if (result.status === "disabled") setLoad({ kind: "disabled" });
      else if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch(() => { if (!cancelled) setLoad({ kind: "unavailable", reason: "Weekly Cash Flow could not be loaded" }); });
    return () => { cancelled = true; };
  }, [read]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Weekly Cash Flow</h1>
        <p className="mt-1 text-sm text-muted-foreground">The last 12 weeks, Monday through Sunday, Eastern Time. Gross collected is succeeded Stripe charges. Cash flow is net minus expenses.</p>
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Weekly Cash Flow…</p>}
      {load.kind === "disabled" && <p className="text-sm text-muted-foreground">Weekly Cash Flow Is Off.</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && (
        <div className="space-y-8">
          <Trend weeks={load.report.weeks} />
          <AdminTableScroll>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  {["Week", "Gross Collected", "Refunds", "Net", "Expenses", "Cash Flow"].map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}
                </tr>
              </thead>
              <tbody>
                {load.report.weeks.map((week) => (
                  <tr key={week.from} className="border-b align-top">
                    <td className="py-2 pr-3">{short(week.from)} – {short(week.through)}</td>
                    <td className="py-2 pr-3">{money(week.grossCents)}</td>
                    <td className="py-2 pr-3">{money(week.refundCents)}</td>
                    <td className="py-2 pr-3">{money(week.netCents)}</td>
                    <td className="py-2 pr-3"><Categories cents={week.expenseCents} categories={week.categories} /></td>
                    <td className="py-2">{money(week.cashFlowCents)}</td>
                  </tr>
                ))}
                <tr className="align-top font-semibold">
                  <td className="py-2 pr-3">12-Week Total</td>
                  <td className="py-2 pr-3">{money(load.report.totals.grossCents)}</td>
                  <td className="py-2 pr-3">{money(load.report.totals.refundCents)}</td>
                  <td className="py-2 pr-3">{money(load.report.totals.netCents)}</td>
                  <td className="py-2 pr-3"><Categories cents={load.report.totals.expenseCents} categories={load.report.totals.categories} /></td>
                  <td className="py-2">{money(load.report.totals.cashFlowCents)}</td>
                </tr>
              </tbody>
            </table>
          </AdminTableScroll>
          <p className="text-sm text-muted-foreground">A non-USD succeeded charge or refund withholds that week&apos;s Stripe totals and the 12-week rollup.</p>
        </div>
      )}
    </div>
  );
}

function Categories({ cents, categories }: { cents: number | null; categories: CashWeek["categories"] }) {
  return (
    <div>
      <div>{money(cents)}</div>
      {categories && categories.length > 0 && (
        <div className="mt-1 space-y-0.5 font-normal text-muted-foreground">
          {categories.map((row) => <div key={row.category}>{row.label} · {money(row.cents)}</div>)}
        </div>
      )}
    </div>
  );
}

function Trend({ weeks }: { weeks: CashWeek[] }) {
  const known = weeks.filter((week) => week.cashFlowCents !== null);
  const peak = Math.max(1, ...known.map((week) => Math.abs(week.cashFlowCents ?? 0)));
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Trend</h2>
      <div className="grid grid-cols-12 gap-1 items-end h-28">
        {weeks.map((week) => {
          const value = week.cashFlowCents;
          const height = value === null ? 0 : Math.max(4, Math.round((Math.abs(value) / peak) * 100));
          return (
            <div key={week.from} className="flex h-full flex-col justify-end" title={`${week.from}: ${money(value)}`}>
              <div className={`w-full rounded-sm ${value === null ? "bg-muted" : value < 0 ? "bg-[#D03020]" : "bg-[#111114]"}`} style={{ height: `${value === null ? 8 : height}%` }} />
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">Each bar is that week&apos;s cash flow. A short muted bar means the week&apos;s total is withheld.</p>
    </section>
  );
}
