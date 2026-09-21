import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X, Plus, Trash2, Wallet, Loader2, Lock } from "lucide-react";
import { MicroLabel, StatusPill } from "./ui";
import {
  getDepositSummary,
  addDepositDeduction,
  removeDepositDeduction,
  settleDeposit,
  type DepositSummary,
} from "@/lib/incidents.functions";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Settle a deposit from itemised deductions rather than a guessed number.
 * Outstanding tolls and driver-responsible incident costs are offered as
 * one-click deductions so the disposition traces back to evidence.
 */
export function DepositDialog({
  rentalId,
  onClose,
  onSettled,
}: {
  rentalId: string;
  onClose: () => void;
  onSettled?: () => void;
}) {
  const fetchSummary = useServerFn(getDepositSummary);
  const addDeduction = useServerFn(addDepositDeduction);
  const removeDeduction = useServerFn(removeDepositDeduction);
  const settle = useServerFn(settleDeposit);

  const [summary, setSummary] = useState<DepositSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    try {
      setSummary(await fetchSummary({ data: { rentalId } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the deposit");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentalId]);

  const settled = !!summary?.settledAt;

  async function add(r: string, a: number, extra?: { tollChargeId?: string; incidentId?: string }) {
    setBusy(true);
    try {
      await addDeduction({
        data: {
          rentalId,
          reason: r,
          amount: a,
          tollChargeId: extra?.tollChargeId ?? null,
          incidentId: extra?.incidentId ?? null,
        },
      });
      setReason("");
      setAmount("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add deduction");
    } finally {
      setBusy(false);
    }
  }

  async function doSettle() {
    if (!summary) return;
    if (
      !confirm(
        `Settle this deposit? ${money(summary.refundDue)} will be refunded and the renter emailed an itemised breakdown.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await settle({ data: { rentalId, notes: notes.trim() || null } });
      toast.success(`Deposit settled — ${money(res.refund)} refunded`);
      await load();
      onSettled?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not settle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#EDEDF0]">
          <h3 className="font-semibold flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Deposit Disposition
          </h3>
          <button onClick={onClose} className="text-[#55555E] hover:text-[#111114]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading || !summary ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="rounded-xl border border-[#EDEDF0] bg-[#FAFAFB] p-3 space-y-1.5 text-sm">
              <Line label="Deposit held" value={money(summary.depositAmount)} />
              <Line label="Deductions" value={`-${money(summary.deductionTotal)}`} />
              <div className="pt-1.5 border-t border-[#EDEDF0] flex items-center justify-between">
                <span className="font-semibold">Refund due</span>
                <span className="font-semibold tabular-nums">{money(summary.refundDue)}</span>
              </div>
              {summary.deductionTotal > summary.depositAmount ? (
                <p className="text-xs text-[#8A1C10]">
                  Deductions exceed the deposit by{" "}
                  {money(summary.deductionTotal - summary.depositAmount)} — bill the difference
                  separately; a refund is never negative.
                </p>
              ) : null}
            </div>

            {settled ? (
              <div className="rounded-xl border border-[#CDE7D6] bg-[#F2FAF5] p-3 text-sm text-[#1F8A4C] flex items-start gap-2">
                <Lock className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">
                    Settled {new Date(summary.settledAt as string).toLocaleDateString()}
                  </div>
                  <div className="text-xs">
                    <StatusPill status="active">
                      {summary.depositStatus.replace(/_/g, " ")}
                    </StatusPill>
                  </div>
                </div>
              </div>
            ) : null}

            {summary.suggestions.length > 0 && !settled ? (
              <div>
                <MicroLabel>Outstanding on this rental</MicroLabel>
                <ul className="mt-1.5 space-y-1.5">
                  {summary.suggestions.map((s) => (
                    <li
                      key={`${s.kind}-${s.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[#EDEDF0] px-3 py-2"
                    >
                      <span className="text-sm capitalize min-w-0 truncate">{s.label}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-sm tabular-nums">{money(s.amount)}</span>
                        <button
                          disabled={busy}
                          onClick={() =>
                            add(s.label, s.amount, {
                              tollChargeId: s.kind === "toll" ? s.id : undefined,
                              incidentId: s.kind === "incident" ? s.id : undefined,
                            })
                          }
                          className="rounded-md bg-[#111114] text-white px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                        >
                          Deduct
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <MicroLabel>Deductions</MicroLabel>
              {summary.deductions.length === 0 ? (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  None — the full deposit will be refunded.
                </p>
              ) : (
                <ul className="mt-1.5 divide-y divide-[#EDEDF0] rounded-lg border border-[#EDEDF0]">
                  {summary.deductions.map((d) => (
                    <li key={d.id} className="px-3 py-2 flex items-center justify-between gap-3">
                      <span className="text-sm min-w-0 truncate">{d.reason}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-sm tabular-nums">-{money(d.amount)}</span>
                        {!settled ? (
                          <button
                            onClick={async () => {
                              await removeDeduction({ data: { id: d.id } });
                              load();
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#55555E] hover:text-[#D03020]"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!settled ? (
              <>
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
                  <div>
                    <MicroLabel>Other deduction</MicroLabel>
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Cleaning, missing fob…"
                      className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
                    />
                  </div>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="$"
                    className="w-24 rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
                  />
                  <button
                    disabled={busy}
                    onClick={() => {
                      const a = Number(amount.replace(/[^\d.]/g, ""));
                      if (reason.trim().length < 2) return toast.error("Describe the deduction.");
                      if (!Number.isFinite(a) || a <= 0) return toast.error("Enter an amount.");
                      add(reason.trim(), a);
                    }}
                    className="inline-flex h-[38px] items-center gap-1 rounded-lg border border-[#EDEDF0] px-3 text-sm disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>

                <div>
                  <MicroLabel>Note to the renter (optional)</MicroLabel>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="mt-1.5 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm"
                  />
                </div>
              </>
            ) : null}
          </div>
        )}

        <div className="p-4 border-t border-[#EDEDF0] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-sm"
          >
            Close
          </button>
          {!settled && summary ? (
            <button
              onClick={doSettle}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D03020] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Settle &amp; refund {money(summary.refundDue)}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#55555E]">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
