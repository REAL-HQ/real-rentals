import { useEffect, useMemo, useState } from "react";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, inputCls } from "./modal";
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
const HARD = new Set(["vehicle_busy", "no_email", "already_active", "vehicle_not_ready"]);

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
  const [overrideReason, setOverrideReason] = useState("");

  const [weeklyRate, setWeeklyRate] = useState("");
  const [deposit, setDeposit] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [depositHeld, setDepositHeld] = useState(false);
  const [pickupMiles, setPickupMiles] = useState("");

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
        // Same observation as the pre-delivery inspection — prefilled, never re-entered.
        setPickupMiles(r.inspectionMileage != null ? String(r.inspectionMileage) : "");
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
  const pickupNum = pickupMiles.trim() ? Number(pickupMiles.replace(/[^\d]/g, "")) : null;

  const canSubmit =
    !busy &&
    !checking &&
    !!vehicleId &&
    rateNum > 0 &&
    pickupNum != null && pickupNum >= 0 &&
    !!startDate &&
    hardBlockers.length === 0 &&
    (softBlockers.length === 0 || (acknowledged && overrideReason.trim().length >= 5));

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
          pickupMileage: pickupNum,
          overrideBlockers: softBlockers.length > 0 && acknowledged,
          overrideReason: softBlockers.length > 0 && acknowledged ? overrideReason.trim() : undefined,
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
    <ModalShell onClose={onClose} size="md" label="Activate Rental">
      <ModalHeader title="Activate Rental"
        subtitle={<>Starts {driver.full_name || "this driver"}&rsquo;s rental, creates their portal login and notifies them.</>}
        onClose={onClose} />
        <ModalBody className="space-y-5">
          <div>
            <MicroLabel>Vehicle</MicroLabel>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className={`${inputCls} mt-1.5`}
            >
              <option value="">Select a vehicle…</option>
              {selectable.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")}
                  {v.license_plate ? ` · ${v.license_plate}` : ""}
                  {v.status === "onboarding" ? " (Needs Setup)" : v.status && v.status !== "available" ? ` (${v.status})` : ""}
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
              {acknowledged && (
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Reason for override (required)"
                  rows={2}
                  className="mt-2 w-full rounded-md border border-[#F6E7B8] bg-white px-2 py-1.5 text-xs text-[#111114]"
                />
              )}
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
                className={`${inputCls} mt-1.5`}
              />
            </div>
            <div>
              <MicroLabel>Deposit $</MicroLabel>
              <input
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                inputMode="decimal"
                placeholder="249"
                className={`${inputCls} mt-1.5`}
              />
            </div>
            <div>
              <MicroLabel>Start date</MicroLabel>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`${inputCls} mt-1.5`}
              />
            </div>
            <div>
              <MicroLabel>End date (optional)</MicroLabel>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={`${inputCls} mt-1.5`}
              />
            </div>
          </div>

          <div>
            <MicroLabel>Pickup Mileage</MicroLabel>
            <input
              value={pickupMiles}
              onChange={(e) => setPickupMiles(e.target.value)}
              inputMode="numeric"
              placeholder="Odometer At Handover"
              aria-label="Pickup Mileage"
              className={`${inputCls} mt-1.5`}
            />
            <p className="text-[11px] text-[#55555E] mt-1">
              {readiness?.inspectionMileage != null && String(readiness.inspectionMileage) === pickupMiles.replace(/[^\d]/g, "")
                ? "From The Pre-Delivery Inspection — Recorded Once."
                : readiness?.currentMileage != null
                  ? `Last Reading: ${readiness.currentMileage.toLocaleString("en-US")} mi.`
                  : "No Mileage On File Yet."}
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={depositHeld}
              onChange={(e) => setDepositHeld(e.target.checked)}
            />
            Deposit already collected
          </label>
        </ModalBody>

        <ModalFooter>
          <ModalButton onClick={onClose}>Cancel</ModalButton>
          <ModalButton variant="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {busy ? "Activating…" : "Activate Rental"}
          </ModalButton>
        </ModalFooter>
    </ModalShell>
  );
}
