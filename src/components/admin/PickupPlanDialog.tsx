import { useState } from "react";
import { createPortal } from "react-dom";
import { Field, FormGrid, inputCls, ModalBody, ModalButton, ModalFooter, ModalHeader, ModalShell } from "./modal";
import { VehicleCombobox, type VehicleComboboxVehicle } from "./VehicleCombobox";
import type { PickupPlan } from "@/lib/pickup-plan";

/** Unmounted preparation form: no live save callback or data loader. */
export function PickupPlanDialog({ plan, vehicles, onClose }: {
  plan: PickupPlan | null; vehicles: VehicleComboboxVehicle[]; onClose: () => void;
}) {
  const [vehicleId, setVehicleId] = useState<string | null>(plan?.vehicleId ?? null);
  // Draft values are never converted/saved as UTC without reviewed timezone handling.
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timeZone, setTimeZone] = useState(plan?.timeZone ?? "");
  const [location, setLocation] = useState(plan?.location ?? "");
  const [reason, setReason] = useState("");
  return createPortal(<div onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <ModalShell label="Pickup Plan" size="md" z="z-[80]" onClose={onClose}>
      <ModalHeader title="Pickup Plan" subtitle={plan ? `Revision ${plan.revision}` : "Appointment Not Confirmed"} onClose={onClose} />
      <ModalBody className="space-y-4">
        <Field label="Assigned Vehicle" required><VehicleCombobox vehicles={vehicles} value={vehicleId} onChange={setVehicleId} aria-label="Assigned Vehicle" /></Field>
        <FormGrid cols={2}>
          <Field label="Pickup Date" required><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Pickup Time" required><input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </FormGrid>
        <Field label="Time Zone" required><input className={inputCls} value={timeZone} placeholder="Not Set" onChange={(e) => setTimeZone(e.target.value)} /></Field>
        <Field label="Pickup Location" required><textarea className={`${inputCls} h-auto py-2`} rows={2} value={location} maxLength={500} placeholder="Not Set" onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Change Reason" required><textarea className={`${inputCls} h-auto py-2`} rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
        <p role="status" className="text-xs text-warning-foreground">Pickup Plan Saving Awaits The Approved Database Update.</p>
      </ModalBody>
      <ModalFooter><ModalButton onClick={onClose}>Cancel</ModalButton><ModalButton variant="primary" disabled>Save Plan</ModalButton></ModalFooter>
    </ModalShell>
  </div>, document.body);
}