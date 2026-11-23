import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, Gauge, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getVehicleMaintenanceTrack,
  saveMonthlyInspection,
  setNextServiceDue,
} from "@/lib/maintenance.functions";
import { fmtDate } from "@/lib/date-format";
import { SectionCard } from "./ui";
import {
  Field,
  FormGrid,
  ModalBody,
  ModalButton,
  ModalFooter,
  ModalHeader,
  ModalShell,
  UploadDropzone,
  inputCls,
} from "./modal";

type Track = Awaited<ReturnType<typeof getVehicleMaintenanceTrack>>;
const todayIso = () => new Date().toISOString().slice(0, 10);
const day = (value: string | null | undefined) =>
  value ? fmtDate(value.length === 10 ? `${value}T12:00:00` : value) : "Not Set";
const mi = (value: number | null | undefined) =>
  value == null ? "Not Set" : `${value.toLocaleString("en-US")} mi`;

async function uploadInbox(
  file: File,
  prefix: "odometer" | "inspection",
): Promise<{ path: string; name: string }> {
  const ext =
    (file.name.split(".").pop() || "jpg").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "jpg";
  const path = `inbox/${prefix}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("vehicle-docs")
    .upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error("Photo upload failed.");
  return { path, name: file.name };
}

export function VehicleMaintenanceCards({
  vehicleId,
  onChanged,
}: {
  vehicleId: string;
  onChanged?: () => void;
}) {
  const load = useServerFn(getVehicleMaintenanceTrack);
  const [data, setData] = useState<Track | null>(null);
  const [failed, setFailed] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);
  const refresh = useCallback(() => {
    setFailed(false);
    return load({ data: { vehicleId } })
      .then((row) => {
        setData(row);
        if (!row.ok) setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [load, vehicleId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (failed || (data && !data.ok)) {
    return (
      <SectionCard title="Next Service Due" icon={<Gauge className="h-4 w-4" />}>
        <p className="text-sm text-[#D03020]">Could Not Load Next Service Due.</p>
      </SectionCard>
    );
  }
  if (!data?.ok) {
    return (
      <SectionCard title="Next Service Due" icon={<Gauge className="h-4 w-4" />}>
        <p className="text-sm text-[#55555E]">Loading Next Service Due.</p>
      </SectionCard>
    );
  }
  const oil = data.next_service_due;
  const month = data.monthly_inspection;
  const identity = [
    data.vehicle.license_plate,
    data.vehicle.vin_last6 ? `VIN …${data.vehicle.vin_last6}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <SectionCard
        title="Next Service Due"
        icon={<Gauge className="h-4 w-4" />}
        subtitle={identity || "Oil Change"}
      >
        <div data-testid="next-service-due" className="space-y-2 text-[13px]">
          <div className="font-medium">Oil Change</div>
          <div className="text-[#55555E]">Next Due Miles: {mi(oil.next_due_miles)}</div>
          <div className="text-[#55555E]">Next Due Date: {day(oil.next_due_on)}</div>
          {oil.interval_miles ? (
            <div className="text-[#55555E]">
              Every {oil.interval_miles.toLocaleString("en-US")} Miles
            </div>
          ) : null}
          {oil.notes ? <div className="text-[#55555E]">Notes: {oil.notes}</div> : null}
          <ModalButton onClick={() => setDueOpen(true)}>Set Next Service Due</ModalButton>
        </div>
      </SectionCard>

      <SectionCard
        title="Monthly Inspection"
        icon={<CalendarClock className="h-4 w-4" />}
        subtitle="Every 30 Days"
      >
        <div data-testid="monthly-inspection" className="space-y-2 text-[13px]">
          <div className="text-[#55555E]">Last Done: {day(month.last_done_on)}</div>
          <div className="text-[#55555E]">Next Due: {day(month.next_due_on)}</div>
          <div className="text-[#55555E]">Notes: {month.notes || "Not Set"}</div>
          <ModalButton onClick={() => setMonthOpen(true)}>Update Monthly Inspection</ModalButton>
          {month.history.length === 0 ? (
            <p className="text-[12px] text-[#9A9AA3]">No Monthly Inspection History.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {month.history.map((line) => (
                <li key={line.id} className="text-[12px] text-[#55555E]">
                  {day(line.performed_on)}
                  {line.odometer != null ? ` · ${mi(line.odometer)}` : ""}
                  {line.notes ? ` · ${line.notes}` : ""}
                  {line.has_photo ? " · Photo On File" : ""}
                </li>
              ))}
            </ul>
          )}
          {month.history_truncated ? (
            <p className="text-[12px] text-[#9A9AA3]">History Is Capped At 50.</p>
          ) : null}
        </div>
      </SectionCard>

      {dueOpen && (
        <NextDueDialog
          vehicleId={vehicleId}
          oil={oil}
          onClose={() => setDueOpen(false)}
          onSaved={() => {
            setDueOpen(false);
            void refresh();
            onChanged?.();
          }}
        />
      )}
      {monthOpen && (
        <MonthlyDialog
          vehicleId={vehicleId}
          month={month}
          onClose={() => setMonthOpen(false)}
          onSaved={() => {
            setMonthOpen(false);
            void refresh();
            onChanged?.();
          }}
        />
      )}
    </>
  );
}

