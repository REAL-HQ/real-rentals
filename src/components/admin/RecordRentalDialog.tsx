import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, ShieldCheck } from "lucide-react";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, inputCls } from "./modal";
import { MicroLabel } from "./ui";
import { previewRecordRental, recordExistingRental, type IntakePreflight } from "@/lib/rental-intake.functions";
import { RECORD_CONFIRM_PHRASE } from "@/lib/rental-intake";
import { getStripeEnvironment } from "@/lib/stripe";
import { fmtDate } from "@/lib/date-format";

type VehicleLite = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  unit_number?: string | null;
  color?: string | null;
  license_plate?: string | null;
  status?: string | null;
  weekly_rate?: number | null;
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Record Rental — a rental that already started outside REAL RENTALS.
 * Check is read-only; Record runs one transaction after typed confirmation.
 * Never charges, subscribes, messages or creates a login.
 */
export function RecordRentalDialog({
  driver,
  vehicles,
  onClose,
  onRecorded,
}: {
  driver: { id: string; full_name?: string | null };
  vehicles: VehicleLite[];
  onClose: () => void;
  onRecorded: () => void;
}) {
  const preview = useServerFn(previewRecordRental);
  const record = useServerFn(recordExistingRental);

  const [query, setQuery] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [mileage, setMileage] = useState("");
  const [rate, setRate] = useState("");
  const [deposit, setDeposit] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<IntakePreflight | null>(null);
  const [busy, setBusy] = useState<"check" | "record" | null>(null);

  const env = (() => {
    try { return getStripeEnvironment(); } catch { return "sandbox" as const; }
  })();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles
      .filter((v) => v.status !== "archived")
      .filter((v) => !q || [v.unit_number, v.year, v.make, v.model, v.color, v.license_plate].join(" ").toLowerCase().includes(q))
      .slice(0, 50);
  }, [vehicles, query]);

  const payload = () => ({
    applicationId: driver.id,
    vehicleId,
    pickupDate,
    pickupMileage: mileage ? Math.round(Number(mileage)) : null,
    weeklyRate: Number(rate),
    depositCollected: deposit === "" ? null : Number(deposit),
    stripeCustomerId: customerId.trim() || null,
    stripeSubscriptionId: subscriptionId.trim() || null,
    environment: env,
  });

  // Any edit invalidates the last check — never record on stale results.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setResult(null); setConfirm(""); };

  async function runCheck() {
    setBusy("check");
    try { setResult(await preview({ data: payload() })); }
    catch (e: any) { toast.error(e?.message || "Check failed"); }
    finally { setBusy(null); }
  }

  async function runRecord() {
    setBusy("record");
    try {
      const r = await record({ data: { ...payload(), confirm, reason } });
      if (r.ok) { toast.success(`Rental recorded · ${r.paymentsRecorded} past payment(s)`); onRecorded(); }
      else setResult((prev) => ({ ...(prev as IntakePreflight), blockers: r.blockers }));
    } catch (e: any) { toast.error(e?.message || "Could not record rental"); }
    finally { setBusy(null); }
  }

  const ready = vehicleId && pickupDate && Number(rate) > 0;
  const clear = result && result.blockers.length === 0 && !result.stripeError;
  const canRecord = clear && confirm === RECORD_CONFIRM_PHRASE && reason.trim().length >= 5;

  return (
    <ModalShell onClose={onClose} size="lg" label="Record Rental">
      <ModalHeader title="Record Rental" subtitle={`${driver.full_name ?? "Driver"} · rental already started`} onClose={onClose} />
      <ModalBody>
        <div className="rounded-lg border border-[#E6E6EA] bg-[#FAFAFB] px-3 py-2 text-[12px] text-[#55555E] flex gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 text-[#1E7B4A]" />
          No charge, no new subscription, no welcome email or text, and no driver login.
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <MicroLabel>Vehicle</MicroLabel>
            <input className={inputCls} placeholder="Search unit, year, color, plate…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className={`${inputCls} mt-1.5`} value={vehicleId} onChange={(e) => edit(setVehicleId)(e.target.value)}>
              <option value="">Select vehicle</option>
              {matches.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.unit_number, v.year, v.color, v.make, v.model].filter(Boolean).join(" ")}{v.license_plate ? ` · ${v.license_plate}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label><MicroLabel>Pickup Date</MicroLabel>
              <input type="date" className={inputCls} value={pickupDate} onChange={(e) => edit(setPickupDate)(e.target.value)} /></label>
            <label><MicroLabel>Pickup Mileage</MicroLabel>
              <input inputMode="numeric" className={inputCls} placeholder="Optional" value={mileage} onChange={(e) => edit(setMileage)(e.target.value.replace(/\D/g, ""))} /></label>
            <label><MicroLabel>Weekly Rate</MicroLabel>
              <input inputMode="decimal" className={inputCls} placeholder="350" value={rate} onChange={(e) => edit(setRate)(e.target.value)} /></label>
            <label><MicroLabel>Deposit Collected</MicroLabel>
              <input inputMode="decimal" className={inputCls} placeholder="Not Set" value={deposit} onChange={(e) => edit(setDeposit)(e.target.value)} /></label>
          </div>
          <p className="text-[11.5px] text-[#77777F]">Open-ended — no end date. Leave Deposit blank if none was collected or it is unknown.</p>
          <div className="grid grid-cols-2 gap-3">
            <label><MicroLabel>Stripe Customer</MicroLabel>
              <input className={inputCls} placeholder="cus_…" value={customerId} onChange={(e) => edit(setCustomerId)(e.target.value)} /></label>
            <label><MicroLabel>Stripe Subscription</MicroLabel>
              <input className={inputCls} placeholder="sub_…" value={subscriptionId} onChange={(e) => edit(setSubscriptionId)(e.target.value)} /></label>
          </div>
        </div>

        {result ? (
          <div className="mt-4 space-y-2">
            {result.stripeError ? (
              <div className="text-[12px] text-[#B3261E]">Stripe: {result.stripeError}</div>
            ) : null}
            {result.blockers.length ? (
              <ul className="rounded-lg border border-[#F6CFCA] bg-[#FDECEA] px-3 py-2 space-y-1">
                {result.blockers.map((b) => (
                  <li key={b.code} className="flex gap-2 text-[12px] text-[#B3261E]"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{b.message}</li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-[#CFE8D9] bg-[#EEF8F2] px-3 py-2 text-[12px] text-[#1E5B3A] flex gap-2">
                <Check className="w-3.5 h-3.5 mt-0.5" /> All checks passed.
              </div>
            )}
            {result.subscription ? (
              <div className="rounded-lg border border-[#E6E6EA] px-3 py-2 text-[12px] text-[#28282E] space-y-0.5">
                <div>Subscription {result.subscription.status} · {result.subscription.weeklyAmount != null ? money(result.subscription.weeklyAmount) : "?"} / {result.subscription.interval ?? "?"}</div>
                <div>Next Billing: {result.subscription.nextBillingDate ? fmtDate(result.subscription.nextBillingDate) : "Not Set"}{result.subscription.cancelAtPeriodEnd ? " · cancels at period end" : ""}</div>
                <div>Past Payments To Record: {result.paymentsToImport.length} · Collected {money(result.collected)}</div>
              </div>
            ) : null}
            {clear ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <label><MicroLabel>Reason</MicroLabel>
                  <input className={inputCls} placeholder="e.g. Picked up Oct 15, paid via Stripe" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                <label><MicroLabel>Type {RECORD_CONFIRM_PHRASE} To Confirm</MicroLabel>
                  <input className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
              </div>
            ) : null}
          </div>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <ModalButton variant="ghost" onClick={onClose}>Cancel</ModalButton>
        {clear ? (
          <ModalButton variant="primary" onClick={runRecord} disabled={!canRecord || busy !== null}>
            {busy === "record" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Record Rental
          </ModalButton>
        ) : (
          <ModalButton variant="primary" onClick={runCheck} disabled={!ready || busy !== null}>
            {busy === "check" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Check
          </ModalButton>
        )}
      </ModalFooter>
    </ModalShell>
  );
}
