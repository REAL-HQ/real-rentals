import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Camera } from "lucide-react";
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

export function QuickAddForm({ onCreated, onMore }: { onCreated: (id: string) => void; onMore: () => void }) {
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

  const input = "w-full rounded-md border border-border px-3 py-2 text-sm";
  return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs font-medium space-y-1">Year *<input inputMode="numeric" value={f.year} onChange={(e) => set("year", e.target.value)} className={input} /></label>
        <label className="text-xs font-medium space-y-1">Make *<input value={f.make} onChange={(e) => set("make", e.target.value)} className={input} /></label>
        <label className="text-xs font-medium space-y-1">Model *<input value={f.model} onChange={(e) => set("model", e.target.value)} className={input} /></label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-2 text-xs font-medium space-y-1">VIN
          <input value={f.vin} onChange={(e) => set("vin", e.target.value.toUpperCase())} maxLength={17} className={`${input} font-mono ${f.vin && !vinOk ? "border-[#D03020]" : ""}`} />
        </label>
        <label className="text-xs font-medium space-y-1">Weekly Rate ($)<input inputMode="decimal" value={f.rate} onChange={(e) => set("rate", e.target.value)} placeholder="Not Set" className={input} /></label>
      </div>
      <label className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2.5 text-sm cursor-pointer hover:bg-soft">
        <Camera className="w-4 h-4 text-muted-foreground" />
        <span className="truncate">{photo ? photo.name : "Vehicle Photo (optional — stays private until you publish it)"}</span>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>

      <div className="rounded-md bg-soft px-3 py-2 text-xs space-y-0.5">
        <div>Rental Ready: <b>{ready ? "Yes" : "No"}</b>{!ready && " — needs year, make, model, valid VIN and a weekly rate above $0"}</div>
        <div>Listing Ready: <b>No</b> — {photo ? "publish the photo from the Photos tab when you're happy with it" : "add a photo"}</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button type="button" onClick={onMore} className="text-xs text-muted-foreground underline">
          More ways to add (detailed form, VIN lookup, scan title, spreadsheet)
        </button>
        <div className="flex gap-2">
          <button type="button" disabled={!!saving} onClick={() => submit(false)} className="rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-50">
            {saving === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Vehicle"}
          </button>
          <button type="button" disabled={!!saving || !ready} onClick={() => submit(true)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving === "available" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save & Make Available"}
          </button>
        </div>
      </div>
    </div>
  );
}
