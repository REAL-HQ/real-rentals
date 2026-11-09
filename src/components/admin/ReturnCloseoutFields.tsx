import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import { confirmConditionUpload, createConditionUploadUrl } from "@/lib/inspections.functions";
import {
  FUEL_OR_CHARGE_LEVELS,
  RETURN_DAMAGE_ITEMS,
  RETURN_PHOTO_BUCKET,
  type DamageResult,
  type ReturnChecklistDraft,
} from "@/lib/return-checklist";

const RESULTS: Array<{ id: DamageResult; label: string }> = [
  { id: "ok", label: "Ok" },
  { id: "damage", label: "Damage" },
  { id: "na", label: "Not Checked" },
];

/**
 * Extra questions for End Rental. BookingActions mounts this only while
 * RETURN_CHECKLIST_ENABLED is true, so the dialog stays as it is while the
 * flag is off. Photos use the existing private condition-media upload.
 */
export function ReturnCloseoutFields({
  vehicleId,
  rentalId,
  value,
  onChange,
}: {
  vehicleId: string;
  rentalId: string;
  value: ReturnChecklistDraft;
  onChange: (next: ReturnChecklistDraft) => void;
}) {
  const startUpload = useServerFn(createConditionUploadUrl);
  const confirm = useServerFn(confirmConditionUpload);
  const [angle, setAngle] = useState("front");

  function patch(partial: Partial<ReturnChecklistDraft>) {
    onChange({ ...value, ...partial });
  }

  async function uploadOne(file: File, onProgress: (pct: number) => void) {
    if (!vehicleId) throw new Error("This rental has no vehicle.");
    onProgress(10);
    const { path, token, bucket } = await startUpload({
      data: { vehicleId, fileName: file.name, mimeType: file.type || "image/jpeg" },
    });
    if (bucket !== RETURN_PHOTO_BUCKET || !path.startsWith(`${vehicleId}/`)) {
      throw new Error("Upload left the private condition bucket.");
    }
    onProgress(40);
    const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, token, file, {
      contentType: file.type || undefined,
    });
    if (error) throw error;
    onProgress(80);
    await confirm({
      data: {
        vehicleId,
        rentalId,
        phase: "checkin",
        angle: angle as "front" | "rear" | "driver_side" | "passenger_side" | "interior_front" | "interior_rear" | "damage",
        path,
        fileName: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        caption: "Return checklist",
      },
    });
    patch({ photos: [...value.photos, { bucket: RETURN_PHOTO_BUCKET, path, angle }] });
    onProgress(100);
  }

  return (
    <div className="space-y-4 rounded-xl border border-[#EDEDF0] p-3" data-testid="return-checklist">
      <div>
        <h3 className="text-sm font-semibold text-[#111114]">Return Checklist</h3>
        <p className="mt-1 text-[12px] text-[#55555E]">Recorded with the return. The deposit line is a note for the manager.</p>
      </div>
      <label className="block text-sm font-medium text-[#111114]" htmlFor="return-when">
        Return Date And Time (ET)
      </label>
      <input
        id="return-when"
        type="datetime-local"
        value={value.returnedAtEt}
        onChange={(e) => patch({ returnedAtEt: e.target.value })}
        className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
      />
      <label className="block text-sm font-medium text-[#111114]" htmlFor="return-odo">
        Odometer
      </label>
      <input
        id="return-odo"
        inputMode="numeric"
        value={value.odometer}
        onChange={(e) => patch({ odometer: e.target.value })}
        className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
      />
      <div className="text-sm font-medium text-[#111114]">Fuel Or Charge</div>
      <div className="flex flex-wrap gap-1.5">
        {FUEL_OR_CHARGE_LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            onClick={() => patch({ fuelOrCharge: level.id })}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              value.fuelOrCharge === level.id ? "border-[#D03020] text-[#D03020]" : "border-[#EDEDF0] text-[#55555E]"
            }`}
          >
            {level.label}
          </button>
        ))}
      </div>
      {(["exterior", "interior"] as const).map((area) => (
        <div key={area}>
          <div className="text-sm font-medium text-[#111114]">{area === "exterior" ? "Exterior" : "Interior"}</div>
          <ul className="mt-2 space-y-2">
            {RETURN_DAMAGE_ITEMS.filter((item) => item.area === area).map((spec) => {
              const mark = value.items.find((item) => item.key === spec.key);
              return (
                <li key={spec.key} className="rounded-lg border border-[#EDEDF0] p-2">
                  <div className="text-sm text-[#111114]">{spec.label}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {RESULTS.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => patch({
                          items: value.items.map((item) => item.key === spec.key ? { ...item, result: result.id } : item),
                        })}
                        className={`rounded-lg border px-2 py-1 text-[12px] ${
                          mark?.result === result.id ? "border-[#D03020] text-[#D03020]" : "border-[#EDEDF0] text-[#55555E]"
                        }`}
                      >
                        {result.label}
                      </button>
                    ))}
                  </div>
                  <input
                    value={mark?.notes ?? ""}
                    onChange={(e) => patch({
                      items: value.items.map((item) => item.key === spec.key ? { ...item, notes: e.target.value } : item),
                    })}
                    placeholder="Notes"
                    className="mt-1 w-full rounded-lg border border-[#EDEDF0] px-2 py-1 text-sm"
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <YesNo label="Keys Returned" value={value.keysReturned} onChange={(keysReturned) => patch({ keysReturned })} />
      <label className="block text-sm font-medium text-[#111114]" htmlFor="return-tolls">
        Tolls Or Tickets
      </label>
      <textarea
        id="return-tolls"
        value={value.tollsTicketsNote}
        onChange={(e) => patch({ tollsTicketsNote: e.target.value })}
        rows={2}
        placeholder="Optional. What was noted at the return"
        className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
      />
      <YesNo
        label="Deposit Decision Needed"
        value={value.depositDecisionNeeded}
        onChange={(depositDecisionNeeded) => patch({ depositDecisionNeeded })}
      />
      <label className="block text-sm font-medium text-[#111114]" htmlFor="return-deposit-note">
        Deposit Decision Note
      </label>
      <textarea
        id="return-deposit-note"
        value={value.depositDecisionNote}
        onChange={(e) => patch({ depositDecisionNote: e.target.value })}
        rows={2}
        placeholder="A note only"
        className="w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
      />
      <div className="text-sm font-medium text-[#111114]">Photos</div>
      <div className="flex flex-wrap gap-1.5">
        {["front", "rear", "driver_side", "passenger_side", "interior_front", "interior_rear", "damage"].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setAngle(key)}
            className={`rounded-lg border px-2 py-1 text-[12px] ${
              angle === key ? "border-[#D03020] text-[#D03020]" : "border-[#EDEDF0] text-[#55555E]"
            }`}
          >
            {key === "driver_side" ? "Driver Side" : key === "passenger_side" ? "Passenger Side" : key === "interior_front" ? "Interior Front" : key === "interior_rear" ? "Interior Rear" : key === "front" ? "Front" : key === "rear" ? "Rear" : "Damage"}
          </button>
        ))}
      </div>
      <FileUploader
        variant="zone"
        title="Drop Return Photos Here"
        label="Add Return Photo"
        accept="image/*,video/mp4,video/quicktime"
        maxBytes={50 * 1024 * 1024}
        multiple
        camera
        upload={(file, { onProgress }) => uploadOne(file, onProgress)}
      />
      <p className="text-[12px] text-[#55555E]">{value.photos.length} photo{value.photos.length === 1 ? "" : "s"} on this return</p>
    </div>
  );
}

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (next: boolean) => void;
}) {
  return (
    <div>
      <div className="text-sm font-medium text-[#111114]">{label}</div>
      <div className="mt-1 flex gap-1.5">
        {[{ id: true, label: "Yes" }, { id: false, label: "No" }].map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              value === opt.id ? "border-[#D03020] text-[#D03020]" : "border-[#EDEDF0] text-[#55555E]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
