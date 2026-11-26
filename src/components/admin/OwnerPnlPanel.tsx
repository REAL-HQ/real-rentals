import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { AdminTableScroll } from "./AdminTableScroll";
import { getOwnerPnlView } from "@/lib/owner-pnl.functions";
import { ownerPnlViewCsv, type OwnerPnlView, type PnlCarRow, type PnlPreset } from "@/lib/owner-pnl-range";
import type { OwnerPnlViewResponse } from "@/lib/owner-pnl.server";

/**
 * Owner P&L. One Eastern Time range, the prior period beside it, and
 * all-time company totals. CSV and Print are built in the browser.
 */

const PRESETS: { id: PnlPreset; label: string }[] = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "last_30", label: "Last 30 Days" },
  { id: "ytd", label: "YTD" },
  { id: "all_time", label: "All Time" },
  { id: "custom", label: "Custom" },
];

type CarSort = "label" | "revenueCents" | "expenseCents" | "netCents" | "allTimeRevenueCents" | "allTimeNetCents" | "daysRented" | "utilizationPct" | "paybackPct";

function money(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function netIsPartial(month: OwnerPnlView["current"]): boolean {
  return !month.feesComplete && month.revenueComplete && month.expensesComplete && month.refundsComplete;
}

function netCell(month: OwnerPnlView["current"]): string {
  if (netIsPartial(month)) return "Partial";
  return money(month.netCents);
}

function downloadCsv(view: OwnerPnlView) {
  const blob = new Blob([ownerPnlViewCsv(view)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `owner-pnl-${view.from}-to-${view.through}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const field = "rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm text-[#111114]";

export function OwnerPnlPanel() {
  const read = useServerFn(getOwnerPnlView);
  const [preset, setPreset] = useState<PnlPreset>("this_month");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<CarSort>("netCents");
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [response, setResponse] = useState<OwnerPnlViewResponse | null>(null);

  useEffect(() => {
    if (preset === "custom" && (!from || !through)) return;
    let cancelled = false;
    setLoading(true);
    setProblem(null);
    read({
      data: {
        preset,
        from: preset === "custom" ? from : undefined,
        through: preset === "custom" ? through : undefined,
        vehicleId: vehicleId || null,
        driverId: driverId || null,
        source: (source || null) as OwnerPnlView["options"]["sources"][number]["source"] | null,
        category: category || null,
      },
    })
      .then((result) => { if (!cancelled) setResponse(result); })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "Owner P&L unavailable");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [read, preset, from, through, vehicleId, driverId, source, category]);

  const view = response?.status === "ready" ? response.view : null;
  const cars = useMemo(() => sortCars(view?.cars ?? [], sort, sortDesc), [view, sort, sortDesc]);
  const lines = view ? [
    ["Revenue", money(view.current.revenueCents), money(view.previous?.revenueCents ?? null), money(view.change?.revenueCents ?? null)],
    ["Refunds", money(view.current.refundsCents), money(view.previous?.refundsCents ?? null), money(view.change?.refundsCents ?? null)],
    ["Expenses", money(view.current.expenseCents), money(view.previous?.expenseCents ?? null), money(view.change?.expenseCents ?? null)],
    ["Fees", view.companyFeesCents === null ? "Unavailable" : money(view.companyFeesCents), view.priorCompanyFeesCents === null ? "—" : money(view.priorCompanyFeesCents), feeChange(view)],
    ["Net", netCell(view.current), view.previous ? netCell(view.previous) : "—", money(view.change?.netCents ?? null)],
  ] as const : [];

  function toggleSort(key: CarSort) {
    if (sort === key) setSortDesc((value) => !value);
    else {
      setSort(key);
      setSortDesc(key !== "label");
    }
  }

  return (
    <div className="owner-pnl space-y-5">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <p className="text-sm text-[#55555E] max-w-3xl">
          Stripe charges plus recorded Cash App, Zelle, Venmo, wire, and cash. A shared reference counts once. Deposits stay off the net. Stripe fees stay on the company net.
        </p>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button type="button" onClick={() => window.print()} className={field}>Print</button>
          <button type="button" disabled={!view} onClick={() => view && downloadCsv(view)} className={`${field} inline-flex items-center gap-1.5 disabled:opacity-50`}>
            <Download className="w-4 h-4" strokeWidth={1.75} />
            Download CSV
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 print:hidden">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPreset(item.id)}
            className={`rounded-lg border px-3 py-2 text-sm ${preset === item.id ? "border-[#111114] bg-[#111114] text-white" : "border-[#EDEDF0] bg-white text-[#111114]"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex flex-wrap gap-2 print:hidden">
          <label className="text-sm text-[#55555E]">From
            <input type="date" aria-label="From" value={from} onChange={(event) => setFrom(event.target.value)} className={`${field} ml-2`} />
          </label>
          <label className="text-sm text-[#55555E]">Through
            <input type="date" aria-label="Through" value={through} onChange={(event) => setThrough(event.target.value)} className={`${field} ml-2`} />
          </label>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 print:hidden">
        <select aria-label="Car" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className={field}>
          <option value="">All Cars</option>
          {(view?.options.cars ?? []).map((car) => <option key={car.id} value={car.id}>{car.label}</option>)}
        </select>
        <select aria-label="Renter" value={driverId} onChange={(event) => setDriverId(event.target.value)} className={field}>
          <option value="">All Renters</option>
          {(view?.options.renters ?? []).map((renter) => <option key={renter.id} value={renter.id}>{renter.name}</option>)}
        </select>
        <select aria-label="Payment Source" value={source} onChange={(event) => setSource(event.target.value)} className={field}>
          <option value="">All Sources</option>
          {(view?.options.sources ?? []).map((row) => <option key={row.source} value={row.source}>{row.label}</option>)}
        </select>
        <select aria-label="Expense Category" value={category} onChange={(event) => setCategory(event.target.value)} className={field}>
          <option value="">All Categories</option>
          {(view?.options.categories ?? []).map((row) => <option key={row.category} value={row.category}>{row.label}</option>)}
        </select>
      </div>

      {loading && <p className="text-sm text-[#55555E]">Loading…</p>}
      {problem && <p className="text-sm text-[#D03020]">{problem}</p>}
      {response?.status === "disabled" && <p className="text-sm text-[#55555E]">P&L Is Off</p>}
      {response?.status === "unavailable" && <p className="text-sm text-[#D03020]">{response.reason}</p>}

      {view && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Headline label="All-Time Revenue" value={money(view.allTime.revenueCents)} />
            <Headline label="All-Time Expenses" value={money(view.allTime.expenseCents)} />
            <Headline label="All-Time Fees" value={view.allTime.feesCents === null ? "Unavailable" : money(view.allTime.feesCents)} />
            <Headline label="All-Time Net" value={money(view.allTime.netCents)} />
          </div>
          <p className="text-sm text-[#55555E]">
            {view.from} – {view.through}
            {view.compareFrom && view.compareThrough ? ` · Compared With ${view.compareFrom} – ${view.compareThrough}` : ""}
          </p>
          {!view.current.revenueComplete && <p className="text-sm text-[#D03020]">Revenue Is Incomplete. Amounts that depend on it are left blank.</p>}
          {!view.current.expensesComplete && <p className="text-sm text-[#D03020]">Expenses Are Incomplete. Amounts that depend on them are left blank.</p>}
          {!view.current.refundsComplete && <p className="text-sm text-[#D03020]">Refunds Are Incomplete. Amounts that depend on them are left blank.</p>}
          {view.current.unmatched.length > 0 && <p className="text-sm text-[#D03020]">Partial Coverage. A recorded Stripe payment has no Payment Intent, charge, invoice, or payment reference, so it is excluded.</p>}
          {(netIsPartial(view.current) || (view.previous && netIsPartial(view.previous))) && <p className="text-sm text-[#D03020]">Stripe fees are Unavailable, so the net is Partial.</p>}
          {!view.feesInNet && <p className="text-sm text-[#55555E]">Stripe fees stay on the company total. This filtered net does not subtract them.</p>}

          <AdminTableScroll className="rounded-xl border border-[#EDEDF0]">
            <table className="w-full text-sm">
              <thead className="bg-[#FAFAFB] text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Line</th>
                  <th className="px-4 py-2.5 font-medium text-right">This Period</th>
                  <th className="px-4 py-2.5 font-medium text-right">Prior Period</th>
                  <th className="px-4 py-2.5 font-medium text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(([label, current, previous, change]) => (
                  <tr key={label} className="border-t border-[#EDEDF0]">
                    <td className="px-4 py-3 font-medium">{label}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{current}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{previous}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </AdminTableScroll>
          <p className="text-sm text-[#55555E]">
            Unattributed Revenue {money(view.current.unattributedRevenueCents)} · Deposits Excluded {money(view.current.depositsExcludedCents)} · Deposit Refunds Excluded {money(view.current.depositRefundsExcludedCents)}
          </p>

          <Section title="Month By Month" hint={view.trendCapped ? "The latest 36 months. Flat bars, no fill between them." : "Revenue, expenses, and net for each month in view."}>
            <TrendChart points={view.trend} />
          </Section>

          <Section title="Income By Source" hint="Stripe is the verified charge. Cash App, Zelle, Venmo, wire, and cash are recorded payments. A shared reference is counted once.">
            {view.current.sources.length === 0 ? <Empty>Source totals are blank until income is complete.</Empty> : (
              <SimpleTable headers={["Source", "This Range"]} rows={view.current.sources.map((row) => [row.label, money(row.cents)])} />
            )}
          </Section>

          <Section title="Expenses By Category" hint="Grouped by the category on each vehicle expense. A linked service and its expense count once.">
            {view.current.expenses.length === 0 ? <Empty>No Expenses In This Range</Empty> : (
              <SimpleTable headers={["Category", "This Range"]} rows={view.current.expenses.map((row) => [row.label, money(row.cents)])} />
            )}
          </Section>

          <Section title="By Car" hint="Range totals, then all-time revenue and net. Days rented and idle are inside the selected range. Stripe fees are not split by car. Payback is all-time net divided by purchase price.">
            {cars.length === 0 ? <Empty>No Car Totals In This Range</Empty> : (
              <AdminTableScroll className="rounded-xl border border-[#EDEDF0]">
                <table className="w-full text-sm">
                  <thead className="bg-[#FAFAFB] text-left">
                    <tr>
                      <SortHead label="Car" active={sort === "label"} onClick={() => toggleSort("label")} />
                      <SortHead label="Revenue" align="right" active={sort === "revenueCents"} onClick={() => toggleSort("revenueCents")} />
                      <SortHead label="Expenses" align="right" active={sort === "expenseCents"} onClick={() => toggleSort("expenseCents")} />
                      <th className="px-3 py-2.5 font-medium text-right">Fees</th>
                      <SortHead label="Net" align="right" active={sort === "netCents"} onClick={() => toggleSort("netCents")} />
                      <SortHead label="All-Time Revenue" align="right" active={sort === "allTimeRevenueCents"} onClick={() => toggleSort("allTimeRevenueCents")} />
                      <SortHead label="All-Time Net" align="right" active={sort === "allTimeNetCents"} onClick={() => toggleSort("allTimeNetCents")} />
                      <SortHead label="Days Rented" align="right" active={sort === "daysRented"} onClick={() => toggleSort("daysRented")} />
                      <th className="px-3 py-2.5 font-medium text-right">Days Idle</th>
                      <SortHead label="Utilization" align="right" active={sort === "utilizationPct"} onClick={() => toggleSort("utilizationPct")} />
                      <SortHead label="Payback" align="right" active={sort === "paybackPct"} onClick={() => toggleSort("paybackPct")} />
                    </tr>
                  </thead>
                  <tbody>
                    {cars.map((row) => (
                      <tr key={row.id} className="border-t border-[#EDEDF0]">
                        <td className="px-3 py-3 font-medium whitespace-nowrap">{row.label}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.revenueCents)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.expenseCents)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">—</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.netCents)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.allTimeRevenueCents)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.allTimeNetCents)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.daysRented}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.daysIdle}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.utilizationPct === null ? "—" : `${row.utilizationPct}%`}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.paybackPct === null ? "—" : `${row.paybackPct}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminTableScroll>
            )}
          </Section>

          <Section title="Revenue By Renter" hint="Renter name only. Income in this range that could be tied to one renter.">
            {view.renters.length === 0 ? <Empty>No Renter Totals In This Range</Empty> : (
              <SimpleTable headers={["Renter", "Revenue"]} rows={view.renters.map((row) => [row.name, money(row.revenueCents)])} />
            )}
          </Section>

          <Section title="Receivables" hint="Open and overdue amounts are unpaid charges on file today. Deposits held are rentals marked held, and they stay off the net.">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Headline label="Open" value={money(view.receivables.openCents)} detail={`${view.receivables.openCount} ${view.receivables.openCount === 1 ? "Charge" : "Charges"}`} />
              <Headline label="Overdue" value={money(view.receivables.overdueCents)} detail={`${view.receivables.overdueCount} ${view.receivables.overdueCount === 1 ? "Charge" : "Charges"}`} />
              <Headline label="Unpaid" value={money(view.receivables.unpaidCents)} />
              <Headline label="Deposits Held" value={money(view.receivables.depositsHeldCents)} detail={`${view.receivables.depositCount} ${view.receivables.depositCount === 1 ? "Rental" : "Rentals"}`} />
            </div>
          </Section>

          <Section title="Unattributed Revenue" hint="Payments with no car and no renter, plus Stripe charges that named more than one car or none. Read only.">
            {view.unattributed.length === 0 ? <Empty>No Unattributed Payments In This Range</Empty> : (
              <SimpleTable headers={["Date", "Amount", "Source", "Reference"]} rows={view.unattributed.map((row) => [row.date, money(row.amountCents), row.source, row.reference])} />
            )}
          </Section>

          {view.notes.length > 0 && (
            <Section title="Notes">
              <ul className="space-y-1 text-sm text-[#55555E]">
                {view.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Headline({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-[#EDEDF0] bg-white px-4 py-3">
      <div className="text-xs text-[#55555E]">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-[#111114]">{value}</div>
      {detail && <div className="text-xs text-[#55555E]">{detail}</div>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-base font-semibold text-[#111114]">{title}</h3>
        {hint && <p className="text-sm text-[#55555E] mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[#55555E]">{children}</p>;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <AdminTableScroll className="rounded-xl border border-[#EDEDF0]">
      <table className="w-full text-sm">
        <thead className="bg-[#FAFAFB] text-left">
          <tr>
            {headers.map((header, index) => (
              <th key={header} className={`px-4 py-2.5 font-medium ${index > 0 ? "text-right" : ""}`}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="border-t border-[#EDEDF0]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`px-4 py-3 ${cellIndex === 0 ? "font-medium" : "text-right tabular-nums"}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTableScroll>
  );
}

function SortHead({ label, onClick, active, align = "left" }: { label: string; onClick: () => void; active: boolean; align?: "left" | "right" }) {
  return (
    <th className={`px-3 py-2.5 font-medium ${align === "right" ? "text-right" : ""}`}>
      <button type="button" onClick={onClick} className={`print:hidden ${active ? "text-[#111114]" : ""}`}>{label}</button>
      <span className="hidden print:inline">{label}</span>
    </th>
  );
}

function TrendChart({ points }: { points: OwnerPnlView["trend"] }) {
  const max = Math.max(1, ...points.flatMap((point) => [Math.abs(point.revenueCents ?? 0), Math.abs(point.expenseCents ?? 0), Math.abs(point.netCents ?? 0)]));
  if (points.length === 0) return <Empty>No Months In This Range</Empty>;
  return (
    <div className="rounded-xl border border-[#EDEDF0] bg-white p-3">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-[#55555E]">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-[#3D5A80]" /> Revenue</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-[#8C6A3D]" /> Expenses</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-[#2F6F4E]" /> Net</span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex items-end gap-3 min-w-max">
          {points.map((point) => (
            <div key={point.month} className="flex w-14 flex-col items-center gap-1">
              <div className="flex h-28 items-end gap-1">
                <Bar cents={point.revenueCents} max={max} color="#3D5A80" />
                <Bar cents={point.expenseCents} max={max} color="#8C6A3D" />
                <Bar cents={point.netCents} max={max} color={(point.netCents ?? 0) < 0 ? "#A33B32" : "#2F6F4E"} />
              </div>
              <span className="text-[10px] text-[#55555E]">{point.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bar({ cents, max, color }: { cents: number | null; max: number; color: string }) {
  const height = cents === null ? 0 : Math.max(2, Math.round((Math.abs(cents) / max) * 112));
  return <div className="w-2 rounded-sm" style={{ height, backgroundColor: color }} />;
}

function feeChange(view: OwnerPnlView): string {
  if (view.companyFeesCents === null || view.priorCompanyFeesCents === null) return "—";
  return money(view.companyFeesCents - view.priorCompanyFeesCents);
}

function sortCars(rows: PnlCarRow[], sort: CarSort, desc: boolean): PnlCarRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    const left = a[sort];
    const right = b[sort];
    if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
    const av = typeof left === "number" ? left : Number.NEGATIVE_INFINITY;
    const bv = typeof right === "number" ? right : Number.NEGATIVE_INFINITY;
    return av - bv;
  });
  if (desc) copy.reverse();
  return copy;
}

const PRINT_CSS = `@media print {
  .owner-pnl, .owner-pnl * { color: #000 !important; background: #fff !important; }
  .owner-pnl table { width: 100%; border-collapse: collapse; }
  .owner-pnl th, .owner-pnl td { border-bottom: 1px solid #000; padding: 4px 8px 4px 0; }
  .owner-pnl section, .owner-pnl table { break-inside: avoid; }
}`;
