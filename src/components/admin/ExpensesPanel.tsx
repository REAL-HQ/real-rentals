import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Plus,
  X,
  Receipt,
  Trash2,
  Paperclip,
  TrendingUp,
  TrendingDown,
  Upload,
  Loader2,
} from "lucide-react";
import { EmptyState, MicroLabel } from "./ui";
import {
  listExpenses,
  createExpense,
  deleteExpense,
  getVehiclePL,
  EXPENSE_CATEGORIES,
  type Expense,
  type VehiclePL,
} from "@/lib/expenses.functions";

// Expenses and per-vehicle P&L.
//
// Two views of the same money: the ledger (what was spent, on what, with the
// receipt attached) and the P&L (whether each car is actually earning). The
// P&L is the one that answers "should I keep this car?", which is why it leads.

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function money2(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type VehicleOption = { id: string; label: string };

/** First and last day of the month, N months back from now. */
function monthRange(monthsBack: number): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

const PERIODS = [
  { id: "1", label: "This month", months: 0 },
  { id: "3", label: "Last 3 months", months: 2 },
  { id: "12", label: "Last 12 months", months: 11 },
  { id: "all", label: "All time", months: -1 },
] as const;

export function ExpensesPanel() {
  const [view, setView] = useState<"pl" | "ledger">("pl");
  const [period, setPeriod] = useState<string>("3");
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);

  const range = useMemo(() => {
    const p = PERIODS.find((x) => x.id === period);
    if (!p || p.months < 0) return { from: null as string | null, to: null as string | null };
    return monthRange(p.months);
  }, [period]);

  useEffect(() => {
    supabase
      .from("vehicles")
      .select("id,year,make,model,license_plate")
      .order("make")
      .then(({ data }) => {
        setVehicles(
          (data ?? []).map((v: any) => ({
            id: v.id,
            label:
              `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() +
              (v.license_plate ? ` · ${v.license_plate}` : ""),
          })),
        );
      });
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Expenses & Profitability</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every cost against every car, and what each one actually earns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {(["pl", "ledger"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-2 text-sm ${view === v ? "bg-[rgba(208,48,32,0.08)] text-[#D03020] font-medium" : "bg-white text-muted-foreground"}`}
              >
                {v === "pl" ? "P&L" : "Ledger"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "pl" ? (
        <ProfitAndLoss from={range.from} to={range.to} />
      ) : (
        <Ledger vehicles={vehicles} from={range.from} to={range.to} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------- P&L

function ProfitAndLoss({ from, to }: { from: string | null; to: string | null }) {
  const load = useServerFn(getVehiclePL);
  const [rows, setRows] = useState<VehiclePL[]>([]);
  const [totals, setTotals] = useState({ revenue: 0, expenses: 0, maintenance: 0, net: 0, days_on_rent: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load({ data: { from, to } })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTotals(res.totals);
      })
      .catch(() => toast.error("Could not load the P&L."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [load, from, to]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!rows.length) {
    return (
      <EmptyState
        icon={<TrendingUp className="w-6 h-6" strokeWidth={1.75} />}
        title="No vehicles yet"
        hint="Add your cars, and this will show what each one earns against what it costs."
      />
    );
  }

  const totalCost = totals.expenses + totals.maintenance;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Revenue collected" value={money(totals.revenue)} tone="good" />
        <Stat label="Costs" value={money(totalCost)} tone="bad" />
        <Stat
          label="Net"
          value={money(totals.net)}
          tone={totals.net >= 0 ? "good" : "bad"}
          emphasis
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-[#FAFAFB] text-left">
            <tr>
              <th className="px-4 py-2.5 font-medium">Vehicle</th>
              <th className="px-4 py-2.5 font-medium text-right">Revenue</th>
              <th className="px-4 py-2.5 font-medium text-right">Expenses</th>
              <th className="px-4 py-2.5 font-medium text-right">Maintenance</th>
              <th className="px-4 py-2.5 font-medium text-right">Net</th>
              <th className="px-4 py-2.5 font-medium text-right">Days rented</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.vehicle_id} className="border-t border-border">
                <td className="px-4 py-3">
                  <span className="font-medium">{r.label}</span>
                  {r.status && (
                    <span className="block text-xs text-muted-foreground capitalize">{r.status}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{money2(r.revenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {money2(r.expenses)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {money2(r.maintenance)}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums font-semibold ${
                    r.net >= 0 ? "text-[#16A34A]" : "text-[#D03020]"
                  }`}
                >
                  {money2(r.net)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {r.days_on_rent}
                  {r.utilization != null && (
                    <span className="block text-xs">{Math.round(r.utilization * 100)}%</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Revenue counts rent actually marked paid — deposits are excluded, since they are held rather than
        earned. Maintenance counts the company's share only, so partner-funded work is not charged against you.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  tone: "good" | "bad";
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${emphasis ? "border-[#D03020]" : "border-border"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "good" ? "text-[#16A34A]" : "text-[#D03020]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- ledger

function Ledger({
  vehicles,
  from,
  to,
}: {
  vehicles: VehicleOption[];
  from: string | null;
  to: string | null;
}) {
  const load = useServerFn(listExpenses);
  const del = useServerFn(deleteExpense);
  const [rows, setRows] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await load({
        data: {
          vehicleId: vehicleFilter === "all" ? undefined : vehicleFilter,
          category: categoryFilter,
          from: from ?? undefined,
          to: to ?? undefined,
        },
      });
      setRows(res);
    } catch {
      toast.error("Could not load expenses.");
    } finally {
      setLoading(false);
    }
  }, [load, vehicleFilter, categoryFilter, from, to]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  async function onDelete(r: Expense) {
    if (!confirm(`Delete this ${r.category} expense of ${money2(r.amount)}?\n\n${r.description}`)) return;
    await del({ data: { id: r.id } });
    toast.success("Deleted");
    void refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="all">All vehicles</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="all">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {rows.length} item(s) · {money2(total)}
        </span>
        <button
          onClick={() => setShowForm(true)}
          disabled={vehicles.length === 0}
          title={vehicles.length === 0 ? "Add a vehicle first" : undefined}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-real-red text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Record Expense
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Receipt className="w-6 h-6" strokeWidth={1.75} />}
          title="No expenses recorded"
          hint="Log registration, insurance, repairs, cleaning and anything else a car costs — attach the receipt while you have it."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-left">
              <tr>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Vehicle</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                <th className="px-4 py-2.5 font-medium">Receipt</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {new Date(r.incurred_on + "T00:00:00").toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">{r.vehicle_label}</td>
                  <td className="px-4 py-3 capitalize">
                    {EXPENSE_CATEGORIES.find((c) => c.value === r.category)?.label ?? r.category}
                  </td>
                  <td className="px-4 py-3">
                    {r.description}
                    {r.vendor_name && (
                      <span className="block text-xs text-muted-foreground">{r.vendor_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{money2(r.amount)}</td>
                  <td className="px-4 py-3">
                    {r.receipt_url ? (
                      <a
                        href={r.receipt_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#D03020] underline"
                      >
                        <Paperclip className="w-3.5 h-3.5" /> View
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => onDelete(r)} className="text-muted-foreground hover:text-[#D03020]">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ExpenseForm
          vehicles={vehicles}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ form

function ExpenseForm({
  vehicles,
  onClose,
  onSaved,
}: {
  vehicles: VehicleOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(createExpense);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [category, setCategory] = useState("maintenance");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [incurredOn, setIncurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);

  const [receipt, setReceipt] = useState<{ path: string; name: string; mime: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleReceipt(file: File) {
    if (file.size > 10 * 1024 * 1024) return toast.error("Receipt must be under 10MB.");
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      // Same shape as every other upload in the app: unique key, never an
      // overwrite, so two receipts in the same second cannot collide.
      const path = `${vehicleId || "unassigned"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("receipts")
        .upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;
      setReceipt({ path, name: file.name, mime: file.type || "application/octet-stream" });
      toast.success("Receipt attached");
    } catch (e: any) {
      console.error("[receipt] upload failed", e);
      toast.error("Could not upload that receipt. Check you have Manager access.");
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!vehicleId) return toast.error("Pick a vehicle");
    if (!description.trim()) return toast.error("Add a description");
    if (!Number.isFinite(amt) || amt < 0) return toast.error("Enter a valid amount");

    setSaving(true);
    try {
      const res = await save({
        data: {
          vehicleId,
          category: category as any,
          description: description.trim(),
          amount: amt,
          incurredOn,
          reference: reference.trim() || null,
          paymentMethod: paymentMethod.trim() || null,
          notes: notes.trim() || null,
          isRecurring,
          receiptPath: receipt?.path ?? null,
          receiptName: receipt?.name ?? null,
          receiptMime: receipt?.mime ?? null,
        },
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Expense recorded");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Expenses are Manager-only." : "Could not save the expense.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <form onSubmit={submit} className="bg-white rounded-xl p-6 max-w-lg w-full space-y-3 my-8">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Record an expense</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Vehicle" full>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Amount ($)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Description" full>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Annual tag renewal"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Date">
            <input
              type="date"
              value={incurredOn}
              onChange={(e) => setIncurredOn(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Invoice / reference">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Paid with">
            <input
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              placeholder="Card, ACH, cash…"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Notes" full>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
          This repeats (insurance, finance payment)
        </label>

        <div>
          <MicroLabel>Receipt</MicroLabel>
          <label className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground cursor-pointer hover:border-[#D03020]">
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
              </>
            ) : receipt ? (
              <>
                <Paperclip className="w-4 h-4" /> {receipt.name} — tap to replace
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" /> Attach a photo or PDF
              </>
            )}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleReceipt(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        <button
          disabled={saving || uploading}
          className="w-full rounded-lg bg-real-red text-white py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save expense"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}
