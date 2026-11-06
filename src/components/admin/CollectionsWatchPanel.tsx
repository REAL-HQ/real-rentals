import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { getCollectionsWatch } from "@/lib/collections-watch.functions";
import type { CollectionsWatchReport, WatchMatch } from "@/lib/collections-watch";
import { AdminTableScroll } from "./AdminTableScroll";

/**
 * Read-only. There is no retry, dunning, email, or other button that writes.
 */

type Load = { kind: "loading" } | { kind: "disabled" } | { kind: "unavailable"; reason: string } | { kind: "ready"; report: CollectionsWatchReport };

const money = (cents: number | null) => cents === null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const statusLabel = (status: "past_due" | "unpaid") => status === "past_due" ? "Past Due" : "Unpaid";

export function CollectionsWatchPanel() {
  const read = useServerFn(getCollectionsWatch);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    void read({ data: undefined }).then((result) => {
      if (cancelled) return;
      if (result.status === "disabled") setLoad({ kind: "disabled" });
      else if (result.status === "unavailable") setLoad({ kind: "unavailable", reason: result.reason });
      else setLoad({ kind: "ready", report: result.report });
    }).catch(() => { if (!cancelled) setLoad({ kind: "unavailable", reason: "Collections Watch could not be loaded" }); });
    return () => { cancelled = true; };
  }, [read]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Collections Watch</h1>
        <p className="mt-1 text-sm text-muted-foreground">Past due subscriptions, failed charges from the last 30 days, and invoices due in the next 7 days. Dates are Eastern Time. This screen does not retry a charge or send a notice.</p>
      </div>
      {load.kind === "loading" && <p className="text-sm text-muted-foreground">Loading Collections Watch…</p>}
      {load.kind === "disabled" && <p className="text-sm text-muted-foreground">Collections Watch Is Off.</p>}
      {load.kind === "unavailable" && <p className="text-sm text-muted-foreground">{load.reason}</p>}
      {load.kind === "ready" && (
        <div className="space-y-8">
          <p className="text-sm text-muted-foreground">{load.report.upcomingInvoiceNote}</p>
          <Section title="Past Due And Unpaid" empty="No past due or unpaid subscriptions." count={load.report.overdue.length}>
            <Table heads={["Customer", "Status", "Amount Due", "Days Overdue", "Failure Reason", "Driver", "Phone"]}>
              {load.report.overdue.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="py-2 pr-3"><div>{row.customerName ?? "—"}</div><div className="text-muted-foreground">{row.customerEmail ?? "—"}</div></td>
                  <td className="py-2 pr-3">{statusLabel(row.status)}</td>
                  <td className="py-2 pr-3">{money(row.amountDueCents)}</td>
                  <td className="py-2 pr-3">{row.daysOverdue === null ? "—" : row.daysOverdue}</td>
                  <td className="py-2 pr-3">{row.failureReason ?? "No Failure Reason"}</td>
                  <Driver match={row.match} />
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Failed Charges" empty="No failed charges in the last 30 days." count={load.report.failedCharges.length}>
            <Table heads={["Date", "Customer", "Amount", "Failure Reason", "Driver", "Phone"]}>
              {load.report.failedCharges.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="py-2 pr-3">{row.createdDate ?? "—"}</td>
                  <td className="py-2 pr-3"><div>{row.customerName ?? "—"}</div><div className="text-muted-foreground">{row.customerEmail ?? "—"}</div></td>
                  <td className="py-2 pr-3">{money(row.amountCents)}</td>
                  <td className="py-2 pr-3">{row.failureReason ?? "No Failure Reason"}</td>
                  <Driver match={row.match} />
                </tr>
              ))}
            </Table>
          </Section>
          <Section title="Due In 7 Days" empty="Nothing is due in the next 7 days." count={load.report.dueSoon.length}>
            <Table heads={["Due", "Customer", "Amount", "Source", "Driver", "Phone"]}>
              {load.report.dueSoon.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="py-2 pr-3">{row.dueDate ?? "—"}</td>
                  <td className="py-2 pr-3"><div>{row.customerName ?? "—"}</div><div className="text-muted-foreground">{row.customerEmail ?? "—"}</div></td>
                  <td className="py-2 pr-3">{money(row.amountCents)}</td>
                  <td className="py-2 pr-3">{row.source}</td>
                  <Driver match={row.match} />
                </tr>
              ))}
            </Table>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, empty, count, children }: { title: string; empty: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {count === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : children}
    </section>
  );
}

function Table({ heads, children }: { heads: string[]; children: ReactNode }) {
  return (
    <AdminTableScroll>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-muted-foreground">{heads.map((head) => <th key={head} className="py-2 pr-3 font-medium">{head}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </AdminTableScroll>
  );
}

function Driver({ match }: { match: WatchMatch }) {
  return (
    <>
      <td className="py-2 pr-3">
        {match.driverId ? <Link to="/admin" search={{ tab: "drivers", id: match.driverId }} className="underline">{match.driverName ?? "Driver"}</Link> : "—"}
        <div className="text-muted-foreground">{match.confidence ? `${match.confidence === "high" ? "High" : match.confidence === "medium" ? "Medium" : "Low"} · ${match.reason}` : match.reason}</div>
      </td>
      <td className="py-2">{match.phone ? <a href={`tel:${match.phone}`} className="underline">{match.phone}</a> : "No Phone"}</td>
    </>
  );
}
