import { createPortal } from "react-dom";
import { Check, Circle } from "lucide-react";
import { ModalBody, ModalButton, ModalFooter, ModalHeader, ModalShell } from "./modal";
import type { PickupPacket } from "@/lib/pickup-plan";
import type { ActivationRequirement } from "@/lib/activation-readiness";
import { PortalPickupPlan } from "@/components/portal/PortalPickupPlan";

/** Prepared review only; never calls activation or modifies evidence. */
export function PickupHandoffDialog({ packet, requirements, paymentVerified, onClose }: {
  packet: PickupPacket | null; requirements: ActivationRequirement[]; paymentVerified: boolean; onClose: () => void;
}) {
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
        <p role="status" className="text-xs text-warning-foreground">Handoff Activation Awaits The Approved Atomic Rental Update.</p>
      </ModalBody>
      <ModalFooter><ModalButton onClick={onClose}>Cancel</ModalButton><ModalButton variant="primary" disabled>Activate</ModalButton></ModalFooter>
    </ModalShell>
  </div>, document.body);
}