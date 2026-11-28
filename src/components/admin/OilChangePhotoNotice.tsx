import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera } from "lucide-react";
import { listOilChangePhotoReminders } from "@/lib/oil-change-reminder.functions";
import type { OilChangePhotoDraft } from "@/lib/oil-next-due.server";
import { SectionCard } from "./ui";

/**
 * Staff draft only. Copy puts the wording on the clipboard.
 * There is no send button and this component never calls the SMS sender.
 */
export function OilChangePhotoNotice({
  vehicleLabel,
  reasonLabel,
  draft,
}: {
  vehicleLabel?: string | null;
  reasonLabel: string;
  draft: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div data-testid="oil-change-photo-notice" className="rounded-xl border border-[#EDEDF0] bg-[#F7F7F8] p-3">
      <p className="text-[13px] font-medium text-[#111114]">Needs Mileage Photo</p>
      {vehicleLabel ? <p className="mt-0.5 text-[12px] text-[#55555E]">{vehicleLabel}</p> : null}
      <p className="mt-1 text-[12px] text-[#55555E]">{reasonLabel}</p>
      <p className="mt-2 text-[13px] text-[#111114]">{draft}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" onClick={copy} className="rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1 text-[12px] font-medium text-[#111114]">
          Copy Text
        </button>
        <span className="text-[12px] text-[#55555E]">{copied ? "Copied. Nothing Was Sent." : "Nothing Is Sent From This Draft."}</span>
      </div>
    </div>
  );
}

/** Service page, when the Needs Odometer filter is selected. Hidden when nobody needs a photo. */
export function OilChangePhotoReminders() {
  const load = useServerFn(listOilChangePhotoReminders);
  const [rows, setRows] = useState<OilChangePhotoDraft[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    load()
      .then((res) => {
        if (!live) return;
        setRows(res.reminders);
        setFailed(false);
      })
      .catch(() => {
        if (!live) return;
        setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [load]);
  if (failed) {
    return <p className="text-[13px] text-[#55555E]">Could Not Load Mileage Photo Reminders.</p>;
  }
  if (!rows || rows.length === 0) return null;
  return (
    <SectionCard title="Needs Mileage Photo" icon={<Camera className="h-4 w-4" />} subtitle="Copy The Text. Nothing Is Sent Until Staff Send It Themselves.">
      <div className="space-y-3">
        {rows.map((row) => (
          <OilChangePhotoNotice key={row.cycleKey} vehicleLabel={row.vehicleLabel} reasonLabel={row.reasonLabel} draft={row.draft} />
        ))}
      </div>
    </SectionCard>
  );
}
