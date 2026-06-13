import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { generateVehicleImage } from "@/lib/admin-ai.functions";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import type { Vehicle } from "./types";
import { toast } from "sonner";
import { Sparkles, Upload, X, Loader2 } from "lucide-react";

const STATUSES = ["available", "rented", "maintenance", "reserved"];
const BODY_TYPES = ["sedan", "suv", "hatchback", "minivan", "truck", "coupe"];

type FormState = {
  year: number;
  make: string;
  model: string;
  trim: string;
  color: string;
  body_type: string;
  mpg: number | null;
  weekly_rate: number;
  monthly_rate: number | null;
  deposit: number | null;
  doors: number | null;
  seats: number | null;
  status: string;
  description: string;
  maintenance_status: string;
  badges: string[];
  uber_eligibility: string[];
  photos: string[];
};

function init(v: Vehicle | null): FormState {
  return {
    year: v?.year ?? new Date().getFullYear(),
    make: v?.make ?? "",
    model: v?.model ?? "",
    trim: v?.trim ?? "",
    color: (v as any)?.color ?? "",
    body_type: v?.body_type ?? "sedan",
    mpg: v?.mpg ?? null,
    weekly_rate: Number(v?.weekly_rate ?? 0),
    monthly_rate: v?.monthly_rate != null ? Number(v.monthly_rate) : null,
    deposit: v?.deposit != null ? Number(v.deposit) : 249,
    doors: v?.doors ?? 4,
    seats: v?.seats ?? null,
    status: v?.status ?? "available",
    description: v?.description ?? "",
    maintenance_status: v?.maintenance_status ?? "Well Maintained",
    badges: v?.badges ?? [],
    uber_eligibility: v?.uber_eligibility ?? [],
    photos: v?.photos ?? [],
  };
}

