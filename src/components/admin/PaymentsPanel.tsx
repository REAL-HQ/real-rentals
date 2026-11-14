import { useEffect, useMemo, useState } from "react";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, inputCls } from "./modal";
import { supabase } from "@/integrations/supabase/client";
import type { Payment, Application, Vehicle } from "./types";
import { toast } from "sonner";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, ChevronDown, Check, ListFilter } from "lucide-react";
import { fmtDate as formatDate } from "@/lib/date-format";
import { COLLECTIONS_WATCH_STATUSES } from "@/lib/collections-watch";
import { STRIPE_UNMATCHED_PAYMENTS_ENABLED } from "@/lib/stripe-unmatched-flag";
import { UnmatchedStripePayments } from "./UnmatchedStripePayments";
import { BILLING_DAY_CHANGE_ENABLED, BILLING_ONE_TIME_EXTENSION_ENABLED, BILLING_PM_UPDATE_LINK_ENABLED } from "@/lib/billing-controls-flag";
import { BillingControls } from "./BillingControls";
import type { StaffTier } from "@/lib/roles";
import { OPEN_STATUSES, canTake, type PaymentStatusAction } from "@/lib/payment-status-rules";
import { changePaymentStatus } from "@/lib/payment-status.functions";
import { releaseUnconfirmedPayment } from "@/lib/payment-unconfirmed.functions";
import { chargeCardOnRental } from "@/lib/rental-payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { VehicleCombobox } from "@/components/admin/VehicleCombobox";
import { StripeCollections } from "./StripeCollections";

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
const STATUS_FILTERS = ["all", "overdue", ...STATUSES.filter((status) => status !== "overdue")] as const;
const SORT_OPTIONS = [
  { value: "due_asc", label: "Due Date: Earliest" },
  { value: "due_desc", label: "Due Date: Latest" },
  { value: "amount_desc", label: "Amount: Highest" },
] as const;
const TYPES = ["rent", "deposit", "late_fee", "toll", "damage", "fee", "other"] as const;

// Date-only values (due_date, paid_date) are calendar dates: formatDate reads
// "2026-11-05" as Nov 5. new Date() would read it as UTC midnight, a day early in ET.
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return formatDate(iso) || "—";
}

