import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wrench, Plus, X } from "lucide-react";

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

export function MaintenancePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; year: number | null; make: string | null; model: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    const [m, v] = await Promise.all([
      supabase.from("maintenance_records").select("*").order("created_at", { ascending: false }),
      supabase.from("vehicles").select("id, year, make, model").order("created_at", { ascending: false }),
    ]);
    if (m.error) toast.error(m.error.message);
    setRows((m.data as any) ?? []);
    setVehicles((v.data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm">
            <option value="all">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
          <span className="text-sm text-muted-foreground">{filtered.length} record(s)</span>
        </div>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#CC0000] text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150">
          <Plus className="w-4 h-4" /> New Record
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border p-10 text-center text-muted-foreground">
          <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No maintenance records yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#EDEDF0] bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-[#FAFAFB] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9A9AA3] text-left">
              <tr><th className="px-4 py-2">Vehicle</th><th>Item</th><th>Category</th><th>Due</th><th>Cost</th><th>Status</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{vName(r.vehicle_id)}</td>
                  <td>{r.item}</td>
                  <td className="capitalize">{r.category ?? "—"}</td>
                  <td>{r.due_date ? new Date(r.due_date).toLocaleDateString() : "—"}</td>
                  <td>{r.total_cost ? `$${r.total_cost}` : "—"}</td>
                  <td>
                    <select value={r.status} onChange={(e) => updateStatus(r.id, e.target.value)} className="rounded border border-border bg-white px-2 py-1 text-xs">
                      <option value="scheduled">Scheduled</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </td>
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