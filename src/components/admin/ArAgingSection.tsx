import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AdminTableScroll } from "./AdminTableScroll";
import { getArAging } from "@/lib/ar-aging.functions";
import { AR_AGING_ENABLED, AR_AGING_OFF } from "@/lib/ar-aging-flag";
import type { AgingReport } from "@/lib/ar-aging";

/**
 * Read-only section on the Payments page. Mounted only while AR_AGING_ENABLED is true.
 */

type Load = { kind: "loading" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: AgingReport };

const money = (cents: number | null) =>
  cents == null ? "Unknown" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function ArAgingSection() {
  const read = useServerFn(getArAging);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    if (!AR_AGING_ENABLED) return;
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
        setLoad({ kind: "unavailable", reason: message === AR_AGING_OFF ? AR_AGING_OFF : "Receivables Aging could not be loaded" });
      });
    return () => {
      cancelled = true;
    };
  }, [read]);

  if (!AR_AGING_ENABLED) return null;

  return (
    <section className="mt-8 space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Receivables Aging</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Rent billed and collected for each active driver. Collected uses the combined Revenue definition: verified Stripe net after refunds and fees, plus recorded payments that are not tied to Stripe. Deposits are not included. Unknown stays unknown. This section does not charge a driver.
        </p>
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Receivables Aging…</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && <Report report={load.report} />}
    </section>
  );
}

function Report({ report }: { report: AgingReport }) {
  return (
    <div className="space-y-3">
      {report.warnings.map((warning) => (
        <p key={warning} className="text-sm text-[#D03020]">{warning}</p>
      ))}
      <div className="grid gap-3 sm:grid-cols-3">
        <Total label="Rent Billed" cents={report.rentBilledCents} />
        <Total label="Collected" cents={report.collectedCents} />
        <Total label="Balance" cents={report.balanceCents} />
      </div>
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Active Drivers.</p>
      ) : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {["Driver", "Rent Billed", "Collected", "Balance", "0-7 Days", "8-30 Days", "31-60 Days", "60+ Days", "Not Yet Due"].map((head) => (
                  <th key={head} className="py-2 pr-3 font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.driverId} className="border-b align-top">
                  <td className="py-2 pr-3">{row.driver}</td>
                  <td className="py-2 pr-3">{money(row.rentBilledCents)}</td>
                  <td className="py-2 pr-3">{money(row.collectedCents)}</td>
                  <td className="py-2 pr-3">{money(row.balanceCents)}</td>
                  <td className="py-2 pr-3">{money(row.bucket0Cents)}</td>
                  <td className="py-2 pr-3">{money(row.bucket8Cents)}</td>
                  <td className="py-2 pr-3">{money(row.bucket31Cents)}</td>
                  <td className="py-2 pr-3">{money(row.bucket60Cents)}</td>
                  <td className="py-2 pr-3">{money(row.notYetDueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
    </div>
  );
}

function Total({ label, cents }: { label: string; cents: number | null }) {
  return (
    <section className="rounded-md border px-4 py-3">
      <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      <p className="mt-1 text-2xl font-semibold">{money(cents)}</p>
    </section>
  );
}
