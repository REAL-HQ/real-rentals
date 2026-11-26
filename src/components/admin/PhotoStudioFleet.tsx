import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  approveAndPublishStudio, approveAndPublishStudioReady, getStudioFleetProgress, runStudioNextCar,
} from "@/lib/photo-studio-fleet.functions";

type Row = Awaited<ReturnType<typeof getStudioFleetProgress>>["rows"][number];

const btn = "rounded-md border border-[#EDEDF0] bg-white px-2.5 py-1 text-[12px] font-medium text-[#111114] hover:bg-[#F4F4F6] disabled:opacity-50";

/** Fleet-wide Photo Studio progress. One click runs cars until the cap; the Owner publishes ready sets. */
export function PhotoStudioFleet({ onChanged }: { onChanged?: () => void }) {
  const load = useServerFn(getStudioFleetProgress);
  const next = useServerFn(runStudioNextCar);
  const publishOne = useServerFn(approveAndPublishStudio);
  const publishAll = useServerFn(approveAndPublishStudioReady);
  const [rows, setRows] = useState<Row[]>([]);
  const [canRun, setCanRun] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await load();
      setRows(r.rows);
      setCanRun(r.canRun);
      setCanPublish(r.canPublish);
      setEnabled(r.enabled);
    } catch {
      setRows([]);
    }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function runAll() {
    if (busy) return;
    if (!window.confirm("Label unlabeled photos, then generate the missing shots for every car still in the fleet? For Sale, Archived, Retired, and Sold are skipped. The daily image limit and monthly cap still apply. Cars that do not fit today stay as Continues Tomorrow. The same button continues the next day.")) return;
    setBusy(true);
    const skip: string[] = [];
    let worked = 0;
    let held: "continues_tomorrow" | "monthly_cap" | null = null;
    try {
      for (let n = 0; n < 40; n++) {
        const r = await next({ data: { skipIds: skip } });
        if (!r.ok) {
          toast.error("error" in r ? r.error : "Could not run Photo Studio.");
          break;
        }
        if (r.outcome === "continues_tomorrow" || r.outcome === "monthly_cap") {
          held = r.outcome;
          if (r.vehicleId) { skip.push(r.vehicleId); continue; }
          toast.message(r.outcome === "continues_tomorrow"
            ? "Continues Tomorrow. The daily limit was reached. Run this again tomorrow."
            : (r.reason ?? "The monthly cap was reached."));
          break;
        }
        if (r.outcome === "done") {
          if (held === "continues_tomorrow") toast.message("Continues Tomorrow. The daily limit was reached. Run this again tomorrow.");
          else if (held === "monthly_cap") toast.message("The monthly cap was reached.");
          else toast.success(worked ? `Photo Studio finished ${worked} ${worked === 1 ? "car" : "cars"}.` : "Every car in the fleet already has its shots.");
          break;
        }
        if (r.vehicleId) skip.push(r.vehicleId);
        worked++;
      }
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error && e.message === "Forbidden" ? "Running Photo Studio is Manager-only." : "Could not run Photo Studio.");
    } finally {
      setBusy(false);
    }
  }

  async function publishReady() {
    if (busy) return;
    const count = rows.filter((r) => r.ready && r.state !== "Published").length;
    if (!count) { toast.message("No Ready Sets"); return; }
    if (!window.confirm(`Approve and publish ${count} ready ${count === 1 ? "set" : "sets"}? Only complete sets that passed the identity check are included.`)) return;
    setBusy(true);
    try {
      const r = await publishAll();
      toast.success(`Published ${r.published} ${r.published === 1 ? "set" : "sets"}.`);
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error && e.message === "Forbidden" ? "Publishing is Owner-only." : "Could not publish.");
    } finally { setBusy(false); }
  }

  async function publishCar(row: Row) {
    if (busy) return;
    if (!window.confirm(`Approve and publish the set for ${row.label}?`)) return;
    setBusy(true);
    try {
      const r = await publishOne({ data: { vehicleId: row.vehicleId } });
      if (!r.ok) toast.error(r.error);
      else toast.success(`Published ${row.label}.`);
      await refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error && e.message === "Forbidden" ? "Publishing is Owner-only." : "Could not publish.");
    } finally { setBusy(false); }
  }

  return (
    <div className="mb-4 rounded-xl border border-[#EDEDF0] bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#EDEDF0] px-3 py-2">
        <div className="min-w-0 flex-1 text-[13px] font-semibold text-[#111114]">Fleet Photo Studio</div>
        {canRun && <button type="button" className={btn} disabled={busy || !enabled} onClick={() => void runAll()}>Run All Cars</button>}
        {canPublish && <button type="button" className={btn} disabled={busy} onClick={() => void publishReady()}>Approve & Publish All Ready</button>}
      </div>
      <p className="px-3 pt-2 text-[11px] text-[#55555E]">For Sale, Archived, Retired, and Sold are not listed. A set is Ready only when every shot passed the identity check.</p>
      {rows.length === 0 ? <p className="px-3 py-3 text-[12px] text-[#55555E]">No Cars In The Working Fleet</p> : (
        <div className="overflow-x-auto px-3 py-2">
          <table className="w-full text-left text-[12px] text-[#111114]">
            <thead>
              <tr className="text-[10px] font-semibold text-[#9A9AA3]">
                <th className="py-1 pr-3 font-semibold">Car</th>
                <th className="py-1 pr-3 font-semibold">Labeled</th>
                <th className="py-1 pr-3 font-semibold">Unknown</th>
                <th className="py-1 pr-3 font-semibold">Generated</th>
                <th className="py-1 pr-3 font-semibold">Approved</th>
                <th className="py-1 pr-3 font-semibold">Published</th>
                <th className="py-1 pr-3 font-semibold">State</th>
                {canPublish && <th className="py-1 font-semibold"> </th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.vehicleId} className="border-t border-[#EDEDF0]">
                  <td className="py-1.5 pr-3">{row.label}</td>
                  <td className="py-1.5 pr-3">{row.labeled}</td>
                  <td className="py-1.5 pr-3">{row.unknown}</td>
                  <td className="py-1.5 pr-3">{row.generated}</td>
                  <td className="py-1.5 pr-3">{row.approved}</td>
                  <td className="py-1.5 pr-3">{row.published}</td>
                  <td className="py-1.5 pr-3">{row.state}</td>
                  {canPublish && (
                    <td className="py-1.5 text-right">
                      {row.ready && row.state !== "Published" && (
                        <button type="button" className={btn} disabled={busy} onClick={() => void publishCar(row)}>Approve & Publish</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
