// Back Office → Settings → Automations: every automated email and text, what
// triggers it, its template, whether it is on, and whether it can actually run.
// Loading this page only reads. Switches are Owner only and future-only.
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { AUTOMATIONS, type AutomationDef } from "@/lib/automation-catalog";
import {
  getAutomationsOverview,
  previewAutomationTemplate,
  setAutomationOn,
  type AutomationRow,
  type AutomationsOverview,
} from "@/lib/automations-overview.functions";
import { fmtDateTime } from "@/lib/date-format";

const PREVIEW_LABELS: Record<string, string> = {
  recovery_24h: "24 Hours",
  recovery_72h: "72 Hours",
  recovery_abandoned: "Quote",
  resume: "Email",
  lead_new: "Email",
  lead_complete: "Email",
  due_tomorrow: "Email",
  past_due: "Email",
  team_alert: "Email",
  collections_plan: "Email",
  payment_failed: "Email",
  payment_receipt: "Email",
  card_expiring: "Email",
  license_expiring: "Email",
};

function delayLabel(min: number): string {
  if (min <= 0) return "Right Away";
  if (min < 60) return `${min} Min`;
  if (min < 1440) return `${Math.round(min / 60)} Hr`;
  return `${Math.round(min / 1440)} Day`;
}

/** The status words shown next to the switch. "On" never hides "can't run". */
export function statusWords(row: Pick<AutomationRow, "on" | "health" | "blockers" | "canToggle">): { label: string; tone: "ok" | "warn" | "off" } {
  if (row.on === false) return { label: "Off", tone: "off" };
  if (row.on === null && !row.canToggle) return { label: "Not Built On", tone: "off" };
  if (row.blockers.length) return { label: "On, Not Running", tone: "warn" };
  if (row.health === "Health Unknown") return { label: "On", tone: "ok" };
  return { label: "On, Running", tone: "ok" };
}

