import { useState } from "react";
import { Car, Repeat } from "lucide-react";
import { RecordNumber } from "./RecordNumber";
import { SWAP_ENABLED, SWAP_REASONS } from "@/lib/record-numbers";
import { fmtDate } from "@/lib/date-format";

// Vehicle assignment history for a booking (or a vehicle).
//
// Entries come ONLY from the future persisted assignment history. Nothing is
// built from the current vehicle link — a single current car is not history.
// Until the backend exists, callers pass no entries and see one quiet line.

export type VehicleAssignment = {
  id: string;
  vehicle: string;
  start: string | null;
  end: string | null;
  mileage: number | null;
  fuel: string | null;
  swapNumber: number | null;
  reason: string | null;
  status: string | null;
};

export function BookingVehicleHistory({
  entries = [],
  showSwap = false,
}: {
  entries?: VehicleAssignment[];
  showSwap?: boolean;
}) {
  const [swapOpen, setSwapOpen] = useState(false);
  return (
    <div data-testid="vehicle-timeline">
      <div className="flex items-center justify-between gap-2">
        {entries.length === 0 ? (
          <p className="text-[13px] text-[#55555E]">No vehicle changes recorded.</p>
        ) : (
          <span />
        )}
        {showSwap && (
          <button
            type="button"
            disabled={!SWAP_ENABLED}
            onClick={() => SWAP_ENABLED && setSwapOpen(true)}
            title={SWAP_ENABLED ? "Swap Vehicle" : "Swap is not available yet"}
            aria-disabled={!SWAP_ENABLED}
            data-testid="swap-button"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1 text-[12px] text-[#55555E] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Repeat className="h-3 w-3" /> Swap
          </button>
        )}
      </div>
      {showSwap && !SWAP_ENABLED && (
        <p className="mt-1 text-[11px] text-[#9A9AA3]">Swap Unavailable — coming after backend approval.</p>
      )}
      {entries.length > 0 && (
        <ol className="mt-3 space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded-lg border border-[#EDEDF0] bg-white p-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <Car className="h-3.5 w-3.5 text-[#9A9AA3]" />
                <span className="font-medium text-[#111114]">{e.vehicle}</span>
                {e.swapNumber != null && <RecordNumber label="Swap" value={e.swapNumber} />}
                {e.status && <span className="text-[#55555E]">{e.status}</span>}
              </div>
              <div className="mt-1 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[12px] text-[#55555E]">
                <span>Start: {e.start ? fmtDate(e.start) : "—"}</span>
                <span>End: {e.end ? fmtDate(e.end) : "—"}</span>
                <span>Mileage: {e.mileage != null ? e.mileage.toLocaleString() : "—"}</span>
                <span>Fuel: {e.fuel ?? "—"}</span>
                <span>Reason: {e.reason ?? "—"}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {SWAP_ENABLED && swapOpen && <SwapForm onClose={() => setSwapOpen(false)} />}
    </div>
  );
}

/** Layout only. Unreachable while SWAP_ENABLED is false; has no save path. */
function SwapForm({ onClose }: { onClose: () => void }) {
  const field = "w-full rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1.5 text-[13px]";
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-[#EDEDF0] bg-white p-3">
      <label className="text-[12px] text-[#55555E]">Vehicle<input className={field} disabled /></label>
      <label className="text-[12px] text-[#55555E]">
        Reason
        <select className={field} disabled>
          {SWAP_REASONS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
      <label className="text-[12px] text-[#55555E]">Date<input type="datetime-local" className={field} disabled /></label>
      <label className="text-[12px] text-[#55555E]">Mileage<input inputMode="numeric" className={field} disabled /></label>
      <label className="text-[12px] text-[#55555E]">Fuel<input className={field} disabled /></label>
      <label className="text-[12px] text-[#55555E]">Rate<input inputMode="decimal" className={field} disabled /></label>
      <label className="text-[12px] text-[#55555E] sm:col-span-2">Notes<textarea className={field} disabled /></label>
      <label className="text-[12px] text-[#55555E] sm:col-span-2">Agreement<input className={field} disabled /></label>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px]">Close</button>
        <button type="button" disabled className="rounded-md bg-black px-3 py-1.5 text-[13px] text-white opacity-50">Save</button>
      </div>
    </div>
  );
}
