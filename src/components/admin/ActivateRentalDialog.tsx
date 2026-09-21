import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, Car, Loader2, ShieldAlert } from "lucide-react";
import {
  getActivationReadiness,
  activateRental,
  type ActivationReadiness,
} from "@/lib/rentals.functions";
import { MicroLabel } from "./ui";

type VehicleLite = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim?: string | null;
  license_plate?: string | null;
  status?: string | null;
  weekly_rate?: number | null;
  deposit?: number | null;
};

/** Blockers the operator is never allowed to click past. */
const HARD = new Set(["vehicle_busy", "no_email", "already_active"]);

export function ActivateRentalDialog({
  driver,
  vehicles,
  onClose,
  onActivated,
}: {
  driver: { id: string; full_name?: string | null; vehicle_id?: string | null };
  vehicles: VehicleLite[];
  onClose: () => void;
  onActivated: () => void;
}) {
  const check = useServerFn(getActivationReadiness);
  const activate = useServerFn(activateRental);

  const [vehicleId, setVehicleId] = useState<string>(driver.vehicle_id ?? "");
  const [readiness, setReadiness] = useState<ActivationReadiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const [weeklyRate, setWeeklyRate] = useState("");
  const [deposit, setDeposit] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [depositHeld, setDepositHeld] = useState(false);

  // Re-check whenever the chosen vehicle changes — the blockers are per
  // vehicle, so showing stale ones would be worse than showing none.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setAcknowledged(false);
    check({ data: { applicationId: driver.id, vehicleId: vehicleId || null } })
      .then((r) => {
        if (cancelled) return;
        setReadiness(r);
        if (r.suggestedWeeklyRate != null && !weeklyRate)
          setWeeklyRate(String(r.suggestedWeeklyRate));
        if (r.suggestedDeposit != null && !deposit) setDeposit(String(r.suggestedDeposit));
      })
      .catch((e) => !cancelled && toast.error(e?.message ?? "Could not check readiness"))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver.id, vehicleId]);

  const hardBlockers = useMemo(
    () => (readiness?.blockers ?? []).filter((b) => HARD.has(b.code)),
    [readiness],
  );
  const softBlockers = useMemo(
    () => (readiness?.blockers ?? []).filter((b) => !HARD.has(b.code)),
    [readiness],
  );

  const rateNum = Number(weeklyRate.replace(/[^\d.]/g, ""));
  const depositNum = Number(deposit.replace(/[^\d.]/g, "")) || 0;

  const canSubmit =
    !busy &&
    !checking &&
    !!vehicleId &&
    rateNum > 0 &&
    !!startDate &&
    hardBlockers.length === 0 &&
    (softBlockers.length === 0 || acknowledged);

  async function submit() {
    setBusy(true);
    try {
      const res = await activate({
        data: {
          applicationId: driver.id,
          vehicleId,
          weeklyRate: rateNum,
          depositAmount: depositNum,
          startDate,
          endDate: endDate || null,
          depositHeld,
          overrideBlockers: softBlockers.length > 0 && acknowledged,
        },
      });
      if (!res.ok) {
        const msg = (res.blockers ?? []).map((b) => b.message).join(" ");
        toast.error(msg || "Could not activate this rental");
        // Re-check so the dialog reflects whatever changed underneath us.
        const fresh = await check({ data: { applicationId: driver.id, vehicleId } });
        setReadiness(fresh);
        return;
      }
      toast.success(
        res.accountCreated
          ? "Rental active — driver emailed a link to set their password"
          : "Rental active — driver notified",
      );
      onActivated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not activate this rental");
    } finally {
      setBusy(false);
    }
  }

  const selectable = vehicles.filter((v) => v.status !== "retired");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-[#EDEDF0]">
          <h3 className="font-semibold flex items-center gap-2">
            <Car className="w-4 h-4" /> Activate Rental
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Creates {driver.full_name || "this driver"}&rsquo;s portal login, starts the rental and
            notifies them.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <MicroLabel>Vehicle</MicroLabel>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white"
            >
              <option value="">Select a vehicle…</option>
              {selectable.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")}
                  {v.license_plate ? ` · ${v.license_plate}` : ""}
                  {v.status && v.status !== "available" ? ` (${v.status})` : ""}
                </option>
              ))}
            </select>
          </div>

          {checking ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking…
            </div>
          ) : null}

          {hardBlockers.length > 0 ? (
            <div className="rounded-xl border border-[#F3C9C4] bg-[#FDF2F1] p-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-[#8A1C10]">
                <ShieldAlert className="w-4 h-4" /> Cannot activate
              </div>
              <ul className="mt-1.5 space-y-1 text-sm text-[#8A1C10]/90">
                {hardBlockers.map((b) => (
                  <li key={b.code}>• {b.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {softBlockers.length > 0 ? (
            <div className="rounded-xl border border-[#F0DCBB] bg-[#FDF8EF] p-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-[#8A5A00]">
                <AlertTriangle className="w-4 h-4" /> Not ready
              </div>
              <ul className="mt-1.5 space-y-1 text-sm text-[#8A5A00]/90">
                {softBlockers.map((b) => (
                  <li key={b.code}>• {b.message}</li>
                ))}
              </ul>
              <label className="mt-2.5 flex items-start gap-2 text-xs text-[#8A5A00]">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I understand and am activating anyway. This is recorded against my account.
                </span>
              </label>
            </div>
          ) : null}

          {readiness?.warnings?.length ? (
            <div className="rounded-xl border border-[#EDEDF0] bg-[#FAFAFB] p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#55555E]">
                Worth knowing
              </div>
              <ul className="mt-1.5 space-y-1 text-sm text-[#55555E]">
                {readiness.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <MicroLabel>Weekly rate $</MicroLabel>
              <input
                value={weeklyRate}
                onChange={(e) => setWeeklyRate(e.target.value)}
                inputMode="decimal"
                placeholder="325"
                className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <MicroLabel>Deposit $</MicroLabel>
              <input
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                inputMode="decimal"
                placeholder="249"
                className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <MicroLabel>Start date</MicroLabel>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <MicroLabel>End date (optional)</MicroLabel>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={depositHeld}
              onChange={(e) => setDepositHeld(e.target.checked)}
            />
            Deposit already collected
          </label>
        </div>

        <div className="p-5 border-t border-[#EDEDF0] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {busy ? "Activating…" : "Activate Rental"}
          </button>
        </div>
      </div>
    </div>
  );
}
