import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ModalBody, ModalSection, ModalFooter, ModalButton, Field, FormGrid, UploadDropzone, ReadinessStatus, inputCls } from "./modal";
import { supabase } from "@/integrations/supabase/client";
import { createVehicle } from "@/lib/vehicles.functions";
import { registerVehicleMedia } from "@/lib/vehicle-media.functions";
import { checkVin } from "@/lib/vin";
import { isRentalReady } from "@/lib/vehicle-readiness";

// Quick Add — the speed path. Only the Rental Ready minimum plus an optional
// photo. The photo goes through the private operational photo path and is
// never published here. Richer paths (detailed form, VIN decode, title scan,
// spreadsheet, Fleet Inbox) stay available behind "More ways to add".

const MAX_BYTES = 15 * 1024 * 1024;

export function QuickAddForm({ onCreated, onMore, onClose }: { onCreated: (id: string) => void; onMore: () => void; onClose?: () => void }) {
  const create = useServerFn(createVehicle);
  const register = useServerFn(registerVehicleMedia);
  const [f, setF] = useState({ year: "", make: "", model: "", vin: "", rate: "" });
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState<null | "save" | "available">(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const vinOk = !!f.vin.trim() && checkVin(f.vin.trim()).formatValid;
  const ready = isRentalReady({ year: f.year, make: f.make, model: f.model, vin: f.vin.trim(), weekly_rate: f.rate });

  async function submit(makeAvailable: boolean) {
    const year = Number(f.year);
    if (!f.year || !Number.isInteger(year) || !f.make.trim() || !f.model.trim()) return toast.error("Year, make and model are required");
    if (f.vin.trim() && !vinOk) return toast.error("That VIN isn't valid — check it against the car");
    const rate = f.rate.trim() === "" ? null : Number(f.rate);
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) return toast.error("Weekly rate must be a number");
    if (makeAvailable && !ready) return toast.error("Year, make, model, a valid VIN and a weekly rate above $0 are needed");
    if (photo && photo.size > MAX_BYTES) return toast.error("Photo must be under 15MB");

    setSaving(makeAvailable ? "available" : "save");
    try {
      const res = await create({
        data: {
          year, make: f.make.trim(), model: f.model.trim(), vin: f.vin.trim() || null,
          weekly_rate: rate, status: "available", make_available: makeAvailable,
        },
      });
      if (!res.ok) return toast.error(res.error);

      if (photo) {
        try {
          const ext = (photo.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
          const path = `${res.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error } = await supabase.storage.from("vehicle-photos").upload(path, photo, { contentType: photo.type || undefined });
          if (error) throw error;
          const r = await register({ data: { vehicleId: res.id, path, fileName: photo.name, mimeType: photo.type || null, sizeBytes: photo.size } });
          if (!r.ok) throw new Error(r.error);
        } catch {
          toast.error("Vehicle saved, but the photo didn't upload. Add it from the Photos tab.");
        }
      }
      toast.success(
        `${res.unit_number ? res.unit_number + " — " : ""}${f.year} ${f.make} ${f.model} ${makeAvailable ? "added and Available" : "saved as Needs Setup"}`,
      );
      onCreated(res.id);
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Only a Manager or Owner can add vehicles." : "Could not add the vehicle.");
    } finally {
      setSaving(null);
    }
  }

  const missingRental = (() => {
    const m: string[] = [];
    if (!f.year.trim() || !f.make.trim() || !f.model.trim()) m.push("details");
    if (!vinOk) m.push(f.vin.trim() ? "Enter a valid VIN" : "Add VIN");
    const r = Number(f.rate);
    if (!f.rate.trim() || !(r > 0)) m.push("Add weekly rate");
    if (m.length === 0) return undefined;
    if (m.length === 1) return m[0] === "details" ? "Add year, make and model" : m[0];
    return "Complete required details";
  })();
  const vinError = f.vin && f.vin.length >= 11 && !vinOk ? "Not a valid VIN" : null;
  const onCancel = onClose ?? (() => {});

  return (
    <>
      <ModalBody>
        <ModalSection>
          <FormGrid cols={3}>
            <Field label="Year" required><input inputMode="numeric" placeholder="2024" value={f.year} onChange={(e) => set("year", e.target.value)} className={inputCls} /></Field>
            <Field label="Make" required><input placeholder="Toyota" value={f.make} onChange={(e) => set("make", e.target.value)} className={inputCls} /></Field>
            <Field label="Model" required><input placeholder="Camry" value={f.model} onChange={(e) => set("model", e.target.value)} className={inputCls} /></Field>
          </FormGrid>
          <FormGrid cols={3}>
            <Field label="VIN" className="sm:col-span-2" error={vinError}>
              <input value={f.vin} onChange={(e) => set("vin", e.target.value.toUpperCase())} maxLength={17} placeholder="17 characters"
                className={`${inputCls} font-mono tracking-wide ${vinError ? "border-brand" : ""}`} />
            </Field>
            <Field label="Weekly Rate">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} placeholder="Not Set" className={`${inputCls} pl-7`} />
              </div>
            </Field>
          </FormGrid>
        </ModalSection>

        <ModalSection label="Photo">
          <UploadDropzone file={photo} onFile={setPhoto} title="Add Vehicle Photo" note="Private until published" />
        </ModalSection>

        <ModalSection label="Readiness">
          <ReadinessStatus items={[
            { label: "Rental Ready", ready, missing: missingRental },
            { label: "Listing Ready", ready: false, missing: photo ? "Publish photo from Photos tab" : "Add a photo" },
          ]} />
        </ModalSection>

        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-border pt-5">
          <span className="mr-2 text-[13px] text-muted-foreground">More ways to add</span>
          {["Detailed Form", "VIN Lookup", "Scan Title", "Spreadsheet Import"].map((l) => (
            <button key={l} type="button" onClick={onMore}
              className="h-8 rounded-full border border-border px-3 text-[13px] font-medium text-foreground hover:bg-muted">{l}</button>
          ))}
        </div>
      </ModalBody>
      <ModalFooter left={onClose ? <ModalButton variant="ghost" onClick={onCancel}>Cancel</ModalButton> : undefined}>
        <ModalButton disabled={!!saving} onClick={() => submit(false)}>
          {saving === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Vehicle"}
        </ModalButton>
        <ModalButton variant="primary" disabled={!!saving || !ready} onClick={() => submit(true)}
          title={ready ? undefined : "Needs year, make, model, a valid VIN and a weekly rate"}>
          {saving === "available" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save & Make Available"}
        </ModalButton>
      </ModalFooter>
    </>
  );
}
