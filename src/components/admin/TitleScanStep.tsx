import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, Loader2, AlertTriangle, ArrowRight, FileText } from "lucide-react";
import { scanVehicleTitle, type TitleScanResult } from "@/lib/vehicle-title-scan.functions";
import { MicroLabel } from "./ui";

// Photograph the title, check what was read, then fill the form.
//
// Nothing here saves anything. The scan returns text with a confidence per
// field and the operator confirms it on the next screen — a transcription that
// writes itself into the fleet is a transcription nobody checks.
//
// The upload goes to vehicle-docs, which is private. Not vehicle-photos, where
// a policy makes every image readable by anyone holding the path: a title
// carries a VIN, an owner's name and usually an address.

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 5 * 1024 * 1024;

const LABELS: Record<string, string> = {
  vin: "VIN",
  year: "Year",
  make: "Make",
  model: "Model",
  color: "Color",
  body_type: "Body type",
  license_plate: "Plate",
  plate_state: "Plate state",
  registration_number: "Registration #",
  registration_state: "Registration state",
  title_number: "Title number",
  title_status: "Title status",
  legal_owner: "Legal owner",
  lienholder: "Lienholder",
  odometer: "Odometer",
  issue_date: "Issued",
  expires_on: "Expires",
};

/** Which scanned fields the Add Vehicle form can actually take. */
const TO_FORM: Record<string, string> = {
  vin: "vin",
  year: "year",
  make: "make",
  model: "model",
  color: "color",
  body_type: "body_type",
  license_plate: "license_plate",
  plate_state: "plate_state",
  odometer: "current_odometer",
};

const CONF: Record<string, { label: string; bg: string; fg: string }> = {
  high: { label: "Clear", bg: "rgba(80,192,96,0.10)", fg: "#3E9A4C" },
  medium: { label: "Check", bg: "rgba(240,192,64,0.12)", fg: "#C68A12" },
  low: { label: "Unclear", bg: "rgba(208,48,32,0.10)", fg: "#D03020" },
};

export function TitleScanStep({ onUse }: { onUse: (prefill: Record<string, string>) => void }) {
  const scan = useServerFn(scanVehicleTitle);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TitleScanResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function run(file: File) {
    if (file.size > MAX_BYTES) {
      return toast.error(
        "Photograph the document rather than scanning it at full resolution — that file is over 5MB.",
      );
    }
    setBusy(true);
    setResult(null);
    setPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `scans/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("vehicle-docs")
        .upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;
      setResult(await scan({ data: { path } }));
    } catch (e: any) {
      console.error("[title-scan] upload failed", e);
      toast.error("Could not upload that document.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const entries = Object.entries(result?.fields ?? {});
  const usable = entries.filter(([k]) => k in TO_FORM);

  function use() {
    const prefill: Record<string, string> = {};
    for (const [k, v] of usable) prefill[TO_FORM[k]] = v.value;
    onUse(prefill);
  }

  return (
    <div className="p-6 space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && run(e.target.files[0])}
      />

      {!result && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="w-full rounded-xl border border-dashed border-border p-8 text-center hover:border-[#D03020] hover:bg-[rgba(208,48,32,0.02)] transition-colors disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 className="w-6 h-6 mx-auto text-[#D03020] animate-spin" />
              <div className="mt-3 text-sm font-medium">Reading the document…</div>
            </>
          ) : (
            <>
              <Camera className="w-6 h-6 mx-auto text-[#D03020]" strokeWidth={1.75} />
              <div className="mt-3 text-sm font-medium">Photograph the title or registration</div>
              <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto leading-relaxed">
                Lay it flat, fill the frame, avoid glare. JPG, PNG or PDF up to 5MB. Nothing is
                saved until you confirm what was read.
              </p>
            </>
          )}
        </button>
      )}

      {result && !result.ok && (
        <div className="rounded-xl border border-[rgba(208,48,32,0.25)] bg-[rgba(208,48,32,0.04)] p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#D03020] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[#111114]">
                The document could not be read
              </div>
              <p className="text-[12px] text-[#55555E] mt-1 leading-relaxed">{result.error}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setResult(null);
              setPreview(null);
            }}
            className="mt-3 text-[12px] text-[#D03020] hover:underline"
          >
            Try another photo
          </button>
        </div>
      )}

      {result?.ok && (
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            {preview && (
              <img
                src={preview}
                alt=""
                className="w-28 h-28 object-cover rounded-lg border border-[#EDEDF0] shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[12px] text-[#55555E]">
                <FileText className="w-3.5 h-3.5" />
                Read as a {result.documentType.replace(/_/g, " ")}
              </div>
              <p className="text-[12px] text-[#9A9AA3] mt-1 leading-relaxed">
                Check every line against the document in your hand. Anything marked Check or Unclear
                was hard to read — the rest is a transcription, not a verification.
              </p>
            </div>
          </div>

          {!!result.warnings.length && (
            <ul className="rounded-lg bg-[rgba(240,192,64,0.08)] px-3.5 py-2.5 space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-[#8A6410]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          {entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
              Nothing legible was found on that document.
            </div>
          ) : (
            <div className="rounded-xl border border-[#EDEDF0] divide-y divide-[#F4F4F6]">
              {entries.map(([k, v]) => {
                const c = CONF[v.confidence] ?? CONF.low;
                const carried = k in TO_FORM;
                return (
                  <div key={k} className="flex items-baseline gap-3 px-3.5 py-2">
                    <div className="w-[36%] shrink-0 text-[12px] text-[#9A9AA3]">
                      {LABELS[k] ?? k}
                    </div>
                    <div className="min-w-0 flex-1 text-[13px] text-[#111114] break-words">
                      {v.value}
                      {v.note && <div className="text-[11px] text-[#9A9AA3] mt-0.5">{v.note}</div>}
                      {!carried && (
                        <div className="text-[11px] text-[#9A9AA3] mt-0.5">
                          Not carried over — add it on the vehicle record after saving.
                        </div>
                      )}
                    </div>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: c.bg, color: c.fg }}
                    >
                      {c.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setResult(null);
                setPreview(null);
              }}
              className="rounded-md px-3.5 py-2 text-[13px] text-[#55555E] hover:bg-[#F4F4F6] transition-colors"
            >
              Scan another
            </button>
            <div className="flex-1" />
            <button
              onClick={use}
              disabled={!usable.length}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#D03020] px-4 py-2 text-[13px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Review {usable.length} field{usable.length === 1 ? "" : "s"}{" "}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
