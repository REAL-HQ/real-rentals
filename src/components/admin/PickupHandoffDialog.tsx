import { createPortal } from "react-dom";
import { useState } from "react";
import { Check, Circle } from "lucide-react";
import { Field, FormGrid, inputCls, ModalBody, ModalButton, ModalFooter, ModalHeader, ModalShell } from "./modal";
import type { PickupPacket } from "@/lib/pickup-plan";
import type { ActivationRequirement } from "@/lib/activation-readiness";
import { PortalPickupPlan } from "@/components/portal/PortalPickupPlan";
import { PICKUP_PAYMENT_METHODS } from "@/lib/pickup-options";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Prepared review only; never calls activation or modifies evidence. */
export function PickupHandoffDialog({ packet, requirements, paymentVerified, onClose }: {
  packet: PickupPacket | null; requirements: ActivationRequirement[]; paymentVerified: boolean; onClose: () => void;
}) {
  const [method, setMethod] = useState("");
  const [otherMethod, setOtherMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [payer, setPayer] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const items = [
    { key: "appointment", label: "Confirmed Pickup", met: packet !== null },
    { key: "payment", label: "Applicable Payment Collected", met: paymentVerified },
    ...requirements.filter((r) => ["inspection", "signed_agreement", "insurance_verified"].includes(r.key)),
  ];
  return createPortal(<div onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <ModalShell label="Key Handoff" size="md" z="z-[80]" onClose={onClose}>
      <ModalHeader title="Key Handoff" onClose={onClose} />
      <ModalBody className="space-y-4">
        <PortalPickupPlan packet={packet} showLinks={false} />
        <ul className="divide-y divide-border">{items.map((item) => <li key={item.key} className="flex min-h-11 items-center gap-2 text-sm">
          {item.met === true ? <Check className="h-4 w-4 shrink-0 text-success" aria-label="Complete" /> : <Circle className="h-4 w-4 shrink-0 text-destructive" aria-label="Incomplete" />}
          <span>{item.label}</span>
        </li>)}</ul>
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Payment Review</summary>
          <div className="mt-4 space-y-4">
            <Field label="Payment Method"><Select value={method} onValueChange={setMethod}><SelectTrigger aria-label="Payment Method"><SelectValue placeholder="Not Set" /></SelectTrigger><SelectContent>{PICKUP_PAYMENT_METHODS.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></Field>
            {method === "other" ? <Field label="Other Method" required><input aria-label="Other Method" className={inputCls} value={otherMethod} maxLength={100} onChange={(e) => setOtherMethod(e.target.value)} /></Field> : null}
            <FormGrid cols={2}>
              <Field label="Amount ($)" required><input aria-label="Amount ($)" inputMode="decimal" className={inputCls} value={amount} placeholder="Not Set" onChange={(e) => setAmount(e.target.value)} /></Field>
              <Field label="Payment Date" required><input aria-label="Payment Date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            </FormGrid>
            <Field label="Payer" required><input aria-label="Payer" className={inputCls} value={payer} maxLength={200} onChange={(e) => setPayer(e.target.value)} /></Field>
            <Field label="Payment Reference" required><input aria-label="Payment Reference" className={inputCls} value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Evidence Note" required><textarea aria-label="Evidence Note" className={`${inputCls} h-auto py-2`} rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
            <p role="status" className="text-xs text-warning-foreground">Payment Verification Awaits Approved Saved Evidence.</p>
            <ModalButton disabled>Save Verification</ModalButton>
          </div>
        </details>
        <p role="status" className="text-xs text-warning-foreground">Handoff Activation Awaits The Approved Atomic Rental Update.</p>
      </ModalBody>
      <ModalFooter><ModalButton onClick={onClose}>Cancel</ModalButton><ModalButton variant="primary" disabled>Activate</ModalButton></ModalFooter>
    </ModalShell>
  </div>, document.body);
}