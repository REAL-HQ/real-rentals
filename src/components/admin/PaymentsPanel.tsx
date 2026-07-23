import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Payment, Application, Vehicle } from "./types";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "./ui";

const STATUSES = ["paid","current","late","past_due","collections"] as const;
const TYPES = ["rent","deposit","late_fee","other"] as const;
const statusBadge: Record<string,string> = {
  paid: "bg-green-100 text-green-800",
  current: "bg-blue-100 text-blue-800",
  late: "bg-amber-100 text-amber-800",
  past_due: "bg-orange-100 text-orange-800",
  collections: "bg-red-100 text-red-800",
};

export function PaymentsPanel() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [drivers, setDrivers] = useState<Application[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<"due_asc" | "due_desc" | "amount_desc">("due_asc");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    supabase.from("payments").select("*").then(({ data }) => setPayments(data || []));
    supabase.from("applications").select("id,full_name,vehicle_id,weekly_rent").then(({ data }) => setDrivers((data as any) || []));
    supabase.from("vehicles").select("*").then(({ data }) => setVehicles((data as any) || []));
  }, []);

  const driverMap = useMemo(() => Object.fromEntries(drivers.map(d => [d.id, d])), [drivers]);
  const vehicleMap = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, v])), [vehicles]);

  async function update(id: string, patch: Partial<Payment>) {
    const { error } = await supabase.from("payments").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setPayments(p => p.map(x => x.id === id ? { ...x, ...patch } : x));
  }
  async function remove(id: string) {
    if (!confirm("Delete payment?")) return;
    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setPayments(p => p.filter(x => x.id !== id));
  }
  async function add(p: Partial<Payment>) {
    const { data, error } = await supabase.from("payments").insert(p as any).select().single();
    if (error) return toast.error(error.message);
    setPayments(cur => [data as Payment, ...cur]);
    setShowAdd(false);
  }

  const filtered = (statusFilter === "all" ? payments : payments.filter(p => p.status === statusFilter)).slice().sort((a, b) => {
    if (sort === "amount_desc") return Number(b.amount) - Number(a.amount);
    const ad = a.due_date || "9999"; const bd = b.due_date || "9999";
    return sort === "due_asc" ? ad.localeCompare(bd) : bd.localeCompare(ad);
  });

  const totalDue = filtered.filter(p => p.status !== "paid").reduce((s, p) => s + Number(p.balance_due || p.amount || 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {(["all", ...STATUSES] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-md capitalize ${statusFilter === s ? "bg-black text-white" : "bg-white border border-border"}`}>
              {s.replace(/_/g, " ")} {s !== "all" && `(${payments.filter(p => p.status === s).length})`}
            </button>
          ))}
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as any)}>
          <SelectTrigger className="h-8 w-40 bg-white text-foreground"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="due_asc">Due date ↑</SelectItem>
            <SelectItem value="due_desc">Due date ↓</SelectItem>
            <SelectItem value="amount_desc">Amount ↓</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">Outstanding: <span className="font-semibold text-foreground">${totalDue.toLocaleString()}</span></div>
        <button onClick={() => setShowAdd(true)} className="ml-auto rounded-md bg-[#CC0000] text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity duration-150">+ Add Payment</button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
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
            {filtered.map(p => {
              const d = p.driver_id ? driverMap[p.driver_id] : null;
              const v = p.vehicle_id ? vehicleMap[p.vehicle_id] : null;
              return (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2">{d?.full_name || "—"}</td>
                  <td className="px-3 py-2 text-xs">{v ? `${v.year} ${v.make} ${v.model}` : "—"}</td>
                  <td className="px-3 py-2 capitalize">{p.type.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-right">${Number(p.amount).toLocaleString()}</td>
                  <td className="px-3 py-2">{p.due_date || "—"}</td>
                  <td className="px-3 py-2">
                    <Select value={p.status} onValueChange={(s) => update(p.id, { status: s, paid_date: s === "paid" ? new Date().toISOString().slice(0,10) : null })}>
                      <SelectTrigger className={`h-7 w-32 bg-white text-foreground text-xs`}><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                    </Select>
                    <span className={`hidden text-[10px] px-2 py-0.5 rounded-full ${statusBadge[p.status]}`}>{p.status}</span>
                  </td>
                  <td className="px-3 py-2">{p.payment_method || "—"}</td>
                  <td className="px-3 py-2 text-right">${Number(p.late_fees).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">${Number(p.balance_due).toLocaleString()}</td>
                  <td className="px-3 py-2"><button onClick={() => remove(p.id)} className="text-xs text-muted-foreground hover:text-real-red">✕</button></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground text-sm">No payments.</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && <AddPayment drivers={drivers} vehicles={vehicles} onClose={() => setShowAdd(false)} onSave={add} />}
    </div>
  );
}

function AddPayment({ drivers, vehicles, onClose, onSave }: {
  drivers: Application[]; vehicles: Vehicle[]; onClose: () => void; onSave: (p: Partial<Payment>) => void;
}) {
  const [form, setForm] = useState<Partial<Payment>>({ type: "rent", status: "current", amount: 0, due_date: new Date().toISOString().slice(0,10) });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Add payment</h2>
        <div className="space-y-3 text-sm">
          <Select value={form.driver_id || "none"} onValueChange={(v) => {
            const d = drivers.find(x => x.id === v);
            setForm({ ...form, driver_id: v === "none" ? null : v, vehicle_id: d?.vehicle_id || form.vehicle_id, amount: form.amount || d?.weekly_rent || 0 });
          }}>
            <SelectTrigger className="bg-white text-foreground"><SelectValue placeholder="Driver" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={form.vehicle_id || "none"} onValueChange={(v) => setForm({ ...form, vehicle_id: v === "none" ? null : v })}>
            <SelectTrigger className="bg-white text-foreground"><SelectValue placeholder="Vehicle" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.year} {v.make} {v.model}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger className="bg-white text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-white text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Amount<input type="number" value={form.amount as any} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} className="w-full bg-soft rounded-md px-3 py-2 mt-1" /></label>
            <label className="text-xs">Due date<input type="date" value={form.due_date || ""} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="w-full bg-soft rounded-md px-3 py-2 mt-1" /></label>
          </div>
          <input placeholder="Payment method (e.g. Card, ACH)" value={form.payment_method || ""} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} className="w-full bg-soft rounded-md px-3 py-2" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button onClick={() => onSave(form)} className="rounded-md bg-real-red text-white px-4 py-2 text-sm">Add</button>
        </div>
      </div>
    </div>
  );
}