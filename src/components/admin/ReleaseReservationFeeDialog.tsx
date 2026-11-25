import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { releaseConfirmMessage } from "@/lib/reservation-fee-hold";

const primary = "inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB]";

export function ReleaseReservationFeeDialog({
  open,
  driverName,
  busy = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  driverName: string | null;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Release This Hold</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#44444C]">{releaseConfirmMessage(driverName)}</p>
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)} disabled={busy}>Cancel</button>
          <button type="button" className={primary} onClick={onConfirm} disabled={busy}>{busy ? "Releasing…" : "Release"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
