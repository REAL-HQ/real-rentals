import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AdminTableScroll } from "./AdminTableScroll";
import { getDepositLedger } from "@/lib/deposit-ledger.functions";
import { DEPOSIT_LEDGER_OFF, DEPOSIT_RETURNS_DUE_ENABLED, DEPOSIT_RETURNS_DUE_OFF } from "@/lib/deposit-ledger-flag";
import { DEPOSIT_STATE_LABEL, STRIPE_CHECK_UNAVAILABLE, depositLedgerToCsv, type DepositLedgerReport } from "@/lib/deposit-ledger";

/**
 * Read-only. Download CSV is built in the browser from the rows on screen.
 * Mounted only while DEPOSIT_LEDGER_ENABLED is true.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: DepositLedgerReport };

const money = (cents: number | null) => (cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }));

export function DepositLedgerPanel() {
  const read = useServerFn(getDepositLedger);
  const [closedOnly, setClosedOnly] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    const data = DEPOSIT_RETURNS_DUE_ENABLED && closedOnly ? { closedOnly: true } : undefined;
    void read({ data })
      .then((result) => {
        if (cancelled) return;
        if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
        else setLoad({ kind: "ready", report: result.report });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "";
        const reason = message === DEPOSIT_LEDGER_OFF || message === DEPOSIT_RETURNS_DUE_OFF ? message : "Deposit Ledger could not be loaded";
        setLoad({ kind: "unavailable", reason });
      });
    return () => {
      cancelled = true;
    };
  }, [read, closedOnly]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deposit Ledger</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Security deposits by renter. Deposits held and refunds due in the next 7 days are Eastern Time totals of what remains. Stripe captured and Stripe refunded are a read-only cross-check. A difference is evidence only. This screen does not refund a deposit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {DEPOSIT_RETURNS_DUE_ENABLED && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={closedOnly}
                onChange={(event) => {
                  setLoad({ kind: "loading" });
                  setClosedOnly(event.target.checked);
                }}
              />
              Closed Rentals Only
            </label>
          )}
          {load.kind === "ready" && load.report.warnings.length === 0 && load.report.heldCents != null && (
            <button type="button" onClick={() => downloadCsv(load.report)} className="rounded-md border px-3 py-1.5 text-[12px] font-medium">
              Download CSV
            </button>
          )}
        </div>
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Deposit Ledger…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </div>
  );
}

function Report({ report }: { report: DepositLedgerReport }) {
  const stripeDown = report.stripeCheck === "unavailable";
  if (report.warnings.length > 0 || report.heldCents == null || report.dueBackCents == null) {
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
      {stripeDown && <p className="text-sm text-[#D03020]">{STRIPE_CHECK_UNAVAILABLE}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Total label="Deposits Held" cents={report.heldCents} />
        <Total label="Refunds Due In The Next 7 Days" cents={report.dueBackCents} detail={`Through ${report.dueThrough}, Eastern Time`} />
      </div>
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Security Deposits.</p>
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {heads().map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row, index) => (
                <tr key={`${row.rentalId ?? "none"}-${row.applicationId ?? index}`} className="border-b align-top">
                  <td className="py-2 pr-3">{row.applicationId ? <Link to="/admin" search={{ tab: "drivers", id: row.applicationId }} className="underline">{row.renter}</Link> : row.renter}</td>
                  <td className="py-2 pr-3">{row.vehicleId ? <Link to="/admin" search={{ tab: "vehicles", id: row.vehicleId }} className="underline">{row.vehicle}</Link> : row.vehicle}</td>
                  <td className="py-2 pr-3">{row.rentalId ? <Link to="/admin" search={{ tab: "bookings", id: row.rentalId }} className="underline">{row.rentalStatus}</Link> : row.rentalStatus}</td>
                  <td className="py-2 pr-3">{money(row.expectedCents)}</td>
                  <td className="py-2 pr-3">{money(row.collectedCents)}</td>
                  <td className="py-2 pr-3">{DEPOSIT_STATE_LABEL[row.state]}</td>
                  {DEPOSIT_RETURNS_DUE_ENABLED && <td className="py-2 pr-3">{row.daysSinceClose == null ? "—" : String(row.daysSinceClose)}</td>}
                  <td className="py-2 pr-3">{money(row.stripeCapturedCents)}</td>
                  <td className="py-2 pr-3">{money(row.stripeRefundedCents)}</td>
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

function heads(): string[] {
  return [
    "Renter",
    "Vehicle",
    "Rental Status",
    "Expected",
    "Collected",
    "State",
    ...(DEPOSIT_RETURNS_DUE_ENABLED ? ["Days Since Close"] : []),
    "Stripe Captured",
    "Stripe Refunded",
    "Evidence",
  ];
}

function Total({ label, cents, detail }: { label: string; cents: number; detail?: string }) {
  return (
    <section className="rounded-md border px-4 py-3">
      <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
      <p className="mt-1 text-2xl font-semibold">{money(cents)}</p>
      {detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}
    </section>
  );
}

function downloadCsv(report: DepositLedgerReport) {
  const blob = new Blob([depositLedgerToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "deposit-ledger.csv";
  link.click();
  URL.revokeObjectURL(url);
}