function NextDueDialog({
  vehicleId,
  oil,
  onClose,
  onSaved,
}: {
  vehicleId: string;
  oil: { next_due_miles: number | null; next_due_on: string | null; notes: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(setNextServiceDue);
  const [miles, setMiles] = useState(oil.next_due_miles != null ? String(oil.next_due_miles) : "");
  const [date, setDate] = useState(oil.next_due_on ?? "");
  const [notes, setNotes] = useState(oil.notes ?? "");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const nextDueMiles = miles.trim() === "" ? null : Number(miles.replace(/\D/g, ""));
    const r = await save({
      data: { vehicleId, nextDueMiles, nextDueOn: date || null, notes: notes.trim() || null },
    }).catch(() => ({ ok: false as const, error: "Could not save." }));
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Next Service Due Saved.");
    onSaved();
  }
  return (
    <ModalShell onClose={onClose} label="Next Service Due" size="sm">
      <ModalHeader
        title="Next Service Due"
        subtitle="Oil Change. Leave a field blank to clear it."
        onClose={onClose}
      />
      <ModalBody>
        <FormGrid cols={2}>
          <Field label="Next Due Miles">
            <input
              inputMode="numeric"
              className={inputCls}
              value={miles}
              onChange={(e) => setMiles(e.target.value)}
              placeholder="166869"
            />
          </Field>
          <Field label="Next Due Date">
            <input
              type="date"
              className={inputCls}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        </FormGrid>
        <Field label="Notes">
          <textarea
            className={`${inputCls} h-20 py-2`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={busy || (!miles.trim() && !date)} onClick={submit}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save Next Service Due
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

function MonthlyDialog({
  vehicleId,
  month,
  onClose,
  onSaved,
}: {
  vehicleId: string;
  month: { last_done_on: string | null; next_due_on: string | null; notes: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useServerFn(saveMonthlyInspection);
  const [lastDone, setLastDone] = useState(month.last_done_on ?? "");
  const [nextDue, setNextDue] = useState(month.next_due_on ?? "");
  const [notes, setNotes] = useState(month.notes ?? "");
  const [odometer, setOdometer] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if ((file || odometer.trim()) && !lastDone) {
      toast.error("Add Last Done with the photo or odometer.");
      return;
    }
    const lastChanged = (lastDone || null) !== (month.last_done_on ?? null);
    const nextChanged = (nextDue || null) !== (month.next_due_on ?? null);
    const notesValue = notes.trim() || null;
    const notesChanged = notesValue !== (month.notes ?? null);
    if (!lastChanged && !nextChanged && !notesChanged && !file && !odometer.trim()) {
      toast.error("Nothing to save.");
      return;
    }
    setBusy(true);
    try {
      let photoPath: string | null = null;
      let photoName: string | null = null;
      if (file) {
        const up = await uploadInbox(file, "inspection");
        photoPath = up.path;
        photoName = up.name;
      }
      const r = await save({
        data: {
          vehicleId,
          lastDoneOn: lastChanged || file || odometer.trim() ? lastDone || null : undefined,
          nextDueOn: nextChanged ? nextDue || null : undefined,
          notes: notesChanged || lastChanged || file ? notesValue : undefined,
          odometer: odometer.trim() === "" ? undefined : Number(odometer.replace(/\D/g, "")),
          photoPath,
          photoName,
        },
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Monthly Inspection Saved.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalShell onClose={onClose} label="Monthly Inspection" size="sm">
      <ModalHeader
        title="Monthly Inspection"
        subtitle="Last done, next due, notes, and one photo."
        onClose={onClose}
      />
      <ModalBody>
        <FormGrid cols={2}>
          <Field label="Last Done">
            <input
              type="date"
              max={todayIso()}
              className={inputCls}
              value={lastDone}
              onChange={(e) => setLastDone(e.target.value)}
            />
          </Field>
          <Field label="Next Due">
            <input
              type="date"
              className={inputCls}
              value={nextDue}
              onChange={(e) => setNextDue(e.target.value)}
            />
          </Field>
          <Field label="Odometer">
            <input
              inputMode="numeric"
              className={inputCls}
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              placeholder="Optional"
            />
          </Field>
        </FormGrid>
        <Field label="Notes">
          <textarea
            className={`${inputCls} h-20 py-2`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <Field label="Photo">
          <UploadDropzone
            disabled={busy}
            file={file}
            onFile={setFile}
            accept="image/*"
            title="Add Photo"
            hint="Drag and drop or browse — JPEG, PNG, WebP, or HEIC, up to 20 MB"
          />
        </Field>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton
          variant="primary"
          disabled={busy || (!lastDone && !nextDue && !notes.trim())}
          onClick={submit}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save Monthly Inspection
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}
