import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wrench, Plus, X, AlertTriangle, Clock, Gauge, Check } from "lucide-react";
import { StatusPill, EmptyState } from "./ui";

type Row = {
  id: string;
  vehicle_id: string;
  item: string;
  category: string;
  status: string;
  due_date: string | null;
  total_cost: number;
  notes: string | null;
  created_at: string;
};

type VehicleLite = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  status: string | null;
  current_odometer: number | null;
  last_oil_change_miles: number | null;
  oil_interval_miles: number | null;
  last_tire_date: string | null;
  last_brake_inspection_date: string | null;
};

function monthsSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 30.44);
}

export function computeDueReasons(v: VehicleLite): string[] {
  const reasons: string[] = [];
  const cur = v.current_odometer ?? null;
  const last = v.last_oil_change_miles ?? null;
  const interval = v.oil_interval_miles ?? 5000;
  // Guardrail: only count as Due when real interval data exists.
  if (cur != null && cur > 0 && last != null && cur - last >= interval) {
    reasons.push(`Oil change (+${(cur - last).toLocaleString()} mi)`);
  }
  if (v.last_tire_date) {
    const tireMonths = monthsSince(v.last_tire_date);
    if (tireMonths != null && tireMonths >= 12) reasons.push("Tires 12+ mo");
  }
  if (v.last_brake_inspection_date) {
    const brakeMonths = monthsSince(v.last_brake_inspection_date);
    if (brakeMonths != null && brakeMonths >= 12) reasons.push("Brake inspection 12+ mo");
  }
  return reasons;
}

export function needsOdometer(v: VehicleLite): boolean {
  return v.current_odometer == null || v.current_odometer <= 0;
}

