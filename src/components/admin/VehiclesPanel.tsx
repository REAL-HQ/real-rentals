import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Vehicle } from "./types";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import { VehicleEditor } from "./VehicleEditor";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function VehiclesPanel({ externalSearch = "" }: { externalSearch?: string } = {}) {
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [partners, setPartners] = useState<Array<{ id: string; name: string }>>([]);
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [bodyFilter, setBodyFilter] = useState<string>("all");
  const [partnerFilter, setPartnerFilter] = useState<string>("all");

  async function load() {
    const { data } = await supabase.from("vehicles").select("*").order("make");
    setRows((data as Vehicle[]) || []);
  }
  useEffect(() => {
    load();
    supabase.from("partners").select("id,name").order("name").then(({ data }) => setPartners(data || []));
  }, []);

  async function assignPartner(v: Vehicle, partner_id: string | null) {
    const { error } = await supabase.from("vehicles").update({ partner_id }).eq("id", v.id);
    if (error) return toast.error(error.message);
    setRows((r) => r.map((x) => x.id === v.id ? { ...x, partner_id } as Vehicle : x));
  }

  async function remove(v: Vehicle) {
    if (!confirm(`Delete ${v.year} ${v.make} ${v.model}? This cannot be undone.`)) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", v.id);
    if (error) return toast.error(error.message);
    setRows((r) => r.filter((x) => x.id !== v.id));
    toast.success("Vehicle deleted");
  }

  const statuses = Array.from(new Set(rows.map((r) => r.status).filter(Boolean))) as string[];
  const bodyTypes = Array.from(new Set(rows.map((r) => r.body_type).filter(Boolean))) as string[];

  const filtered = rows.filter((v) => {
    if (statusFilter !== "all" && v.status !== statusFilter) return false;
    if (bodyFilter !== "all" && v.body_type !== bodyFilter) return false;
    if (partnerFilter !== "all") {
      const pid = (v as any).partner_id ?? null;
      if (partnerFilter === "__none__" ? pid !== null : pid !== partnerFilter) return false;
    }
    const effective = (externalSearch || search).trim();
    if (effective) {
      const q = effective.toLowerCase();
      const hay = `${v.year} ${v.make} ${v.model} ${v.trim ?? ""} ${(v as any).color ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all" || bodyFilter !== "all" || partnerFilter !== "all";

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="flex-1 flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search make, model, trim, color…"
            className="flex-1 min-w-[200px] border border-border rounded-md px-3 py-2 text-sm bg-white"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[140px] bg-white text-foreground text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={bodyFilter} onValueChange={setBodyFilter}>
            <SelectTrigger className="h-9 w-[140px] bg-white text-foreground text-sm"><SelectValue placeholder="Body type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All body types</SelectItem>
              {bodyTypes.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={partnerFilter} onValueChange={setPartnerFilter}>
            <SelectTrigger className="h-9 w-[160px] bg-white text-foreground text-sm"><SelectValue placeholder="Partner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All partners</SelectItem>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(""); setStatusFilter("all"); setBodyFilter("all"); setPartnerFilter("all"); }}
              className="text-sm text-muted-foreground hover:text-foreground px-2"
            >
              Clear
            </button>
          )}
        </div>
        <button onClick={() => setEditing("new")}
          className="inline-flex items-center gap-2 rounded-md bg-real-red text-white px-4 py-2 text-sm font-medium hover:opacity-90 self-start lg:self-auto">
          <Plus className="w-4 h-4" /> Add Vehicle
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((v) => {
          const img = resolvePhotoUrl(v.photos?.[0]);
          return (
            <div key={v.id} className="rounded-2xl bg-soft overflow-hidden">
              <div className="aspect-[4/3] bg-white flex items-center justify-center">
                {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <span className="text-xs text-muted-foreground">No photo</span>}
              </div>
              <div className="p-4">
                <div className="font-medium">{v.year} {v.make} {v.model}</div>
                <div className="text-xs text-muted-foreground">${Number(v.weekly_rate)}/wk · {v.body_type || "—"} · {v.status}</div>
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Partner</div>
                  <Select
                    value={(v as any).partner_id ?? "__none__"}
                    onValueChange={(val) => assignPartner(v, val === "__none__" ? null : val)}
                  >
                    <SelectTrigger className="h-8 bg-white text-foreground text-xs"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unassigned</SelectItem>
                      {partners.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setEditing(v)} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-black text-white px-3 py-1.5 text-sm">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => remove(v)} className="group rounded-md border border-border px-3 py-1.5 text-sm hover:border-real-red">
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground group-hover:text-real-red" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {rows.length === 0 && <div className="text-sm text-muted-foreground mt-6">No vehicles yet. Click "Add Vehicle" to create one.</div>}
      {rows.length > 0 && filtered.length === 0 && <div className="text-sm text-muted-foreground mt-6">No vehicles match the current filters.</div>}

      {editing && (
        <VehicleEditor
          vehicle={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { await load(); setEditing(null); }}
        />
      )}
    </div>
  );
}