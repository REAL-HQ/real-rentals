// Review for multi-file service transactions (one invoice = one review card).
// Coordinators receive the operational half only from the server; financial
// blocks render only when the server sent them.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RotateCw, Eye, AlertTriangle, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { reprocessServiceItem, rebuildBatchServiceTransactions, applyServiceTransaction, ignoreServiceTransaction } from "@/lib/fleet-inbox.functions";
import { categoryLabel } from "@/lib/maintenance-rules";
import { StatusPill } from "@/components/admin/ui";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const CHARGE: Record<string, string> = { paid: "Paid", recall: "Recall", warranty: "Warranty", no_charge: "No Charge", unknown: "Unknown" };
const ROLE: Record<string, string> = { primary: "Invoice Page", alternate: "Duplicate Photo", payment: "Payment Evidence", possible_payment: "Possible Payment Match", unrelated: "Unrelated" };
const PAY: Record<string, string> = { corroborated: "Payment Corroborated", partial: "Partial Payment", overpayment: "Overpayment", conflict: "Payment Conflict", unknown: "Payment Unknown" };
const REC: Record<string, string> = { reconciled: "Reconciled", needs_review: "Financial Reconciliation — Needs Review", unknown: "Financial Review Required" };

function Field({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "warn" }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-[13px]">
      <span className="text-[#55555E]">{k}</span>
      <span className={`text-right ${tone === "warn" ? "text-[#B45309]" : "text-[#111114]"}`}>{v}</span>
    </div>
  );
}
function decisionText(dc: any) {
  if (!dc) return "—";
  if (dc.status === "conflict") return `Conflict — Review Required (${dc.sources.map((s: any) => s.value).join(" / ")})`;
  if (dc.status === "none") return "Not Provided";
  return `${dc.value}${dc.status === "agreed" && dc.sources.length > 1 ? ` · ${dc.sources.length} pages agree` : ""}`;
}

export function ServiceTransactionReview({ d, isManager, reload, openFile }: { d: any; isManager: boolean; reload: () => Promise<void> | void; openFile: (id: string) => void }) {
  const reprocess = useServerFn(reprocessServiceItem);
  const rebuild = useServerFn(rebuildBatchServiceTransactions);
  const [busy, setBusy] = useState<string | null>(null);
  const txs = (d.transactions ?? []) as any[];
  const serviceItems = (d.items as any[]).filter((i) => /receipt|invoice|oil_service|tires|brakes/.test(i.doc_class ?? "") && i.status !== "duplicate");

  async function reprocessAll() {
    try {
      for (const [n, it] of serviceItems.entries()) {
        setBusy(`Reading ${it.file_name} (${n + 1} of ${serviceItems.length})…`);
        const r = await reprocess({ data: { itemId: it.id } });
        if (!r.ok) toast.error(`${it.file_name}: ${r.error}`);
      }
      setBusy("Grouping evidence…");
      const r = await rebuild({ data: { batchId: d.batch.id } });
      toast.success(`${r.transactions} service transaction${r.transactions === 1 ? "" : "s"} ready for review — nothing applied.`);
      await reload();
    } catch (e: any) { toast.error(e?.message ?? "Reprocess failed."); }
    finally { setBusy(null); }
  }

  if (!txs.length && !serviceItems.length) return null;
  return (
    <section className="rounded-xl border border-[#EDEDF0] bg-white">
      <header className="px-4 py-3 border-b border-[#EDEDF0] flex flex-wrap items-center gap-2 justify-between">
        <div className="text-[13px] font-semibold inline-flex items-center gap-1.5"><Wrench className="w-4 h-4" /> Service Transactions ({txs.length})</div>
        {isManager && serviceItems.length > 0 && (
          <button disabled={!!busy} onClick={reprocessAll} className="min-h-[36px] px-3 rounded-lg border border-[#EDEDF0] text-xs inline-flex items-center gap-1.5 hover:bg-[#F7F7F8] disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />} {busy ?? "Reprocess Service Files"}
          </button>
        )}
      </header>
      <div className="divide-y divide-[#EDEDF0]">
        {txs.map((t) => <TxCard key={t.id} t={t} d={d} isManager={isManager} reload={reload} openFile={openFile} />)}
        {!txs.length && <p className="px-4 py-3 text-sm text-[#55555E]">Service files have not been grouped yet.</p>}
      </div>
    </section>
  );
}

