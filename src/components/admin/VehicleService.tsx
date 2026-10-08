import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Gauge, Wrench, FileText, AlertTriangle, Lock, Clock } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { getFleetDocumentFile } from "@/lib/fleet-inbox.functions";
import {
  getVehicleService, addServiceEvent, addManualReading, setVehicleInterval, resolveOdometerConflict,
} from "@/lib/maintenance.functions";
import { SOURCE_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, SERVICE_CATEGORIES, categoryLabel, dueLabel } from "@/lib/maintenance-rules";
import { SectionCard, EmptyState } from "./ui";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalSection, ModalButton, Field, FormGrid, inputCls, UploadDropzone } from "./modal";
import { fmtDate } from "@/lib/date-format";

type Data = Awaited<ReturnType<typeof getVehicleService>>;
const mi = (n: unknown) => (n == null || n === "" ? "—" : `${Number(n).toLocaleString("en-US")} mi`);
const usd = (n: unknown) => (n == null || n === "" ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" }));
const d = (s: string | null | undefined) => (s ? fmtDate(s.length === 10 ? s + "T12:00:00" : s) : "Date Unknown");
const todayIso = () => new Date().toISOString().slice(0, 10);
const TONE: Record<string, string> = {
  overdue: "bg-brand/10 text-brand", due: "bg-brand/10 text-brand", due_soon: "bg-warning/15 text-warning-foreground",
  ok: "bg-success/10 text-success", unknown: "bg-muted text-muted-foreground",
};

export function useOpenEvidence() {
  const fileFn = useServerFn(getFleetDocumentFile);
  return async (id: string) => {
    try {
      const f = await fileFn({ data: { documentId: id } });
      const bin = atob(f.base64); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { toast.error("Could not open the evidence."); }
  };
}

export function VehicleService({ vehicleId, openAdd = false }: { vehicleId: string; openAdd?: boolean }) {
  const load = useServerFn(getVehicleService);
  const [data, setData] = useState<Data | null>(null);
  const [adding, setAdding] = useState(openAdd);
  const [reading, setReading] = useState<null | { supersedes?: any }>(null);
  const [detail, setDetail] = useState<any>(null);
  const [override, setOverride] = useState<any>(null);
  const openEvidence = useOpenEvidence();
  const refresh = useCallback(() => load({ data: { vehicleId } }).then(setData).catch(() => toast.error("Could not load service history.")), [vehicleId, load]);
  useEffect(() => { refresh(); }, [refresh]);

  if (!data) return <div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const completed = data.records.filter((r: any) => r.status === "completed");
  const open = data.records.filter((r: any) => r.status !== "completed");
  const latest = completed[0];
  const nextDue = [...data.schedules].filter((s: any) => s.due.state !== "unknown").sort((a: any, b: any) => {
    const r: Record<string, number> = { overdue: 0, due: 1, due_soon: 2, ok: 3 }; return (r[a.due.state] ?? 9) - (r[b.due.state] ?? 9);
  })[0];
  const chart = [...data.readings].filter((r: any) => r.status !== "superseded").reverse().map((r: any) => ({ date: r.observed_on, miles: r.mileage }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Mileage" value={mi(data.currentMileage)} sub={data.mileageAsOf ? `As Of ${d(data.mileageAsOf)}` : "No Readings Yet"} />
        <Stat label="Latest Service" value={latest ? latest.item : "None On Record"} sub={latest ? `${d(latest.performed_on)}${latest.odometer ? ` · ${mi(latest.odometer)}` : ""}` : undefined} />
        <Stat label="Next Service" value={nextDue ? nextDue.item : data.schedules.length ? "Unknown" : "No Intervals Set"} sub={nextDue?.due.reason} tone={nextDue?.due.state} />
        {data.canCost
          ? <Stat label="Maintenance Spend" value={usd(data.spend)} sub={`${data.downtimeDays} Days Downtime`} />
          : <Stat label="Downtime" value={`${data.downtimeDays} Days`} sub="In Maintenance" />}
      </div>

      <div className="flex flex-wrap gap-2">
        <ModalButton variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add Service</ModalButton>
        <ModalButton onClick={() => setReading({})}><Gauge className="h-4 w-4" /> Add Reading</ModalButton>
      </div>

      {open.length > 0 && (
        <SectionCard title="Open Maintenance" icon={<Wrench className="h-4 w-4" />}>
          <div className="divide-y divide-border">{open.map((r: any) => <ServiceRow key={r.id} r={r} canCost={data.canCost} onOpen={() => setDetail(r)} onEvidence={openEvidence} />)}</div>
        </SectionCard>
      )}

      <SectionCard title="Maintenance Due" icon={<Clock className="h-4 w-4" />} subtitle="Company intervals from Settings, with any overrides for this vehicle">
        {data.schedules.length === 0
          ? <div className="text-[13px] text-muted-foreground">No maintenance intervals are set. An Owner can add them in Settings → Maintenance.</div>
          : <div className="divide-y divide-border">{data.schedules.map((s: any) => (
              <div key={s.key} className="flex flex-wrap items-center gap-3 py-2.5 text-[13px]">
                <div className="min-w-[140px] flex-1 font-medium">{s.item}</div>
                <div className="text-muted-foreground">
                  {[s.interval_miles ? `Every ${s.interval_miles.toLocaleString("en-US")} mi` : null, s.interval_days ? `${Math.round(s.interval_days / 30)} Months` : null].filter(Boolean).join(" Or ")}
                  {s.is_override && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px]">Vehicle Override</span>}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[s.due.state] ?? TONE.unknown}`}>{dueLabel(s.due.state)}</span>
                <span className="text-muted-foreground">{s.due.reason}</span>
                {data.canManage && s.default_id && <button className="text-[12px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setOverride(s)}>Change Interval</button>}
              </div>
            ))}</div>}
      </SectionCard>

      <SectionCard title="Service History" icon={<Wrench className="h-4 w-4" />}>
        {completed.length === 0
          ? <EmptyState title="No Service History Yet" hint="Add a service, or drop a receipt into Fleet Inbox." />
          : <div className="divide-y divide-border">{completed.map((r: any) => <ServiceRow key={r.id} r={r} canCost={data.canCost} onOpen={() => setDetail(r)} onEvidence={openEvidence} />)}</div>}
      </SectionCard>

      <SectionCard title="Mileage History" icon={<Gauge className="h-4 w-4" />} subtitle="Every reading keeps its source. Current mileage is the newest valid reading.">
        {chart.length >= 2 && (
          <div className="mb-4 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={60} /><Tooltip /><Line type="monotone" dataKey="miles" stroke="var(--real-red)" dot /></LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {data.readings.length === 0
          ? <div className="text-[13px] text-muted-foreground">No mileage readings yet.</div>
          : <div className="divide-y divide-border text-[13px]">{data.readings.map((r: any) => (
              <div key={r.id} className={`flex flex-wrap items-center gap-3 py-2 ${r.status === "superseded" ? "opacity-50" : ""}`}>
                <div className="w-28 text-muted-foreground">{d(r.observed_on)}</div>
                <div className="w-28 font-medium tabular-nums">{mi(r.mileage)}</div>
                <div className="flex-1">{SOURCE_LABELS[r.source_type] ?? r.source_type}{r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}</div>
                {r.status === "conflict" && <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand"><AlertTriangle className="h-3 w-3" /> Needs Review — Odometer Conflict</span>}
                {r.status === "superseded" && <span className="text-[11px] text-muted-foreground">Corrected</span>}
                {r.document_id && <button className="text-[12px] underline-offset-2 hover:underline" onClick={() => openEvidence(r.document_id)}>View Evidence</button>}
                {r.status === "conflict" && data.canManage && <ConflictActions id={r.id} onDone={refresh} />}
                {r.status === "valid" && r.source_type === "manual" && <button className="text-[12px] text-muted-foreground hover:underline" onClick={() => setReading({ supersedes: r })}>Correct</button>}
              </div>
            ))}</div>}
      </SectionCard>

      {adding && <AddServiceDialog vehicleId={vehicleId} canCost={data.canCost} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />}
      {reading && <AddReadingDialog vehicleId={vehicleId} supersedes={reading.supersedes} onClose={() => setReading(null)} onSaved={() => { setReading(null); refresh(); }} />}
      {detail && <ServiceDetail r={detail} canCost={data.canCost} onClose={() => setDetail(null)} onEvidence={openEvidence} />}
      {override && <OverrideDialog vehicleId={vehicleId} s={override} onClose={() => setOverride(null)} onSaved={() => { setOverride(null); refresh(); }} />}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-[15px] font-semibold">{value}</div>
      {sub && <div className={`mt-0.5 truncate text-[12px] ${tone === "overdue" || tone === "due" ? "text-brand" : "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );
}

function ServiceRow({ r, canCost, onOpen, onEvidence }: { r: any; canCost: boolean; onOpen: () => void; onEvidence: (id: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-[13px]">
      <button onClick={onOpen} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-left">
        <span className="w-28 text-muted-foreground">{d(r.performed_on)}</span>
        <span className="w-24 tabular-nums text-muted-foreground">{mi(r.odometer)}</span>
        <span className="min-w-[160px] flex-1 font-medium">{r.item}</span>
        <span className="text-muted-foreground">{r.vendor_name ?? "Vendor Unknown"}</span>
        {canCost && <span className="w-24 text-right tabular-nums">{usd(r.total_cost)}</span>}
        {r.status !== "completed" && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px]">{r.status === "in_progress" ? "Open" : "Scheduled"}</span>}
      </button>
      {r.document_id && <button className="inline-flex items-center gap-1 text-[12px] underline-offset-2 hover:underline" onClick={() => onEvidence(r.document_id)}><FileText className="h-3.5 w-3.5" /> View Receipt</button>}
    </div>
  );
}

function ConflictActions({ id, onDone }: { id: string; onDone: () => void }) {
  const fn = useServerFn(resolveOdometerConflict);
  const act = async (decision: "valid" | "superseded") => {
    const reason = window.prompt(decision === "valid" ? "Why is this reading correct?" : "Why should this reading not be used?");
    if (!reason || reason.trim().length < 3) return;
    const r = await fn({ data: { readingId: id, decision, reason } });
    if (!r.ok) toast.error(r.error); else { toast.success("Reading reviewed."); onDone(); }
  };
  return <span className="flex gap-2 text-[12px]"><button className="hover:underline" onClick={() => act("valid")}>Mark Valid</button><button className="text-muted-foreground hover:underline" onClick={() => act("superseded")}>Don't Use</button></span>;
}

function ServiceDetail({ r, canCost, onClose, onEvidence }: { r: any; canCost: boolean; onClose: () => void; onEvidence: (id: string) => void }) {
  const Line = ({ k, v }: { k: string; v: any }) => <div className="flex justify-between gap-4 py-1.5 text-[13px]"><span className="text-muted-foreground">{k}</span><span className="text-right">{v ?? "—"}</span></div>;
  return (
    <ModalShell onClose={onClose} label="Service Record">
      <ModalHeader title={r.item} subtitle={`${d(r.performed_on)} · ${r.vendor_name ?? "Vendor Unknown"}`} onClose={onClose} />
      <ModalBody>
        <ModalSection label="Details">
          <Line k="Mileage" v={mi(r.odometer)} />
          <Line k="Invoice" v={r.invoice_number} />
          <Line k="Status" v={r.status === "completed" ? "Completed" : "Open"} />
          <Line k="Source" v={r.source === "fleet_inbox" ? `Fleet Inbox${r.document_page ? ` · Page ${r.document_page}` : ""}` : "Manual Entry"} />
          {r.description && <Line k="Description" v={r.description} />}
          {r.notes && <Line k="Notes" v={r.notes} />}
        </ModalSection>
        {r.items?.length > 0 && (
          <ModalSection label="Service Items">
            {r.items.map((i: any) => <Line key={i.id} k={`${i.description} (${categoryLabel(i.category)})`} v={canCost ? usd(i.amount) : ""} />)}
          </ModalSection>
        )}
        {canCost ? (
          <ModalSection label="Costs">
            <Line k="Labor" v={usd(r.labor_cost)} /><Line k="Parts" v={usd(r.parts_cost)} /><Line k="Tax" v={usd(r.tax_amount)} />
            {r.other_cost != null && <Line k="Other" v={usd(r.other_cost)} />}
            {r.warranty_covered != null && <Line k="Warranty Covered" v={usd(r.warranty_covered)} />}
            <Line k="Total" v={<b>{usd(r.total_cost)}</b>} />
            {r.payment_method && <Line k="Paid By" v={PAYMENT_METHOD_LABELS[r.payment_method] ?? r.payment_method} />}
          </ModalSection>
        ) : <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Lock className="h-3.5 w-3.5" /> Costs are visible to Managers and Owners.</div>}
        <div className="text-[12px] text-muted-foreground">Created {d(r.created_at)}{r.updated_at && r.updated_at !== r.created_at ? ` · Updated ${d(r.updated_at)}` : ""}</div>
      </ModalBody>
      <ModalFooter>
        {r.document_id && <ModalButton onClick={() => onEvidence(r.document_id)}><FileText className="h-4 w-4" /> View Receipt</ModalButton>}
        <ModalButton onClick={onClose}>Close</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^0-9.]/g, "")));

function AddServiceDialog({ vehicleId, canCost, onClose, onSaved }: { vehicleId: string; canCost: boolean; onClose: () => void; onSaved: () => void }) {
  const save = useServerFn(addServiceEvent);
  const [f, setF] = useState({ status: "completed" as "completed" | "open", date: todayIso(), mileage: "", vendor: "", invoice: "", notes: "", labor: "", parts: "", tax: "", total: "", method: "", priority: "normal" });
  const [items, setItems] = useState<{ description: string; category: string; amount: string }[]>([{ description: "", category: "", amount: "" }]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const valid = items.some((i) => i.description.trim()) && (f.status === "open" || !!f.date);

  async function submit() {
    setBusy(true);
    try {
      let receiptPath: string | null = null;
      if (file) {
        const ext = (file.name.split(".").pop() || "bin").replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
        receiptPath = `inbox/service-${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("vehicle-docs").upload(receiptPath, file, { contentType: file.type || undefined });
        if (error) throw new Error("Receipt upload failed.");
      }
      const r = await save({ data: {
        vehicleId, status: f.status, performedOn: f.date || null, mileage: f.mileage ? Number(f.mileage.replace(/\D/g, "")) : null,
        vendorName: f.vendor || null, invoiceNumber: f.invoice || null, notes: f.notes || null,
        items: items.filter((i) => i.description.trim()).map((i) => ({ description: i.description, category: i.category || null, amount: canCost ? num(i.amount) : null })),
        laborCost: canCost ? num(f.labor) : null, partsCost: canCost ? num(f.parts) : null, taxAmount: canCost ? num(f.tax) : null, totalCost: canCost ? num(f.total) : null,
        paymentMethod: canCost && f.method ? f.method : null, priority: f.status === "open" ? (f.priority as any) : null,
        receiptPath, receiptName: file?.name ?? null, receiptMime: file?.type ?? null,
      } });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(r.odometerStatus === "conflict" ? "Service saved. The mileage was flagged for review." : "Service saved.");
      onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Could not save."); } finally { setBusy(false); }
  }

  return (
    <ModalShell onClose={onClose} label="Add Service" size="lg">
      <ModalHeader title="Add Service" subtitle="Leave anything you don't know blank — unknown stays unknown." onClose={onClose} />
      <ModalBody>
        <FormGrid cols={3}>
          <Field label="Status"><select className={inputCls} value={f.status} onChange={set("status")}><option value="completed">Completed</option><option value="open">Open Work</option></select></Field>
          <Field label="Service Date" required={f.status === "completed"}><input type="date" max={todayIso()} className={inputCls} value={f.date} onChange={set("date")} /></Field>
          <Field label="Mileage"><input inputMode="numeric" className={inputCls} value={f.mileage} onChange={set("mileage")} placeholder="e.g. 92150" /></Field>
          <Field label="Vendor / Shop"><input className={inputCls} value={f.vendor} onChange={set("vendor")} /></Field>
          <Field label="Invoice Number"><input className={inputCls} value={f.invoice} onChange={set("invoice")} /></Field>
          {f.status === "open" && <Field label="Priority"><select className={inputCls} value={f.priority} onChange={set("priority")}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></Field>}
        </FormGrid>
        <ModalSection label="Services Performed" aside={<button className="text-[12px] hover:underline" onClick={() => setItems([...items, { description: "", category: "", amount: "" }])}>+ Add Line</button>}>
          {items.map((it, n) => (
            <div key={n} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px_120px]">
              <input className={inputCls} placeholder="e.g. Front Brake Pads" value={it.description} onChange={(e) => setItems(items.map((x, i) => i === n ? { ...x, description: e.target.value } : x))} />
              <select className={inputCls} value={it.category} onChange={(e) => setItems(items.map((x, i) => i === n ? { ...x, category: e.target.value } : x))}>
                <option value="">Auto Category</option>{SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
              </select>
              {canCost && <input inputMode="decimal" className={inputCls} placeholder="Amount" value={it.amount} onChange={(e) => setItems(items.map((x, i) => i === n ? { ...x, amount: e.target.value } : x))} />}
            </div>
          ))}
        </ModalSection>
        {canCost && (
          <ModalSection label="Costs">
            <FormGrid cols={3}>
              <Field label="Labor"><input inputMode="decimal" className={inputCls} value={f.labor} onChange={set("labor")} /></Field>
              <Field label="Parts"><input inputMode="decimal" className={inputCls} value={f.parts} onChange={set("parts")} /></Field>
              <Field label="Tax"><input inputMode="decimal" className={inputCls} value={f.tax} onChange={set("tax")} /></Field>
              <Field label="Total"><input inputMode="decimal" className={inputCls} value={f.total} onChange={set("total")} placeholder="Blank = sum of known" /></Field>
              <Field label="Paid By"><select className={inputCls} value={f.method} onChange={set("method")}><option value="">Unknown</option>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</select></Field>
            </FormGrid>
            <div className="text-[12px] text-muted-foreground">A completed service with a cost is added to Expenses once, linked to this record.</div>
          </ModalSection>
        )}
        <ModalSection label="Receipt">
          <UploadDropzone file={file} onFile={setFile} accept="image/*,application/pdf" title="Add Receipt" hint="Drag & drop or browse — stored privately" />
        </ModalSection>
        <Field label="Notes"><textarea className={`${inputCls} h-20 py-2`} value={f.notes} onChange={set("notes")} /></Field>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={!valid || busy} onClick={submit}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save Service</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

function AddReadingDialog({ vehicleId, supersedes, onClose, onSaved }: { vehicleId: string; supersedes?: any; onClose: () => void; onSaved: () => void }) {
  const save = useServerFn(addManualReading);
  const [mileage, setMileage] = useState(supersedes ? String(supersedes.mileage) : "");
  const [date, setDate] = useState(supersedes?.observed_on ?? todayIso());
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await save({ data: { vehicleId, mileage: Number(mileage.replace(/\D/g, "")), observedOn: date, note: note || null, supersedesId: supersedes?.id ?? null, reason: reason || null } }).catch(() => ({ ok: false as const, error: "Could not save." }));
    setBusy(false);
    if (!r.ok) { toast.error((r as any).error); return; }
    toast.success((r as any).status === "conflict" ? "Saved — flagged as a possible odometer conflict." : "Reading saved.");
    onSaved();
  };
  return (
    <ModalShell onClose={onClose} label={supersedes ? "Correct Reading" : "Add Reading"} size="sm">
      <ModalHeader title={supersedes ? "Correct Reading" : "Add Mileage Reading"} subtitle={supersedes ? "The original reading is kept and marked Corrected." : "Readings are never edited or deleted."} onClose={onClose} />
      <ModalBody>
        <FormGrid cols={2}>
          <Field label="Mileage" required><input inputMode="numeric" className={inputCls} value={mileage} onChange={(e) => setMileage(e.target.value)} /></Field>
          <Field label="Date" required><input type="date" max={todayIso()} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </FormGrid>
        {supersedes && <Field label="Reason For Correction" required><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
        <Field label="Note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={busy || !mileage || !date || (!!supersedes && !reason.trim())} onClick={submit}>Save Reading</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

function OverrideDialog({ vehicleId, s, onClose, onSaved }: { vehicleId: string; s: any; onClose: () => void; onSaved: () => void }) {
  const save = useServerFn(setVehicleInterval);
  const [miles, setMiles] = useState(s.is_override && s.interval_miles ? String(s.interval_miles) : "");
  const [months, setMonths] = useState(s.is_override && s.interval_days ? String(Math.round(s.interval_days / 30)) : "");
  const go = async (revert: boolean) => {
    const r = await save({ data: { vehicleId, defaultId: s.default_id, interval_miles: revert || !miles ? null : Number(miles), interval_days: revert || !months ? null : Number(months) * 30 } });
    if (!r.ok) toast.error(r.error); else { toast.success(revert ? "Using company interval." : "Interval saved for this vehicle."); onSaved(); }
  };
  return (
    <ModalShell onClose={onClose} label="Change Interval" size="sm">
      <ModalHeader title={`${s.item} Interval`} subtitle={`Company: ${[s.company_miles ? `${s.company_miles.toLocaleString("en-US")} mi` : null, s.company_days ? `${Math.round(s.company_days / 30)} months` : null].filter(Boolean).join(" or ")}`} onClose={onClose} />
      <ModalBody>
        <FormGrid cols={2}>
          <Field label="Every (Miles)"><input inputMode="numeric" className={inputCls} value={miles} onChange={(e) => setMiles(e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Every (Months)"><input inputMode="numeric" className={inputCls} value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))} /></Field>
        </FormGrid>
      </ModalBody>
      <ModalFooter left={s.is_override ? <ModalButton variant="ghost" onClick={() => go(true)}>Use Company Interval</ModalButton> : undefined}>
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={!miles && !months} onClick={() => go(false)}>Save For This Vehicle</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}
