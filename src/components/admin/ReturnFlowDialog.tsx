import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { FileUploader } from "@/components/FileUploader";
import { supabase } from "@/integrations/supabase/client";
import { confirmConditionUpload, createConditionUploadUrl } from "@/lib/inspections.functions";
import {
  FUEL_OR_CHARGE_LEVELS,
  RETURN_PHOTO_BUCKET,
  etWallTime,
} from "@/lib/return-checklist";
import {
  RETURN_FLOW_ENABLED,
  RETURN_STEPS,
  detailsReady,
  moneyCents,
  photosReady,
  previewFinalAmount,
  type FinalChargeDraft,
  type ReturnBalanceSummary,
  type ReturnStepId,
  type SubscriptionCancelMode,
} from "@/lib/return-flow";
import {
  cancelReturnSubscription,
  completeReturn,
  createFinalInvoice,
  getReturnBalance,
} from "@/lib/return-flow.functions";
import { MicroLabel } from "./ui";

/**
 * Guided Return for an active rental. Manager+ only (server re-checks).
 * Steps: Details → Photos → Balance → Invoice → Billing → Done.
 * Cancel Reservation stays elsewhere; this is only for active rentals.
 */
export function ReturnFlowDialog({
  rentalId,
  driverName,
  onClose,
  onCompleted,
  onComposeMessage,
}: {
  rentalId: string;
  driverName?: string;
  onClose: () => void;
  onCompleted: () => void;
  /** Opens the existing SMS/email composer with a draft — never auto-sends. */
  onComposeMessage?: (draft: { applicationId: string | null; body: string; channel: "sms" | "email" }) => void;
}) {
  const loadBalance = useServerFn(getReturnBalance);
  const makeInvoice = useServerFn(createFinalInvoice);
  const cancelSub = useServerFn(cancelReturnSubscription);
  const finish = useServerFn(completeReturn);
  const startUpload = useServerFn(createConditionUploadUrl);
  const confirmUpload = useServerFn(confirmConditionUpload);

  const [step, setStep] = useState<ReturnStepId>("details");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<ReturnBalanceSummary | null>(null);

  const [returnedAtEt, setReturnedAtEt] = useState(etWallTime());
  const [mileage, setMileage] = useState("");
  const [fuelOrCharge, setFuelOrCharge] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [keysReturned, setKeysReturned] = useState<boolean | null>(null);
  const [destination, setDestination] = useState<"available" | "maintenance" | "needs_inspection">("needs_inspection");

  const [photos, setPhotos] = useState<Array<{ bucket: typeof RETURN_PHOTO_BUCKET; path: string; angle: string }>>([]);
  const [skipReason, setSkipReason] = useState("");
  const [angle, setAngle] = useState("front");

  const [extraCharges, setExtraCharges] = useState<FinalChargeDraft[]>([]);
  const [chargeLabel, setChargeLabel] = useState("");
  const [chargeCents, setChargeCents] = useState("");
  const [chargeKind, setChargeKind] = useState<FinalChargeDraft["kind"]>("damage");
  const [depositApply, setDepositApply] = useState(0);

  const [invoiceConfirm, setInvoiceConfirm] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [manualOwedLabel, setManualOwedLabel] = useState<string | null>(null);

  const [subMode, setSubMode] = useState<"period_end" | "now">("period_end");
  const [subConfirm, setSubConfirm] = useState(false);
  const [subDone, setSubDone] = useState<SubscriptionCancelMode>("none");
  const [resultBadge, setResultBadge] = useState<string | null>(null);

  useEffect(() => {
    if (!RETURN_FLOW_ENABLED) return;
    let live = true;
    loadBalance({ data: { rentalId } })
      .then((b) => {
        if (!live) return;
        setBalance(b);
        setDepositApply(b.depositApplyCents);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load balance.");
      });
    return () => {
      live = false;
    };
  }, [loadBalance, rentalId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const finalCents = useMemo(() => {
    if (!balance) return 0;
    return previewFinalAmount({
      owedCents: balance.totalOwedCents,
      depositApplyCents: depositApply,
      extraCharges,
    });
  }, [balance, depositApply, extraCharges]);

  if (!RETURN_FLOW_ENABLED) return null;

  async function uploadOne(file: File, onProgress: (pct: number) => void) {
    if (!balance?.vehicleId) throw new Error("This rental has no vehicle.");
    onProgress(10);
    const { path, token, bucket } = await startUpload({
      data: { vehicleId: balance.vehicleId, fileName: file.name, mimeType: file.type || "image/jpeg" },
    });
    if (bucket !== RETURN_PHOTO_BUCKET || !path.startsWith(`${balance.vehicleId}/`)) {
      throw new Error("Upload left the private condition bucket.");
    }
    onProgress(40);
    const { error: upErr } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, {
      contentType: file.type || undefined,
    });
    if (upErr) throw upErr;
    onProgress(80);
    await confirmUpload({
      data: {
        vehicleId: balance.vehicleId,
        rentalId,
        phase: "checkin",
        angle: angle as "front" | "rear" | "driver_side" | "passenger_side" | "interior_front" | "interior_rear" | "damage",
        path,
        fileName: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        caption: "Return",
      },
    });
    setPhotos((prev) => [...prev, { bucket: RETURN_PHOTO_BUCKET, path, angle }]);
    onProgress(100);
  }

  function goNext() {
    setError(null);
    if (step === "details") {
      if (!detailsReady({ returnedAtEt, mileage, fuelOrCharge }) || keysReturned == null) {
        setError("Enter return time, mileage, fuel or charge, and whether keys came back.");
        return;
      }
      setStep("photos");
      return;
    }
    if (step === "photos") {
      if (!photosReady({ photoCount: photos.length, skipReason })) {
        setError("Add photos, or enter a skip reason.");
        return;
      }
      setStep("balance");
      return;
    }
    if (step === "balance") {
      setStep("invoice");
      return;
    }
    if (step === "invoice") {
      setStep("billing");
      return;
    }
    if (step === "billing") {
      setStep("done");
    }
  }

  async function onCreateInvoice() {
    if (!balance) return;
    if (!invoiceConfirm) {
      setError("Check Confirm before creating the invoice.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!balance.hasStripeCustomer) {
        setManualOwedLabel(moneyCents(finalCents));
        toast.message("No Stripe customer — record the amount and send payment options manually.");
        setStep("billing");
        return;
      }
      if (finalCents <= 0) {
        setManualOwedLabel("$0.00");
        setStep("billing");
        return;
      }
      const res = await makeInvoice({
        data: {
          rentalId,
          amountCents: finalCents,
          description: `Final balance — ${balance.driverName}`,
          confirm: true as const,
          extraCharges,
        },
      });
      setInvoiceUrl(res.hostedUrl);
      toast.success("Final invoice created. Nothing was sent yet.");
      setStep("billing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function onCancelSubscription() {
    if (!subConfirm) {
      setError("Check Confirm before cancelling the subscription.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await cancelSub({ data: { rentalId, mode: subMode, confirm: true as const } });
      setSubDone(res.mode);
      toast.success(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the subscription.");
    } finally {
      setBusy(false);
    }
  }

  async function onComplete() {
    if (!balance?.vehicleId) {
      setError("This rental has no vehicle.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await finish({
        data: {
          rentalId,
          vehicleId: balance.vehicleId,
          returnedAtEt,
          mileage,
          fuelOrCharge: fuelOrCharge as "empty" | "quarter" | "half" | "three_quarter" | "full",
          conditionNotes,
          keysReturned: keysReturned === true,
          vehicleDestination: destination,
          photos,
          photosSkippedReason: photos.length ? null : skipReason,
          balanceDueCents: finalCents,
          depositApplyCents: depositApply,
          tollsTicketsNote: conditionNotes,
        },
      });
      setResultBadge(res.badge);
      toast.success(res.badge === "Balance Due" ? "Return complete — balance due." : "Return complete.");
      onCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the return.");
    } finally {
      setBusy(false);
    }
  }

  function draftMessage(channel: "sms" | "email") {
    const name = balance?.driverName || driverName || "there";
    const amount = moneyCents(finalCents);
    const link = invoiceUrl ? `\nPay here: ${invoiceUrl}` : "";
    const body =
      channel === "sms"
        ? `Hi ${name}, your Real Rentals return is recorded. Balance due: ${amount}.${link}\nReply if you have questions.`
        : `Hi ${name},\n\nYour Real Rentals return is recorded. Balance due: ${amount}.${link}\n\nThank you,\nReal Rentals`;
    onComposeMessage?.({ applicationId: balance?.applicationId ?? null, body, channel });
  }

  const title = "Return";

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="return-flow-dialog"
    >
      <div
        className="bg-white w-full max-w-lg min-h-full sm:min-h-0 rounded-none sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#EDEDF0] px-5 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-[#111114]">{title}</h3>
            <p className="text-[12px] text-[#55555E]">{balance?.driverName || driverName || "Active Rental"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[#9A9AA3] hover:bg-[#F4F4F6]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-[#EDEDF0] px-3 py-2">
          {RETURN_STEPS.map((s) => (
            <span
              key={s.id}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                s.id === step ? "bg-[#D03020] text-white" : "bg-[#F4F4F6] text-[#55555E]"
              }`}
            >
              {s.label}
            </span>
          ))}
        </div>

        <div className="space-y-4 p-5">
          {step === "details" && (
            <>
              <div>
                <MicroLabel>Return Date And Time (ET)</MicroLabel>
                <input
                  type="datetime-local"
                  value={returnedAtEt}
                  onChange={(e) => setReturnedAtEt(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                  aria-label="Return Date And Time"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <MicroLabel>Mileage</MicroLabel>
                  <input
                    value={mileage}
                    onChange={(e) => setMileage(e.target.value)}
                    inputMode="numeric"
                    placeholder="Odometer"
                    className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                    aria-label="Mileage"
                    data-testid="return-mileage"
                  />
                </div>
                <div>
                  <MicroLabel>Fuel Or Charge</MicroLabel>
                  <select
                    value={fuelOrCharge}
                    onChange={(e) => setFuelOrCharge(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                    aria-label="Fuel Or Charge"
                  >
                    <option value="">Choose</option>
                    {FUEL_OR_CHARGE_LEVELS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <MicroLabel>Condition Notes</MicroLabel>
                <textarea
                  value={conditionNotes}
                  onChange={(e) => setConditionNotes(e.target.value)}
                  rows={3}
                  className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                  aria-label="Condition Notes"
                />
              </div>
              <div>
                <MicroLabel>Keys Returned</MicroLabel>
                <div className="mt-1.5 flex gap-2">
                  {[true, false].map((v) => (
                    <button
                      key={String(v)}
                      type="button"
                      aria-pressed={keysReturned === v}
                      onClick={() => setKeysReturned(v)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-[13px] ${
                        keysReturned === v
                          ? "border-[#D03020] bg-[rgba(208,48,32,0.04)] font-medium text-[#111114]"
                          : "border-[#EDEDF0] bg-white text-[#55555E]"
                      }`}
                    >
                      {v ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <MicroLabel>Vehicle Goes To</MicroLabel>
                <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      ["needs_inspection", "Inspection"],
                      ["available", "Available"],
                      ["maintenance", "Maintenance"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={destination === id}
                      onClick={() => setDestination(id)}
                      className={`rounded-lg border px-3 py-2 text-[13px] ${
                        destination === id
                          ? "border-[#D03020] bg-[rgba(208,48,32,0.04)] font-medium text-[#111114]"
                          : "border-[#EDEDF0] bg-white text-[#55555E]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-[#9A9AA3]">Inspection and Maintenance both send the car to maintenance until readiness clears.</p>
              </div>
            </>
          )}

          {step === "photos" && (
            <>
              <p className="text-[13px] text-[#55555E]">Drag and drop or click to upload. Photos stay in the private condition bucket.</p>
              <div>
                <MicroLabel>Angle</MicroLabel>
                <select
                  value={angle}
                  onChange={(e) => setAngle(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                >
                  {["front", "rear", "driver_side", "passenger_side", "interior_front", "interior_rear", "damage"].map((a) => (
                    <option key={a} value={a}>
                      {a.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <FileUploader upload={(file, ctx) => uploadOne(file, ctx.onProgress)} accept="image/*" multiple label="Return Photos" title="Return Photos" />
              {photos.length > 0 && (
                <ul className="space-y-1 text-[12px] text-[#55555E]" data-testid="return-photo-list">
                  {photos.map((p) => (
                    <li key={p.path} className="truncate">
                      {p.angle}: {p.path.split("/").pop()}
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <MicroLabel>Skip Reason</MicroLabel>
                <input
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  placeholder="Required if skipping photos"
                  className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                  aria-label="Skip Reason"
                />
              </div>
            </>
          )}

          {step === "balance" && (
            <>
              {!balance ? (
                <p className="text-[13px] text-[#55555E]">Loading balance…</p>
              ) : (
                <>
                  <ul className="space-y-2" data-testid="return-balance-lines">
                    {balance.lines.length === 0 ? (
                      <li className="text-[13px] text-[#55555E]">No unpaid rent or fees on file.</li>
                    ) : (
                      balance.lines.map((line) => (
                        <li key={line.key} className="flex justify-between text-[13px]">
                          <span className={line.waived ? "text-[#9A9AA3] line-through" : "text-[#111114]"}>
                            {line.label}
                            {line.waived ? " (Waived)" : ""}
                          </span>
                          <span className="tabular-nums">{moneyCents(line.cents)}</span>
                        </li>
                      ))
                    )}
                  </ul>
                  {balance.depositHeldCents > 0 && (
                    <div>
                      <MicroLabel>Apply Deposit</MicroLabel>
                      <input
                        type="number"
                        min={0}
                        max={balance.depositHeldCents / 100}
                        step="0.01"
                        value={(depositApply / 100).toFixed(2)}
                        onChange={(e) => setDepositApply(Math.round(Number(e.target.value || 0) * 100))}
                        className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-[11px] text-[#9A9AA3]">Held {moneyCents(balance.depositHeldCents)}</p>
                    </div>
                  )}
                  <div className="rounded-lg border border-[#EDEDF0] p-3 space-y-2">
                    <MicroLabel>Add Charge</MicroLabel>
                    <input
                      value={chargeLabel}
                      onChange={(e) => setChargeLabel(e.target.value)}
                      placeholder="Damage, Cleaning, Toll…"
                      className="w-full rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <select
                        value={chargeKind}
                        onChange={(e) => setChargeKind(e.target.value as FinalChargeDraft["kind"])}
                        className="rounded-lg border border-[#EDEDF0] bg-white px-2 py-2 text-sm"
                      >
                        <option value="damage">Damage</option>
                        <option value="cleaning">Cleaning</option>
                        <option value="toll">Toll</option>
                        <option value="other">Other</option>
                      </select>
                      <input
                        value={chargeCents}
                        onChange={(e) => setChargeCents(e.target.value)}
                        placeholder="0.00"
                        inputMode="decimal"
                        className="flex-1 rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        className="rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm"
                        onClick={() => {
                          const cents = Math.round(Number(chargeCents) * 100);
                          if (!chargeLabel.trim() || !Number.isFinite(cents) || cents <= 0) return;
                          setExtraCharges((prev) => [...prev, { label: chargeLabel.trim(), cents, kind: chargeKind }]);
                          setChargeLabel("");
                          setChargeCents("");
                        }}
                      >
                        Add
                      </button>
                    </div>
                    {extraCharges.map((c, i) => (
                      <div key={`${c.label}-${i}`} className="flex justify-between text-[12px]">
                        <span>
                          {c.label} ({c.kind})
                        </span>
                        <span className="tabular-nums">{moneyCents(c.cents)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[14px] font-semibold text-[#111114]" data-testid="return-final-amount">
                    Final {moneyCents(finalCents)}
                  </p>
                </>
              )}
            </>
          )}

          {step === "invoice" && (
            <>
              <p className="text-[13px] text-[#55555E]">
                {balance?.hasStripeCustomer
                  ? "Creates a one-off invoice for this renter's Stripe customer. Nothing is emailed or texted until you send it."
                  : "No Stripe customer on file. We'll show the amount owed and manual payment options on the next step."}
              </p>
              <p className="text-[14px] font-semibold">Amount {moneyCents(finalCents)}</p>
              {balance?.hasStripeCustomer && finalCents > 0 && (
                <label className="flex items-center gap-2 text-[13px] text-[#111114]">
                  <input type="checkbox" checked={invoiceConfirm} onChange={(e) => setInvoiceConfirm(e.target.checked)} />
                  Confirm create invoice
                </label>
              )}
              {invoiceUrl && (
                <p className="break-all text-[12px] text-[#55555E]">
                  Invoice ready:{" "}
                  <a className="text-[#D03020] underline" href={invoiceUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </p>
              )}
              {manualOwedLabel && <p className="text-[13px]">Manual amount owed: {manualOwedLabel}</p>}
            </>
          )}

          {step === "billing" && (
            <>
              {(balance?.stripeSubscriptionId || balance?.autopayActive) && subDone === "none" ? (
                <>
                  <p className="flex items-start gap-1.5 text-[13px] text-[#C68A12]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />A weekly Stripe subscription is still on. Cancel it before completing.
                  </p>
                  <div className="flex gap-2">
                    {(
                      [
                        ["period_end", "At Period End"],
                        ["now", "Cancel Now"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={subMode === id}
                        onClick={() => setSubMode(id)}
                        className={`flex-1 rounded-lg border px-3 py-2 text-[13px] ${
                          subMode === id
                            ? "border-[#D03020] bg-[rgba(208,48,32,0.04)] font-medium"
                            : "border-[#EDEDF0] bg-white text-[#55555E]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={subConfirm} onChange={(e) => setSubConfirm(e.target.checked)} />
                    Confirm cancel subscription
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onCancelSubscription}
                    className="rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    {busy ? "Cancelling…" : "Cancel Subscription"}
                  </button>
                </>
              ) : (
                <p className="text-[13px] text-[#55555E]">
                  {subDone === "now"
                    ? "Subscription cancelled."
                    : subDone === "period_end"
                      ? "Subscription set to end after this period."
                      : "No weekly subscription on this rental."}
                </p>
              )}
              <div className="space-y-2 rounded-lg border border-[#EDEDF0] p-3">
                <p className="text-[12px] font-medium text-[#111114]">Final Message</p>
                <p className="text-[12px] text-[#55555E]">Opens the existing composer. You confirm Send From (default 888). Nothing auto-sends.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm" onClick={() => draftMessage("sms")}>
                    Draft SMS
                  </button>
                  <button type="button" className="rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-sm" onClick={() => draftMessage("email")}>
                    Draft Email
                  </button>
                </div>
              </div>
            </>
          )}

          {step === "done" && (
            <>
              <p className="text-[13px] text-[#55555E]">
                Completing marks the rental Closed, sets the vehicle destination, keeps portal access, and records any balance due for the Past tab.
              </p>
              {resultBadge && <p className="text-[14px] font-semibold">{resultBadge}</p>}
            </>
          )}

          {error && (
            <p className="rounded-lg bg-[rgba(208,48,32,0.06)] px-3 py-2 text-[12px] text-[#D03020]" data-testid="return-flow-error">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-[#EDEDF0] px-5 py-4">
          <button
            type="button"
            onClick={() => {
              setError(null);
              if (step === "details") onClose();
              else {
                const order = RETURN_STEPS.map((s) => s.id);
                const i = order.indexOf(step);
                if (i > 0) setStep(order[i - 1]);
              }
            }}
            className="rounded-lg border border-[#EDEDF0] bg-white px-4 py-2 text-sm"
          >
            {step === "details" ? "Cancel" : "Back"}
          </button>
          <div className="flex gap-2">
            {step === "invoice" && balance?.hasStripeCustomer && finalCents > 0 && !invoiceUrl ? (
              <button
                type="button"
                disabled={busy}
                onClick={onCreateInvoice}
                className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create Invoice
              </button>
            ) : null}
            {step === "invoice" && (invoiceUrl || !balance?.hasStripeCustomer || finalCents <= 0) ? (
              <button type="button" onClick={goNext} className="rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white">
                Continue
              </button>
            ) : null}
            {step !== "invoice" && step !== "done" ? (
              <button
                type="button"
                onClick={goNext}
                disabled={step === "billing" && !!(balance?.stripeSubscriptionId || balance?.autopayActive) && subDone === "none"}
                className="rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Continue
              </button>
            ) : null}
            {step === "done" ? (
              <button
                type="button"
                disabled={busy}
                onClick={onComplete}
                data-testid="return-complete"
                className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy ? "Saving…" : "Complete"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
