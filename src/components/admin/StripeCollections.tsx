import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStripeCollections } from "@/lib/stripe-collections.functions";
import { collectionsRefreshState, collectionsRequestRange, formatStripeAmount, STRIPE_COLLECTIONS_ENABLED } from "@/lib/stripe-collections";
import { stripeCollectionsQuery } from "@/lib/stripe-collections-query";
import { STRIPE_COLLECTIONS_TEST_MODE } from "@/lib/stripe-collections.test-mode";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import { resolveRange } from "@/lib/date-range";

export function StripeCollections({ from: fromProp, to: toProp, hideRange = false }: { from?: string; to?: string; hideRange?: boolean } = {}) {
  // Test-only synthetic mode is dev-server-only; production builds keep the feature hidden.
  const featureVisible = STRIPE_COLLECTIONS_ENABLED || (import.meta.env.DEV && STRIPE_COLLECTIONS_TEST_MODE);
  const [initial] = useState(() => resolveRange("last_30"));
  const [fromState, setFrom] = useState(initial.from);
  const [toState, setTo] = useState(initial.to);
  const controlled = Boolean(fromProp && toProp);
  const from = controlled ? fromProp! : fromState;
  const to = controlled ? toProp! : toState;
  const [environment, setEnvironment] = useState<"live" | "sandbox">("live");
  const load = useServerFn(getStripeCollections);
  const valid = collectionsRequestRange(from, to) !== null;
  const query = useQuery(stripeCollectionsQuery(load, environment, from, to, featureVisible));
  const report = query.isError || !valid ? undefined : query.data;
  const refresh = collectionsRefreshState({ valid, fetching: query.isFetching, failed: query.isError, refreshedAt: query.data?.refreshedAt, stale: query.isStale });
  const customers = report?.collectionsComplete ? report.customers : report?.verifiedCollections.customers;
  const money = (field: "gross" | "refunds" | "fees" | "net") => report?.collectionsComplete
    ? report.totals?.length ? report.totals.map(t => formatStripeAmount(t[field], t.currency)).join(" · ") : "—"
    : "—";
  if (!featureVisible) return null;
  return (
    <section aria-label="Stripe Collections" className="space-y-4 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Stripe Collections</h2>
          <p role="status" className="text-xs text-muted-foreground mt-1">{refresh.status}{refresh.cached ? " · Cached Data" : ""} · Last Successful: {refresh.lastSuccessfulAt ? fmtDateTime(refresh.lastSuccessfulAt) : "—"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-1" aria-label="Collections Mode">{(["live", "sandbox"] as const).map(mode => <Button key={mode} size="sm" variant={environment === mode ? "secondary" : "ghost"} aria-pressed={environment === mode} onClick={() => setEnvironment(mode)}>{mode === "live" ? "Live" : "Test"}</Button>)}</div>
          {!hideRange && <>
            <label className="text-xs text-muted-foreground">From <input aria-label="Collections From" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 w-36 rounded-md border border-input bg-background px-2 text-foreground" /></label>
            <label className="text-xs text-muted-foreground">To <input aria-label="Collections To" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 w-36 rounded-md border border-input bg-background px-2 text-foreground" /></label>
          </>}
          <Button aria-label="Refresh Collections" title="Refresh Collections" variant="outline" size="icon" disabled={!valid || query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin motion-reduce:animate-none" : ""} /></Button>
        </div>
      </div>
      {!valid && <p role="alert" className="text-sm text-destructive">Choose a valid range of up to 366 days.</p>}
      {query.isError && <p role="alert" className="text-sm text-destructive">Stripe collections unavailable. {query.error.message}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Gross Collections", money("gross")], ["Refunds", money("refunds")], ["Stripe Fees", money("fees")], ["Net Collections", money("net")],
          ["Successful Payments", report?.collectionsComplete ? report.successful : "—"], ["Active Subscriptions", report?.activeSubscriptions ?? "—"],
          ["Upcoming Billing", report?.subscriptions.filter(s => s.nextAt !== null).length ?? "—"], ["Linked Failures", report?.collectionsComplete ? report.failed : "—"],
        ].map(([label, value]) => <div key={label} className="rounded-md border border-border bg-card p-3 min-w-0"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-2 text-xl font-semibold text-card-foreground tabular-nums break-words">{value}</div></div>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Subscription Collections · {fmtDate(from)} – {fmtDate(to)}</span>
        <span>Paid Payouts: {report?.payouts?.length ? report.payouts.map(p => formatStripeAmount(p.amount, p.currency)).join(" · ") : "—"} · Account-Wide</span>
      </div>
      {report?.warnings.map(w => <p key={w} className="text-xs text-muted-foreground">{w}</p>)}
      {report?.incompletePortions.map(p => <p key={`${p.source}:${p.id}`} className="text-xs text-muted-foreground">Incomplete · {p.source} {p.id} · {p.reason}</p>)}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground mb-3">Customer Collections{report && !report.collectionsComplete ? " · Verified Only" : ""}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-muted-foreground"><tr>{["Customer", "Gross", "Refunds", "Fees", "Net"].map(h => <th key={h} className="py-2 pr-3 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{customers?.map(c => <tr key={`${c.id}:${c.currency}`} className="border-t border-border"><td className="py-3 pr-3 min-w-28">{c.name}</td>{([c.gross, c.refunds, c.fees, c.net]).map((v, i) => <td key={i} className="py-3 pr-3 whitespace-nowrap tabular-nums">{formatStripeAmount(v, c.currency)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {!customers?.length && <p className="py-3 text-xs text-muted-foreground">{report?.collectionsComplete ? "No collections in this range." : "—"}</p>}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground mb-3">Subscriptions</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-muted-foreground"><tr>{["Customer", "Status", "Next Billing", "Base Rate"].map(h => <th key={h} className="py-2 pr-3 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{report?.subscriptions.map(s => <tr key={s.id} className="border-t border-border"><td className="py-3 pr-3 min-w-28">{s.name}</td><td className="py-3 pr-3 whitespace-nowrap">{s.status.split("_").map(w => w[0]?.toUpperCase() + w.slice(1)).join(" ")}{s.cancelAtPeriodEnd ? " · Ending" : ""}</td><td className="py-3 pr-3 whitespace-nowrap">{s.nextAt ? fmtDate(s.nextAt * 1000) : "—"}</td><td className="py-3 whitespace-nowrap tabular-nums">{formatStripeAmount(s.scheduledAmount, s.currency)}</td></tr>)}</tbody>
            </table>
          </div>
          {!report?.subscriptions.length && <p className="py-3 text-xs text-muted-foreground">{report ? "No subscriptions." : "—"}</p>}
        </div>
      </div>
    </section>
  );
}