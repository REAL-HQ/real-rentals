import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppSelect } from "@/components/ui/app-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  FORGIVE_REASONS,
  feeStatusLabel,
  forgivableFees,
  forgiveReasonLabel,
  planAsWaivers,
  planForgiveness,
  r2,
  type ForgiveMode,
  type LedgerCredit,
} from "@/lib/late-fee-ledger";
import {
  forgiveRentalLateFees,
  getLateFeeLedger,
  undoRentalLateFeeForgiveness,
  type LateFeeLedgerResponse,
} from "@/lib/late-fee-forgiveness.functions";

// Manage Late Fees: every late fee on a rental, one line per late day, with
// Forgive Selected, Forgive An Amount (oldest first, part of a fee allowed) and
// Forgive All. Manager and above; Owner can undo. Nothing is sent to the
// renter and no Stripe charge is touched.

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary = "inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmtAt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "");
const who = (email: string | null) => (email ? email.split("@")[0] : "Staff");

type Kind = "selected" | "amount" | "all";

export function ManageLateFeesDialog({
  open, onOpenChange, rentalId, driverName, onChanged,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; rentalId: string; driverName: string; onChanged?: () => void;
}) {
  const read = useServerFn(getLateFeeLedger);
  const forgive = useServerFn(forgiveRentalLateFees);
  const undo = useServerFn(undoRentalLateFeeForgiveness);
  const [data, setData] = useState<LateFeeLedgerResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState<Kind>("selected");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoadError(null);
    read({ data: { rentalId } })
      .then((res) => { if (alive) { setData(res); setSelected(new Set()); } })
      .catch((e) => { if (alive) setLoadError(e instanceof Error && e.message === "Forbidden" ? "Managers And Owners Only." : "Late Fees Could Not Be Loaded."); });
    return () => { alive = false; };
  }, [open, rentalId, read, reload]);

  const ledger = data?.ledger ?? null;
  const forgivable = useMemo(() => (ledger ? forgivableFees(ledger) : []), [ledger]);
  const openTotal = r2(forgivable.reduce((t, f) => t + f.open, 0));
  const mode: ForgiveMode | null =
    kind === "all" ? { kind: "all" }
      : kind === "selected" ? (selected.size ? { kind: "selected", feeIds: [...selected] } : null)
        : Number(amount) > 0 ? { kind: "amount", amount: r2(Number(amount)) } : null;
  const plan = ledger && mode ? planForgiveness(ledger, mode) : null;
  const waiverCheck = plan && !plan.problem && data?.storage === "waivers" && ledger ? planAsWaivers(ledger, plan) : null;
  const blocked = waiverCheck && !waiverCheck.ok ? `${waiverCheck.why} needs the pending database update. Until it is approved, forgive whole days starting from the oldest, or Forgive All.` : null;
  const canSubmit = !!plan && !plan.problem && !blocked && !!reason && (reason !== "other" || !!note.trim()) && !busy;

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const submit = async () => {
    if (!mode || !plan || plan.problem) return;
    if (!reason) { toast.error("Choose A Reason"); return; }
    setBusy(true);
    try {
      const res = await forgive({ data: { rentalId, mode, reason, note: note.trim() || null, expectedOpen: openTotal } });
      toast.success(`Forgave ${usd(res.total)} In Late Fees. Nothing Was Sent To The Renter.`);
      for (const w of res.warnings) toast.warning(w);
      setAmount(""); setNote(""); setReason(""); setKind("selected");
      setReload((n) => n + 1);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Forgive The Late Fees");
    } finally {
      setBusy(false);
    }
  };

  const undoCredit = async (c: LedgerCredit) => {
    if (!c.forgivenessId) return;
    if (!window.confirm(`Undo forgiving ${usd(c.amount)}? It becomes owed again. Nothing is sent to the renter.`)) return;
    setBusy(true);
    try {
      await undo({ data: { forgivenessId: c.forgivenessId, note: null } });
      toast.success("Forgiveness Undone");
      setReload((n) => n + 1);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Undo");
    } finally {
      setBusy(false);
    }
  };

  const policy = data?.policy;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white sm:max-w-2xl" data-testid="manage-late-fees" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Manage Late Fees: {driverName}</DialogTitle>
          <DialogDescription>
            Nothing is sent to the renter, and no Stripe charge is touched. Paid late fees can't be forgiven here.
          </DialogDescription>
        </DialogHeader>
        {loadError ? <p className="text-sm text-[#D03020]">{loadError}</p> : null}
        {!data && !loadError ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {data && ledger ? (
          <div className="grid gap-4 text-sm">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]" data-testid="late-fee-totals">
              <span>Unpaid <strong className="tabular-nums text-[#D03020]">{usd(openTotal)}</strong></span>
              <span>Forgiven <strong className="tabular-nums">{usd(r2(ledger.totalForgiven + ledger.totalWaived))}</strong></span>
              <span>Paid <strong className="tabular-nums">{usd(ledger.totalPaid)}</strong></span>
              {policy ? <span className="text-muted-foreground">{usd(policy.daily)}/Day{policy.cap > 0 ? ` · Up To ${usd(policy.cap)} Per Week` : ""}</span> : null}
            </div>
            {data.storage === "waivers" ? (
              <p className="rounded-md bg-[#FFF7E6] px-3 py-2 text-[12px] text-[#8A5A00]" data-testid="late-fee-storage-note">
                Forgiving part of a fee, or a later day while keeping an earlier one, and Undo need a database update that is waiting for approval. Forgive All and whole days from the oldest work now.
              </p>
            ) : null}
            {ledger.weeks.length === 0 ? (
              <p className="text-muted-foreground" data-testid="late-fee-empty">No Late Fees On This Rental.</p>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-[#EDEDF0]">
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-white text-[11px] font-semibold text-[#55555E]">
                    <tr className="border-b border-[#EDEDF0]">
                      <th className="w-8 px-2 py-2" />
                      <th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2 text-right">Amount</th>
                      <th className="px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.weeks.map((w) => (
                      <WeekRows key={w.dueDate} week={w} selected={selected} onToggle={(id) => { setKind("selected"); toggle(id); }} canUndo={data.canUndo} onUndo={undoCredit} busy={busy} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {forgivable.length ? (
              <div className="grid gap-3 rounded-lg border border-[#EDEDF0] p-3">
                <div className="grid gap-2" role="radiogroup" aria-label="Forgive">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="forgive-kind" checked={kind === "selected"} onChange={() => setKind("selected")} />
                    Forgive Selected ({selected.size}{selected.size ? `, ${usd(plan && kind === "selected" && !plan.problem ? plan.total : 0)}` : ""})
                  </label>
                  <label className="flex flex-wrap items-center gap-2">
                    <input type="radio" name="forgive-kind" checked={kind === "amount"} onChange={() => setKind("amount")} />
                    Forgive An Amount
                    <input
                      className="w-28 rounded-lg border border-border bg-white px-2 py-1 text-sm"
                      inputMode="decimal" placeholder="$0.00" aria-label="Amount To Forgive" value={amount}
                      onFocus={() => setKind("amount")} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    />
                    <span className="text-[12px] text-muted-foreground">Oldest First</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="forgive-kind" checked={kind === "all"} onChange={() => setKind("all")} />
                    Forgive All ({usd(openTotal)})
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason</label>
                    <AppSelect className={input} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
                      <option value="">Choose A Reason</option>
                      {FORGIVE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </AppSelect>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Note{reason === "other" ? "" : " (Optional)"}</label>
                    <input className={input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
                  </div>
                </div>
                {plan?.problem && mode ? <p className="text-[12px] text-[#D03020]">{plan.problem}</p> : null}
                {blocked ? <p className="text-[12px] text-[#8A5A00]" data-testid="late-fee-blocked">{blocked}</p> : null}
                {plan && !plan.problem && !blocked ? (
                  <p className="text-[12px] text-muted-foreground" data-testid="late-fee-preview">
                    Forgives {usd(plan.total)} across {plan.allocations.length} fee{plan.allocations.length === 1 ? "" : "s"}. Late fees owed after: {usd(r2(openTotal - plan.total))}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>Close</button>
          {forgivable.length ? (
            <button type="button" className={primary} disabled={!canSubmit} onClick={submit} data-testid="late-fee-forgive">
              {busy ? "Saving…" : plan && !plan.problem ? `Forgive ${usd(plan.total)}` : "Forgive"}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WeekRows({ week, selected, onToggle, canUndo, onUndo, busy }: {
  week: LateFeeLedgerResponse["ledger"]["weeks"][number];
  selected: Set<string>;
  onToggle: (id: string) => void;
  canUndo: boolean;
  onUndo: (c: LedgerCredit) => void;
  busy: boolean;
}) {
  return (
    <>
      <tr className="bg-[#FAFAFB]">
        <td colSpan={4} className="px-2 py-1.5 text-[11px] font-semibold text-[#55555E]">
          Week Due {fmtDay(week.dueDate)} · {week.settled ? "Rent Paid" : week.owing ? "Rent Owed" : "Rent Not Owed"}
          {week.capReached ? " · Weekly Cap Reached" : ""}
        </td>
      </tr>
      {week.fees.length === 0 ? (
        <tr><td colSpan={4} className="px-2 py-2 text-muted-foreground">No Late Days Yet.</td></tr>
      ) : week.fees.map((f) => {
        const struck = f.status === "forgiven" || f.status === "waived";
        const selectable = week.owing && !week.settled && f.open > 0;
        return (
          <tr key={f.id} className="border-t border-[#EDEDF0]" data-testid="late-fee-line" data-status={f.status}>
            <td className="px-2 py-1.5">
              {selectable ? (
                <input type="checkbox" aria-label={`Select ${fmtDay(f.feeDate)}`} checked={selected.has(f.id)} onChange={() => onToggle(f.id)} />
              ) : f.status === "paid" ? (
                <input type="checkbox" disabled aria-label="Paid Late Fees Can't Be Forgiven Here" title="Paid Late Fees Can't Be Forgiven Here" />
              ) : null}
            </td>
            <td className="px-2 py-1.5 whitespace-nowrap">{fmtDay(f.feeDate)} <span className="text-[11px] text-muted-foreground">Day {f.day}</span></td>
            <td className={`px-2 py-1.5 text-right tabular-nums ${struck ? "line-through text-muted-foreground" : f.status === "paused" ? "text-muted-foreground" : ""}`}>
              {usd(f.amount)}
              {f.status === "partly_forgiven" ? <span className="block text-[11px] text-muted-foreground no-underline">{usd(f.open)} Left</span> : null}
            </td>
            <td className="px-2 py-1.5">
              <span className={f.status === "open" ? "font-medium text-[#D03020]" : f.status === "paid" ? "text-[#2E8540]" : "text-[#55555E]"}>{feeStatusLabel(f)}</span>
              {f.status === "paid" ? <span className="block text-[11px] text-muted-foreground">Can't Be Forgiven Here</span> : null}
              {f.credits.map((c, i) => (
                <span key={i} className="block text-[11px] text-muted-foreground" data-testid="late-fee-credit">
                  {c.kind === "forgiven" && f.status === "partly_forgiven" ? `${usd(c.amount)} ` : ""}Forgiven By {who(c.byEmail)}{c.at ? ` · ${fmtAt(c.at)}` : ""}{c.reason ? ` · ${forgiveReasonLabel(c.reason)}` : ""}{c.note ? ` · ${c.note}` : ""}
                  {canUndo && c.forgivenessId ? (
                    <button type="button" className="ml-2 font-medium text-[#D03020] hover:underline disabled:opacity-50" disabled={busy} onClick={() => onUndo(c)}>Undo</button>
                  ) : null}
                </span>
              ))}
            </td>
          </tr>
        );
      })}
    </>
  );
}
