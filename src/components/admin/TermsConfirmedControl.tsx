import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppSelect } from "@/components/ui/app-select";
import { MOVE_FORWARD_LABEL, parseStaffTerms, type StaffTermsState } from "@/lib/staff-terms";

export type MoveForwardSubmit = (args: { terms: { weekly_rate: string; deposit: string; start_date: string; vehicle_id: string }; retry: boolean }) => Promise<{ ok: boolean; error?: string; delivery?: string }>;

/**
 * The Terms Confirmed row's right-side control: Move Forward opens a small
 * confirm dialog prefilled with what the agreement would print (weekly rate,
 * deposit, start date, vehicle). Staff confirm or edit; the server re-checks
 * everything and refuses terms the agreement would not print. Failed shows
 * Retry, which re-sends the same event to FLEET.
 */
export function TermsConfirmedControl({
  state,
  enabled,
  vehicles,
  onSubmit,
  disabledReason,
  defaultOpen = false,
}: {
  state: StaffTermsState | null;
  enabled: boolean;
  vehicles: { id: string; label: string }[];
  onSubmit: MoveForwardSubmit;
  disabledReason?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefill = state?.prefill ?? null;
  const [weekly, setWeekly] = useState("");
  const [deposit, setDeposit] = useState("");
  const [start, setStart] = useState("");
  const [vehicle, setVehicle] = useState("");
  useEffect(() => {
    if (!open) return;
    setError(null);
    setWeekly(prefill?.weekly_rate != null ? String(prefill.weekly_rate) : "");
    setDeposit(prefill?.deposit != null ? String(prefill.deposit) : "");
    setStart(prefill?.start_date ?? "");
    setVehicle(prefill?.vehicle_id ?? "");
  }, [open, prefill?.weekly_rate, prefill?.deposit, prefill?.start_date, prefill?.vehicle_id]);

  const latest = state?.latest ?? null;
  const failed = latest?.delivery === "failed";
  const sent = latest?.delivery === "sent" || latest?.delivery === "sending";
  const vehicleOptions = vehicles.some((v) => v.id === vehicle) || !vehicle
    ? vehicles
    : [{ id: vehicle, label: prefill?.vehicle_label || "Assigned Vehicle" }, ...vehicles];

  async function retry() {
    if (!latest || busy) return;
    setBusy(true);
    try {
      const r = await onSubmit({ terms: { weekly_rate: String(latest.terms.weekly_rate), deposit: String(latest.terms.deposit), start_date: latest.terms.start_date, vehicle_id: latest.terms.vehicle_id }, retry: true });
      if (!r.ok) throw new Error(r.error ?? "Could Not Send To FLEET.");
      if (r.delivery === "failed") toast.error("FLEET Did Not Receive It Yet. Try Again Shortly.");
      else toast.success("Sent To FLEET");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Send To FLEET.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (busy) return;
    const parsed = parseStaffTerms({ weekly_rate: weekly, deposit, start_date: start, vehicle_id: vehicle });
    if (!parsed.ok) { setError(parsed.error); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await onSubmit({ terms: { weekly_rate: weekly, deposit, start_date: start, vehicle_id: vehicle }, retry: false });
      if (!r.ok) { setError(r.error ?? "Could Not Move Forward."); return; }
      setOpen(false);
      if (r.delivery === "failed") toast.error("Saved, But FLEET Did Not Receive It. Use Retry.");
      else toast.success("Terms Confirmed. FLEET Will Send The Agreement.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could Not Move Forward.");
    } finally {
      setBusy(false);
    }
  }

  const btn = "h-7 text-[11px]";
  return (
    <>
      {failed ? (
        <Button type="button" variant="outline" size="sm" className={btn} disabled={!enabled || busy} onClick={retry} data-testid="terms-retry">Retry</Button>
      ) : sent ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={btn}
          disabled={!enabled || busy}
          title={!enabled ? disabledReason : undefined}
          onClick={() => setOpen(true)}
          data-testid="move-forward"
        >
          {MOVE_FORWARD_LABEL}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="max-w-lg" data-testid="move-forward-dialog">
          <DialogHeader>
            <DialogTitle>Confirm Terms</DialogTitle>
            <DialogDescription>
              Confirm what you went over with the applicant. FLEET sends the rental agreement with exactly these terms.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="mf-weekly">Weekly Rate ($)</Label>
              <Input id="mf-weekly" inputMode="decimal" value={weekly} onChange={(e) => setWeekly(e.target.value)} />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="mf-deposit">Deposit ($)</Label>
              <Input id="mf-deposit" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="mf-start">Start Date</Label>
              <Input id="mf-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor="mf-vehicle">Vehicle</Label>
              <AppSelect id="mf-vehicle" className="w-full min-w-0 overflow-hidden [&>span]:min-w-0 [&>span]:truncate" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                <option value="" disabled>Choose Vehicle</option>
                {vehicleOptions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </AppSelect>
            </div>
          </div>
          {state?.blockers?.length ? (
            <p className="text-[12px] text-[#9A5B00]">Fix First: {state.blockers.map((b) => b.label).join(", ")}</p>
          ) : null}
          {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={confirm} disabled={busy} data-testid="move-forward-confirm">{busy ? "Sending…" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
