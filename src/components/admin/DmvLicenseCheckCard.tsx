import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { IdCard } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DMV_CHECK_STATUSES,
  DMV_FLORIDA_CHECK_URL,
  DMV_HOME_STATE,
  dmvDisplay,
  dmvLogBlockers,
  dmvStatusLabel,
  normalizeLicenseState,
} from "@/lib/dmv-license-check";
import { getDmvLicenseProfile, logDmvLicenseCheck, type DmvProfile } from "@/lib/dmv-license-check.functions";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";

const TONE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  bad: "bg-rose-100 text-rose-800",
  warn: "bg-amber-100 text-amber-800",
  none: "bg-[#F1F1F4] text-[#55555E]",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
}

/**
 * Driver profile: State DMV License Check (Florida: FLHSMV). Any staff tier logs
 * the result. Approval, agreement sends and Reservation Fee links need a Valid
 * check under 24 hours old; anything else goes to Needs Staff. An out-of-state
 * license shows as Unverified.
 */
export function DmvLicenseCheckCard({ applicationId, licenseState, onLogged }: { applicationId: string; licenseState?: string | null; onLogged?: () => void }) {
  const load = useServerFn(getDmvLicenseProfile);
  const log = useServerFn(logDmvLicenseCheck);
  const [profile, setProfile] = useState<DmvProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [state, setState] = useState(DMV_HOME_STATE);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    load({ data: { applicationId } })
      .then((p) => {
        setProfile(p);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [applicationId, load]);
  useEffect(() => refresh(), [refresh, licenseState]);

  if (failed || !profile || !profile.installed) return null;

  const latest = profile.checks[0] ?? null;
  const show = dmvDisplay(latest, profile.licenseState, Date.now());
  const blockers = dmvLogBlockers({ status, licenseState: state, note });
  const startOpen = () => {
    setStatus("");
    setNote("");
    setState(normalizeLicenseState(profile.licenseState) ?? DMV_HOME_STATE);
    setOpen(true);
  };

  async function save() {
    setBusy(true);
    try {
      const r = await log({ data: { applicationId, status: status as any, licenseState: state, note } });
      toast.success(r.routed ? "Logged. Not Valid: Sent To Needs Staff." : "State DMV Check Logged.");
      setOpen(false);
      refresh();
      onLogged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="dmv-license-card" className="rounded-xl border border-[#EDEDF0] bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <IdCard className="h-4 w-4 text-[#9A9AA3]" />
        <h3 className="text-[13px] font-semibold text-[#111114]">State DMV License Check</h3>
        <span data-testid="dmv-license-status" className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[show.tone]}`}>
          {show.label}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <a className={secondary} href={DMV_FLORIDA_CHECK_URL} target="_blank" rel="noreferrer">
            Open FLHSMV Check
          </a>
          <button type="button" className={primary} onClick={startOpen} data-testid="dmv-license-log">
            Log Check
          </button>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-[#55555E]">
        Needed Before Approval, And Again Before The Agreement And Reservation Fee Go Out If The Last Check Is Over 24 Hours Old. Not Valid Means Needs Staff.
      </p>
      {profile.checks.length ? (
        <ul className="mt-3 divide-y divide-[#F1F1F4] text-[12px] text-[#3A3A42]">
          {profile.checks.map((c) => (
            <li key={c.id} className="py-1.5">
              <span className="font-semibold">{dmvStatusLabel(c.status)}</span> ({c.licenseState}) · {when(c.checkedAt)} · {c.checkedByLabel}
              {c.note ? <span className="block text-[#55555E]">{c.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log State DMV Check</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-[12px] font-medium">
              Result
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className={input} data-testid="dmv-license-result">
                  <SelectValue placeholder="Pick The Result" />
                </SelectTrigger>
                <SelectContent>
                  {DMV_CHECK_STATUSES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block text-[12px] font-medium">
              License State (Two Letters)
              <input className={input} value={state} maxLength={2} onChange={(e) => setState(e.target.value.toUpperCase())} />
            </label>
            <label className="block text-[12px] font-medium">
              Note
              <textarea className={input} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What The DMV Site Showed (For Example, Valid, Expires 2029)" />
            </label>
            {blockers.length && (status || note) ? <p className="text-[12px] text-rose-700">{blockers[0]}</p> : null}
          </div>
          <DialogFooter>
            <button type="button" className={secondary} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className={primary} disabled={busy || blockers.length > 0} onClick={save} data-testid="dmv-license-save">
              Save Check
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