export function PaymentsPanel({ initialFilter, autoOpenAdd, tier = null }: { initialFilter?: string; autoOpenAdd?: boolean; tier?: StaffTier | null } = {}) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [drivers, setDrivers] = useState<Application[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  // Arriving from the dashboard's Collections card asks for everything
  // unresolved at once, which no single status covers.
  const [statusFilter, setStatusFilter] = useState<string>(initialFilter ?? "all");
  const [sort, setSort] = useState<"due_asc" | "due_desc" | "amount_desc">("due_asc");
  const [showAdd, setShowAdd] = useState(!!autoOpenAdd);
  const [showManual, setShowManual] = useState(false);
  const [paymentsSection, setPaymentsSection] = useState<"ledger" | "stripe">("ledger");

  useEffect(() => {
    supabase
      .from("payments")
      .select("*")
      .then(({ data }) => setPayments(data || []));
    supabase
      .from("applications")
      .select("id,full_name,vehicle_id,weekly_rent")
      .then(({ data }) => setDrivers((data as any) || []));
    supabase
      .from("vehicles")
      .select("*")
      .then(({ data }) => setVehicles((data as any) || []));
  }, []);

  const driverMap = useMemo(() => Object.fromEntries(drivers.map((d) => [d.id, d])), [drivers]);
  const vehicleMap = useMemo(() => Object.fromEntries(vehicles.map((v) => [v.id, v])), [vehicles]);

  // Payment rows are financial history. Every status change goes through changePaymentStatus,
  // which checks who may make it, applies it only if the row still has the status shown here,
  // and records actor, before/after and reason in the audit log. Paid, refunded, waived and void
  // rows are settled and never change here: a refund happens in the Stripe Dashboard.
  async function changeStatus(p: Payment, driverName: string, action: PaymentStatusAction, to?: string) {
    const amount = Number(p.balance_due) > 0 ? Number(p.balance_due) : Number(p.amount ?? 0);
    const money = `$${amount.toLocaleString()}`;
    const confirmText: Record<PaymentStatusAction, string> = {
      set_open_status: `Change this ${money} charge for ${driverName} to ${STATUS_LABEL[to ?? ""] ?? to}?`,
      mark_paid: `Record ${money} from ${driverName} as received outside Stripe (cash, Zelle, check)? This counts as revenue. Never use it for a card charge: Stripe charges are marked paid automatically.`,
      waive: `Waiving forgives ${money} that ${driverName} legitimately owes. It is no longer owed or collected. Continue?`,
      void: `Voiding removes ${money} from what ${driverName} owes. Only void a charge entered in error or replaced by another charge. Continue?`,
    };
    if (!window.confirm(confirmText[action])) return;
    let method: string | null = null;
    if (action === "mark_paid") {
      method = window.prompt("How was it received? (Cash, Zelle, Check...)")?.trim() || null;
      if (!method) return;
    }
    const reason = window.prompt(
      action === "mark_paid" ? "Reference (receipt, Zelle confirmation, who received it). Saved with the payment and in the audit log." : "Why? Saved with the payment and in the audit log.",
    )?.trim();
    if (!reason || reason.length < 3) return void (reason != null && toast.error("A reason of at least 3 characters is required."));
    try {
      const res = await changePaymentStatus({ data: { paymentId: p.id, action, expectedStatus: String(p.status), toStatus: to ?? null, reason, method } });
      if ("error" in res) return toast.error(res.error);
      const { data } = await supabase.from("payments").select("*").eq("id", p.id).maybeSingle();
      if (data) setPayments((list) => list.map((x) => (x.id === p.id ? (data as Payment) : x)));
      toast.success(`${STATUS_LABEL[res.status] ?? res.status}: saved`);
    } catch {
      toast.error("Could not reach the server. Reload Payments before trying again.");
    }
  }
  // A Processing charge Stripe never confirmed: the server checks Stripe and releases it to Failed
  // only if Stripe shows nothing collected and nothing in flight. Owner only; audited.
  async function releaseUnconfirmed(p: Payment, driverName: string) {
    const money = `$${Number(p.amount ?? 0).toLocaleString()}`;
    if (!window.confirm(`Check Stripe for this ${money} charge to ${driverName}? If Stripe shows it was not collected and is not processing, it becomes Failed (still owed) and can be charged again. If Stripe collected it, nothing changes.`)) return;
    const reason = window.prompt("Why? (e.g. the charge timed out and never settled). Saved in the audit log.")?.trim();
    if (!reason || reason.length < 3) return void (reason != null && toast.error("A reason of at least 3 characters is required."));
    try {
      const res = await releaseUnconfirmedPayment({ data: { paymentId: p.id, reason } });
      if ("error" in res) return toast.error(res.error);
      const { data } = await supabase.from("payments").select("*").eq("id", p.id).maybeSingle();
      if (data) setPayments((list) => list.map((x) => (x.id === p.id ? (data as Payment) : x)));
      toast.success(`Stripe shows it was not collected (${res.checked} payments checked). It is now Failed and still owed.`);
    } catch {
      toast.error("Could not reach the server. Nothing was changed.");
    }
  }
  // Owner: collect this existing charge with the card on file (a retry on the same row, never a
  // second charge). The server refuses while any charge on the rental is still Processing.
  async function chargeExisting(p: Payment, driverName: string) {
    const owed = Number(p.balance_due) > 0 ? Number(p.balance_due) : Number(p.amount ?? 0);
    if (!p.rental_id) return toast.error("This charge isn't linked to a rental, so it can't be charged to a card.");
    if (!window.confirm(`Charge $${owed.toLocaleString()} to ${driverName}'s card on file for this charge? Press once.`)) return;
    const reason = ({ rent: "rent", late_fee: "late_fee", toll: "toll", damage: "damage" } as Record<string, string>)[String(p.type)] ?? "other";
    try {
      const res = await chargeCardOnRental({ data: { rentalId: p.rental_id, amountCents: Math.round(owed * 100), reason: reason as any, paymentId: p.id, environment: getStripeEnvironment() } });
      if ("error" in res) toast.error(res.error);
      else if (res.status === "paid") toast.success(`Paid: $${owed.toFixed(2)} collected`);
      else toast.warning(`Charge of $${owed.toFixed(2)} submitted but not confirmed; Payments shows it as Processing. Don't charge again: check the payment in Stripe.`);
    } catch {
      toast.error("Could not reach the server. Check Payments before trying again.");
    }
    const { data } = await supabase.from("payments").select("*").eq("id", p.id).maybeSingle();
    if (data) setPayments((list) => list.map((x) => (x.id === p.id ? (data as Payment) : x)));
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

  const filtered = (
    statusFilter === "all"
      ? payments
      : statusFilter === "overdue"
        ? payments.filter((p) => OVERDUE_SET.has(p.status as string))
        : payments.filter((p) => p.status === statusFilter)
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

  const statusCount = (status: string) => {
    if (status === "all") return payments.length;
    if (status === "overdue") return payments.filter((payment) => OVERDUE_SET.has(payment.status as string)).length;
    return payments.filter((payment) => payment.status === status).length;
  };
  const statusLabel = (status: string) => status === "all" ? "All" : STATUS_LABEL[status] ?? status.replace(/_/g, " ");

  return (
    <div className="max-lg:min-w-0">
      <div className="admin-sticky-bar mb-4 grid grid-cols-1 gap-2 pb-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Select value={paymentsSection} onValueChange={(value) => setPaymentsSection(value as "ledger" | "stripe")}>
            <SelectTrigger aria-label="Payment View" className="h-8 w-36 shrink-0 bg-white text-xs text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ledger">Payments</SelectItem>
              <SelectItem value="stripe">Stripe Collections</SelectItem>
            </SelectContent>
          </Select>
          {paymentsSection === "ledger" ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Payment Filters${statusFilter === "all" ? "" : `: ${statusLabel(statusFilter)}`}`}
                    title="Filter And Sort Payments"
                    className={`inline-flex h-8 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-3 text-xs font-medium text-foreground hover:bg-soft ${statusFilter === "all" ? "border-border" : "border-foreground"}`}
                  >
                    <ListFilter className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Filters{statusFilter === "all" ? "" : `: ${statusLabel(statusFilter)} (${statusCount(statusFilter)})`}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64 bg-white text-foreground">
                  <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Payment Status</DropdownMenuLabel>
                  {STATUS_FILTERS.map((status) => (
                    <DropdownMenuItem
                      key={status}
                      onSelect={() => setStatusFilter(status)}
                      className="flex items-center justify-between gap-3 bg-white text-xs text-foreground focus:bg-muted"
                    >
                      <span>{statusLabel(status)} ({statusCount(status)})</span>
                      {statusFilter === status ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Sort Payments</DropdownMenuLabel>
                  {SORT_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onSelect={() => setSort(option.value)}
                      className="flex items-center justify-between gap-3 bg-white text-xs text-foreground focus:bg-muted"
                    >
                      <span>{option.label}</span>
                      {sort === option.value ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="hidden whitespace-nowrap text-sm text-muted-foreground md:block">
                Outstanding: <span className="font-semibold text-foreground">${totalDue.toLocaleString()}</span>
              </div>
            </>
          ) : null}
        </div>
        {paymentsSection === "ledger" ? (
          <div className="flex shrink-0 items-center gap-2 max-lg:w-full">
            <button
              onClick={() => setShowManual(true)}
              className="ml-auto rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium max-lg:ml-0 max-lg:flex-1"
            >
              Manual Payments
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="rounded-md bg-[#D03020] text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity duration-150 max-lg:flex-1"
            >
              + Add Payment
            </button>
          </div>
        ) : null}
      </div>

      {paymentsSection === "stripe" ? (
        <div className="rounded-2xl border border-[#EDEDF0] bg-white p-4 sm:p-5">
          <StripeCollections />
        </div>
      ) : (
      <>
      {STRIPE_UNMATCHED_PAYMENTS_ENABLED ? <UnmatchedStripePayments /> : null}
      {(BILLING_PM_UPDATE_LINK_ENABLED || BILLING_DAY_CHANGE_ENABLED || BILLING_ONE_TIME_EXTENSION_ENABLED) ? <BillingControls /> : null}

      {showManual && <ManualPaymentsWorkspace payments={payments} driverMap={driverMap} onClose={() => setShowManual(false)} />}
      <AdminTableScroll className="max-lg:min-w-0 rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
        <table className="w-full text-sm max-lg:min-w-[52rem]">
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
                  <td className="px-3 text-[13px] font-medium text-[#111114] max-lg:whitespace-nowrap">{driverName}</td>
                  <td className="px-3 text-xs text-[#55555E] max-lg:whitespace-nowrap">
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
                    {!canTake(tier, "set_open_status", String(p.status)) ? (
                      <StatusPill status={p.status}>{STATUS_LABEL[p.status] ?? p.status.replace(/_/g, " ")}</StatusPill>
                    ) : (
                    <Select
                      value={p.status}
                      onValueChange={(s) => changeStatus(p, driverName, "set_open_status", s)}
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
                        {OPEN_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="text-[13px]">
                            {STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    )}
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
                        {canTake(tier, "mark_paid", String(p.status)) && (
                          <DropdownMenuItem onClick={() => changeStatus(p, driverName, "mark_paid")}>
                            <Check className="w-4 h-4 mr-2" /> Mark as Paid (Received Outside Stripe)
                          </DropdownMenuItem>
                        )}
                        {tier === "owner" && p.rental_id && !p.stripe_invoice_id && p.status !== "upcoming" && OPEN_STATUSES.includes(p.status as any) && (
                          <DropdownMenuItem onClick={() => chargeExisting(p, driverName)}>
                            Charge Card for This Charge
                          </DropdownMenuItem>
                        )}
                        {canTake(tier, "waive", String(p.status)) && (
                          <DropdownMenuItem onClick={() => changeStatus(p, driverName, "waive")}>
                            Waive (Forgive Debt)
                          </DropdownMenuItem>
                        )}
                        {canTake(tier, "void", String(p.status)) && (
                          <DropdownMenuItem
                            className="text-[#D03020] focus:text-[#D03020]"
                            onClick={() => changeStatus(p, driverName, "void")}
                          >
                            Void (Entered In Error)
                          </DropdownMenuItem>
                        )}
                        {(p.status === "paid" || p.status === "refunded") && (
                          <DropdownMenuItem disabled>Refunds Happen in the Stripe Dashboard</DropdownMenuItem>
                        )}
                        {(p.status === "pending") && (
                          <DropdownMenuItem disabled>Processing in Stripe: Check Stripe Before Any Change</DropdownMenuItem>
                        )}
                        {p.status === "pending" && tier === "owner" && (
                          <DropdownMenuItem onClick={() => releaseUnconfirmed(p, driverName)}>
                            Check Stripe and Release (Not Collected)
                          </DropdownMenuItem>
                        )}
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
      </>
      )}
    </div>
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
          <VehicleCombobox
            vehicles={vehicles as any}
            value={form.vehicle_id}
            onChange={(id) => setForm({ ...form, vehicle_id: id })}
            placeholder="Vehicle"
            aria-label="Vehicle"
          />
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
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
                {/* A new charge starts owed. Money received is recorded with Mark as Paid, which is audited. */}
                {OPEN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
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
