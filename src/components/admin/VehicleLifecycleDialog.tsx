import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { archiveVehicle, restoreVehicle, getVehicleDeleteCheck, deleteVehiclePermanently } from "@/lib/vehicles.functions";
import { confirmMatches } from "@/lib/vehicle-lifecycle";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export type LifecycleMode = "archive" | "restore" | "delete";

export function VehicleLifecycleDialog({
  vehicle,
  mode,
  onClose,
  onDone,
}: {
  vehicle: { id: string; unit_number: string | null; label: string };
  mode: LifecycleMode;
  onClose: () => void;
  onDone: () => void;
}) {
  const archive = useServerFn(archiveVehicle);
  const restore = useServerFn(restoreVehicle);
  const check = useServerFn(getVehicleDeleteCheck);
  const del = useServerFn(deleteVehiclePermanently);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<{ label: string; count: number }[] | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "delete") return;
    check({ data: { id: vehicle.id } })
      .then((r) => (r.ok ? setBlockers(r.blockers) : setCheckError(r.error)))
      .catch((e) => setCheckError(e?.message ?? "Only the Owner can delete permanently."));
  }, [mode, vehicle.id, check]);

  async function run() {
    setBusy(true);
    try {
      if (mode === "archive") {
        const r = await archive({ data: { id: vehicle.id, reason } });
        if (!r.ok) return toast.error(r.error ?? "Archive failed.");
        toast.success("Vehicle archived");
      } else if (mode === "restore") {
        const r = await restore({ data: { id: vehicle.id } });
        if (!r.ok) return toast.error(r.error ?? "Restore failed.");
        const prev = r.previousStatus ? ` (was ${r.previousStatus} before archiving)` : "";
        toast.success(`Restored to Onboarding${prev}`, {
          description: r.missing?.length ? `Not rental ready: ${r.missing.join(", ")}` : "Review readiness before making it Available.",
        });
      } else {
        const r = await del({ data: { id: vehicle.id, confirm: typed } });
        if (!r.ok) return toast.error(r.error ?? "Delete failed.");
        toast.success("Vehicle permanently deleted");
      }
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "You don't have permission to do that.");
    } finally {
      setBusy(false);
    }
  }

  const canRun =
    !busy &&
    (mode === "archive" ? reason.trim().length >= 3 : mode === "restore" ? true : blockers !== null && blockers.length === 0 && confirmMatches(vehicle.unit_number, typed));

  const title = mode === "archive" ? "Archive Vehicle" : mode === "restore" ? "Restore Vehicle" : "Delete Permanently";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{vehicle.unit_number ? `${vehicle.unit_number} · ` : ""}{vehicle.label}</DialogDescription>
        </DialogHeader>

        {mode === "archive" && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">Removes the vehicle from the active fleet. All photos, documents, expenses, service, mileage, incidents and finance history are kept.</p>
            <label className="block text-xs font-medium">Reason (Required)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} className="w-full rounded-md border border-border px-3 py-2 text-sm" />
          </div>
        )}

        {mode === "restore" && (
          <p className="text-sm text-muted-foreground">The vehicle returns as Onboarding. It is never made Available automatically — check its readiness first.</p>
        )}

        {mode === "delete" && (
          <div className="space-y-3 text-sm">
            {checkError && <p className="text-destructive">{checkError}</p>}
            {!checkError && blockers === null && <p className="text-muted-foreground">Checking linked records…</p>}
            {blockers && blockers.length > 0 && (
              <div>
                <p className="font-medium">Cannot delete — these records would be lost or orphaned:</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {blockers.map((b) => <li key={b.label}>{b.label}: {b.count < 0 ? "could not be checked" : b.count}</li>)}
                </ul>
                <p className="mt-2 text-muted-foreground">Keep the vehicle archived instead.</p>
              </div>
            )}
            {blockers && blockers.length === 0 && (
              <>
                <p>This removes only the vehicle record itself. It has no linked rentals, payments, documents, photos, service or finance records. This cannot be undone.</p>
                {vehicle.unit_number ? (
                  <>
                    <label className="block text-xs font-medium">Type {vehicle.unit_number} To Confirm</label>
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} className="w-full rounded-md border border-border px-3 py-2 text-sm font-mono" />
                  </>
                ) : (
                  <p className="text-destructive">This vehicle has no unit number, so it cannot be confirmed for deletion.</p>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={run}
            disabled={!canRun}
            className={`rounded-md px-4 py-2 text-sm text-primary-foreground disabled:opacity-40 ${mode === "restore" ? "bg-primary" : "bg-destructive"}`}
          >
            {busy ? "Working…" : title}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
