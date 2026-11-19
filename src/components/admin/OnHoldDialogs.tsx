import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { putReservationOnHold, resumeReservationFromHold } from "@/lib/rental-hold.functions";
import { checkHoldReason } from "@/lib/rental-hold";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB]";

export function OnHoldBadge({ reason }: { reason?: string | null }) {
  return (
    <span
      data-testid="on-hold-badge"
      data-rental-status="on_hold"
      title={reason ?? "On Hold"}
      className="inline-flex rounded-full bg-[#FFF4D6] px-2 py-0.5 text-[11px] font-semibold text-[#8A6A00]"
    >
      On Hold
    </span>
  );
}

/** Put a Reserved rental On Hold (instead of releasing it or calling it a no-show). A reason is required. */
export function PutOnHoldDialog({ open, onOpenChange, rentalId, driverName, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; rentalId: string; driverName: string | null; onSaved: () => void }) {
  const save = useServerFn(putReservationOnHold);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const check = checkHoldReason(reason);
  const submit = async () => {
    setBusy(true);
    try {
      await save({ data: { rentalId, reason } });
      toast.success("Reservation On Hold");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Put On Hold");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle>Put On Hold: {driverName ?? "Driver"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#55555E]">The car stays held for this renter. No release, no-show or forfeiture texts go out while it is On Hold.</p>
        <label className="mt-2 block text-xs font-medium text-muted-foreground">Reason</label>
        <textarea className={input} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="hold-reason" />
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={primary} disabled={busy || !check.ok} onClick={() => void submit()}>Put On Hold</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Resume an On Hold rental to Reserved with a new pickup date. */
export function ResumeHoldDialog({ open, onOpenChange, rentalId, driverName, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; rentalId: string; driverName: string | null; onSaved: () => void }) {
  const save = useServerFn(resumeReservationFromHold);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await save({ data: { rentalId, pickupDate: date } });
      toast.success("Reservation Resumed");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Resume");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle>Resume Reservation: {driverName ?? "Driver"}</DialogTitle>
        </DialogHeader>
        <label className="block text-xs font-medium text-muted-foreground">New Pickup Date</label>
        <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} data-testid="resume-date" />
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={primary} disabled={busy || !date} onClick={() => void submit()}>Resume</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
