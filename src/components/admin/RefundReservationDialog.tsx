import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppSelect } from "@/components/ui/app-select";
import { refundReservationFeePayment } from "@/lib/reservation-fee-refund.functions";
import {
  RESERVATION_FEE_REFUND_POLICY_STAFF,
  RESERVATION_FEE_REFUND_REASONS,
  RESERVATION_FEE_REFUND_REASON_LABEL,
  parseReservationFeeRefundReason,
  reservationFeeRefundedDetail,
} from "@/lib/reservation-fee-refund";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB]";

export function RefundReservationDialog({
  open,
  onOpenChange,
  paymentId,
  driverName,
  amount,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentId: string;
  driverName: string;
  amount: number;
  onDone: (result: { status: "refunded" | "already"; reason: string }) => void;
}) {
  const refund = useServerFn(refundReservationFeePayment);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setNote("");
      setPolicyError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!parseReservationFeeRefundReason(reason)) {
      setPolicyError(`Choose a refundable reason. ${RESERVATION_FEE_REFUND_POLICY_STAFF}`);
      return;
    }
    setPolicyError(null);
    setBusy(true);
    try {
      const res = await refund({ data: { paymentId, reason: reason as any, note: note.trim() || null } });
      if (res.status === "blocked") {
        setPolicyError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(res.status === "already" ? reservationFeeRefundedDetail(res.reason) : `Refunded $${res.amount.toFixed(2)} — ${reservationFeeRefundedDetail(res.reason)}`);
      onOpenChange(false);
      onDone({ status: res.status, reason: res.reason });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refund the Reservation Fee.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white">
        <DialogHeader>
          <DialogTitle>Refund Reservation Fee: {driverName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#55555E]">
          Refunds ${amount.toFixed(2)} to the original card. This is allowed only for the reasons below. A Reservation Fee can be refunded once.
        </p>
        <p className="text-[11px] text-[#55555E]">{RESERVATION_FEE_REFUND_POLICY_STAFF}</p>
        <div className="grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason</label>
            <AppSelect className={input} value={reason} onChange={(e) => { setReason(e.target.value); setPolicyError(null); }} aria-label="Refund reason">
              <option value="">Choose a refundable reason</option>
              {RESERVATION_FEE_REFUND_REASONS.map((r) => (
                <option key={r} value={r}>{RESERVATION_FEE_REFUND_REASON_LABEL[r]}</option>
              ))}
            </AppSelect>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Note (optional)</label>
            <textarea className={input} rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} aria-label="Refund note" />
          </div>
          {policyError ? <p className="text-sm text-[#8A1C10]">{policyError}</p> : null}
        </div>
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={primary} disabled={busy} onClick={() => void submit()}>
            {busy ? "Refunding…" : `Refund $${amount.toFixed(2)}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
