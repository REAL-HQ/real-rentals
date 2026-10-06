import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Loader2, Plus, AlertTriangle, Clock } from "lucide-react";
import { getFleetMaintenance } from "@/lib/maintenance.functions";
import { supabase } from "@/integrations/supabase/client";
import { SectionCard } from "./ui";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, Field, inputCls } from "./modal";
import { VehicleService } from "./VehicleService";

const TONE: Record<string, string> = {
  overdue: "bg-brand/10 text-brand", conflict: "bg-brand/10 text-brand", open: "bg-warning/15 text-warning-foreground",
  due: "bg-brand/10 text-brand", due_soon: "bg-warning/15 text-warning-foreground",
};
const LABEL: Record<string, string> = { overdue: "Overdue", conflict: "Needs Review", open: "Open", due: "Due", due_soon: "Due Soon" };

// Fleet-wide maintenance: what needs attention now, what is coming up.
export function FleetServiceCenter({ autoOpenAdd = false }: { autoOpenAdd?: boolean }) {
  const load = useServerFn(getFleetMaintenance);
  const [data, setData] = useState<{ attention: any[]; upcoming: any[] } | null>(null);
  const [view, setView] = useState<"attention" | "upcoming">("attention");
  const [picking, setPicking] = useState(autoOpenAdd);
  const [vehicleFor, setVehicleFor] = useState<string | null>(null);
  useEffect(() => { load().then(setData).catch(() => setData({ attention: [], upcoming: [] })); }, [load]);
  useEffect(() => { if (autoOpenAdd) setPicking(true); }, [autoOpenAdd]);

  const rows = data ? data[view] : [];
  return (
    <>
      <SectionCard
        title="Maintenance"
        icon={view === "attention" ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
        right={<ModalButton variant="primary" className="h-9" onClick={() => setPicking(true)}><Plus className="h-4 w-4" /> Add Service</ModalButton>}
      >
        <div className="mb-3 flex gap-1.5">
          {(["attention", "upcoming"] as const).map((k) => (
            <button key={k} onClick={() => setView(k)} className={`h-8 rounded-full px-3 text-[13px] ${view === k ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}>
              {k === "attention" ? "Needs Attention" : "Upcoming"}{data ? ` (${data[k].length})` : ""}
            </button>
          ))}
        </div>
        {!data ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : rows.length === 0 ? (
          <div className="text-[13px] text-muted-foreground">{view === "attention" ? "All clear — nothing overdue, due or open." : "Nothing coming due soon."}</div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r, n) => (
              <Link key={n} to="/admin" search={{ tab: "vehicles", id: r.vehicle.id } as any} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px] hover:bg-muted/40">
                <span className="w-20 font-semibold">{r.vehicle.unit_number ?? "—"}</span>
                <span className="min-w-[140px] flex-1">{r.item}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[r.due.state] ?? ""}`}>{LABEL[r.due.state] ?? r.due.state}</span>
                <span className="text-muted-foreground">{r.due.reason}</span>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
      {picking && <PickVehicle onClose={() => setPicking(false)} onPick={(id) => { setPicking(false); setVehicleFor(id); }} />}
      {vehicleFor && (
        <ModalShell onClose={() => setVehicleFor(null)} label="Vehicle Service" size="workspace">
          <ModalHeader title="Service" onClose={() => setVehicleFor(null)} />
          <ModalBody><VehicleService vehicleId={vehicleFor} openAdd /></ModalBody>
        </ModalShell>
      )}
    </>
  );
}

function PickVehicle({ onClose, onPick }: { onClose: () => void; onPick: (id: string) => void }) {
  const [list, setList] = useState<any[]>([]);
  const [id, setId] = useState("");
  useEffect(() => {
    supabase.from("vehicles").select("id,unit_number,year,make,model").is("archived_at", null).order("unit_number").then(({ data }) => setList(data ?? []));
  }, []);
  return (
    <ModalShell onClose={onClose} label="Add Service" size="sm">
      <ModalHeader title="Add Service" subtitle="Choose the vehicle." onClose={onClose} />
      <ModalBody>
        <Field label="Vehicle" required>
          <select className={inputCls} value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Select A Vehicle</option>
            {list.map((v) => <option key={v.id} value={v.id}>{v.unit_number} · {v.year} {v.make} {v.model}</option>)}
          </select>
        </Field>
      </ModalBody>
      <ModalFooter><ModalButton onClick={onClose}>Cancel</ModalButton><ModalButton variant="primary" disabled={!id} onClick={() => onPick(id)}>Continue</ModalButton></ModalFooter>
    </ModalShell>
  );
}
