// Settings → Photo Reading. The Owner's switch over the only thing in this
// system that spends money.
//
// Photo Enhancement's panel sits next to this one and says, correctly, that
// nothing it does can incur a charge. This one is the opposite case, so it
// leads with the switch, states the cost in money rather than in units, and
// shows what has been spent today — an Owner should not have to open the
// audit log to find out whether the limit is doing anything.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPhotoReadingStatus, savePhotoReadingSettings } from "@/lib/vehicle-photo-analysis.functions";
import { fmtDateTime } from "@/lib/date-format";

type Status = Awaited<ReturnType<typeof getPhotoReadingStatus>>;

export function PhotoReadingPanel() {
  const status = useServerFn(getPhotoReadingStatus);
  const save = useServerFn(savePhotoReadingSettings);
  const [data, setData] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);

  const load = () =>
    status()
      .then((d) => { setData(d); setLimit(d.dailyLimit); setErr(null); })
      .catch(() => setErr("Could not load Photo Reading settings."));
  useEffect(() => { void load(); }, []);

  async function update(patch: { enabled?: boolean; clearPause?: boolean }) {
    if (!data) return;
    setBusy(true);
    try {
      await save({ data: { enabled: patch.enabled ?? data.enabled, dailyLimit: limit, clearPause: patch.clearPause } });
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
          <input
            type="checkbox"
            aria-label="Photo Reading enabled"
            checked={data.enabled}
            disabled={busy || !owner}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          Photo Reading {data.enabled ? "On" : "Off"}
        </label>
        <p className="text-[12px] text-[#55555E] leading-relaxed">
          Lets staff read a vehicle photograph for details that are visible on the car — the plate,
          the colour, the body type, an odometer, a VIN plate. Every detail still needs an individual
          tick before it is saved to the vehicle. Uploading photos never reads anything; someone has
          to ask.
        </p>
        <p className="text-[12px] text-[#8A4B00] leading-relaxed">
          Unlike Photo Enhancement, this one costs money. Each photograph is read by the same
          document reader Fleet Inbox uses, at roughly a cent or less per photo. The daily limit
          below is enforced on the server before any reading is queued.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-[12px] text-[#55555E] space-y-1">
            <span className="block font-medium text-[#111114]">Daily Limit (Photos)</span>
            <input
              type="number" min={0} max={1000} value={limit} disabled={!owner}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full rounded-md border border-[#EDEDF0] px-2 py-1.5 text-[13px]"
            />
          </label>
          <div className="text-[12px] text-[#55555E] space-y-1">
            <span className="block font-medium text-[#111114]">Used Today</span>
            <p className="py-1.5 text-[13px] text-[#111114]">
              {data.usedToday} of {data.dailyLimit} · {data.remainingToday} left
            </p>
          </div>
        </div>

        {owner && (
          <button
            type="button" disabled={busy} onClick={() => update({})}
            className="rounded-lg bg-[#111114] text-white px-3 py-1.5 text-[13px] disabled:opacity-50"
          >
            Save Limits
          </button>
        )}
        {!owner && (
          <p className="text-[12px] text-[#9A9AA3]">Only an Owner can change these settings.</p>
        )}
      </div>

      {data.pausedReason && (
        <div className="rounded-xl border border-[#F59E0B] bg-[#FFFBEB] p-5 space-y-2">
          <h3 className="text-[14px] font-semibold text-[#8A4B00]">Paused</h3>
          <p className="text-[13px] text-[#8A4B00]">
            {data.pausedReason}
            {data.pausedAt ? ` · ${fmtDateTime(data.pausedAt)}` : ""}
          </p>
          {owner && (
            <button
              type="button" disabled={busy} onClick={() => update({ clearPause: true })}
              className="rounded-lg border border-[#EDEDF0] bg-white px-3 py-1.5 text-[13px] disabled:opacity-50"
            >
              Resume Photo Reading
            </button>
          )}
        </div>
      )}

      <div className="rounded-xl border border-[#EDEDF0] bg-white p-5 space-y-2">
        <h3 className="text-[14px] font-semibold text-[#111114]">Status</h3>
        <p className="text-[13px] text-[#55555E]">
          {data.refusal ?? "A Manager or Owner can read photos from a vehicle's Photos tab right now."}
        </p>
        <p className="text-[12px] text-[#9A9AA3]">
          {data.updatedAt ? `Last changed ${fmtDateTime(data.updatedAt)}.` : "Never changed — using the default, which is Off."}
          {" "}The count resets at midnight UTC.
        </p>
      </div>
    </div>
  );
}
