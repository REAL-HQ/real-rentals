import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AppSelect } from "@/components/ui/app-select";
import { Modal } from "@/components/admin/BookingModal";
import { PAYMENT_METHODS } from "@/lib/agreement-prep";
import { sendUpdatedAgreement } from "@/lib/rental-amendment.functions";
import { AMENDMENT_RATE_MAX, AMENDMENT_RATE_MIN } from "@/lib/rental-amendment";

const CONSENT_CHANNELS = [
  { value: "sms", label: "Text Message" },
  { value: "call", label: "Phone Call" },
  { value: "in_person", label: "In Person" },
  { value: "email", label: "Email" },
] as const;

/**
 * Send Updated Agreement: a new weekly rate for an active rental. The server
 * (rental-amendment.server.ts) stores the change as pending and sends the
 * same agreement through the normal e-sign flow; the rate changes only after
 * the renter signs, from the effective date or the next rent week. A rate
 * increase needs the renter's consent recorded here.
 */
export function UpdatedAgreementDialog({
  rentalId,
  currentRate,
  driverName,
  onClose,
  onSent,
}: {
  rentalId: string;
  currentRate: number | null;
  driverName: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const send = useServerFn(sendUpdatedAgreement);
  const [rate, setRate] = useState("");
  const [effective, setEffective] = useState("");
  const [reason, setReason] = useState("");
  const [channel, setChannel] = useState<string>("sms");
  const [receivedAt, setReceivedAt] = useState("");
  const [quote, setQuote] = useState("");
  const [ack, setAck] = useState(false);
  // v1.14 choices; blank = keep what the current signed agreement says.
  const [waiver, setWaiver] = useState("");
  const [schedule, setSchedule] = useState("");
  const [method, setMethod] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => `staff-${rentalId}-${Date.now().toString(36)}`);
  const newRate = Number(rate);
  const valid = Number.isFinite(newRate) && newRate > 0;
  const increase = valid && currentRate != null && newRate > currentRate;
  const outOfBounds = valid && (newRate < AMENDMENT_RATE_MIN || newRate > AMENDMENT_RATE_MAX);
  const consentGiven = receivedAt.trim() !== "" && quote.trim().length >= 2;
  const canSend = valid && newRate !== currentRate && reason.trim().length >= 5 && (!increase || consentGiven) && (!outOfBounds || ack) && !busy;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const at = receivedAt ? new Date(receivedAt) : null;
      const res = await send({
        data: {
          rentalId,
          newWeeklyRate: newRate,
          effectiveDate: effective || undefined,
          reason: reason.trim(),
          consent: consentGiven && at && !Number.isNaN(at.getTime()) ? { channel: channel as "sms", receivedAt: at.toISOString(), quote: quote.trim() } : undefined,
          outOfBoundsAck: outOfBounds ? ack : undefined,
          terms:
            waiver || schedule || method || owner.trim()
              ? {
                  damageWaiver: (waiver || undefined) as "accepted" | "declined" | undefined,
                  paymentSchedule: (schedule || undefined) as "weekly" | "every_4_weeks" | undefined,
                  paymentMethod: method || undefined,
                  vehicleOwner: owner.trim() || undefined,
                }
              : undefined,
          idempotencyKey: key,
        },
      });
      if (!res.ok) {
        setError(String(res.error ?? "The updated agreement was not sent."));
        return;
      }
      toast.success(`Updated agreement sent. The new rate starts after ${driverName ?? "the renter"} signs.`);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The updated agreement was not sent.");
    } finally {
      setBusy(false);
    }
  }

  const label = "text-[12px] font-medium text-[#55555E]";
  const input = "mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm bg-white";
  return (
    <Modal title="Send Updated Agreement" onClose={onClose} testId="updated-agreement-dialog">
      <div className="space-y-3">
        <p className="text-[13px] text-[#55555E]">
          Sends {driverName ?? "the renter"} the current rental agreement (v1.14) with the new weekly rate and a note at the top. No Reservation Fee, no new deposit, and paid weeks are not billed again. Nothing about the rental or billing changes until they sign. The current agreement stays on file.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className={label}>Current Weekly Rate</div>
            <div className="mt-1.5 text-sm text-[#111114]" data-testid="amend-current-rate">{currentRate != null ? `$${currentRate}` : "Not Set"}</div>
          </div>
          <label className="block">
            <span className={label}>New Weekly Rate</span>
            <input type="number" inputMode="decimal" min={1} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className={input} data-testid="amend-new-rate" />
          </label>
        </div>
        <label className="block">
          <span className={label}>Effective Date</span>
          <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className={input} data-testid="amend-effective-date" />
          <span className="mt-1 block text-[12px] text-[#77777F]">Leave blank for the next rent week. Never earlier than today. If they sign later, it starts with the next rent week after signing.</span>
        </label>
        <label className="block">
          <span className={label}>Reason</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={input} data-testid="amend-reason" />
        </label>
        <fieldset className="rounded-lg border border-[#EDEDF0] p-3">
          <legend className={`${label} px-1`}>Renter Agreed {increase ? "(Required For An Increase)" : "(Optional)"}</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>How</span>
              <AppSelect value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="How The Renter Agreed" className={input}>
                {CONSENT_CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </AppSelect>
            </label>
            <label className="block">
              <span className={label}>When</span>
              <input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={input} data-testid="amend-consent-at" />
            </label>
          </div>
          <label className="mt-3 block">
            <span className={label}>What They Said</span>
            <textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={2} className={input} data-testid="amend-consent-quote" />
          </label>
        </fieldset>
        <fieldset className="rounded-lg border border-[#EDEDF0] p-3">
          <legend className={`${label} px-1`}>Agreement Choices (Blank Keeps The Current Agreement&apos;s)</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>Damage Waiver</span>
              <AppSelect value={waiver} onChange={(e) => setWaiver(e.target.value)} aria-label="Damage Waiver" className={input}>
                <option value="">Keep Current</option>
                <option value="accepted">Accepted</option>
                <option value="declined">Declined</option>
              </AppSelect>
            </label>
            <label className="block">
              <span className={label}>Payment Schedule</span>
              <AppSelect value={schedule} onChange={(e) => setSchedule(e.target.value)} aria-label="Payment Schedule" className={input}>
                <option value="">Keep Current</option>
                <option value="weekly">Weekly</option>
                <option value="every_4_weeks">Every 4 Weeks</option>
              </AppSelect>
            </label>
            <label className="block">
              <span className={label}>Payment Method</span>
              <AppSelect value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment Method" className={input}>
                <option value="">Keep Current</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </AppSelect>
            </label>
            <label className="block">
              <span className={label}>Vehicle Owner</span>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Keep Current" className={input} data-testid="amend-vehicle-owner" />
            </label>
          </div>
        </fieldset>
        {outOfBounds && (
          <label className="flex items-start gap-2 text-[12px] text-[#C68A12]">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="amend-bounds-ack" />
            ${valid ? newRate : ""}/week is outside the usual ${AMENDMENT_RATE_MIN}–${AMENDMENT_RATE_MAX}. I confirm this rate is intended.
          </label>
        )}
        {error && (
          <p className="rounded-lg bg-[rgba(208,48,32,0.06)] px-3 py-2 text-[12px] text-[#D03020]" data-testid="amend-error">
            {error}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm">
          Cancel
        </button>
        <button
          onClick={go}
          disabled={!canSend}
          data-testid="amend-send"
          className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {busy ? "Sending…" : "Send Updated Agreement"}
        </button>
      </div>
    </Modal>
  );
}

