import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Vehicle } from "./types";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import { VehicleEditor } from "./VehicleEditor";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

export function VehiclesPanel() {
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);

  async function load() {
    const { data } = await supabase.from("vehicles").select("*").order("make");
    setRows((data as Vehicle[]) || []);
  }
  useEffect(() => { load(); }, []);

  async function remove(v: Vehicle) {
    if (!confirm(`Delete ${v.year} ${v.make} ${v.model}? This cannot be undone.`)) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", v.id);
    if (error) return toast.error(error.message);
    setRows((r) => r.filter((x) => x.id !== v.id));
    toast.success("Vehicle deleted");
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setEditing("new")}
          className="inline-flex items-center gap-2 rounded-md bg-real-red text-white px-4 py-2 text-sm font-medium hover:opacity-90">
          <Plus className="w-4 h-4" /> Add vehicle
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((v) => {
          const img = resolvePhotoUrl(v.photos?.[0]);
          return (
            <div key={v.id} className="rounded-2xl bg-soft overflow-hidden">
              <div className="aspect-[4/3] bg-white flex items-center justify-center">
                {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <span className="text-xs text-muted-foreground">No photo</span>}
              </div>
              <div className="p-4">
                <div className="font-medium">{v.year} {v.make} {v.model}</div>
                <div className="text-xs text-muted-foreground">${Number(v.weekly_rate)}/wk · {v.body_type || "—"} · {v.status}</div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setEditing(v)} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-black text-white px-3 py-1.5 text-sm">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button onClick={() => remove(v)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-real-red hover:text-white hover:border-real-red">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {rows.length === 0 && <div className="text-sm text-muted-foreground mt-6">No vehicles yet. Click "Add vehicle" to create one.</div>}

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