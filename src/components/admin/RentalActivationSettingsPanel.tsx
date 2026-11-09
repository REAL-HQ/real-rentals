import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldAlert } from "lucide-react";
import {
  getRentalActivationSettings,
  setAllowActivationWithoutInsuranceVerification,
} from "@/lib/rental-activation-settings.functions";
import {
  ALLOW_WITHOUT_INSURANCE_LABEL,
  type RentalActivationSettings,
} from "@/lib/rental-activation-settings";

/**
 * Settings → Rentals → Rental Terms. Owner only: the section is Owner-only in the
 * menu, the server functions call requireOwner, and the database function checks
 * private.is_owner() again and audits every change (actor, old → new, time).
 */
export function RentalActivationSettingsPanel() {
  const load = useServerFn(getRentalActivationSettings);
  const save = useServerFn(setAllowActivationWithoutInsuranceVerification);
  const [settings, setSettings] = useState<RentalActivationSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((s) => !cancelled && setSettings(s))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function change(allow: boolean) {
    if (
      allow &&
      !window.confirm(
        "Turn on Allow Activation Without Insurance Verification? Managers will be able to start a rental for a driver whose insurance is unverified, missing or expired after acknowledging a warning. Every other requirement still applies.",
      )
    )
      return;
    setBusy(true);
    try {
      const r = await save({ data: { allow } });
      setSettings((s) => ({
        ...(s ?? { present: true, readable: true }),
        allowWithoutInsuranceVerification: r.to,
        present: true,
        readable: true,
      }));
      toast.success(`${ALLOW_WITHOUT_INSURANCE_LABEL}: ${r.to ? "On" : "Off"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the setting");
    } finally {
      setBusy(false);
    }
  }

  const on = settings?.allowWithoutInsuranceVerification === true;
  return (
    <div
      className="mt-4 rounded-xl border border-[#EDEDF0] bg-white p-5"
      aria-label="Rental Activation"
    >
      <h3 className="text-[15px] font-semibold text-[#111114]">Rental Activation</h3>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[#111114]">
            {ALLOW_WITHOUT_INSURANCE_LABEL}
          </div>
          <p className="mt-1 text-[12px] text-[#55555E]">
            Off (default): a rental cannot start until the driver&rsquo;s insurance is verified. On:
            a Manager or Owner may start one with insurance unverified, missing or expired, only
            after acknowledging a warning. Insurance is never marked verified by this, and approval,
            license documents, the signed agreement and vehicle readiness are still required. Every
            change is recorded in Activity.
          </p>
          {failed ? (
            <p className="mt-2 text-[12px] text-[#8A1C10]">
              Could Not Load This Setting. It Is Treated As Off.
            </p>
          ) : settings && !settings.readable ? (
            <p className="mt-2 text-[12px] text-[#8A1C10]">
              The Saved Value Could Not Be Read. It Is Treated As Off.
            </p>
          ) : null}
          {on ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[#8A1C10]">
              <ShieldAlert className="w-3.5 h-3.5" /> On: Rentals Can Start Without Verified
              Insurance.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={ALLOW_WITHOUT_INSURANCE_LABEL}
          disabled={busy || !settings}
          onClick={() => void change(!on)}
          className={`shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[#D03020]" : "bg-[#C4C4CB]"}`}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 mx-auto animate-spin text-white" />
          ) : (
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
            />
          )}
        </button>
      </div>
    </div>
  );
}