export function AutomationsCatalog() {
  const load = useServerFn(getAutomationsOverview);
  const toggle = useServerFn(setAutomationOn);
  const preview = useServerFn(previewAutomationTemplate);
  const [data, setData] = useState<AutomationsOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setData(await load()); setFailed(false); } catch { setFailed(true); }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function flip(def: AutomationDef, on: boolean) {
    const msg = on
      ? `Turn on ${def.title}? It applies from now on. Nothing already missed is sent.`
      : `Turn off ${def.title}? Nothing from it will be sent until it is turned back on.`;
    if (!window.confirm(msg)) return;
    setBusy(def.key);
    try {
      await toggle({ data: { key: def.key, on } });
      toast.success(`${def.title} ${on ? "On" : "Off"}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save. Nothing was changed.");
    } finally { setBusy(null); }
  }

  if (failed) return <p className="text-sm text-[#55555E]">Automations could not load. Refresh to try again.</p>;
  if (!data) return <p className="text-sm text-[#55555E]">Loading…</p>;

  const byKey = new Map(data.rows.map((r) => [r.key, r]));
  const groups = ["Applicants", "Renters", "Team"] as const;

  return (
    <div className="space-y-5" data-testid="automations-catalog">
      <div className="rounded-xl border border-[#EDEDF0] bg-white p-4 text-[13px] text-[#55555E] space-y-1">
        <h3 className="text-[13px] font-semibold text-[#111114]">Automations</h3>
        <p>Every email and text the app sends on its own. A switch only changes what happens from now on. Nothing old is sent when you turn something on.</p>
        <p>
          Email: {data.emailReady ? "Set Up" : "Not Set Up"} · SMS: {data.smsReady ? "Set Up" : "Not Set Up"} ({data.smsSentEver} sent so far)
          {data.cronKnown ? "" : " · Schedule health isn't available yet."}
        </p>
        {!data.isOwner && <p>Only the Owner can change switches.</p>}
      </div>
      {groups.map((g) => (
        <section key={g} className="space-y-2">
          <h4 className="text-[12px] font-semibold text-[#55555E]">{g}</h4>
          {AUTOMATIONS.filter((a) => a.audience === g).map((def) => {
            const row = byKey.get(def.key);
            if (!row) return null;
            return <AutomationCard key={def.key} def={def} row={row} isOwner={data.isOwner} busy={busy === def.key} onFlip={(on) => void flip(def, on)} preview={preview} />;
          })}
        </section>
      ))}
    </div>
  );
}

function AutomationCard({ def, row, isOwner, busy, onFlip, preview }: { def: AutomationDef; row: AutomationRow; isOwner: boolean; busy: boolean; onFlip: (on: boolean) => void; preview: (a: { data: { id: string } }) => Promise<any> }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<{ id: string; subject: string | null; html: string | null; reason?: string } | null>(null);
  const status = statusWords(row);
  const tone = status.tone === "ok" ? "text-[#1B7F3B]" : status.tone === "warn" ? "text-[#B45309]" : "text-[#55555E]";

  async function show(id: string) {
    try { const r = await preview({ data: { id } }); setShown({ id, ...r }); }
    catch { setShown({ id, subject: null, html: null, reason: "Preview could not load." }); }
  }

  return (
    <div className="rounded-xl border border-[#EDEDF0] bg-white p-4 space-y-2" data-automation={def.key}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-[#111114]">{def.title}</span>
            <span className="text-[12px] text-[#55555E]">{def.channels.join(" + ")}</span>
            <span className={`text-[12px] font-medium ${tone}`} data-status>{status.label}</span>
          </div>
          <p className="text-[13px] text-[#55555E]">{def.trigger} {def.cadence}</p>
          <p className="text-[12px] text-[#8A8A93]">
            {row.lastSentAt ? `Last Sent ${fmtDateTime(row.lastSentAt)} (${row.lastState ?? "unknown"}) · ${row.sent30d} in 30 days` : "Never Sent"}
            {row.lastRunAt ? ` · Last Run ${fmtDateTime(row.lastRunAt)}${row.lastRunFailed ? " Failed" : ""}` : ""}
          </p>
          {row.blockers.map((b) => <p key={b} className="text-[12px] text-[#B45309]">{b}</p>)}
          {def.note && <p className="text-[12px] text-[#8A8A93]">{def.note}</p>}
        </div>
        {row.canToggle && row.on !== null && (
          <Switch aria-label={def.title} checked={row.on} disabled={!isOwner || busy} onCheckedChange={(v) => onFlip(v)} />
        )}
      </div>
      {(def.previews.length > 0 || row.smsSteps.length > 0 || row.emailSteps.length > 0) && (
        <button type="button" className="text-[12px] font-medium text-[#D03020]" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide Templates" : "Templates"}
        </button>
      )}
      {open && (
        <div className="space-y-2 border-t border-[#EDEDF0] pt-2">
          {def.previews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {def.previews.map((id) => (
                <button key={id} type="button" onClick={() => void show(id)} className={`rounded-md border px-2 py-1 text-[12px] ${shown?.id === id ? "border-[#D03020] text-[#D03020]" : "border-[#EDEDF0] text-[#111114]"}`}>
                  {PREVIEW_LABELS[id] ?? "Email"}
                </button>
              ))}
            </div>
          )}
          {shown && (shown.html ? (
            <div className="space-y-1">
              <p className="text-[12px] text-[#55555E]"><span className="font-medium text-[#111114]">Subject:</span> {shown.subject}</p>
              <iframe title={`${def.title} Preview`} sandbox="" srcDoc={shown.html} className="h-[420px] w-full rounded-md border border-[#EDEDF0] bg-white" />
              <p className="text-[11px] text-[#8A8A93]">Sample data. Nothing was sent.</p>
            </div>
          ) : <p className="text-[12px] text-[#55555E]">{shown.reason}</p>)}
          {[...row.smsSteps.map((s) => ({ ...s, ch: "SMS", subject: null as string | null })), ...row.emailSteps.map((s) => ({ ...s, ch: "Email" }))]
            .sort((a, b) => a.order - b.order)
            .map((s) => (
              <div key={`${s.ch}-${s.order}`} className="rounded-md bg-[#F7F7F9] p-2 text-[12px]">
                <p className="font-medium text-[#111114]">{s.ch} · {delayLabel(s.delayMinutes)}{s.active ? "" : " · Step Off"}</p>
                {s.subject && <p className="text-[#55555E]">Subject: {s.subject}</p>}
                <p className="whitespace-pre-wrap text-[#55555E]">{s.body}</p>
              </div>
            ))}
          {(row.smsSteps.length > 0 || row.emailSteps.length > 0) && <p className="text-[11px] text-[#8A8A93]">Edit these steps in Workflows below.</p>}
        </div>
      )}
    </div>
  );
}
