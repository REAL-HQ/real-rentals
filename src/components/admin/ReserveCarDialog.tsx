import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VehicleCombobox } from "@/components/admin/VehicleCombobox";
import {
  createReservation,
  getReservationDepositSettings,
  listApprovedForReservation,
  listVehiclesForReservation,
} from "@/lib/reservations.functions";
import type { ReservationDepositSettings } from "@/lib/reservation-deposit-settings";
import { easternParts } from "@/lib/rent-reminders";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary =
  "inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary =
  "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/**
 * Shared Reserved action: from Next Step after approval, or Bookings → Booked.
 * Only approved / active applicants. Sends the Booking Login Email once when
 * automation is On. Never marks insurance or verification complete.
 */
export function ReserveCarDialog({
  open,
  onOpenChange,
  applicationId,
  driverName,
  settings,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When set (driver profile), the person is locked in. */
  applicationId?: string | null;
  driverName?: string | null;
  settings?: ReservationDepositSettings | null;
  onSaved: () => void;
}) {
  const create = useServerFn(createReservation);
  const loadVehicles = useServerFn(listVehiclesForReservation);
  const loadPeople = useServerFn(listApprovedForReservation);
  const loadSettings = useServerFn(getReservationDepositSettings);
  const [resolvedSettings, setResolvedSettings] = useState<ReservationDepositSettings | null>(settings ?? null);
  const [vehicles, setVehicles] = useState<Array<{ id: string; unit_number: string | null; year: number | null; make: string | null; model: string | null; status: string | null }>>([]);
  const [people, setPeople] = useState<Array<{ id: string; full_name: string | null; email: string | null }>>([]);
  const [personId, setPersonId] = useState(applicationId ?? "");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [pickupDate, setPickupDate] = useState(easternParts(new Date()).date);
  const [pickupTime, setPickupTime] = useState("09:00");
  const [pickupLocation, setPickupLocation] = useState("");
  const [note, setNote] = useState("");
  const depositOn = resolvedSettings?.enabled === true;
  const [depositRequired, setDepositRequired] = useState(depositOn);
  const [depositAmount, setDepositAmount] = useState(depositOn && settings ? String(settings.defaultAmount || "") : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPersonId(applicationId ?? "");
    setVehicleId(null);
    setPickupDate(easternParts(new Date()).date);
    setPickupTime("09:00");
    setPickupLocation("");
    setNote("");
    const applySettings = (s: ReservationDepositSettings | null) => {
      setResolvedSettings(s);
      setDepositRequired(s?.enabled === true);
      setDepositAmount(s?.enabled && s.defaultAmount > 0 ? String(s.defaultAmount) : "");
    };
    if (settings) applySettings(settings);
    else {
      loadSettings()
        .then(applySettings)
        .catch(() => applySettings(null));
    }
    loadVehicles()
      .then(setVehicles)
      .catch(() => setVehicles([]));
    if (!applicationId) {
      loadPeople()
        .then(setPeople)
        .catch(() => setPeople([]));
    }
  }, [open, applicationId, settings, loadVehicles, loadPeople, loadSettings]);

  const submit = async () => {
    const appId = applicationId || personId;
    if (!appId) {
      toast.error("Pick A Person");
      return;
    }
    if (!vehicleId) {
      toast.error("Pick A Vehicle");
      return;
    }
    if (pickupLocation.trim().length < 3) {
      toast.error("Enter A Pickup Location");
      return;
    }
    setBusy(true);
    try {
      const res = await create({
        data: {
          applicationId: appId,
          vehicleId,
          pickupDate,
          pickupTime,
          pickupLocation: pickupLocation.trim(),
          note: note.trim() || undefined,
          depositRequired: depositOn ? depositRequired : false,
          depositAmount: depositOn && depositRequired ? Number(depositAmount) || 0 : 0,
        },
      });
      const emailNote =
        res.loginEmail === "sent"
          ? " Booking Login Email Sent."
          : res.loginEmail === "skipped"
            ? " Login Email Already Sent Earlier."
            : res.loginEmail === "off"
              ? " Booking Login Email Is Off."
              : res.loginEmail === "held"
                ? " Booking Login Email Held."
                : res.loginEmail === "failed"
                  ? " Login Email Could Not Be Sent."
                  : "";
      toast.success(`Reserved.${emailNote}`);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Reserve The Car");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reserved{driverName ? `: ${driverName}` : ""}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Confirm the pickup appointment. Account login details are emailed when Reserved is saved.</p>
        <div className="grid gap-3">
          {!applicationId ? (
            <Field label="Approved Driver">
              <select className={input} value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Approved Driver">
                <option value="">Select…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email || p.id}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Vehicle">
            <VehicleCombobox vehicles={vehicles} value={vehicleId} onChange={setVehicleId} allowNone={false} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pickup Date">
              <input className={input} type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} aria-label="Pickup Date" required />
            </Field>
            <Field label="Pickup Time">
              <input className={input} type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} aria-label="Pickup Time" required />
            </Field>
          </div>
          <Field label="Pickup Location">
            <textarea className={`${input} min-h-20 resize-y`} value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} placeholder="Street Address, City, State" aria-label="Pickup Location" maxLength={180} required />
          </Field>
          <Field label="Note">
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" aria-label="Note" maxLength={140} />
          </Field>
          {depositOn ? (
            <>
              <Field label="Deposit Required">
                <select
                  className={input}
                  value={depositRequired ? "yes" : "no"}
                  onChange={(e) => setDepositRequired(e.target.value === "yes")}
                  aria-label="Deposit Required"
                >
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
              {depositRequired ? (
                <Field label="Deposit Amount">
                  <input
                    className={input}
                    inputMode="decimal"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    aria-label="Deposit Amount"
                  />
                </Field>
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className={primary} disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : "Reserved"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
