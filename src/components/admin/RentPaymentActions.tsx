import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MANUAL_METHODS, easternParts, money } from "@/lib/rent-reminders";
import { recordRentPayment, waiveLateFee, type RentalLateFeeStatus } from "@/lib/rent-reminders.functions";

// Active Rentals → Record Payment (manual payers only) and Waive Late Fee.
// Neither sends a message or charges a card.

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function lateFeeLabel(s: RentalLateFeeStatus | undefined, loaded: boolean): string {
  if (!loaded) return "Loading…";
  if (!s) return "Unavailable";
  if (!s.owing) return "None";
  if (s.waived) return "Waived";
  if (s.lateFee <= 0) return "None Yet";
  return money(s.lateFee);
}

export function RecordPaymentDialog({
  open, onOpenChange, rentalId, driverName, weeklyRate, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; rentalId: string; driverName: string; weeklyRate: number | null; onSaved: () => void;
}) {
  const save = useServerFn(recordRentPayment);
  const [amount, setAmount] = useState(weeklyRate ? String(weeklyRate) : "");
  const [method, setMethod] = useState<string>(MANUAL_METHODS[0].value);
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(easternParts(new Date()).date);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const n = Number(amount);
    if (!(n > 0)) { toast.error("Enter An Amount"); return; }
    setBusy(true);
    try {
      const res = await save({ data: { rentalId, amount: n, method, reference: reference.trim() || null, paidOn } });
      toast.success(res.covered ? `Payment Recorded. Next Due ${res.nextDue}. Reminders Stop For This Week.` : "Payment Recorded. The Week Is Not Fully Paid Yet.");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Record The Payment");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white">
        <DialogHeader><DialogTitle>Record Payment: {driverName}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Amount"><input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" /></Field>
          <Field label="Method">
            <select className={input} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
              {MANUAL_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Reference"><input className={input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Confirmation Or Note" aria-label="Reference" /></Field>
          <Field label="Date Paid"><input className={input} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Date Paid" /></Field>
        </div>
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={primary} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Record Payment"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WaiveLateFeeDialog({
  open, onOpenChange, rentalId, driverName, status, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; rentalId: string; driverName: string; status: RentalLateFeeStatus | undefined; onSaved: () => void;
}) {
  const save = useServerFn(waiveLateFee);
  const [wholeWeek, setWholeWeek] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dueDate = status?.dueDate ?? null;
  const submit = async () => {
    if (!dueDate) { toast.error("No Due Date To Waive"); return; }
    if (!reason.trim()) { toast.error("Enter A Reason"); return; }
    setBusy(true);
    try {
      await save({ data: { rentalId, dueDate, wholeWeek, reason: reason.trim(), amountWaived: status?.lateFee ?? null } });
      toast.success("Late Fee Waived");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Waive The Late Fee");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white">
        <DialogHeader><DialogTitle>Waive Late Fee: {driverName}</DialogTitle></DialogHeader>
        <div className="grid gap-3 text-sm">
          <p className="text-[#55555E]">
            Week Due {dueDate ?? "Unknown"} · Late Fee Now {status ? money(status.lateFee) : "Unavailable"}. Nothing is sent to the renter.
          </p>
          <Field label="Waive">
            <select className={input} value={wholeWeek ? "week" : "today"} onChange={(e) => setWholeWeek(e.target.value === "week")} aria-label="Waive">
              <option value="week">Whole Week</option>
              <option value="today">Through Today Only</option>
            </select>
          </Field>
          <Field label="Reason"><input className={input} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" /></Field>
        </div>
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={primary} disabled={busy || !dueDate} onClick={submit}>{busy ? "Saving…" : "Waive Late Fee"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
