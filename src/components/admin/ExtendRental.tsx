import { useEffect, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, Loader2, X } from "lucide-react";
import { fmtDate } from "@/lib/date-format";
import {
  BILLING_EFFECT_LABEL,
  EXTEND_RENTAL_ENABLED,
  addCalendarDays,
  easternToday,
  extensionPreview,
  formatExtraWeeks,
} from "@/lib/extend-rental";
import { extendRental, loadExtendContext, type ExtendRentalResult } from "@/lib/extend-rental.functions";

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ExtendRentalButton({
  rentalId,
  phase,
  canManage,
  onExtended,
}: {
  rentalId: string;
  phase: string;
  canManage: boolean;
  onExtended: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!EXTEND_RENTAL_ENABLED || phase !== "active" || !canManage) return null;
  return (
    <div className="mt-3">
      <button
        type="button"
        data-testid="extend-rental"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#EDEDF0] bg-white px-3 py-2 text-[13px] text-[#55555E] hover:border-[#D7D7DC] hover:text-[#111114]"
      >
        <CalendarPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
        Extend Rental
      </button>
      {EXTEND_RENTAL_ENABLED && open ? (
        <ExtendRentalDialog
          rentalId={rentalId}
          onClose={() => setOpen(false)}
          onExtended={onExtended}
        />
      ) : null}
    </div>
  );
}

function ExtendRentalDialog({
  rentalId,
  onClose,
  onExtended,
}: {
  rentalId: string;
  onClose: () => void;
  onExtended: () => void;
}) {
  const load = useServerFn(loadExtendContext);
  const extend = useServerFn(extendRental);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const [context, setContext] = useState<Awaited<ReturnType<typeof load>> | null>(null);
  const [newEnd, setNewEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ExtendRentalResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    load({ data: { rentalId } })
      .then((row) => {
        if (!cancelled) setContext(row);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Extend Rental could not be loaded");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, rentalId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const preview =
    context && newEnd
      ? extensionPreview({
          currentEnd: context.endDate,
          newEnd,
          weeklyRate: context.weeklyRate,
          nextPaymentDue: context.nextPaymentDue,
        })
      : null;
  const reasonOk = reason.trim().length >= 5 && reason.trim().length <= 500;
  const minEnd = context?.endDate
    ? (() => {
        const dayAfter = addCalendarDays(context.endDate, 1);
        const today = easternToday();
        const tomorrow = addCalendarDays(today, 1);
        return dayAfter > today ? dayAfter : tomorrow;
      })()
    : addCalendarDays(easternToday(), 1);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!EXTEND_RENTAL_ENABLED || !context?.endDate || !preview || !preview.ok || !reasonOk) return;
    setSaving(true);
    setError(null);
    try {
      const key = JSON.stringify({
        rentalId,
        expectedEnd: context.endDate,
        newEnd,
        reason: reason.trim(),
      });
      const operationId = operation.current?.key === key ? operation.current.id : crypto.randomUUID();
      operation.current = { key, id: operationId };
      const saved = await extend({
        data: {
          operationId,
          rentalId,
          expectedEnd: context.endDate,
          newEnd,
          reason: reason.trim(),
        },
      });
      setResult(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extend Rental could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-testid="extend-rental-dialog"
        className="min-h-full w-full max-w-lg bg-white shadow-2xl sm:min-h-0 sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#EDEDF0] px-5 py-4">
          <h3 className="text-[15px] font-semibold text-[#111114]">Extend Rental</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-[#9A9AA3] hover:bg-[#F4F4F6] hover:text-[#111114]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form
          className="space-y-4 p-5"
          onSubmit={(event) => {
            void onSubmit(event);
          }}
        >
          {loading && (
            <p className="flex items-center gap-2 text-[13px] text-[#55555E]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
            </p>
          )}
          {context && (
            <p className="text-[13px] text-[#55555E]">
              Current End Date: {context.endDate ? fmtDate(context.endDate) : "Open-ended"}
            </p>
          )}
          {context && !context.endDate && (
            <p className="text-[13px] text-[#55555E]">
              An end date is required before this rental can be extended.
            </p>
          )}
          {context?.endDate && !result && (
            <>
              <label className="block text-[12px] text-[#55555E]">
                New End Date
                <input
                  type="date"
                  required
                  min={minEnd}
                  value={newEnd}
                  onChange={(event) => setNewEnd(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1.5 text-[13px]"
                />
                <span className="mt-1 block text-[11px] text-[#9A9AA3]">Eastern Time</span>
              </label>
              {preview?.ok && (
                <dl className="grid grid-cols-1 gap-2 rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] p-3 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#55555E]">Extra Weeks</dt>
                    <dd className="text-[#111114]">{preview.extraWeeksLabel}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#55555E]">Extension Cost</dt>
                    <dd className="text-[#111114]">{usd(preview.extensionCost)}</dd>
                  </div>
                  <div>
                    <dt className="text-[#55555E]">Next Billing Date</dt>
                    <dd className="text-[#111114]">
                      {preview.nextPaymentDue ? fmtDate(preview.nextPaymentDue) : "Not Recorded"}
                      {" — "}
                      {BILLING_EFFECT_LABEL[preview.effect]}
                    </dd>
                    {preview.includedCharges.length > 0 && (
                      <dd className="mt-1 text-[12px] text-[#55555E]">
                        {preview.includedCharges.map((day) => fmtDate(day)).join(", ")}
                      </dd>
                    )}
                  </div>
                </dl>
              )}
              {preview && !preview.ok && <p className="text-[12px] text-[#D03020]">{preview.error}</p>}
              <label className="block text-[12px] text-[#55555E]">
                Reason
                <textarea
                  required
                  minLength={5}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1.5 text-[13px]"
                />
              </label>
              <p className="text-[12px] text-[#55555E]">Stripe is not called. Proration is none.</p>
            </>
          )}
          {result && <BillingPlan result={result} />}
          {error && (
            <p className="rounded-lg bg-[rgba(208,48,32,0.06)] px-3 py-2 text-[12px] text-[#D03020]">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm">
              {result ? "Close" : "Cancel"}
            </button>
            {result ? (
              <button
                type="button"
                onClick={() => {
                  onExtended();
                  onClose();
                }}
                className="rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white"
              >
                Done
              </button>
            ) : (
              <button
                type="submit"
                disabled={saving || loading || !preview?.ok || !reasonOk}
                className="inline-flex items-center gap-2 rounded-lg bg-[#D03020] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Extend Rental
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function BillingPlan({ result }: { result: ExtendRentalResult }) {
  const plan = result.billingPlan;
  const call = plan.stripe.call;
  return (
    <div className="space-y-2 rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] p-3 text-[13px]" data-testid="extend-billing-plan">
      <p className="font-medium text-[#111114]">Billing Plan</p>
      <p className="text-[#55555E]">
        Extra Weeks: {formatExtraWeeks(result.extraDays)}. Extension Cost: {usd(result.extensionCost)}.
      </p>
      <p className="text-[#55555E]">
        Next Billing Date: {plan.nextPaymentDue ? fmtDate(plan.nextPaymentDue) : "Not Recorded"} —{" "}
        {BILLING_EFFECT_LABEL[plan.effect]}
      </p>
      <p className="text-[#55555E]">Proration: none. Stripe is not called.</p>
      {call && plan.stripe.params ? (
        <p className="text-[#55555E]">
          Logged Call: {call} cancel_at {plan.stripe.params.cancel_at}, proration_behavior none. Not Sent.
        </p>
      ) : (
        <p className="text-[#55555E]">No Subscription Is On File</p>
      )}
    </div>
  );
}
