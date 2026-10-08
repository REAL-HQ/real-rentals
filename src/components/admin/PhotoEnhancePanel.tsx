import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPhotoEnhanceStatus, savePhotoEnhanceSettings } from "@/lib/photo-enhance.functions";

type Status = Awaited<ReturnType<typeof getPhotoEnhanceStatus>>;

export function PhotoEnhancePanel() {
  const status = useServerFn(getPhotoEnhanceStatus);
  const save = useServerFn(savePhotoEnhanceSettings);
  const [data, setData] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [cap, setCap] = useState(10);
  const [busy, setBusy] = useState(false);

  const load = () =>
    status()
      .then((d) => { setData(d); setLimit(d.dailyLimit); setCap(d.monthlyPaidCapCents / 100); setErr(null); })
      .catch((e) => setErr(e?.message === "Forbidden" ? "Only Managers and Owners can view this." : "Could not load."));
  useEffect(() => { void load(); }, []);

  async function update(enabled: boolean) {
    setBusy(true);
    try {
      await save({ data: { enabled, dailyLimit: limit, monthlyPaidCapCents: Math.round(cap * 100) } });
      toast.success("Saved");
      await load();
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Only an Owner can change these settings." : "Could not save.");
    } finally { setBusy(false); }
  }

  if (err) return <p className="text-[13px] text-[#55555E]">{err}</p>;
  if (!data) return <p className="text-[13px] text-[#55555E]">Loading…</p>;
  const owner = data.isOwner;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#EDEDF0] bg-white p-5 space-y-4">
        <label className="flex items-center gap-2 text-[14px] font-medium cursor-pointer">
          <input type="checkbox" checked={data.enabled} disabled={busy || !owner} onChange={(e) => update(e.target.checked)} />
          Photo Enhancement {data.enabled ? "On" : "Off"}
        </label>
        <p className="text-[12px] text-[#55555E] leading-relaxed">
          Photos are processed free on the device of the person who clicks Enhance. The car itself is never redrawn —
          Studio only replaces the background. Results stay private until someone approves and then separately publishes them.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[12px] text-[#55555E] space-y-1">
            <span className="block font-medium text-[#111114]">Daily Limit (Photos)</span>
            <input type="number" min={0} max={1000} value={limit} disabled={!owner} onChange={(e) => setLimit(Number(e.target.value))} className="w-full rounded-md border border-[#EDEDF0] px-2 py-1.5 text-[13px]" />
          </label>
          <label className="text-[12px] text-[#55555E] space-y-1">
            <span className="block font-medium text-[#111114]">Monthly Paid Processing Cap ($)</span>
            <input type="number" min={0} step={1} value={cap} disabled={!owner} onChange={(e) => setCap(Number(e.target.value))} className="w-full rounded-md border border-[#EDEDF0] px-2 py-1.5 text-[13px]" />
          </label>
        </div>
        {owner && (
          <button type="button" disabled={busy} onClick={() => update(data.enabled)} className="rounded-lg bg-[#111114] text-white px-3 py-1.5 text-[13px] disabled:opacity-50">
            Save Limits
          </button>
        )}
        <p className="text-[12px] text-[#9A9AA3]">No paid provider is connected, so the paid cap is a safeguard only.</p>
      </div>

      <div className="rounded-xl border border-[#EDEDF0] bg-white p-5 space-y-2">
        <h3 className="text-[14px] font-semibold text-[#111114]">Usage</h3>
        <p className="text-[13px] text-[#55555E]">Today: {data.usedToday} of {data.dailyLimit} photos · Paid this month: ${(data.paidThisMonthCents / 100).toFixed(2)} of ${(data.monthlyPaidCapCents / 100).toFixed(2)}</p>
        {owner && (
          data.recent.length === 0 ? (
            <p className="text-[12px] text-[#9A9AA3]">No enhancements yet.</p>
          ) : (
            <ul className="divide-y divide-[#EDEDF0] text-[12px]">
              {data.recent.map((r: any) => (
                <li key={r.id} className="py-1.5 flex flex-wrap gap-x-3">
                  <span className="text-[#9A9AA3]">{new Date(r.created_at).toLocaleString()}</span>
                  <span className="capitalize">{r.mode}</span>
                  <span className={r.status === "failed" ? "text-[#D03020]" : "text-[#55555E]"}>{r.status === "failed" ? "Failed" : r.status === "succeeded" ? "Done" : "Started"}</span>
                  {r.processing_ms != null && <span className="text-[#9A9AA3]">{(r.processing_ms / 1000).toFixed(1)}s</span>}
                  {r.error && <span className="text-[#D03020] w-full">{r.error} — retry from the vehicle's Photos tab.</span>}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
