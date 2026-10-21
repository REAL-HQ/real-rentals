import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, inputCls } from "./modal";
import { supabase } from "@/integrations/supabase/client";
import type { Payment, Application, Vehicle } from "./types";
import { toast } from "sonner";
import { StripeCollections } from "./StripeCollections";
import { getStripeCollections } from "@/lib/stripe-collections.functions";
import { stripeCollectionsQuery } from "@/lib/stripe-collections-query";
import { resolveRange, type DayRange } from "@/lib/date-range";
import {
  DEDUPE_RULE,
  SOURCE_FILTERS,
  SOURCE_LABEL,
  SOURCE_MAPPING_GAPS,
  classifyPaymentSource,
  readEveryPage,
  summarizePayments,
  type DepositRentalFact,
  type Metric,
  type RefundLink,
  type SourceFilter,
} from "@/lib/payment-reporting";
import { rangeMessage } from "@/lib/eastern-day";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AdminTableScroll } from "./AdminTableScroll";
import { ManualPaymentsWorkspace } from "./ManualPaymentsWorkspace";
import { StatusPill, EmptyState } from "./ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, ChevronDown, Check } from "lucide-react";
import { fmtDate as formatDate } from "@/lib/date-format";
import { COLLECTIONS_WATCH_STATUSES } from "@/lib/collections-watch";

const STATUSES = [
  "upcoming",
  "pending",
  "current",
  "paid",
  "overdue",
  "past_due",
  "failed",
  "unpaid",
  "collections",
  "refunded",
  "waived",
] as const;
/** Everything the dashboard's Collections card counts: due and not received. */
const OVERDUE_SET = new Set<string>(COLLECTIONS_WATCH_STATUSES);
const STATUS_LABEL: Record<string, string> = {
  upcoming: "Upcoming",
  pending: "Processing",
  current: "Due",
  paid: "Paid",
  overdue: "Overdue",
  past_due: "Past Due",
  failed: "Failed",
  unpaid: "Unpaid",
  collections: "In Collections",
  refunded: "Refunded",
  waived: "Waived",
  void: "Void",
  late: "Late",
};
const TYPES = ["rent", "deposit", "late_fee", "toll", "damage", "fee", "other"] as const;

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDate(d);
}

