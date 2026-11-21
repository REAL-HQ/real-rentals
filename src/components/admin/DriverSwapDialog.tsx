import { Repeat, X } from "lucide-react";
import { SwapVehiclePanel } from "./BookingVehicleHistory";

/**
 * Swap Vehicle from the driver profile. It hosts the same SwapVehiclePanel the
 * booking page uses (form, open-swap card, flag and Manager/Owner gate all live
 * there), so there is exactly one swap flow. It never starts anything itself.
 */
export function DriverSwapDialog({
  rentalId,
  driverName,
  onClose,
}: {
  rentalId: string;
  driverName?: string | null;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Swap Vehicle"
      data-testid="driver-swap-dialog"
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full min-w-0 max-w-6xl rounded-none bg-[#FAFAFB] shadow-2xl sm:my-2 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-[#EDEDF0] bg-white px-5 py-3 sm:rounded-t-2xl">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#111114]">
            <Repeat className="h-4 w-4" /> Swap Vehicle{driverName ? ` — ${driverName}` : ""}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[#55555E] hover:bg-[#F4F4F6]">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="px-5 pb-5">
          <SwapVehiclePanel rentalId={rentalId} autoOpen onChanged={() => {}} onClosed={onClose} />
        </div>
      </div>
    </div>
  );
}