export function VehicleEditor({ vehicle, onClose, onSaved }: {
  vehicle: Vehicle | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<FormState>(() => init(vehicle));
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const genImage = useServerFn(generateVehicleImage);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    if (!f.make || !f.model || !f.weekly_rate) return toast.error("Make, model, and weekly rate are required");
    setSaving(true);
    const payload = {
      year: f.year, make: f.make, model: f.model, trim: f.trim || null,
      color: f.color || null,
      body_type: f.body_type || null,
      mpg: f.mpg, weekly_rate: f.weekly_rate, monthly_rate: f.monthly_rate,
      deposit: f.deposit, doors: f.doors, seats: f.seats,
      status: f.status, description: f.description || null,
      maintenance_status: f.maintenance_status || null,
      badges: f.badges, uber_eligibility: f.uber_eligibility, photos: f.photos,
    };
    const { error } = vehicle
      ? await supabase.from("vehicles").update(payload).eq("id", vehicle.id)
      : await supabase.from("vehicles").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(vehicle ? "Vehicle updated" : "Vehicle created");
    onSaved();
  }

  async function uploadFile(file: File) {
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `vehicles/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("vehicle-photos").upload(path, file, { upsert: false });
    setUploading(false);
    if (error) return toast.error(error.message);
    set("photos", [...f.photos, path]);
    toast.success("Photo uploaded");
  }

  async function aiGenerate() {
    if (!f.make || !f.model || !f.year || !f.color) {
      return toast.error("Fill in year, make, model, and color first");
    }
    setGenerating(true);
    try {
      const result = await genImage({
        data: {
          year: f.year, make: f.make, model: f.model, color: f.color,
          body_type: f.body_type || null, trim: f.trim || null,
        },
      });
      const bytes = Uint8Array.from(atob(result.b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes as unknown as BlobPart], { type: "image/png" });
      const path = `vehicles/ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const { error } = await supabase.storage.from("vehicle-photos").upload(path, blob, { contentType: "image/png" });
      if (error) throw error;
      set("photos", [...f.photos, path]);
      toast.success("AI image generated");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("429")) toast.error("AI rate limit — try again in a moment.");
      else if (msg.includes("402")) toast.error("AI credits exhausted. Add credits in workspace settings.");
      else toast.error(msg.slice(0, 200));
    } finally {
      setGenerating(false);
    }
  }

  function removePhoto(idx: number) {
    set("photos", f.photos.filter((_, i) => i !== idx));
  }
  function movePhoto(idx: number, dir: -1 | 1) {
    const next = [...f.photos];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    set("photos", next);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex justify-between items-center">
          <h2 className="text-lg font-semibold">{vehicle ? "Edit vehicle" : "Add vehicle"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Num label="Year" v={f.year} onChange={(n) => set("year", n)} />
            <Txt label="Make" v={f.make} onChange={(s) => set("make", s)} />
            <Txt label="Model" v={f.model} onChange={(s) => set("model", s)} />
            <Txt label="Trim" v={f.trim} onChange={(s) => set("trim", s)} />
            <Txt label="Color" v={f.color} onChange={(s) => set("color", s)} />
            <Sel label="Body type" v={f.body_type} options={BODY_TYPES} onChange={(s) => set("body_type", s)} />
            <Num label="Doors" v={f.doors} onChange={(n) => set("doors", n)} />
            <Num label="Seats" v={f.seats} onChange={(n) => set("seats", n)} />
            <Num label="MPG" v={f.mpg} onChange={(n) => set("mpg", n)} />
            <Num label="Weekly $" v={f.weekly_rate} onChange={(n) => set("weekly_rate", n ?? 0)} />
            <Num label="Monthly $" v={f.monthly_rate} onChange={(n) => set("monthly_rate", n)} />
            <Num label="Deposit $" v={f.deposit} onChange={(n) => set("deposit", n)} />
            <Sel label="Status" v={f.status} options={STATUSES} onChange={(s) => set("status", s)} />
            <Txt label="Maintenance" v={f.maintenance_status} onChange={(s) => set("maintenance_status", s)} />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Description</label>
            <textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={3}
              className="mt-1 w-full border border-border rounded-md px-3 py-2 text-sm" />
          </div>

          <CSV label="Badges (comma separated)" v={f.badges} onChange={(a) => set("badges", a)} />
          <CSV label="Uber eligibility (comma separated, e.g. UberX, Comfort)" v={f.uber_eligibility} onChange={(a) => set("uber_eligibility", a)} />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Photos (first is primary)</label>
              <div className="flex gap-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs hover:bg-soft">
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadFile(file); e.target.value = ""; }} />
                </label>
                <button type="button" onClick={aiGenerate} disabled={generating}
                  className="inline-flex items-center gap-1.5 rounded-md bg-black text-white px-3 py-1.5 text-xs disabled:opacity-50">
                  {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {generating ? "Generating…" : "Generate with AI"}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">AI uses year, make, model, color (and trim/body type if set) to create a studio-style photo. Optional — upload your own if you have one.</p>
            {f.photos.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">No photos yet</div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {f.photos.map((p, i) => (
                  <div key={i} className="relative group">
                    <div className="aspect-square rounded-md overflow-hidden bg-soft border border-border">
                      <img src={resolvePhotoUrl(p) ?? ""} alt="" className="w-full h-full object-cover" />
                    </div>
                    {i === 0 && <div className="absolute top-1 left-1 bg-black text-white text-[10px] px-1.5 py-0.5 rounded">Primary</div>}
                    <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => movePhoto(i, -1)} className="bg-white/90 rounded text-[10px] px-1.5">←</button>
                      <button onClick={() => removePhoto(i)} className="bg-real-red text-white rounded text-[10px] px-1.5">✕</button>
                      <button onClick={() => movePhoto(i, 1)} className="bg-white/90 rounded text-[10px] px-1.5">→</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sticky bottom-0 bg-white border-t border-border px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-md bg-real-red text-white px-5 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? "Saving…" : vehicle ? "Save changes" : "Create vehicle"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Txt({ label, v, onChange }: { label: string; v: string; onChange: (s: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input value={v} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-border rounded-md px-2 py-1.5 text-sm" />
    </label>
  );
}
function Num({ label, v, onChange }: { label: string; v: number | null; onChange: (n: number | null) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type="number" value={v ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="mt-1 w-full border border-border rounded-md px-2 py-1.5 text-sm" />
    </label>
  );
}
function Sel({ label, v, options, onChange }: { label: string; v: string; options: string[]; onChange: (s: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <select value={v} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-border rounded-md px-2 py-1.5 text-sm bg-white">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function CSV({ label, v, onChange }: { label: string; v: string[]; onChange: (a: string[]) => void }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <input value={v.join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
        className="mt-1 w-full border border-border rounded-md px-3 py-2 text-sm" />
    </label>
  );
}