export function PaymentsPanel({
  initialFilter,
  autoOpenAdd,
  initialRange,
  canSeeCollections = false,
}: {
  initialFilter?: string;
  autoOpenAdd?: boolean;
  initialRange?: DayRange;
  canSeeCollections?: boolean;
} = {}) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [drivers, setDrivers] = useState<Application[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [source, setSource] = useState<SourceFilter>("all");
  const [range, setRange] = useState<DayRange>(() => initialRange ?? resolveRange("last_30"));
  const [refundLinks, setRefundLinks] = useState<RefundLink[] | null>([]);
  const [depositRentals, setDepositRentals] = useState<DepositRentalFact[] | null>(null);
  const [extras, setExtras] = useState<"loading" | "ready" | "failed">("loading");
  const [readsComplete, setReadsComplete] = useState(true);
  // Arriving from the dashboard's Collections card asks for everything
  // unresolved at once, which no single status covers.
  const [statusFilter, setStatusFilter] = useState<string>(initialFilter ?? "all");
  const [sort, setSort] = useState<"due_asc" | "due_desc" | "amount_desc">("due_asc");
  const [showAdd, setShowAdd] = useState(!!autoOpenAdd);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    let live = true;
    supabase
      .from("applications")
      .select("id,full_name,vehicle_id,weekly_rent")
      .then(({ data }) => { if (live) setDrivers((data as any) || []); });
    supabase
      .from("vehicles")
      .select("*")
      .then(({ data }) => { if (live) setVehicles((data as any) || []); });
    (async () => {
      const [paymentPage, refundPage, rentalPage] = await Promise.all([
        readEveryPage<Payment>((from, to) =>
          supabase.from("payments").select("*", { count: "exact" }).order("id", { ascending: true }).range(from, to),
        ),
        readEveryPage<RefundLink>((from, to) =>
          supabase.from("payment_refunds").select("stripe_charge_id,stripe_payment_intent_id,payment_ids", { count: "exact" }).order("id", { ascending: true }).range(from, to),
        ),
        readEveryPage<DepositRentalFact>((from, to) =>
          supabase.from("rentals").select("id,deposit_amount,deposit_held,deposit_status", { count: "exact" }).order("id", { ascending: true }).range(from, to),
        ),
      ]);
      if (!live) return;
      setPayments(paymentPage.rows);
      setRefundLinks(refundPage.complete ? refundPage.rows : null);
      setDepositRentals(rentalPage.complete ? rentalPage.rows : null);
      setReadsComplete(paymentPage.complete && refundPage.complete && rentalPage.complete);
      setExtras(paymentPage.rows.length || paymentPage.complete ? "ready" : "failed");
    })().catch(() => {
      if (!live) return;
      setExtras("failed");
      setReadsComplete(false);
      setRefundLinks(null);
    });
    return () => { live = false; };
  }, []);

  const driverMap = useMemo(() => Object.fromEntries(drivers.map((d) => [d.id, d])), [drivers]);
  const vehicleMap = useMemo(() => Object.fromEntries(vehicles.map((v) => [v.id, v])), [vehicles]);

  async function update(id: string, patch: Partial<Payment>) {
    const { error } = await supabase.from("payments").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setPayments((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  async function remove(id: string) {
    if (!confirm("Delete payment?")) return;
    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setPayments((p) => p.filter((x) => x.id !== id));
  }
  async function add(p: Partial<Payment>) {
    const { data, error } = await supabase
      .from("payments")
      .insert(p as any)
      .select()
      .single();
    if (error) return toast.error(error.message);
    setPayments((cur) => [data as Payment, ...cur]);
    setShowAdd(false);
  }

  const sourced = source === "all" ? payments : payments.filter((p) => classifyPaymentSource(p) === source);
  const loadCollections = useServerFn(getStripeCollections);
  const stripeQuery = useQuery(stripeCollectionsQuery(loadCollections, "live", range.from, range.to, canSeeCollections && (source === "all" || source === "stripe")));
  const rangeProblem = rangeMessage(range);
  const summary = useMemo(() => {
    if (rangeProblem) {
      return summarizePayments({
        payments: [],
        refundLinks: [],
        stripe: { status: "hidden", collectionsComplete: false, totals: null, charges: [] },
        deposits: null,
        source,
        range,
      });
    }
    if (extras === "loading") return null;
    const stripe = !canSeeCollections
      ? { status: "hidden" as const, collectionsComplete: false, totals: null, charges: [] }
      : stripeQuery.isError
        ? { status: "error" as const, collectionsComplete: false, totals: null, charges: [] }
        : stripeQuery.data
          ? {
              status: "ready" as const,
              collectionsComplete: stripeQuery.data.collectionsComplete,
              totals: stripeQuery.data.totals,
              charges: stripeQuery.data.verifiedCollections.charges,
            }
          : { status: "loading" as const, collectionsComplete: false, totals: null, charges: [] };
    return summarizePayments({
      payments,
      refundLinks: extras === "failed" ? null : refundLinks,
      stripe,
      deposits: extras === "ready" && depositRentals ? { rentals: depositRentals, payments } : null,
      source,
      range,
      truncated: !readsComplete || extras === "failed",
    });
  }, [rangeProblem, extras, readsComplete, canSeeCollections, stripeQuery.isError, stripeQuery.data, payments, refundLinks, depositRentals, source, range]);
  const stripeTagged = sourced.filter((p) => p.stripe_payment_intent_id || p.stripe_invoice_id || p.stripe_subscription_id);

  const filtered = (
    statusFilter === "all"
      ? sourced
      : statusFilter === "overdue"
        ? sourced.filter((p) => OVERDUE_SET.has(p.status as string))
        : sourced.filter((p) => p.status === statusFilter)
  )
    .slice()
    .sort((a, b) => {
      if (sort === "amount_desc") return Number(b.amount) - Number(a.amount);
      const ad = a.due_date || "9999";
      const bd = b.due_date || "9999";
      return sort === "due_asc" ? ad.localeCompare(bd) : bd.localeCompare(ad);
    });

  // Owed now: due/unpaid states only. Upcoming isn't due yet; paid, refunded,
  // waived and void owe nothing. A settled balance of 0 is 0, not the amount.
  const OWED = new Set(["pending", "current", "late", "overdue", "past_due", "failed", "unpaid", "collections"]);
  const totalDue = filtered
    .filter((p) => OWED.has(p.status as string))
    .reduce((s, p) => s + (p.balance_due == null ? Number(p.amount || 0) : Number(p.balance_due)), 0);

  return (
    <div>
      <div className="admin-sticky-bar flex flex-wrap items-center gap-2 mb-4 pb-2">
        <div className="flex flex-wrap gap-2 text-xs">
          {SOURCE_FILTERS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={source === id}
              onClick={() => setSource(id)}
              className={`px-3 py-1.5 rounded-md ${source === id ? "bg-black text-white" : "bg-white border border-border"}`}
            >
              {SOURCE_LABEL[id]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {(["all", "overdue", ...STATUSES.filter((x) => x !== "overdue")] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md capitalize ${statusFilter === s ? "bg-black text-white" : "bg-white border border-border"}`}
            >
              {s.replace(/_/g, " ")}{" "}
              {s !== "all" &&
                `(${
                  s === "overdue"
                    ? sourced.filter((p) => OVERDUE_SET.has(p.status as string)).length
                    : sourced.filter((p) => p.status === s).length
                })`}
            </button>
          ))}
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as any)}>
          <SelectTrigger className="h-8 w-40 bg-white text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="due_asc">Due date ↑</SelectItem>
            <SelectItem value="due_desc">Due date ↓</SelectItem>
            <SelectItem value="amount_desc">Amount ↓</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">
          Outstanding:{" "}
          <span className="font-semibold text-foreground">${totalDue.toLocaleString()}</span>
        </div>
        <button
          onClick={() => setShowManual(true)}
          className="ml-auto rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium"
        >
          Manual Payments
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className=" rounded-md bg-[#D03020] text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity duration-150"
        >
          + Add Payment
        </button>
      </div>

      {rangeProblem && <p role="alert" className="mb-3 text-sm text-[#CC0000]">{rangeProblem}</p>}
      {!readsComplete && extras !== "loading" && (
        <p role="status" className="mb-3 text-sm text-[#CC0000]">The payment read stopped before the last row, so no total is shown.</p>
      )}
      <PaymentSummaryBar
        summary={summary}
        range={range}
        onRange={setRange}
        source={source}
        duplicateCount={summary?.duplicateIds.length ?? 0}
      />
      {summary && summary.unmatched.length > 0 && (
        <section className="mb-4 rounded-2xl border border-[#EDEDF0] bg-white p-4 text-sm">
          <h2 className="font-semibold">Unmatched Payments</h2>
          <p className="mt-1 text-muted-foreground">These rows are not in the combined total. No amount was used to guess a match.</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {summary.unmatched.map((row) => (
              <li key={row.id}>
                {row.payment_method || "No method"} · {row.amount === null ? "Amount unavailable" : `$${row.amount.toLocaleString()}`} · {row.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
      {source !== "all" && source !== "stripe" && (
        <section className="mb-4 rounded-2xl border border-[#EDEDF0] bg-white p-4 text-sm">
          <h2 className="font-semibold">Reconciliation</h2>
          <p className="mt-1 text-muted-foreground">{DEDUPE_RULE}</p>
          <p className="mt-2">
            {sourced.length} recorded {SOURCE_LABEL[source]} {sourced.length === 1 ? "transaction" : "transactions"}.{" "}
            {stripeTagged.length} also {stripeTagged.length === 1 ? "has" : "have"} a Stripe payment intent, invoice, or subscription id.
          </p>
          {stripeTagged.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {stripeTagged.slice(0, 8).map((p) => (
                <li key={p.id}>
                  {p.stripe_payment_intent_id || p.stripe_invoice_id || p.stripe_subscription_id} · {p.status} · ${Number(p.amount).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {source === "stripe" && canSeeCollections && (
        <div className="mb-4">
          <StripeCollections from={range.from} to={range.to} hideRange />
        </div>
      )}
      {source === "stripe" && !canSeeCollections && (
        <p className="mb-4 text-sm text-muted-foreground">Verified Stripe collections are Manager only. Recorded Stripe payments are listed below.</p>
      )}
      <details className="mb-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Source Mapping</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {SOURCE_MAPPING_GAPS.map((gap) => <li key={gap}>{gap}</li>)}
        </ul>
      </details>
      {showManual && <ManualPaymentsWorkspace payments={payments} driverMap={driverMap} onClose={() => setShowManual(false)} />}
      <AdminTableScroll className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-[#FAFAFB] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3]">
            <tr>
              <th className="text-left px-3 py-2.5">Driver</th>
              <th className="text-left px-3 py-2.5">Vehicle</th>
              <th className="text-left px-3 py-2.5">Type</th>
              <th className="text-right px-3 py-2.5">Amount</th>
              <th className="text-left px-3 py-2.5">Due</th>
              <th className="text-left px-3 py-2.5">Status</th>
              <th className="text-left px-3 py-2.5">Method</th>
              <th className="text-right px-3 py-2.5">Late Fees</th>
              <th className="text-right px-3 py-2.5">Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const d = p.driver_id ? driverMap[p.driver_id] : null;
              const v = p.vehicle_id ? vehicleMap[p.vehicle_id] : null;
              const driverName = d?.full_name || (p.driver_id ? "Unnamed driver" : "—");
              const lateFees = Number(p.late_fees || 0);
              return (
                <tr
                  key={p.id}
                  className="border-t border-[#EDEDF0] h-11 hover:bg-[#FAFAFB] transition-colors duration-150"
                >
                  <td className="px-3 text-[13px] font-medium text-[#111114]">{driverName}</td>
                  <td className="px-3 text-xs text-[#55555E]">
                    {v ? `${v.year} ${v.make} ${v.model}` : "—"}
                  </td>
                  <td className="px-3 capitalize text-[13px]">{p.type.replace(/_/g, " ")}</td>
                  <td className="px-3 text-right tabular-nums text-[13px]">
                    ${Number(p.amount).toLocaleString()}
                  </td>
                  <td className="px-3 text-[13px] text-[#55555E] tabular-nums">
                    {fmtDate(p.due_date)}
                  </td>
                  <td className="px-3">
                    <Select
                      value={p.status}
                      onValueChange={(s) =>
                        update(p.id, {
                          status: s,
                          paid_date: s === "paid" ? new Date().toISOString().slice(0, 10) : null,
                        })
                      }
                    >
                      <SelectTrigger className="h-7 w-auto border-0 bg-transparent p-0 shadow-none hover:opacity-80 focus:ring-0 [&>svg]:hidden">
                        <span className="inline-flex items-center gap-1">
                          <StatusPill status={p.status}>
                            {STATUS_LABEL[p.status] ?? p.status.replace(/_/g, " ")}
                          </StatusPill>
                          <ChevronDown className="w-3 h-3 text-[#9A9AA3]" />
                        </span>
                      </SelectTrigger>
                      <SelectContent align="start" className="min-w-[11rem]">
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="text-[13px]">
                            {STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 text-[13px]">{p.payment_method || "—"}</td>
                  <td
                    className={`px-3 text-right tabular-nums text-[13px] ${lateFees > 0 ? "text-[#D03020] font-medium" : "text-[#9A9AA3]"}`}
                  >
                    ${lateFees.toLocaleString()}
                  </td>
                  <td className="px-3 text-right tabular-nums text-[13px]">
                    ${Number(p.balance_due).toLocaleString()}
                  </td>
                  <td className="px-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-[#F4F4F6] text-[#9A9AA3]">
                        <MoreVertical className="w-4 h-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            update(p.id, {
                              status: "paid",
                              paid_date: new Date().toISOString().slice(0, 10),
                            })
                          }
                        >
                          <Check className="w-4 h-4 mr-2" /> Mark as Paid
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => update(p.id, { status: "waived" })}>
                          Waive
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-[#D03020] focus:text-[#D03020]"
                          onClick={() => remove(p.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="p-4">
                  <EmptyState
                    title="No Payments Yet"
                    hint="Payments appear here once a driver is charged or a rental invoice is created."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </AdminTableScroll>

      {showAdd && (
        <AddPayment
          drivers={drivers}
          vehicles={vehicles}
          onClose={() => setShowAdd(false)}
          onSave={add}
        />
      )}
    </div>
  );
}

function metricText(metric: Metric) {
  if (metric.amount === null) return "Unavailable";
  return metric.amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function PaymentSummaryBar({
  summary,
  range,
  onRange,
  source,
  duplicateCount,
}: {
  summary: ReturnType<typeof summarizePayments> | null;
  range: DayRange;
  onRange: (range: DayRange) => void;
  source: SourceFilter;
  duplicateCount: number;
}) {
  const tiles: { label: string; metric: Metric }[] = summary
    ? [
        { label: "Gross Collected", metric: summary.grossCollected },
        { label: "Net Collected", metric: summary.netCollected },
        { label: "Outstanding Balances", metric: summary.outstanding },
        { label: "Refunds", metric: summary.refunds },
        { label: "Deposits Held", metric: summary.depositsHeld },
        { label: "Processing Fees", metric: summary.fees },
      ]
    : [];
  return (
    <section aria-label="Payment Summary" className="mb-4 rounded-2xl border border-[#EDEDF0] bg-white p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Summary · {SOURCE_LABEL[source]}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary ? `${summary.coverage}. ${summary.coverageReason}` : "Loading summary…"}
            {duplicateCount > 0 ? ` ${duplicateCount} recorded ${duplicateCount === 1 ? "payment matches" : "payments match"} a verified Stripe charge and ${duplicateCount === 1 ? "is" : "are"} not added again.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <label>From <input aria-label="Summary From" type="date" value={range.from} onChange={(e) => onRange({ ...range, from: e.target.value })} className="h-8 rounded-md border border-input bg-background px-2 text-foreground" /></label>
          <label>To <input aria-label="Summary To" type="date" value={range.to} onChange={(e) => onRange({ ...range, to: e.target.value })} className="h-8 rounded-md border border-input bg-background px-2 text-foreground" /></label>
        </div>
      </div>
      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-md border border-border p-3" title={tile.metric.reason ?? undefined}>
              <div className="text-xs text-muted-foreground">{tile.label}</div>
              <div className={`mt-2 text-xl font-semibold tabular-nums ${tile.metric.amount === null ? "text-muted-foreground" : tile.metric.amount < 0 ? "text-[#CC0000]" : ""}`}>{metricText(tile.metric)}</div>
              {tile.metric.reason && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{tile.metric.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AddPayment({
  drivers,
  vehicles,
  onClose,
  onSave,
}: {
  drivers: Application[];
  vehicles: Vehicle[];
  onClose: () => void;
  onSave: (p: Partial<Payment>) => void;
}) {
  const [form, setForm] = useState<Partial<Payment>>({
    type: "rent",
    status: "current",
    amount: 0,
    due_date: new Date().toISOString().slice(0, 10),
  });
  return (
    <ModalShell onClose={onClose} size="md" label="Add Payment">
      <ModalHeader title="Add Payment" onClose={onClose} />
      <ModalBody>
        <div className="space-y-4 text-sm">
          <Select
            value={form.driver_id || "none"}
            onValueChange={(v) => {
              const d = drivers.find((x) => x.id === v);
              setForm({
                ...form,
                driver_id: v === "none" ? null : v,
                vehicle_id: d?.vehicle_id || form.vehicle_id,
                amount: form.amount || d?.weekly_rent || 0,
              });
            }}
          >
            <SelectTrigger className="bg-white text-foreground">
              <SelectValue placeholder="Driver" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={form.vehicle_id || "none"}
            onValueChange={(v) => setForm({ ...form, vehicle_id: v === "none" ? null : v })}
          >
            <SelectTrigger className="bg-white text-foreground">
              <SelectValue placeholder="Vehicle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.year} {v.make} {v.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger className="bg-white text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-white text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              Amount
              <input
                type="number"
                value={form.amount as any}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                className={`${inputCls} mt-1.5`}
              />
            </label>
            <label className="text-xs">
              Due date
              <input
                type="date"
                value={form.due_date || ""}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className={`${inputCls} mt-1.5`}
              />
            </label>
          </div>
          <input
            placeholder="Payment method (e.g. Card, ACH)"
            value={form.payment_method || ""}
            onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            className={inputCls}
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" onClick={() => onSave(form)}>Add Payment</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}
