import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VehicleCombobox } from "@/components/admin/VehicleCombobox";
import { listVehiclesForReservation, switchReservationVehicle } from "@/lib/reservations.functions";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary =
  "inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary =
  "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB]";

type Option = {
  id: string;
  unit_number: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  license_plate?: string | null;
  vin?: string | null;
  status: string | null;
  weekly_rate?: number | null;
};

/**
 * Switch Vehicle on a Reserved rental (Manager+). Same searchable picker as
 * Reserve A Car, available cars only. Keeps the Reservation Fee, pickup date,
 * time and place; keeps the rate unless it is edited here. Sends nothing to
 * the renter.
 */
export function SwitchReservationVehicleDialog({
  open,
  onOpenChange,
  rentalId,
  driverName,
  currentVehicleLabel,
  currentRate,
  onSwitched,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rentalId: string;
  driverName?: string | null;
  currentVehicleLabel?: string | null;
  /** Manager+ only; null when unknown. */
  currentRate?: number | null;
  onSwitched: () => void;
}) {
  const loadVehicles = useServerFn(listVehiclesForReservation);
  const run = useServerFn(switchReservationVehicle);
  const [vehicles, setVehicles] = useState<Option[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [rate, setRate] = useState("");
  const [issue, setIssue] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVehicleId(null);
    setRate(currentRate != null ? String(currentRate) : "");
    setIssue(false);
    setReason("");
    loadVehicles()
      .then((v) => setVehicles(v as Option[]))
      .catch(() => setVehicles([]));
  }, [open, currentRate, loadVehicles]);

  const picked = vehicles.find((v) => v.id === vehicleId) ?? null;
  const listedRate = typeof picked?.weekly_rate === "number" ? picked.weekly_rate : null;

  const submit = async () => {
    if (!vehicleId) {
      toast.error("Pick A Vehicle");
      return;
    }
    const n = rate.trim() === "" ? null : Number(rate);
    if (n != null && !(n > 0)) {
      toast.error("Enter A Real Weekly Rate");
      return;
    }
    setBusy(true);
    try {
      const res = await run({
        data: {
          rentalId,
          newVehicleId: vehicleId,
          ...(n != null && n !== currentRate ? { weeklyRate: n } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          oldCarHasIssue: issue,
        },
      });
      toast.success(
        `Vehicle Switched.${res.oldVehicleStatus === "maintenance" ? " Old Car Sent To Service." : ""}${res.oldVehicleReleased ? "" : " The Old Car Could Not Be Released; Check Its Status."}`,
      );
      if (res.agreement.needsAttention) {
        toast.warning(`Agreement Needs Attention: ${res.agreement.message}`, { duration: 12000 });
      }
      onOpenChange(false);
      onSwitched();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Switch The Vehicle");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle>Switch Vehicle{driverName ? `: ${driverName}` : ""}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#55555E]">
          {currentVehicleLabel ? `Now reserved: ${currentVehicleLabel}. ` : ""}
          The Reservation Fee, pickup date, time and place stay the same. The renter is not messaged.
        </p>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">New Vehicle (Available Only)</label>
            <VehicleCombobox vehicles={vehicles} value={vehicleId} onChange={setVehicleId} allowNone={false} aria-label="New Vehicle" />
          </div>
          {currentRate != null ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Weekly Rate</label>
              <input
                className={input}
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                aria-label="Weekly Rate"
              />
              {listedRate != null && listedRate !== Number(rate) ? (
                <button type="button" className="mt-1 text-xs text-[#D03020] underline" onClick={() => setRate(String(listedRate))}>
                  Use This Car's Listed Rate (${listedRate.toLocaleString()}/wk)
                </button>
              ) : null}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-[#111114]">
            <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} aria-label="Old Car Has An Issue" />
            Old Car Has An Issue (Send It To Service)
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason (Optional)</label>
            <input
              className={input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why The Car Is Changing"
              maxLength={300}
              aria-label="Reason"
            />
          </div>
        </div>
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className={primary} disabled={busy || !vehicleId} onClick={() => void submit()}>
            {busy ? "Switching…" : "Switch Vehicle"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
