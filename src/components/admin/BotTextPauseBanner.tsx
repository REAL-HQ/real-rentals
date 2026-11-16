import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getBotTextPause, updateBotTextPause } from "@/lib/staff-text-pause.functions";

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " ET";

/**
 * Light notice on a driver profile while bot outreach is paused because a
 * person on the team texted them from Quo (or paused it here). Not a Needs
 * Staff flag. Any staff member can resume the bots or add 48 hours.
 */
export function BotTextPauseBanner({ applicationId }: { applicationId: string }) {
  const load = useServerFn(getBotTextPause);
  const update = useServerFn(updateBotTextPause);
  const [until, setUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    load({ data: { applicationId } })
      .then((r) => { if (!cancelled) setUntil(r.paused ? r.until : null); })
      .catch(() => { if (!cancelled) setUntil(null); });
    return () => { cancelled = true; };
  }, [applicationId, load]);
  if (!until) return null;
  async function act(action: "clear" | "extend") {
    if (busy) return;
    setBusy(true);
    try {
      const r = await update({ data: { applicationId, action, ...(action === "extend" ? { hours: 48 } : {}) } });
      if (!r.ok) throw new Error(r.error ?? "Could Not Update The Pause.");
      setUntil(r.until ?? null);
      toast.success(action === "clear" ? "Bots Resumed" : "Bots Paused 48 More Hours");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Update The Pause.");
    } finally {
      setBusy(false);
    }
  }
  const btn = "inline-flex h-8 items-center rounded-md border border-[#D6D6DB] bg-white px-3 text-xs font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";
  return (
    <div role="status" data-bot-text-pause className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-[#E4E4E8] bg-[#FAFAFB] px-4 py-3 text-sm text-[#33333A]">
      <span className="rounded-full bg-[#55555E] px-2 py-0.5 text-[11px] font-semibold text-white">Bots Paused</span>
      <span className="min-w-0 flex-1">Staff Are Texting This Person. Automatic Texts And Emails Hold Until {fmt(until)}.</span>
      <button type="button" disabled={busy} onClick={() => void act("extend")} className={btn}>+48 Hours</button>
      <button type="button" disabled={busy} onClick={() => void act("clear")} className={btn}>Resume Bots</button>
    </div>
  );
}
