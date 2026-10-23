import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AdminTableScroll } from "./AdminTableScroll";
import { getRentReconciliation } from "@/lib/rent-reconciliation.functions";
import { RENT_RECONCILIATION_OFF } from "@/lib/rent-reconciliation-flag";
import {
  RENT_CATEGORIES,
  RENT_CATEGORY_LABEL,
  STRIPE_CHECK_UNAVAILABLE,
  lastFullWeek,
  rentReconciliationToCsv,
  type RentReconciliationReport,
  type RentRow,
} from "@/lib/rent-reconciliation";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * Mounted only while RENT_RECONCILIATION_ENABLED is true.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: RentReconciliationReport };

const money = (cents: number | null) => (cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }));

export function RentReconciliationPanel() {
  const read = useServerFn(getRentReconciliation);
  const [weekStart, setWeekStart] = useState(() => lastFullWeek()?.from ?? "");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void read({ data: { weekStart: weekStart || undefined } })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
        else setLoad({ kind: "ready", report: result.report });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        setLoad({ kind: "unavailable", reason: message === RENT_RECONCILIATION_OFF ? RENT_RECONCILIATION_OFF : "Rent Payment Reconciliation could not be loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read, weekStart]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rent Payment Reconciliation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rent payments for one Monday through Sunday, Eastern Time, compared with Stripe. Deposits are left out. A difference is evidence only. This screen does not change a payment or a refund.
          </p>
        </div>
        {load.kind === "ready" && load.report.warnings.length === 0 && (
          <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
            Download CSV
          </button>
        )}
      </div>
      <label className="block text-sm font-medium">
        Week Starting
        <input
          type="date"
          value={weekStart}
          onChange={(event) => setWeekStart(event.target.value || lastFullWeek()?.from || "")}
          className="mt-1 block rounded-md border bg-background px-2 py-1 text-sm font-normal"
        />
      </label>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Rent Payment Reconciliation…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: RentReconciliationReport }) {
  const stripeDown = report.stripeCheck === "unavailable";
  if (report.warnings.length > 0) {
    return (
      <div className="space-y-2">
        {report.warnings.map((warning) => (
          <p key={warning} className="text-sm text-[#D03020]">{warning}</p>
        ))}
        {stripeDown && <p className="text-sm text-[#D03020]">{STRIPE_CHECK_UNAVAILABLE}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Week of {report.from} through {report.through}, Eastern Time.</p>
      {stripeDown && <p className="text-sm text-[#D03020]">{STRIPE_CHECK_UNAVAILABLE}</p>}
      {report.totals && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {RENT_CATEGORIES.map((category) => (
            <Total key={category} label={RENT_CATEGORY_LABEL[category]} count={report.totals![category].count} cents={report.totals![category].cents} />
          ))}
        </div>
      )}
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Rent Payments.</p>
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["Renter", "Vehicle", "Payment Status", "Category", "Amount", "Net Collected", "Stripe Captured", "Stripe Refunded", "Evidence"].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <Row key={row.id} row={row} />
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

function Row({ row }: { row: RentRow }) {
  return (
    <tr className="border-b align-top">
      <td className="py-2 pr-3">{row.applicationId ? <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }} className="underline">{row.renter}</Link> : row.renter}</td>
      <td className="py-2 pr-3">{row.vehicleId ? <Link to="/admin" search={{ tab: "vehicles", id: row.vehicleId }} className="underline">{row.vehicle}</Link> : row.vehicle}</td>
      <td className="py-2 pr-3">{row.statusLabel}</td>
      <td className="py-2 pr-3">{row.category ? RENT_CATEGORY_LABEL[row.category] : "—"}</td>
      <td className="py-2 pr-3">{money(row.amountCents)}</td>
      <td className="py-2 pr-3">{money(row.netCollectedCents)}</td>
      <td className="py-2 pr-3">{money(row.stripeCapturedCents)}</td>
      <td className="py-2 pr-3">{money(row.stripeRefundedCents)}</td>
      <td className="py-2 pr-3">{row.evidence.length ? row.evidence.join(" ") : "—"}</td>
    </tr>
  );
}

function Total({ label, count, cents }: { label: string; count: number; cents: number | null }) {
  return (
    <section className="rounded-md border px-4 py-3">
      <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
      <p className="mt-1 text-2xl font-semibold">{money(cents)}</p>
      <p className="mt-1 text-sm text-muted-foreground">{count} {count === 1 ? "Row" : "Rows"}</p>
    </section>
  );
}

function downloadCsv(report: RentReconciliationReport) {
  const blob = new Blob([rentReconciliationToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rent-payment-reconciliation.csv";
  link.click();
  URL.revokeObjectURL(url);
}
