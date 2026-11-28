import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppSelect } from "@/components/ui/app-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { rowOpenProps } from "@/lib/row-click";
import { FIXED_COSTS_ENABLED } from "@/lib/fixed-costs-flag";
import { endFixedCost, getFixedCosts, saveFixedCost, type FixedCostsResponse } from "@/lib/fixed-costs.functions";
import {
  FIXED_COST_FREQUENCIES,
  FIXED_COSTS_COPY as C,
  FREQUENCY_LABELS,
  KIND_LABELS,
  ROW_STATUS_LABELS,
  type FixedCostFrequency,
  type FixedCostItem,
  type FixedCostKind,
  type FixedCostRow,
  type FixedCostScope,
} from "@/lib/fixed-costs";
import { LinkedVehicleCell } from "./VehicleCell";

const money = (n: number | null | undefined) =>
  n == null ? "-" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Draft = {
  id: string | null;
  kind: FixedCostKind;
  scope: FixedCostScope;
  vehicleId: string | null;
  rentalId: string | null;
  title: string;
  label: string;
  provider: string;
  amount: string;
  frequency: FixedCostFrequency;
  nextDueOn: string;
  notes: string;
};

function draftFromRow(row: FixedCostRow): Draft {
  // A row priced by the default is filled with its own line, not by editing the default.
  const own = row.status !== "default" && row.status !== "missing" && row.status !== "fleet";
  return {
    id: own ? row.itemId : null,
    kind: row.kind,
    scope: row.target.scope,
    vehicleId: row.target.vehicleId,
    rentalId: row.target.rentalId,
    title: own ? C.editCost : C.addCost,
    label: own ? row.label ?? "" : "",
    provider: own ? row.provider ?? "" : "",
    amount: own && row.amount != null ? String(row.amount) : "",
    frequency: own && row.frequency ? row.frequency : "monthly",
    nextDueOn: own ? row.nextDueOn ?? "" : "",
    notes: "",
  };
}

function draftFromDefault(kind: FixedCostKind, item: FixedCostItem | null): Draft {
  return {
    id: item?.id ?? null,
    kind,
    scope: "default",
    vehicleId: null,
    rentalId: null,
    title: kind === "gps" ? C.defaultGps : C.defaultInsurance,
    label: item?.label ?? "",
    provider: item?.provider ?? "",
    amount: item ? String(item.amount) : "",
    frequency: item?.frequency ?? "monthly",
    nextDueOn: item?.next_due_on ?? "",
    notes: item?.notes ?? "",
  };
}

function fleetDraft(kind: FixedCostKind): Draft {
  return { id: null, kind, scope: "fleet", vehicleId: null, rentalId: null, title: C.fleetLine, label: "", provider: "", amount: "", frequency: "monthly", nextDueOn: "", notes: "" };
}

