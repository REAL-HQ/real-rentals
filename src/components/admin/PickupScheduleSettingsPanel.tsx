import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPickupSchedule, savePickupSchedule } from "@/lib/pickup-schedule.functions";
import {
  DEFAULT_PICKUP_SCHEDULE,
  validatePickupSchedule,
  WEEKDAY_LABELS,
  type PickupScheduleSettings,
} from "@/lib/pickup-schedule";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const list = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Settings → Rental Terms → Pickup Schedule. Days, start times and slot length
 * for pickups (Reserved dialog and FLEET), the field rep, and the staff text +
 * email when a reservation is fully confirmed. Notifications are Off by
 * default. Owner saves.
 */
export function PickupScheduleSettingsPanel() {
  const load = useServerFn(getPickupSchedule);
  const save = useServerFn(savePickupSchedule);
  const [draft, setDraft] = useState<PickupScheduleSettings>(DEFAULT_PICKUP_SCHEDULE);
  const [times, setTimes] = useState(DEFAULT_PICKUP_SCHEDULE.startTimes.join(", "));
  const [sms, setSms] = useState(DEFAULT_PICKUP_SCHEDULE.notify.sms.join("\n"));
  const [emails, setEmails] = useState(DEFAULT_PICKUP_SCHEDULE.notify.emails.join("\n"));
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (s: PickupScheduleSettings) => {
    setDraft(s);
    setTimes(s.startTimes.join(", "));
    setSms(s.notify.sms.join("\n"));
    setEmails(s.notify.emails.join("\n"));
  };

  useEffect(() => {
    let cancelled = false;
    load()
      .then((s) => !cancelled && (apply(s), setLoaded(true)))
      .catch(() => !cancelled && toast.error("Could Not Load The Pickup Schedule"));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const candidate = { ...draft, startTimes: list(times), notify: { ...draft.notify, sms: list(sms), emails: list(emails) } };
  const check = validatePickupSchedule(candidate);

  async function persist() {
    if (!check.ok) {
      toast.error(check.errors[0]);
      return;
    }
    setBusy(true);
    try {
      apply(await save({ data: check.value }));
      toast.success("Pickup Schedule Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[#EDEDF0] bg-white p-5" aria-label="Pickup Schedule" data-testid="pickup-schedule-settings">
      <h3 className="text-[15px] font-semibold text-[#111114]">Pickup Schedule</h3>
      <p className="mt-1 text-[12px] text-[#55555E]">
        Pickup slots offered in Reserved and to FLEET, earliest first, one booking per slot. Times are Eastern.
      </p>
      <div className="mt-4 grid gap-3">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Days</div>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((d, i) => {
              const on = draft.days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  className={`h-8 rounded-md border px-3 text-sm ${on ? "border-[#D03020] bg-[#FDEDEB] text-[#8A1C10]" : "border-[#D6D6DB] bg-white text-[#55555E]"}`}
                  onClick={() => setDraft({ ...draft, days: on ? draft.days.filter((x) => x !== i) : [...draft.days, i].sort() })}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-muted-foreground">
            Start Times (24-hour, comma separated)
            <input className={input} value={times} onChange={(e) => setTimes(e.target.value)} aria-label="Start Times" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Slot Length (minutes)
            <input className={input} inputMode="numeric" value={draft.slotMinutes} onChange={(e) => setDraft({ ...draft, slotMinutes: Number(e.target.value) || 0 })} aria-label="Slot Length" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Minimum Notice (minutes)
            <input className={input} inputMode="numeric" value={draft.minNoticeMinutes} onChange={(e) => setDraft({ ...draft, minNoticeMinutes: Number(e.target.value) || 0 })} aria-label="Minimum Notice" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Field Rep
            <input className={input} value={draft.fieldRep.name} onChange={(e) => setDraft({ ...draft, fieldRep: { name: e.target.value } })} aria-label="Field Rep" />
          </label>
        </div>
        <label className="text-xs font-medium text-muted-foreground">
          Default Pickup Location
          <input className={input} value={draft.defaultLocation ?? ""} onChange={(e) => setDraft({ ...draft, defaultLocation: e.target.value || null })} placeholder="Street Address, City, State" aria-label="Default Pickup Location" maxLength={180} />
        </label>
        <div className="rounded-lg border border-[#EDEDF0] p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[13px] font-medium text-[#111114]">Confirmed Reservation Alerts</div>
              <p className="mt-1 text-[12px] text-[#55555E]">
                Text and email when a reservation is fully confirmed: Reserved, Approved, pickup time and place set, deposit not pending
                {draft.notify.requireSignedAgreement ? ", agreement signed" : ""}. Texts go from the main business line.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.notify.enabled}
              aria-label="Confirmed Reservation Alerts"
              onClick={() => setDraft({ ...draft, notify: { ...draft.notify, enabled: !draft.notify.enabled } })}
              className={`h-6 w-11 shrink-0 rounded-full ${draft.notify.enabled ? "bg-[#D03020]" : "bg-[#D6D6DB]"}`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white transition ${draft.notify.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-muted-foreground">
              Text To (one per line)
              <textarea className={`${input} min-h-16`} value={sms} onChange={(e) => setSms(e.target.value)} aria-label="Text To" />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Email To (one per line)
              <textarea className={`${input} min-h-16`} value={emails} onChange={(e) => setEmails(e.target.value)} aria-label="Email To" />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[12px] text-[#55555E]">
            <input
              type="checkbox"
              checked={draft.notify.requireSignedAgreement}
              onChange={(e) => setDraft({ ...draft, notify: { ...draft.notify, requireSignedAgreement: e.target.checked } })}
            />
            Require A Signed Agreement Before Confirming
          </label>
        </div>
        {!check.ok ? <p className="text-[12px] text-[#8A1C10]">{check.errors[0]}</p> : null}
        <div>
          <button
            type="button"
            disabled={busy || !loaded}
            onClick={() => void persist()}
            className="inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save Pickup Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
