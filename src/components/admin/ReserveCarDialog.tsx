import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VehicleCombobox } from "@/components/admin/VehicleCombobox";
import { ApprovedDriverCombobox } from "@/components/admin/ApprovedDriverCombobox";
import type { ApprovedDriverOption } from "@/lib/approved-driver-picker";
import {
  createReservation,
  listApprovedForReservation,
  listVehiclesForReservation,
} from "@/lib/reservations.functions";
import { listPickupSlots } from "@/lib/pickup-schedule.functions";
import type { PickupSlot } from "@/lib/pickup-schedule";
import { easternParts } from "@/lib/rent-reminders";
import { reservationPickupDate } from "@/lib/reservations";

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
 * Only approved / active applicants. Sends the Pickup Booked Email (no login
 * details) once when automation is On. Never marks insurance or verification complete.
 */
export function ReserveCarDialog({
  open,
  onOpenChange,
  applicationId,
  driverName,
  onSaved,
  intent = "reserve",
  defaultVehicleId = null,
  defaultPickupDate = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When set (driver profile), the person is locked in. */
  applicationId?: string | null;
  driverName?: string | null;
  onSaved: () => void;
  /** book_pickup: profile recovery after a paid Reservation Fee with no slot. */
  intent?: "reserve" | "book_pickup";
  /** Application vehicle. Used when it is free to reserve. */
  defaultVehicleId?: string | null;
  /** Application start date (YYYY-MM-DD). */
  defaultPickupDate?: string | null;
}) {
  const create = useServerFn(createReservation);
  const loadVehicles = useServerFn(listVehiclesForReservation);
  const loadPeople = useServerFn(listApprovedForReservation);
  const loadSlots = useServerFn(listPickupSlots);
  const [slots, setSlots] = useState<PickupSlot[]>([]);
  const [fieldRep, setFieldRep] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Array<{ id: string; unit_number: string | null; year: number | null; make: string | null; model: string | null; license_plate?: string | null; vin?: string | null; status: string | null }>>([]);
  const [people, setPeople] = useState<ApprovedDriverOption[]>([]);
  const [personId, setPersonId] = useState(applicationId ?? "");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [pickupDate, setPickupDate] = useState(easternParts(new Date()).date);
  const [pickupTime, setPickupTime] = useState("09:30");
  const [pickupLocation, setPickupLocation] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const bookingPickup = intent === "book_pickup";
  const lockedDate = reservationPickupDate(defaultPickupDate);

  useEffect(() => {
    if (!open) return;
    setPersonId(applicationId ?? "");
    setVehicleId(defaultVehicleId ?? null);
    setPickupDate(lockedDate ?? easternParts(new Date()).date);
    setPickupTime("09:30");
    setPickupLocation("");
    setNote("");
    // Pickup Schedule: prefill an open slot and the default location.
    // Book Pickup keeps the application start date when one is on file.
    loadSlots()
      .then(({ slots: openSlots, settings: schedule }) => {
        setSlots(openSlots);
        setFieldRep(schedule.fieldRep.name);
        if (lockedDate) {
          setPickupDate(lockedDate);
          const onDay = openSlots.find((s) => s.date === lockedDate);
          if (onDay) setPickupTime(onDay.time);
        } else if (openSlots[0]) {
          setPickupDate(openSlots[0].date);
          setPickupTime(openSlots[0].time);
        }
        if (schedule.defaultLocation) setPickupLocation((cur) => cur || schedule.defaultLocation || "");
      })
      .catch(() => setSlots([]));
    loadVehicles()
      .then((rows) => {
        setVehicles(rows);
        if (defaultVehicleId && !rows.some((v) => v.id === defaultVehicleId)) setVehicleId(null);
      })
      .catch(() => setVehicles([]));
    if (!applicationId) {
      loadPeople()
        .then(setPeople)
        .catch(() => setPeople([]));
    }
  }, [open, applicationId, defaultVehicleId, lockedDate, loadVehicles, loadPeople, loadSlots]);

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
        },
      });
      const emailNote =
        res.loginEmail === "sent"
          ? " Pickup Booked Email Sent."
          : res.loginEmail === "skipped"
            ? " Pickup Booked Email Not Needed."
            : res.loginEmail === "off"
              ? " Pickup Booked Email Is Off."
              : res.loginEmail === "held"
                ? " Pickup Booked Email Held."
                : res.loginEmail === "failed"
                  ? " Pickup Booked Email Could Not Be Sent."
                  : "";
      toast.success(`${bookingPickup ? "Pickup Booked" : "Reserved"}.${emailNote}`);
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
          <DialogTitle>{bookingPickup ? "Book Pickup" : "Reserved"}{driverName ? `: ${driverName}` : ""}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {bookingPickup
            ? "Choose the vehicle, date, time, and location. Saving uses the same checks as Reserve A Car. The signed agreement and the paid Reservation Fee are linked to the rental. The Reservation Fee is applied to week 1. The renter gets the Pickup Booked email when this is saved."
            : "Confirm the pickup appointment. Account login details are emailed when Reserved is saved."}
        </p>
        <div className="grid gap-3">
          {!applicationId ? (
            <Field label="Approved Driver">
              <ApprovedDriverCombobox people={people} value={personId} onChange={setPersonId} />
            </Field>
          ) : null}
          <Field label="Vehicle">
            <VehicleCombobox vehicles={vehicles} value={vehicleId} onChange={setVehicleId} allowNone={false} />
          </Field>
          {slots.length ? (
            <Field label={`Open Pickup Slots${fieldRep ? ` (Field Rep: ${fieldRep})` : ""}`}>
              <div className="flex flex-wrap gap-2" aria-label="Open Pickup Slots">
                {slots.slice(0, 9).map((s) => {
                  const on = s.date === pickupDate && s.time === pickupTime;
                  return (
                    <button
                      key={s.start_at}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setPickupDate(s.date);
                        setPickupTime(s.time);
                      }}
                      className={`h-8 rounded-md border px-2 text-xs ${on ? "border-[#D03020] bg-[#FDEDEB] text-[#8A1C10]" : "border-[#D6D6DB] bg-white text-[#111114]"}`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}
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
        </div>
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className={primary} disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : bookingPickup ? "Book Pickup" : "Reserved"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