function TxCard({ t, d, isManager, reload, openFile }: { t: any; d: any; isManager: boolean; reload: () => Promise<void> | void; openFile: (id: string) => void }) {
  const applyFn = useServerFn(applyServiceTransaction);
  const ignoreFn = useServerFn(ignoreServiceTransaction);
  const op = t.operational ?? {}; const fin = t.financial;
  const [open, setOpen] = useState(true);
  const [vehicleId, setVehicleId] = useState<string>(t.match_vehicle_id ?? "");
  const [accept, setAccept] = useState<Set<string>>(new Set((op.vehicleChanges ?? []).filter((c: any) => c.safe).map((c: any) => c.field)));
  const [confirmFin, setConfirmFin] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [working, setWorking] = useState(false);
  const pending = t.status === "pending" || t.status === "failed";
  const matched = d.vehicles.find((v: any) => v.id === t.match_vehicle_id);
  const ap = op.applyPreview ?? {};
  const c = op.counts ?? {};

  async function apply() {
    setWorking(true);
    try {
      const r = await applyFn({ data: { transactionId: t.id, vehicleId, acceptFields: [...accept] as any, acceptMileage: true, confirmFinancial: confirmFin } });
      toast[r.ok ? "success" : "error"](r.message); await reload();
    } finally { setWorking(false); }
  }

  return (
    <div className="px-4 py-4 space-y-3">
      <button onClick={() => setOpen(!open)} className="w-full flex flex-wrap items-center gap-2 text-left">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <span className="font-semibold text-[14px]">{op.vendor ?? "Unknown Vendor"}{op.invoiceNumber ? ` · Invoice ${op.invoiceNumber}` : ""}</span>
        <span className="text-xs text-[#55555E]">{c.sourceFiles} Source File{c.sourceFiles === 1 ? "" : "s"} · {c.invoicePages} Invoice Page{c.invoicePages === 1 ? "" : "s"}{c.duplicatePages ? ` · ${c.duplicatePages} Duplicate Photo${c.duplicatePages === 1 ? "" : "s"}` : ""} · {c.paymentEvidence} Payment Evidence</span>
        <span className="ml-auto"><StatusPill tone={(t.status === "applied" ? "green" : t.kind === "match" ? "neutral" : "amber") as any}>{t.status === "pending" ? (t.kind === "match" ? "Matched — Pending Review" : t.kind === "conflict" ? "Conflict — Review Required" : "Vehicle Match Required") : t.status[0].toUpperCase() + t.status.slice(1)}</StatusPill></span>
      </button>
      {open && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="rounded-lg border border-[#EDEDF0] p-3">
              <div className="text-[11px] uppercase tracking-wider text-[#9A9AA3] mb-1">Vehicle</div>
              {matched ? <Field k="Matched" v={`${matched.unit_number ?? ""} · ${matched.year ?? ""} ${matched.make ?? ""} ${matched.model ?? ""} · by ${t.match_basis === "vin" ? "Exact VIN" : t.match_basis}`} /> : <Field k="Match" v="Vehicle Match Required" tone="warn" />}
              <Field k="Unit" v={op.unitNumber ? `${op.unitNumber} (from REAL RENTALS record)` : "—"} />
              <Field k="VIN" v={decisionText(op.identity?.vin)} tone={op.identity?.vin?.status === "conflict" ? "warn" : undefined} />
              <Field k="Year" v={`${decisionText(op.identity?.year)}${op.identity?.year?.note ? " · normalized" : ""}`} tone={op.identity?.year?.status === "conflict" ? "warn" : undefined} />
              <Field k="Make / Model" v={`${decisionText(op.identity?.make)} / ${decisionText(op.identity?.model)}`} />
              <Field k="Color" v={decisionText(op.identity?.color)} />
              <Field k="Plate" v={decisionText(op.identity?.plate)} tone={op.identity?.plate?.status === "conflict" ? "warn" : undefined} />
              {(op.vehicleChanges ?? []).map((ch: any) => (
                <label key={ch.field} className="flex items-center gap-2 text-[13px] mt-1">
                  <input type="checkbox" disabled={!pending || ch.kind !== "fill"} checked={accept.has(ch.field)} onChange={(e) => { const n = new Set(accept); e.target.checked ? n.add(ch.field) : n.delete(ch.field); setAccept(n); }} />
                  {ch.kind === "fill" ? `Fill Blank ${ch.label}: ${ch.proposed}` : `${ch.label} Conflict: ${ch.current} on file vs ${ch.proposed}`}
                </label>
              ))}
              {!matched && pending && (
                <div className="mt-2">
                  <div className="text-[12px] text-[#55555E] mb-1">Possible vehicles (choose one; nothing is selected automatically):</div>
                  <select className="w-full border border-[#EDEDF0] rounded-lg px-2 py-2 text-[13px] bg-white text-[#111114]" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">Select Vehicle…</option>
                    {(op.candidates ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.unit_number} · {v.year} {v.make} {v.model}{v.color ? ` · ${v.color}` : ""}{v.license_plate ? ` · ${v.license_plate}` : ""}{v.vin ? ` · VIN …${String(v.vin).slice(-6)}` : ""}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-[#EDEDF0] p-3">
              <div className="text-[11px] uppercase tracking-wider text-[#9A9AA3] mb-1">Dates And Mileage</div>
              <Field k="Opened" v={op.dates?.opened ?? "—"} />
              <Field k="Completed" v={op.dates?.completed ? `${op.dates.completed} (${op.dates.completedSource})` : "Not Provided"} />
              <Field k="Mileage In" v={decisionText(op.mileage?.in)} tone={op.mileage?.in?.status === "conflict" ? "warn" : undefined} />
              <Field k="Mileage Out" v={decisionText(op.mileage?.out)} tone={op.mileage?.out?.status === "conflict" ? "warn" : undefined} />
              <Field k="Proposed Mileage Observation" v={op.mileage?.status === "proposed" ? `${Number(op.mileage.canonical).toLocaleString("en-US")} mi · ${op.mileage.canonicalSource}` : op.mileage?.status === "review" ? "None — Review Required" : "None"} tone={op.mileage?.status === "review" ? "warn" : undefined} />
            </div>
            <div className="rounded-lg border border-[#EDEDF0] p-3">
              <div className="text-[11px] uppercase tracking-wider text-[#9A9AA3] mb-1">Supporting Evidence</div>
              {(op.evidence ?? []).map((e: any) => (
                <div key={e.itemId} className="flex items-center gap-2 py-1 text-[13px]">
                  <span className="flex-1 min-w-0 truncate">{e.fileName}</span>
                  <span className="text-xs text-[#55555E]">{ROLE[e.usedAs] ?? e.usedAs}{e.pageNumber ? ` · Page ${e.pageNumber}${e.pageCount ? ` of ${e.pageCount}` : ""}` : ""}{e.alternateOf ? ` · Same Page As ${e.alternateOf}` : ""}{e.obscured ? " · Partly Covered" : ""}</span>
                  {isManager && e.documentId && <button onClick={() => openFile(e.documentId)} className="text-xs inline-flex items-center gap-1 text-[#55555E] hover:text-[#111114]"><Eye className="w-3.5 h-3.5" /> View</button>}
                </div>
              ))}
              {!isManager && <p className="text-xs text-[#9A9AA3] mt-1">Originals contain pricing and are available to Managers and Owners only.</p>}
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-[#EDEDF0] p-3">
              <div className="text-[11px] uppercase tracking-wider text-[#9A9AA3] mb-1">Service Operations ({(fin?.operations ?? op.operations ?? []).length})</div>
              {(fin?.operations ?? op.operations ?? []).map((o: any, n: number) => (
                <div key={n} className="py-1.5 border-b last:border-0 border-[#F2F2F4]">
                  <button className="w-full flex items-start gap-2 text-left text-[13px]" onClick={() => setExpanded({ ...expanded, [n]: !expanded[n] })}>
                    <span className="flex-1">{o.code ? `${o.code} · ` : ""}{o.heading}<span className="text-xs text-[#9A9AA3]"> · {categoryLabel(o.category)} · {CHARGE[o.chargeType] ?? o.chargeType}</span></span>
                    {fin && <span className="tabular-nums">{usd(o.cost)}</span>}
                  </button>
                  {fin && expanded[n] && (
                    <div className="mt-1 pl-2 text-xs text-[#55555E] space-y-1 whitespace-pre-wrap">
                      {o.request && <div><b>Request:</b> {o.request}</div>}
                      {o.work && <div><b>Work Performed:</b> {o.work}</div>}
                      {o.techNotes && <div><b>Technician Notes:</b> {o.techNotes}</div>}
                      {(o.parts ?? []).map((p: any, i: number) => <div key={i}>Part: {p.description}{p.partNumber ? ` (${p.partNumber})` : ""}{p.quantity ? ` × ${p.quantity}` : ""} — {usd(p.amount)}</div>)}
                      <div>Parts {usd(o.partsAmount)} · Labor {usd(o.laborAmount)} · Sources: {o.sourceFiles.join(", ")}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {fin && (
              <div className="rounded-lg border border-[#EDEDF0] p-3">
                <div className="text-[11px] uppercase tracking-wider text-[#9A9AA3] mb-1">Financial Summary (Manager / Owner)</div>
                {["labor", "parts", "misc", "shopSupplies", "tax", "warrantyCredit", "vendorCredit", "other"].filter((k) => fin.summary?.[k] != null).map((k) => <Field key={k} k={k === "shopSupplies" ? "Shop Supplies" : k === "warrantyCredit" ? "Warranty Credit" : k === "vendorCredit" ? "Vendor Credit" : k[0].toUpperCase() + k.slice(1)} v={usd(fin.summary[k])} />)}
                <Field k="Invoice Total" v={`${usd(fin.summary?.total)}${fin.summarySource ? ` · from ${fin.summarySource}` : ""}`} />
                <Field k="Reconciliation" v={REC[fin.reconciliation?.status] ?? "—"} tone={fin.reconciliation?.status === "reconciled" ? undefined : "warn"} />
                {(fin.reconciliation?.detail ?? []).map((x: string, i: number) => <div key={i} className="text-xs text-[#55555E]">· {x}</div>)}
                <div className="mt-2" />
                <Field k="Payment Amount" v={usd(fin.payment?.amount)} />
                <Field k="Payment Date / Time" v={[fin.payment?.date, fin.payment?.time].filter(Boolean).join(" ") || "—"} />
                <Field k="Payment Method" v={fin.payment?.methodState === "conflict" ? "Payment Method Conflict" : fin.payment?.method ?? fin.payment?.invoicePaymentField ?? "—"} tone={fin.payment?.methodState === "conflict" ? "warn" : undefined} />
                {fin.payment?.methodState === "conflict" && fin.payment.methodSources.map((m: any, i: number) => <div key={i} className="text-xs text-[#55555E]">· {m.file}: {m.value}</div>)}
                <Field k="Payment Reconciliation" v={PAY[fin.payment?.state] ?? "—"} tone={fin.payment?.state === "corroborated" ? undefined : "warn"} />
                <Field k="Actual Cost (One Linked Expense)" v={usd(fin.actualCost)} />
                {(fin.issues ?? []).map((x: string, i: number) => <div key={i} className="text-xs text-[#B45309] flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{x}</div>)}
              </div>
            )}
            <div className="rounded-lg border border-[#EDEDF0] p-3">
              <div className="text-[11px] uppercase tracking-wider text-[#9A9AA3] mb-1">If Approved, This Creates</div>
              <Field k="Vehicles Created" v={ap.vehiclesCreated ?? 0} />
              <Field k="Service Records" v={ap.serviceRecords ?? 0} />
              {fin && <Field k="Linked Expenses" v={ap.expenses ?? 0} />}
              <Field k="Mileage Observations" v={ap.mileageObservations ?? 0} />
              {(op.issues ?? []).map((x: string, i: number) => <div key={i} className="text-xs text-[#B45309] flex gap-1 mt-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{x}</div>)}
            </div>
            {pending && isManager && (
              <div className="flex flex-wrap items-center gap-2">
                {fin?.reconciliation?.status !== "reconciled" && (
                  <label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={confirmFin} onChange={(e) => setConfirmFin(e.target.checked)} /> I Reviewed The Figures</label>
                )}
                <button disabled={working || !vehicleId} onClick={apply} className="min-h-[40px] px-4 rounded-lg bg-[#111114] text-white text-sm disabled:opacity-50">{working ? "Applying…" : "Approve Transaction"}</button>
                <button disabled={working} onClick={async () => { await ignoreFn({ data: { transactionId: t.id } }); await reload(); }} className="min-h-[40px] px-3 rounded-lg border border-[#EDEDF0] text-sm">Ignore</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
