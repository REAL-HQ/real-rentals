import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getForfeitedFeeCreditSettings, saveForfeitedFeeCreditSettings } from "@/lib/forfeited-fee-credit.functions";
import {
  DEFAULT_FORFEITED_FEE_CREDIT,
  type ForfeitedFeeCreditMode,
  type ForfeitedFeeCreditSettings,
} from "@/lib/forfeited-fee-credit";

const MODES: { id: ForfeitedFeeCreditMode; label: string; hint: string }[] = [
  { id: "auto", label: "Automatic", hint: "Late pickup saves the credit when it keeps the fee." },
  { id: "case_by_case", label: "Case By Case", hint: "The fee stays kept. Cancelled rows say Fee Kept, Credit Not Decided until staff choose." },
  { id: "off", label: "Off", hint: "Nothing is saved automatically. Staff can still keep one fee as a credit from the row menu." },
];

/**
 * Settings → Rental Terms. Manager and Owner save. A Coordinator sees the
 * current policy and cannot change it. The server checks the tier again.
 */
export function ForfeitedFeeCreditSettings({
  canEdit = true,
  initial,
}: {
  canEdit?: boolean;
  /** Skip the server read. Screenshots and tests pass the policy directly. */
  initial?: ForfeitedFeeCreditSettings;
} = {}) {
  const load = useServerFn(getForfeitedFeeCreditSettings);
  const save = useServerFn(saveForfeitedFeeCreditSettings);
  const [draft, setDraft] = useState<ForfeitedFeeCreditSettings>(initial ?? DEFAULT_FORFEITED_FEE_CREDIT);
  const [daysText, setDaysText] = useState(String((initial ?? DEFAULT_FORFEITED_FEE_CREDIT).days));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    load()
      .then((s) => {
        if (cancelled) return;
        setDraft(s);
        setDaysText(String(s.days));
      })
      .catch(() => {
        if (!cancelled) toast.error("Could Not Load The Credit Policy");
      });
    return () => {
      cancelled = true;
    };
  }, [load, initial]);

  async function persist() {
    const days = Number(daysText);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      toast.error("Enter A Whole Number Of Days From 1 To 3650.");
      return;
    }
    setBusy(true);
    try {
      await save({ data: { mode: draft.mode, days } });
      setDraft({ ...draft, days });
      toast.success("Credit Policy Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save The Credit Policy");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[#EDEDF0] bg-white p-5" data-testid="forfeited-fee-credit-settings">
      <h3 className="text-[15px] font-semibold text-[#111114]">Forfeited Fee Credit</h3>
      <p className="mt-1 text-[12px] text-[#55555E]">
        Staff only. A kept Reservation Fee can become a credit toward that same renter&apos;s next rental. Renters are not told about credits.
      </p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Credit Mode">
        {MODES.map((mode) => {
          const on = draft.mode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              aria-pressed={on}
              disabled={!canEdit}
              onClick={() => setDraft({ ...draft, mode: mode.id })}
              className={`h-9 rounded-md border px-3 text-sm font-medium ${
                on ? "border-[#111114] bg-[#111114] text-white" : "border-[#D6D6DB] bg-white text-[#111114]"
              } disabled:opacity-60`}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] text-[#55555E]">{MODES.find((mode) => mode.id === draft.mode)?.hint}</p>
      <label className="mt-4 block text-xs font-medium text-[#55555E]">
        Credit Duration (Days)
        <input
          className="mt-1 w-28 rounded-lg border border-[#D6D6DB] bg-white px-3 py-2 text-sm text-[#111114]"
          inputMode="numeric"
          aria-label="Credit Duration (Days)"
          value={daysText}
          disabled={!canEdit}
          onChange={(e) => setDaysText(e.target.value)}
        />
      </label>
      {canEdit ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void persist()}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50"
        >
          Save Credit Policy
        </button>
      ) : (
        <p className="mt-4 text-[12px] text-[#55555E]">Managers and Owners change this policy.</p>
      )}
    </div>
  );
}
