import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  getReservationDepositSettings,
  saveReservationDepositSettings,
} from "@/lib/reservations.functions";
import {
  DEFAULT_RESERVATION_DEPOSIT_SETTINGS,
  type ReservationDepositSettings,
} from "@/lib/reservation-deposit-settings";

/**
 * Settings → Rentals → Deposits. Global Off/On for reservation deposits,
 * default amount, and whether a pending deposit blocks Start Rental.
 * Off by default; Owner saves.
 */
export function ReservationDepositSettingsPanel() {
  const load = useServerFn(getReservationDepositSettings);
  const save = useServerFn(saveReservationDepositSettings);
  const [settings, setSettings] = useState<ReservationDepositSettings | null>(null);
  const [draft, setDraft] = useState<ReservationDepositSettings>(DEFAULT_RESERVATION_DEPOSIT_SETTINGS);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setDraft(s);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function persist(next: ReservationDepositSettings) {
    setBusy(true);
    try {
      const saved = await save({ data: next });
      setSettings(saved);
      setDraft(saved);
      toast.success("Deposit Settings Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save");
    } finally {
      setBusy(false);
    }
  }

  const on = draft.enabled === true;
  return (
    <div className="mt-4 rounded-xl border border-[#EDEDF0] bg-white p-5" aria-label="Deposit" data-testid="reservation-deposit-settings">
      <h3 className="text-[15px] font-semibold text-[#111114]">Deposit</h3>
      <p className="mt-1 text-[12px] text-[#55555E]">
        Optional. Off by default — reserve looks the same as today.
        Staff can still override per booking. Record Deposit is manual (Cash App, Venmo, Zelle, cash, card).
        Stripe deposit charging is a future hook only; never a generic generic Stripe payment page link.
      </p>
      {failed ? <p className="mt-2 text-[12px] text-[#8A1C10]">Could Not Load. Treated As Off.</p> : null}
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-[#111114]">Required</div>
          <p className="mt-1 text-[12px] text-[#55555E]">On: new reservations prefill the default amount as required.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Deposit"
          disabled={busy || !settings}
          onClick={() => {
            const next = { ...draft, enabled: !on };
            setDraft(next);
            void persist(next);
          }}
          className={`shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[#D03020]" : "bg-[#C4C4CB]"}`}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 mx-auto animate-spin text-white" /> : (
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
          )}
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Amount ($)</span>
          <input
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            inputMode="decimal"
            value={draft.defaultAmount}
            disabled={busy || !settings}
            onChange={(e) => setDraft((d) => ({ ...d, defaultAmount: Number(e.target.value) || 0 }))}
            onBlur={() => settings && void persist(draft)}
            aria-label="Amount"
          />
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={draft.blockStartWhenPending}
            disabled={busy || !settings}
            onChange={(e) => {
              const next = { ...draft, blockStartWhenPending: e.target.checked };
              setDraft(next);
              void persist(next);
            }}
            aria-label="Block Start While Pending"
          />
          <span className="text-[12px] text-[#55555E]">Block Start While Pending (Off By Default)</span>
        </label>
      </div>
    </div>
  );
}
