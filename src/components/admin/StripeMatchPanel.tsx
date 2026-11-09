import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getStripeMatchReport } from "@/lib/stripe-match.functions";
import type { StripeMatchReport, StripeMatchRow } from "@/lib/stripe-match";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. There is no button that writes a Stripe customer id or a rental.
 */

type Load = { kind: "loading" } | { kind: "disabled" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: StripeMatchReport };

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const statusLabel = (status: StripeMatchRow["subscriptionStatus"]) => status === "past_due" ? "Past Due" : "Active";
const confidenceLabel = (row: StripeMatchRow) => row.confidence === "high" ? "High" : row.confidence === "medium" ? "Medium" : row.confidence === "low" ? "Low" : "None";

export function StripeMatchPanel() {
  const read = useServerFn(getStripeMatchReport);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined }).then((result) => {
      if (cancelled) return;
      if (result.status === "disabled") setLoad({ kind: "disabled" });
      else if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch(() => { if (!cancelled) setLoad({ kind: "unavailable", reason: "Stripe Match could not be loaded" }); });
    return () => { cancelled = true; };
  }, [read]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Stripe ↔ App Match</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live customers with an active or past due subscription. Last Paid is the latest succeeded charge in the last 90 days, in Eastern Time. This report does not save a link.
        </p>
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Stripe Match…</p>}
      {load.kind === "disabled" && <p className="text-sm text-muted-foreground">Stripe Match Is Off.</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && (
        <>
          <Section title="Matched" rows={load.report.matched} empty="No Stripe customer matched an application." />
          <Section title="Unmatched" rows={load.report.unmatched} empty="Every listed Stripe customer matched an application." />
        </>
      )}
    </div>
  );
}

function Section({ title, rows, empty }: { title: string; rows: StripeMatchRow[]; empty: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <AdminTableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Subscription</th>
                <th className="py-2 pr-3 font-medium">Weekly Amount</th>
                <th className="py-2 pr-3 font-medium">Last Paid</th>
                <th className="py-2 pr-3 font-medium">Match</th>
                <th className="py-2 pr-3 font-medium">Driver</th>
                <th className="py-2 pr-3 font-medium">Vehicle</th>
                <th className="py-2 font-medium">App Rental</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.customerId} className="border-b align-top">
                  <td className="py-2 pr-3">
                    <div>{row.name ?? "—"}</div>
                    <div className="text-muted-foreground">{row.email ?? "—"}</div>
                  </td>
                  <td className="py-2 pr-3">{statusLabel(row.subscriptionStatus)}</td>
                  <td className="py-2 pr-3">{row.weeklyAmountCents === null ? "Not Weekly" : money(row.weeklyAmountCents)}</td>
                  <td className="py-2 pr-3">{row.lastPaidDate ?? "No Charge In 90 Days"}</td>
                  <td className="py-2 pr-3">{confidenceLabel(row)} · {row.reason}</td>
                  <td className="py-2 pr-3">
                    {row.driverId ? <Link to="/admin" search={{ tab: "drivers", id: row.driverId }} className="underline">{row.driverName ?? "Driver"}</Link> : "—"}
                  </td>
                  <td className="py-2 pr-3">{row.vehicleLabel ?? "—"}</td>
                  <td className="py-2">{row.rentalExists ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableScroll>
      )}
    </section>
  );
}
