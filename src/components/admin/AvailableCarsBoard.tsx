import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "./ui";
import { assignCarFromBoard, listAssignableDrivers, listAvailableCars } from "@/lib/available-cars.functions";
import { SLOT_LABELS } from "@/lib/photo-studio";

type Car = Awaited<ReturnType<typeof listAvailableCars>>["cars"][number];

export function AvailableCarsBoard({ canAssign }: { canAssign: boolean }) {
  const list = useServerFn(listAvailableCars);
  const drivers = useServerFn(listAssignableDrivers);
  const assign = useServerFn(assignCarFromBoard);
  const [cars, setCars] = useState<Car[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Car | null>(null);
  const [pool, setPool] = useState<{ id: string; name: string; status: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCars((await list({ data: {} })).cars); } finally { setLoading(false); }
  }, [list]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cars;
    return cars.filter((c) => [c.unit, c.year, c.make, c.model, c.color, c.plate, c.vinLast6].filter(Boolean).join(" ").toLowerCase().includes(t));
  }, [cars, q]);

  const openAssign = async (c: Car) => {
    setTarget(c);
    setPool((await drivers()).drivers);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input placeholder="Search plate, VIN last 6, unit, make, model, color" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
        <span className="text-sm text-muted-foreground">{shown.length} available</span>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : shown.length === 0 ? <EmptyState title="No Available Cars" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <div key={c.id} className="rounded-lg border bg-white overflow-hidden">
              <div className="grid grid-cols-2 gap-px bg-muted">
                {c.photos.slice(0, 4).map((p) => (
                  <div key={p.slot} className="relative bg-white">
                    <img src={p.url ?? ""} alt={SLOT_LABELS[p.slot]} className="w-full aspect-[4/3] object-cover" />
                  </div>
                ))}
                {c.photos.length === 0 && <div className="col-span-2 aspect-[8/3] grid place-items-center text-xs text-muted-foreground">No approved photos yet</div>}
              </div>
              <div className="p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{[c.year, c.make, c.model, c.trim].filter(Boolean).join(" ")}</div>
                  {c.aiGenerated && <Badge variant="secondary" title="Photos Are AI-generated From This Car's Own Photos And Approved By The Team">AI photos</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[c.unit && `Unit ${c.unit}`, c.color, c.plate && `Plate ${c.plate}${c.plateState ? ` (${c.plateState})` : ""}`, c.vinLast6 && `VIN …${c.vinLast6}`, c.mileage != null && `${Number(c.mileage).toLocaleString()} mi`].filter(Boolean).join(" · ")}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-medium">{c.weeklyRate != null ? `$${c.weeklyRate.toFixed(0)}/week` : "Rate not set"}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{c.assigned ? "assigned" : c.status}</Badge>
                    {canAssign && !c.assigned && <Button size="sm" onClick={() => openAssign(c)}>Assign</Button>}
                  </div>
                </div>
                {c.setStatus !== "approved" && <div className="text-[11px] text-amber-700">Photos: {c.setStatus}{c.missingExterior.length ? ` · missing ${c.missingExterior.map((s) => SLOT_LABELS[s]).join(", ")}` : ""}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign {target ? [target.year, target.make, target.model].join(" ") : ""}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Only approved drivers without a car are listed.</p>
          <div className="max-h-80 overflow-auto divide-y">
            {pool.length === 0 && <p className="text-sm py-2">No approved drivers waiting for a car.</p>}
            {pool.map((d) => (
              <button key={d.id} className="w-full text-left py-2 px-1 hover:bg-muted text-sm" onClick={async () => {
                const r = await assign({ data: { vehicleId: target!.id, driverId: d.id } });
                if (!r.ok) toast.error(r.error); else { toast.success(`Assigned to ${d.name}.`); setTarget(null); await load(); }
              }}>{d.name} <span className="text-muted-foreground">· {d.status}</span></button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
