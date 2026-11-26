import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { autoLabelUnlabeled, previewAutoLabel } from "@/lib/photo-class-label.functions";
import { PHOTO_LABEL_COST_CENTS, formatLabelCost } from "@/lib/photo-class-label";

/** Label photos that are still Unknown. A label a person set is left alone. */
export function AutoLabelPhotos({ vehicleId, onDone }: { vehicleId: string; onDone?: () => void }) {
  const preview = useServerFn(previewAutoLabel);
  const run = useServerFn(autoLabelUnlabeled);
  const [busy, setBusy] = useState(false);

  async function go(scope: "car" | "all") {
    if (busy) return;
    setBusy(true);
    try {
      const vehicle = scope === "car" ? vehicleId : null;
      const p = await preview({ data: { vehicleId: vehicle } });
      if (p.count === 0) {
        toast.message(scope === "car" ? "No Unlabeled Photos On This Car" : "No Unlabeled Photos");
        return;
      }
      const each = formatLabelCost(p.costCents);
      const total = formatLabelCost(p.count * p.costCents);
      const where = scope === "car" ? "on this car" : "on every car";
      const noun = p.count === 1 ? "photo" : "photos";
      if (!window.confirm(`Label ${p.count} unlabeled ${noun} ${where}? About ${each} per photo (about ${total}). Labels you already set stay as they are.`)) return;
      const r = await run({ data: { vehicleId: vehicle } });
      toast.success(`Labeling ${r.queued} ${r.queued === 1 ? "photo" : "photos"} in the background. About ${each} each.`);
      window.setTimeout(() => onDone?.(), 4000);
    } catch (e) {
      toast.error(e instanceof Error && e.message === "Forbidden" ? "Labeling photos is staff-only." : "Could not start labeling.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void go("car")}
        className="rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1 text-[12px] font-medium text-[#111114] hover:bg-[#F4F4F6] disabled:opacity-50"
      >
        Auto-Label Unlabeled
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void go("all")}
        className="rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1 text-[12px] font-medium text-[#111114] hover:bg-[#F4F4F6] disabled:opacity-50"
      >
        All Cars
      </button>
      <span className="text-[11px] text-[#55555E]">About {formatLabelCost(PHOTO_LABEL_COST_CENTS)} Per Photo. Labels You Set Stay.</span>
    </div>
  );
}
