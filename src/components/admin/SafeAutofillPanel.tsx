import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getAutofillStatus, saveAutofillSettingsFn, undoAutofillFn } from "@/lib/safe-autofill.functions";
import { fmtDateTime } from "@/lib/date-format";

const LABEL: Record<string, string> = { trim: "Trim", body_type: "Body Type", color: "Color", fuel_type: "Fuel Type", seats: "Seats" };

export function SafeAutofillPanel() {
  const status = useServerFn(getAutofillStatus);
  const save = useServerFn(saveAutofillSettingsFn);
  const undo = useServerFn(undoAutofillFn);
  const [data, setData] = useState<Awaited<ReturnType<typeof getAutofillStatus>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cap, setCap] = useState(50);
  const [busy, setBusy] = useState(false);

  const load = () => status().then((d) => { setData(d); setCap(d.settings.daily_cap); setErr(null); }).catch((e) => setErr(e?.message ?? "Could not load."));
  useEffect(() => { void load(); }, []);

  async function update(enabled: boolean, clearPause = false) {
    setBusy(true);
    try { await save({ data: { enabled, dailyCap: cap, clearPause } }); toast.success("Saved"); await load(); }
    catch (e: any) { toast.error(e?.message ?? "Could not save."); } finally { setBusy(false); }
  }
  async function doUndo(scope: { vehicleId?: string; batchId?: string }) {
    setBusy(true);
    try { const r = await undo({ data: scope }); toast.success(`Undid ${r.reverted}; kept ${r.kept} edited since.`); await load(); }
    catch (e: any) { toast.error(e?.message ?? "Could not undo."); } finally { setBusy(false); }
  }

  if (err) return <p className="text-[13px] text-[#55555E]">{err}</p>;
  if (!data) return <p className="text-[13px] text-[#55555E]">Loading…</p>;
  const s = data.settings;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#EDEDF0] bg-white p-5 space-y-3">
        <label className="flex items-center gap-2 text-[14px] font-medium cursor-pointer">
          <input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => update(e.target.checked)} />
          Safe Autofill {s.enabled ? "On" : "Off"}
        </label>
        <p className="text-[12px] text-[#55555E]">Fills only blank Trim, Body Type, Color, Fuel Type and Seats from a title or registration with an exact, valid VIN match, high confidence and no conflicting documents. VIN, plate, mileage, rates, deposit, status, title, finance, insurance and registration details always need approval. Applies to newly analyzed documents only.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[11px] text-[#55555E]">Daily Limit</label>
            <input type="number" min={1} max={500} value={cap} onChange={(e) => setCap(Number(e.target.value))} className="mt-1 block w-24 rounded-md border border-[#EDEDF0] px-2 py-1 text-[13px]" />
          </div>
          <button disabled={busy || cap === s.daily_cap || cap < 1 || cap > 500} onClick={() => update(s.enabled)} className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[12px] font-medium disabled:opacity-50">Save Limit</button>
          <span className="text-[12px] text-[#55555E]">Used Today: {data.usedToday} / {s.daily_cap}</span>
        </div>
        {s.paused_reason && (
          <div className="rounded-md bg-[#FFF4E5] p-3 text-[12px] text-[#8A4B00] flex flex-wrap items-center justify-between gap-2">
            <span>{s.paused_reason}</span>
            <button disabled={busy} onClick={() => update(s.enabled, true)} className="rounded-md border border-[#8A4B00]/30 px-2.5 py-1 font-medium">Resume</button>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-[#EDEDF0] bg-white p-5">
        <h3 className="text-[14px] font-semibold mb-2">Automatic Fill History</h3>
        {data.events.length === 0 ? <p className="text-[12px] text-[#55555E]">No automatic fills yet.</p> : (
          <div className="space-y-2">
            {data.events.map((e: any) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F2F2F4] pb-2 text-[12px]">
                <div className="min-w-0">
                  <span className="font-medium">{e.vehicles?.unit_number ?? "Vehicle"}</span> · {LABEL[e.field] ?? e.field}: {e.previous_value ?? "Not Set"} → {e.new_value}
                  <div className="text-[#55555E]">{fmtDateTime(e.created_at)} · {e.doc_class}{e.page ? ` · Page ${e.page}` : ""} · “{e.evidence_raw}” · {e.confidence}{e.undone_at ? ` · ${e.undo_result === "reverted" ? "Undone" : "Kept (Edited Since)"}` : ""}</div>
                </div>
                {!e.undone_at && (
                  <div className="flex gap-1.5">
                    <button disabled={busy} onClick={() => doUndo({ vehicleId: e.vehicle_id })} className="rounded-md border border-[#EDEDF0] px-2 py-1">Undo Vehicle</button>
                    {e.batch_id && <button disabled={busy} onClick={() => doUndo({ batchId: e.batch_id })} className="rounded-md border border-[#EDEDF0] px-2 py-1">Undo Batch</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
