import { useEffect, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Car, Repeat } from "lucide-react";
import { RecordNumber } from "./RecordNumber";
import { SWAP_ENABLED, SWAP_REASONS } from "@/lib/record-numbers";
import { fmtDate } from "@/lib/date-format";
import {
  listAssignmentHistory,
  swapRentalVehicle,
  type AssignmentHistoryEntry,
} from "@/lib/vehicle-swap.functions";

// Vehicle assignment history for a booking or a vehicle.
//
// Entries come only from list_assignment_history_v1. A missing function on
// today's database is an empty list. The current vehicle link is not history.
// SwapForm is mounted only while SWAP_ENABLED is true, so the swap RPC is
// not called while that flag is false.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusLabel(status: string | null): string | null {
  if (status === "open") return "Open";
  if (status === "closed") return "Closed";
  return status;
}

export function BookingVehicleHistory({
  rentalId,
  vehicleId,
  showSwap = false,
}: {
  rentalId?: string;
  vehicleId?: string;
  showSwap?: boolean;
}) {
  const load = useServerFn(listAssignmentHistory);
  const [entries, setEntries] = useState<AssignmentHistoryEntry[]>([]);
  const [swapOpen, setSwapOpen] = useState(false);
  const open = entries.find((e) => e.status === "open" || e.end == null);

  useEffect(() => {
    if (!rentalId && !vehicleId) return;
    let cancelled = false;
    void load({ data: { rentalId: rentalId ?? null, vehicleId: vehicleId ?? null } })
      .then((result) => {
        if (!cancelled) setEntries(result.ready ? result.entries : []);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [load, rentalId, vehicleId, swapOpen]);

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
            onClick={() => {
              if (SWAP_ENABLED) setSwapOpen(true);
            }}
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
                <span className="font-medium text-[#111114]">{e.vehicle || "Vehicle"}</span>
                {e.swapNumber != null && <RecordNumber label="Swap" value={e.swapNumber} />}
                {e.status && <span className="text-[#55555E]">{statusLabel(e.status)}</span>}
              </div>
              <div className="mt-1 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[12px] text-[#55555E]">
                <span>Start: {e.start ? fmtDate(e.start) : "—"}</span>
                <span>End: {e.end ? fmtDate(e.end) : "—"}</span>
                <span>Mileage: {e.mileage != null ? e.mileage.toLocaleString() : "—"}</span>
                <span>Fuel: —</span>
                <span>Reason: {e.reason ?? "—"}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {SWAP_ENABLED && swapOpen && rentalId && (
        <SwapForm
          rentalId={rentalId}
          expectedAssignmentId={open?.id ?? null}
          onClose={() => setSwapOpen(false)}
          onSaved={() => setSwapOpen(false)}
        />
      )}
    </div>
  );
}

function wholeMiles(raw: string, label: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a whole number`);
  const value = Number(text);
  if (value > 2_000_000) throw new Error(`${label} is out of range`);
  return value;
}

/** Wired to swap_rental_vehicle_tx. Unmounted while SWAP_ENABLED is false. */
function SwapForm({
  rentalId,
  expectedAssignmentId,
  onClose,
  onSaved,
}: {
  rentalId: string;
  expectedAssignmentId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const swap = useServerFn(swapRentalVehicle);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const [vehicle, setVehicle] = useState("");
  const [reason, setReason] = useState<(typeof SWAP_REASONS)[number]>("Replacement");
  const [notes, setNotes] = useState("");
  const [effective, setEffective] = useState("");
  const [returnMiles, setReturnMiles] = useState("");
  const [pickupMiles, setPickupMiles] = useState("");
  const [agreement, setAgreement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const field = "mt-1 w-full rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1.5 text-[13px]";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!SWAP_ENABLED) return;
    setSaving(true);
    setError(null);
    try {
      if (!expectedAssignmentId) throw new Error("No open assignment to swap.");
      const replacement = vehicle.trim();
      const evidence = agreement.trim();
      if (!UUID.test(replacement)) throw new Error("Replacement Vehicle must be the vehicle id");
      if (!UUID.test(evidence)) throw new Error("Agreement must be the evidence id");
      if (!effective) throw new Error("Effective Time is required");
      const effectiveAt = new Date(effective).toISOString();
      if (Number.isNaN(Date.parse(effectiveAt))) throw new Error("Effective Time is not a real time");
      const reasonText = `${reason}${notes.trim() ? `: ${notes.trim()}` : ""}`;
      if (reasonText.length < 5 || reasonText.length > 500) throw new Error("Reason must be 5 to 500 characters");
      const key = JSON.stringify({
        rentalId,
        expectedAssignmentId,
        replacement,
        effectiveAt,
        reasonText,
        returnMiles,
        pickupMiles,
        evidence,
      });
      const operationId = operation.current?.key === key ? operation.current.id : crypto.randomUUID();
      operation.current = { key, id: operationId };
      await swap({
        data: {
          operationId,
          rentalId,
          expectedAssignmentId,
          replacementVehicleId: replacement,
          effectiveAt,
          returnMileage: wholeMiles(returnMiles, "Return Mileage"),
          pickupMileage: wholeMiles(pickupMiles, "Pickup Mileage"),
          reason: reasonText,
          agreementEvidenceId: evidence,
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      data-testid="swap-form"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-[#EDEDF0] bg-white p-3"
    >
      <label className="text-[12px] text-[#55555E]">
        Replacement Vehicle
        <input className={field} value={vehicle} onChange={(e) => setVehicle(e.target.value)} autoComplete="off" />
      </label>
      <label className="text-[12px] text-[#55555E]">
        Reason
        <select className={field} value={reason} onChange={(e) => setReason(e.target.value as (typeof SWAP_REASONS)[number])}>
          {SWAP_REASONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[12px] text-[#55555E]">
        Effective Time
        <input type="datetime-local" className={field} value={effective} onChange={(e) => setEffective(e.target.value)} required />
      </label>
      <label className="text-[12px] text-[#55555E]">
        Return Mileage
        <input inputMode="numeric" className={field} value={returnMiles} onChange={(e) => setReturnMiles(e.target.value)} />
      </label>
      <label className="text-[12px] text-[#55555E]">
        Pickup Mileage
        <input inputMode="numeric" className={field} value={pickupMiles} onChange={(e) => setPickupMiles(e.target.value)} />
      </label>
      <label className="text-[12px] text-[#55555E]">
        Agreement
        <input className={field} value={agreement} onChange={(e) => setAgreement(e.target.value)} autoComplete="off" />
      </label>
      <label className="text-[12px] text-[#55555E] sm:col-span-2">
        Notes
        <textarea className={field} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="sm:col-span-2 text-[12px] text-[#55555E]">Fuel: —</p>
      {!expectedAssignmentId && (
        <p className="sm:col-span-2 text-[12px] text-[#9A9AA3]">No open assignment to swap.</p>
      )}
      {error && <p className="sm:col-span-2 text-[12px] text-[#D03020]">{error}</p>}
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px]">
          Close
        </button>
        <button
          type="submit"
          disabled={saving || !expectedAssignmentId}
          className="rounded-md bg-black px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
        >
          Save Swap
        </button>
      </div>
    </form>
  );
}