export function FixedCostsPanel() {
  const load = useServerFn(getFixedCosts);
  const save = useServerFn(saveFixedCost);
  const end = useServerFn(endFixedCost);
  const [res, setRes] = useState<FixedCostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setError(null);
    load()
      .then(setRes)
      .catch((e) => setError(e instanceof Error ? e.message : "Could Not Load Fixed Costs"));
  }, [load]);
  useEffect(() => { refresh(); }, [refresh]);

  const report = res?.report ?? null;
  const groups = useMemo(() => {
    const rows = report?.rows ?? [];
    return (["insurance", "gps"] as const).map((kind) => ({
      kind,
      rows: rows.filter((r) => r.kind === kind).sort((a, b) => Number(b.status === "missing") - Number(a.status === "missing")),
    }));
  }, [report]);

  if (!FIXED_COSTS_ENABLED) return null;
  if (error) return <p className="text-[13px] text-[#D03020]">{error}</p>;
  if (!res || !report) return <p className="text-[13px] text-[#55555E]">Loading Fixed Costs</p>;
  const setupNeeded = res.status === "setup_needed";
  const t = report.totals;
  const missing = t.missingInsurance + t.missingGps;

  const submit = async () => {
    if (!draft) return;
    const amount = Number(draft.amount);
    if (draft.amount.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      toast.error("Enter An Amount");
      return;
    }
    setBusy(true);
    try {
      await save({
        data: {
          id: draft.id,
          kind: draft.kind,
          scope: draft.scope,
          vehicleId: draft.vehicleId,
          rentalId: draft.rentalId,
          label: draft.label || null,
          provider: draft.provider || null,
          amount,
          frequency: draft.frequency,
          nextDueOn: draft.nextDueOn || null,
          notes: draft.notes || null,
        },
      });
      toast.success("Cost Saved");
      setDraft(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save");
    } finally {
      setBusy(false);
    }
  };

  const endLine = async () => {
    if (!draft?.id) return;
    setBusy(true);
    try {
      await end({ data: { id: draft.id } });
      toast.success("Cost Ended");
      setDraft(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not End");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="fixed-costs-panel">
      {setupNeeded ? (
        <div role="status" className="rounded-xl border border-[#F2C94C] bg-[#FFF8E1] px-4 py-3 text-[13px] text-[#5C4A00]">
          <span className="font-semibold">{C.setupNeeded}.</span> {C.setupHint}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="fixed-costs-totals">
        <Total label={C.grandTotal} value={money(t.grandMonthly)} strong />
        <Total label={C.insuranceTotal} value={money(t.insuranceMonthly)} hint={t.missingInsurance ? `${t.missingInsurance} ${C.missingCost}` : undefined} />
        <Total label={C.gpsTotal} value={money(t.gpsMonthly)} hint={t.missingGps ? `${t.missingGps} ${C.missingCost}` : undefined} />
        <Total label={C.next30} value={money(t.next30)} hint={t.undatedLines ? `${t.undatedLines} ${C.undatedNote}` : undefined} />
      </div>

      {missing > 0 ? (
        <p className="text-[13px] text-[#D03020]" data-testid="fixed-costs-missing">
          {missing} {missing === 1 ? "row needs" : "rows need"} a cost before the total is complete.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#55555E]">{C.defaults}</span>
        {(["gps", "insurance"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={setupNeeded}
            onClick={() => setDraft(draftFromDefault(kind, report.defaults[kind]))}
            className="h-8 rounded-full border border-[#E4E4E8] bg-white px-3 text-[13px] text-[#111114] hover:bg-[#F4F4F6] disabled:opacity-50"
          >
            {kind === "gps" ? C.defaultGps : C.defaultInsurance}: {report.defaults[kind] ? `${money(report.defaults[kind]!.amount)} ${FREQUENCY_LABELS[report.defaults[kind]!.frequency]}` : C.notSet}
          </button>
        ))}
      </div>

      {groups.map(({ kind, rows }) => (
        <section key={kind} className="rounded-xl border border-[#EDEDF0] bg-white" data-testid={`fixed-costs-${kind}`}>
          <header className="flex items-center justify-between gap-2 border-b border-[#EDEDF0] px-4 py-3">
            <h2 className="text-[15px] font-semibold">{KIND_LABELS[kind]}</h2>
            <div className="flex items-center gap-3">
              <span className="text-[13px] tabular-nums text-[#55555E]">{money(kind === "gps" ? t.gpsMonthly : t.insuranceMonthly)} / mo</span>
              <button
                type="button"
                disabled={setupNeeded}
                onClick={() => setDraft(fleetDraft(kind))}
                className="h-8 rounded-full bg-[#D03020] px-3 text-[13px] font-semibold text-white hover:bg-[#B5281A] disabled:opacity-50"
              >
                {C.addFleetLine}
              </button>
            </div>
          </header>
          {rows.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-[#55555E]">No {KIND_LABELS[kind]} Rows</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[12px] text-[#55555E]">
                  <tr>
                    <th className="px-4 py-2 font-medium">{C.vehicle}</th>
                    <th className="px-4 py-2 font-medium">{C.renter}</th>
                    <th className="px-4 py-2 font-medium">{C.frequency}</th>
                    <th className="px-4 py-2 text-right font-medium">{C.amount}</th>
                    <th className="px-4 py-2 text-right font-medium">{C.monthly}</th>
                    <th className="px-4 py-2 font-medium">{C.dueDate}</th>
                    <th className="px-4 py-2 font-medium">{C.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.key}
                      {...(setupNeeded ? {} : rowOpenProps(() => setDraft(draftFromRow(row))))}
                      data-testid="fixed-cost-row"
                      data-status={row.status}
                      className={`border-t border-[#F0F0F2] ${setupNeeded ? "" : "cursor-pointer hover:bg-[#FAFAFB]"}`}
                    >
                      <td className="px-4 py-2">
                        {row.vehicleId ? (
                          <LinkedVehicleCell vehicleId={row.vehicleId} size="sm" fallback={row.vehicle ? { year: row.vehicle.year, make: row.vehicle.make, model: row.vehicle.model, plate: row.vehicle.plate, vin: row.vehicle.vin } : undefined} />
                        ) : (
                          <span className="font-medium">{row.label || C.fleetLine}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">{row.renter ?? (row.target.scope === "rental" ? C.unnamed : "-")}</td>
                      <td className="px-4 py-2">{row.frequency ? FREQUENCY_LABELS[row.frequency] : "-"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(row.amount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{money(row.monthly)}</td>
                      <td className="px-4 py-2 tabular-nums">{row.nextDueOn ?? "-"}</td>
                      <td className="px-4 py-2">
                        <StatusPill status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      <Dialog open={!!draft} onOpenChange={(open) => { if (!open) setDraft(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.title} · {draft ? KIND_LABELS[draft.kind] : ""}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); void submit(); }}
            >
              {draft.scope === "fleet" || draft.scope === "default" ? (
                <Field label="Name">
                  <input className={inputCls} value={draft.label} maxLength={80} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                </Field>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <Field label={C.amount}>
                  <input className={inputCls} inputMode="decimal" required value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} aria-label={C.amount} />
                </Field>
                <Field label={C.frequency}>
                  <AppSelect aria-label={C.frequency} value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value as FixedCostFrequency })}>
                    {FIXED_COST_FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
                  </AppSelect>
                </Field>
              </div>
              <Field label={C.dueDate}>
                <input type="date" className={inputCls} value={draft.nextDueOn} onChange={(e) => setDraft({ ...draft, nextDueOn: e.target.value })} aria-label={C.dueDate} />
              </Field>
              <Field label={C.provider}>
                <input className={inputCls} value={draft.provider} maxLength={120} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} aria-label={C.provider} />
              </Field>
              <Field label={C.notes}>
                <input className={inputCls} value={draft.notes} maxLength={500} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} aria-label={C.notes} />
              </Field>
              <div className="flex items-center justify-between gap-2 pt-2">
                {draft.id ? (
                  <button type="button" disabled={busy} onClick={() => void endLine()} className="h-9 rounded-full border border-[#E4E4E8] px-3 text-[13px] text-[#D03020] hover:bg-[#FFF1EF] disabled:opacity-50">
                    {C.endCost}
                  </button>
                ) : <span />}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setDraft(null)} className="h-9 rounded-full border border-[#E4E4E8] px-3 text-[13px] hover:bg-[#F4F4F6]">{C.cancel}</button>
                  <button type="submit" disabled={busy} className="h-9 rounded-full bg-[#D03020] px-4 text-[13px] font-semibold text-white hover:bg-[#B5281A] disabled:opacity-50">{C.save}</button>
                </div>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const inputCls = "h-9 w-full rounded-lg border border-[#E4E4E8] bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#D03020]/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[12px] font-medium text-[#55555E]">{label}</span>
      {children}
    </label>
  );
}

function Total({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${strong ? "border-[#111114] bg-[#111114] text-white" : "border-[#EDEDF0] bg-white"}`}>
      <div className={`text-[12px] ${strong ? "text-white/70" : "text-[#55555E]"}`}>{label}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums">{value}</div>
      {hint ? <div className={`mt-0.5 text-[12px] ${strong ? "text-white/70" : "text-[#D03020]"}`}>{hint}</div> : null}
    </div>
  );
}

function StatusPill({ status }: { status: FixedCostRow["status"] }) {
  const tone =
    status === "missing" ? "bg-[#FFF1EF] text-[#D03020]"
    : status === "rental_ended" || status === "archived" ? "bg-[#FFF8E1] text-[#5C4A00]"
    : status === "default" || status === "fleet" ? "bg-[#F0F0F2] text-[#55555E]"
    : "bg-[#EAF7EE] text-[#1E7A3C]";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}>{ROW_STATUS_LABELS[status]}</span>;
}