export function MaintenancePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<VehicleLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [odoDrafts, setOdoDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [m, v] = await Promise.all([
      supabase.from("maintenance_records").select("*").order("created_at", { ascending: false }),
      supabase.from("vehicles")
        .select("id, year, make, model, status, current_odometer, last_oil_change_miles, oil_interval_miles, last_tire_date, last_brake_inspection_date")
        .order("created_at", { ascending: false }),
    ]);
    if (m.error) toast.error(m.error.message);
    setRows((m.data as any) ?? []);
    setVehicles((v.data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const downVehicles = vehicles.filter((v) => v.status === "maintenance");
  const dueVehicles = vehicles
    .filter((v) => v.status !== "maintenance")
    .map((v) => ({ v, reasons: computeDueReasons(v) }))
    .filter((x) => x.reasons.length > 0);
  const needsOdoVehicles = vehicles.filter(
    (v) => v.status !== "maintenance" && needsOdometer(v),
  );

  let filtered = rows;
  if (statusFilter === "scheduled") filtered = rows.filter((r) => r.status === "scheduled");
  else if (statusFilter === "in_shop") filtered = rows.filter((r) => r.status === "in_progress");
  else if (statusFilter === "down" || statusFilter === "due" || statusFilter === "needs_odo") filtered = [];
  const vName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() : id.slice(0, 8);
  };

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase.from("maintenance_records").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Updated");
    load();
  }

  async function saveOdometer(vehicleId: string) {
    const raw = odoDrafts[vehicleId];
    const val = Number(String(raw ?? "").replace(/[^\d]/g, ""));
    if (!val || val <= 0) return toast.error("Enter a valid odometer");
    setSavingId(vehicleId);
    const { error } = await supabase
      .from("vehicles")
      .update({ current_odometer: val })
      .eq("id", vehicleId);
    setSavingId(null);
    if (error) return toast.error(error.message);
    toast.success("Odometer saved");
    setOdoDrafts((d) => { const n = { ...d }; delete n[vehicleId]; return n; });
    load();
  }

  return (
    <div className="space-y-4">
      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2 text-xs">
        {[
          { id: "all", label: "All", count: rows.length + downVehicles.length + dueVehicles.length },
          { id: "down", label: "Down", count: downVehicles.length },
          { id: "due", label: "Due", count: dueVehicles.length },
          { id: "needs_odo", label: "Needs Odometer", count: needsOdoVehicles.length },
          { id: "scheduled", label: "Scheduled", count: rows.filter((r) => r.status === "scheduled").length },
          { id: "in_shop", label: "In Shop", count: rows.filter((r) => r.status === "in_progress").length },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setStatusFilter(s.id)}
            className={`px-3 py-1.5 rounded-md border transition-colors ${
              statusFilter === s.id ? "bg-black text-white border-black" : "bg-white border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
            }`}
          >
            {s.label} <span className="opacity-70">({s.count})</span>
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={() => setBulkMode((b) => !b)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors ${
              bulkMode ? "bg-black text-white border-black" : "bg-white border-[#EDEDF0] text-[#55555E] hover:border-[#D6D6DB]"
            }`}
          >
            <Gauge className="w-3.5 h-3.5" /> {bulkMode ? "Done" : "Log Odometer"}
          </button>
        </div>
      </div>

      {bulkMode && (
        <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
          <header className="px-5 py-3 border-b border-[#EDEDF0] flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#111114]" />
            <div className="text-[13px] font-semibold text-[#111114]">Bulk Odometer Entry</div>
            <div className="text-[11px] text-[#9A9AA3]">Type mileage per vehicle and press Save</div>
          </header>
          <ul className="divide-y divide-[#F4F4F6] max-h-[520px] overflow-auto">
            {vehicles.map((v) => (
              <li key={v.id} className="px-5 py-2.5 flex items-center gap-3">
                <div className="text-[13px] text-[#111114] flex-1 truncate">
                  {`${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || v.id.slice(0, 8)}
                </div>
                <div className="text-[11px] text-[#9A9AA3] tabular-nums w-24 text-right">
                  {v.current_odometer ? `${v.current_odometer.toLocaleString()} mi` : "—"}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="New reading"
                  value={odoDrafts[v.id] ?? ""}
                  onChange={(e) => setOdoDrafts((d) => ({ ...d, [v.id]: e.target.value }))}
                  className="w-32 rounded-md border border-[#EDEDF0] px-2 py-1 text-[12px] tabular-nums focus:outline-none focus:border-[#111114]"
                />
                <button
                  onClick={() => saveOdometer(v.id)}
                  disabled={savingId === v.id || !odoDrafts[v.id]}
                  className="inline-flex items-center gap-1 rounded-md bg-[#111114] text-white px-2.5 py-1 text-[11px] font-medium hover:opacity-90 disabled:opacity-40"
                >
                  <Check className="w-3 h-3" /> {savingId === v.id ? "…" : "Save"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(statusFilter === "all" || statusFilter === "down") && downVehicles.length > 0 && (
        <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
          <header className="px-5 py-3 border-b border-[#EDEDF0] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#D03020]" />
            <div className="text-[13px] font-semibold text-[#111114]">Down ({downVehicles.length})</div>
            <div className="text-[11px] text-[#9A9AA3]">Currently Out Of Service</div>
          </header>
          <ul className="divide-y divide-[#F4F4F6]">
            {downVehicles.map((v) => (
              <li key={v.id} className="px-5 py-2.5 flex items-center gap-3">
                <div className="text-[13px] text-[#111114] flex-1">{`${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim()}</div>
                <StatusPill tone="red">Maintenance</StatusPill>
                <div className="text-[11px] text-[#9A9AA3] tabular-nums">{v.current_odometer?.toLocaleString() ?? "—"} mi</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(statusFilter === "all" || statusFilter === "due") && dueVehicles.length > 0 && (
        <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
          <header className="px-5 py-3 border-b border-[#EDEDF0] flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#C68A12]" />
            <div className="text-[13px] font-semibold text-[#111114]">Due ({dueVehicles.length})</div>
            <div className="text-[11px] text-[#9A9AA3]">Routine Service Overdue</div>
          </header>
          <ul className="divide-y divide-[#F4F4F6]">
            {dueVehicles.map(({ v, reasons }) => (
              <li key={v.id} className="px-5 py-2.5 flex items-center gap-3 flex-wrap">
                <div className="text-[13px] text-[#111114] flex-1 min-w-[180px]">{`${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim()}</div>
                {reasons.map((r) => <StatusPill key={r} tone="amber">{r}</StatusPill>)}
                <div className="text-[11px] text-[#9A9AA3] tabular-nums">{v.current_odometer?.toLocaleString() ?? "—"} mi</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(statusFilter === "all" || statusFilter === "needs_odo") && needsOdoVehicles.length > 0 && (
        <div className="rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
          <header className="px-5 py-3 border-b border-[#EDEDF0] flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#9A9AA3]" />
            <div className="text-[13px] font-semibold text-[#111114]">Needs Odometer ({needsOdoVehicles.length})</div>
            <div className="text-[11px] text-[#9A9AA3]">Missing Reading — Not Counted Toward Due</div>
          </header>
          <ul className="divide-y divide-[#F4F4F6]">
            {needsOdoVehicles.map((v) => (
              <li key={v.id} className="px-5 py-2.5 flex items-center gap-3">
                <div className="text-[13px] text-[#111114] flex-1">{`${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim()}</div>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Log reading"
                  value={odoDrafts[v.id] ?? ""}
                  onChange={(e) => setOdoDrafts((d) => ({ ...d, [v.id]: e.target.value }))}
                  className="w-32 rounded-md border border-[#EDEDF0] px-2 py-1 text-[12px] tabular-nums focus:outline-none focus:border-[#111114]"
                />
                <button
                  onClick={() => saveOdometer(v.id)}
                  disabled={savingId === v.id || !odoDrafts[v.id]}
                  className="inline-flex items-center gap-1 rounded-md bg-[#111114] text-white px-2.5 py-1 text-[11px] font-medium hover:opacity-90 disabled:opacity-40"
                >
                  <Check className="w-3 h-3" /> Save
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">{filtered.length} record(s)</div>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150">
          <Plus className="w-4 h-4" /> New Record
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Wrench className="w-6 h-6" strokeWidth={1.75} />}
          title="No Service Records Yet"
          hint="Log a service item or odometer reading to start tracking vehicle upkeep."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3] text-left">
              <tr><th className="px-4 py-2">Vehicle</th><th>Status</th><th>Item</th><th>Category</th><th>Due</th><th>Cost</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{vName(r.vehicle_id)}</td>
                  <td>
                    <select value={r.status} onChange={(e) => updateStatus(r.id, e.target.value)} className="rounded border border-border bg-white px-2 py-1 text-xs">
                      <option value="scheduled">Scheduled</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </td>
                  <td>{r.item}</td>
                  <td className="capitalize">{r.category ?? "—"}</td>
                  <td>{r.due_date ? new Date(r.due_date).toLocaleDateString() : "—"}</td>
                  <td>{r.total_cost ? `$${r.total_cost}` : "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <NewMaintenanceForm vehicles={vehicles} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function NewMaintenanceForm({ vehicles, onClose, onCreated }: { vehicles: any[]; onClose: () => void; onCreated: () => void }) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [item, setItem] = useState("");
  const [category, setCategory] = useState("routine");
  const [dueDate, setDueDate] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicleId || !item) return toast.error("Vehicle and item are required");
    setSaving(true);
    const { error } = await supabase.from("maintenance_records").insert({
      vehicle_id: vehicleId, item, category, status: "scheduled",
      due_date: dueDate || null, total_cost: cost ? Number(cost) : 0, notes: notes || null,
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Created");
    onCreated();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl p-6 max-w-md w-full space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">New Maintenance Record</h3><button type="button" onClick={onClose}><X className="w-4 h-4" /></button></div>
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="w-full rounded border border-border bg-white px-3 py-2 text-sm">
          {vehicles.map((v) => <option key={v.id} value={v.id}>{`${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim()}</option>)}
        </select>
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item (e.g. Oil change)" className="w-full rounded border border-border px-3 py-2 text-sm" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded border border-border bg-white px-3 py-2 text-sm">
          <option value="routine">Routine</option><option value="repair">Repair</option><option value="recall">Recall</option><option value="inspection">Inspection</option>
        </select>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded border border-border px-3 py-2 text-sm" />
        <input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Cost ($)" className="w-full rounded border border-border px-3 py-2 text-sm" />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" rows={2} className="w-full rounded border border-border px-3 py-2 text-sm" />
        <button disabled={saving} className="w-full rounded-lg bg-real-red text-white py-2 text-sm font-medium">{saving ? "Saving…" : "Create"}</button>
      </form>
    </div>
  );
}