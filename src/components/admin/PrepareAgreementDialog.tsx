import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgreementPdfViewer } from "@/components/admin/AgreementPdfViewer";
import { previewAgreement, sendAgreement } from "@/lib/agreements.functions";
import { EMPTY_PREP, type AgreementPrep, type AdditionalDriver } from "@/lib/agreement-prep";

type Blocker = { field: string; label: string; why: string; fix?: { tab: "payments" | "rental" } | { vehicleId: string } };
type Res = {
  pdfBase64: string | null;
  fingerprint: string | null;
  canSend: boolean;
  sendRefusal: string | null;
  blockers: Blocker[];
  companyMissing?: string[];
  merge: Record<string, string>;
  terms: Record<string, string> | null;
  template: { label: string };
};

function Section({ title, children, open = true, badge }: { title: string; children: React.ReactNode; open?: boolean; badge?: number }) {
  return (
    <details open={open} className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[13px] font-medium">
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {badge ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">{badge} To Fix</span> : null}
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-2.5 border-t px-3 py-3 text-[12px]">{children}</div>
    </details>
  );
}

const input = "h-8 w-full rounded-md border bg-background px-2 text-[12px]";
const Radio = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
  <label className="flex cursor-pointer items-center gap-2"><input type="radio" checked={checked} onChange={onChange} /> {label}</label>
);

export function PrepareAgreementDialog({ applicationId, onClose, onSent, onOpenTab }: {
  applicationId: string; onClose: () => void; onSent: (r: any) => void; onOpenTab?: (tab: string) => void;
}) {
  const doPreview = useServerFn(previewAgreement);
  const doSend = useServerFn(sendAgreement);
  const [prep, setPrep] = useState<AgreementPrep>(EMPTY_PREP);
  const [res, setRes] = useState<Res | null>(null);
  const [reviewedKey, setReviewedKey] = useState<string>("");
  const [rendering, setRendering] = useState(false);
  const [tab, setTab] = useState<"details" | "preview">("details");
  const [companyAck, setCompanyAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => JSON.stringify(prep), [prep]);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      setRendering(true);
      try {
        const r = (await doPreview({ data: { applicationId, prep } })) as Res;
        if (!stale) { setRes(r); setReviewedKey(key); }
      } catch (e: any) {
        if (!stale) toast.error(e?.message ?? "Could not build the agreement");
      } finally { if (!stale) setRendering(false); }
    }, 600);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, applicationId]);

  const m = res?.merge ?? {};
  const terms = res?.terms ?? {};
  const upToDate = reviewedKey === key && !rendering;
  const needsAck = (res?.companyMissing?.length ?? 0) > 0 && !companyAck;
  const canSend = !!res?.fingerprint && res.canSend && upToDate && !needsAck && !busy;
  const byField = (f: string) => (res?.blockers ?? []).filter((b) => b.field === f).length;

  const setDriver = (i: number, patch: Partial<AdditionalDriver>) =>
    setPrep((p) => ({ ...p, drivers: { ...p.drivers, list: p.drivers.list.map((d, j) => (j === i ? { ...d, ...patch } : d)) } }));

  async function send() {
    if (!canSend || !res?.fingerprint) return;
    setBusy(true);
    try {
      const r = await doSend({ data: { applicationId, fingerprint: res.fingerprint, companyAck: companyAck || undefined, prep } });
      onSent(r);
    } catch (e: any) { toast.error(e?.message ?? "Could not send the agreement"); } finally { setBusy(false); }
  }

  function fix(b: Blocker) {
    if (!b.fix) return null;
    if ("vehicleId" in b.fix) return <a className="ml-1 font-semibold underline" href={`/admin?tab=vehicles&id=${b.fix.vehicleId}`} target="_blank" rel="noreferrer">Open Vehicle</a>;
    const t = b.fix.tab;
    return onOpenTab ? <button className="ml-1 font-semibold underline" onClick={() => { onClose(); onOpenTab(t); }}>{t === "payments" ? "Open Payments" : "Open Rental"}</button> : null;
  }

  const row = (k: string, v?: string) => (
    <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v && v.trim() ? v : <span className="text-destructive">Not Set</span>}</dd></div>
  );

  const details = (
    <div className="space-y-3 p-3 sm:p-4">
      {res && res.blockers.length > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive" data-testid="prep-blockers">
          <p className="font-semibold">This agreement cannot be sent yet:</p>
          {res.blockers.map((b, i) => <p key={i}>- {b.label}: {b.why}{fix(b)}</p>)}
        </div>
      )}
      {res?.sendRefusal && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px]">{res.sendRefusal}</p>}

      <Section title="Rental Details">
        <dl className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-3 gap-y-1">
          {row("Driver", m.driver_name)}{row("Phone / Email", [m.driver_phone, m.driver_email].filter(Boolean).join(" / "))}
          {row("License", m.license_number ? `${m.license_number} / ${m.license_state}` : "")}{row("Date of Birth", m.driver_dob)}
          {row("Vehicle", m.vehicle)}{row("Color / VIN", m.vehicle_vin ? `${m.vehicle_color} / ${m.vehicle_vin}` : "")}{row("Plate", m.license_plate)}
          {row("Start Date", m.start_date)}{row("Minimum Term", terms.min_term_weeks ? `${terms.min_term_weeks} weeks — ends ${m.min_term_end || "Not Set"}` : "")}
          {row("Weekly Rate", m.weekly_rate)}{row("Payment Method", m.card_on_file)}
          {row("Agreement Number", m.agreement_number)}{row("Template", res?.template.label)}
        </dl>
        <p className="text-[11px] text-muted-foreground">Corrections are made in the driver's and vehicle's own records; this screen never invents values. Preparing an agreement never charges the card.</p>
      </Section>

      <Section title="Authorized Drivers" badge={byField("additional_drivers")}>
        <Radio checked={prep.drivers.mode === "none"} onChange={() => setPrep((p) => ({ ...p, drivers: { mode: "none", list: [] } }))} label="No Additional Drivers (prints None Authorized)" />
        <Radio checked={prep.drivers.mode === "listed"} onChange={() => setPrep((p) => ({ ...p, drivers: { mode: "listed", list: p.drivers.list.length ? p.drivers.list : [{ name: "", licenseNumber: "", licenseState: "", licenseExpiration: "", verified: false }] } }))} label="Add Approved Driver" />
        {prep.drivers.mode === "listed" && prep.drivers.list.map((d, i) => (
          <div key={i} className="space-y-1.5 rounded-md border p-2">
            <div className="flex items-center justify-between"><span className="font-medium">Driver {i + 1}</span>
              <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Remove Driver" onClick={() => setPrep((p) => ({ ...p, drivers: { ...p.drivers, list: p.drivers.list.filter((_, j) => j !== i) } }))}><Trash2 className="h-3.5 w-3.5" /></Button></div>
            <input className={input} placeholder="Full legal name" value={d.name} onChange={(e) => setDriver(i, { name: e.target.value, verified: false })} />
            <div className="grid grid-cols-[1fr_60px] gap-1.5">
              <input className={input} placeholder="License number" value={d.licenseNumber} onChange={(e) => setDriver(i, { licenseNumber: e.target.value, verified: false })} />
              <input className={input} placeholder="State" maxLength={2} value={d.licenseState} onChange={(e) => setDriver(i, { licenseState: e.target.value.toUpperCase(), verified: false })} />
            </div>
            <label className="block">License Expiration<input type="date" className={input} value={d.licenseExpiration} onChange={(e) => setDriver(i, { licenseExpiration: e.target.value, verified: false })} /></label>
            <label className="flex items-start gap-2"><input type="checkbox" checked={d.verified} onChange={(e) => setDriver(i, { verified: e.target.checked })} className="mt-0.5" />
              <span>I checked this driver's physical license: the name, number, state and expiration match, and it is valid.</span></label>
          </div>
        ))}
        {prep.drivers.mode === "listed" && prep.drivers.list.length < 4 && (
          <Button size="sm" variant="outline" onClick={() => setPrep((p) => ({ ...p, drivers: { ...p.drivers, list: [...p.drivers.list, { name: "", licenseNumber: "", licenseState: "", licenseExpiration: "", verified: false }] } }))}><Plus className="h-3.5 w-3.5" /> Add Driver</Button>
        )}
      </Section>

      <Section title="Reservation Fee" badge={byField("reservation_fee")}>
        <Radio checked={prep.reservation.mode === "not_required"} onChange={() => setPrep((p) => ({ ...p, reservation: { mode: "not_required", amount: null } }))} label="Not Required" />
        <Radio checked={prep.reservation.mode === "required"} onChange={() => setPrep((p) => ({ ...p, reservation: { mode: "required", amount: p.reservation.amount } }))} label="Required" />
        {prep.reservation.mode === "required" && (
          <>
            <label className="block">Amount ($)<input type="number" min={0} step="0.01" className={input} value={prep.reservation.amount ?? ""} onChange={(e) => setPrep((p) => ({ ...p, reservation: { mode: "required", amount: e.target.value === "" ? null : Number(e.target.value) } }))} /></label>
            <p className="text-[11px] text-muted-foreground">Terms (Section 2): due when pickup or delivery is scheduled and applied in full to the first week; non-refundable on no-show or cancellation less than {terms.reservation_cancel_hours ?? "—"} hours before; fully refunded otherwise. It is not a security deposit.</p>
          </>
        )}
      </Section>

      <Section title="Security Deposit" badge={byField("deposit_amount")}>
        <Radio checked={prep.deposit.mode === "none"} onChange={() => setPrep((p) => ({ ...p, deposit: { mode: "none", amount: null, reason: "" } }))} label="No Deposit" />
        <Radio checked={prep.deposit.mode === "required"} onChange={() => setPrep((p) => ({ ...p, deposit: { mode: "required", amount: p.deposit.amount, reason: "" } }))} label="Deposit Required" />
        <Radio checked={prep.deposit.mode === "waived"} onChange={() => setPrep((p) => ({ ...p, deposit: { mode: "waived", amount: null, reason: p.deposit.reason } }))} label="Deposit Waived" />
        {prep.deposit.mode === "required" && <label className="block">Amount ($)<input type="number" min={0} step="0.01" className={input} value={prep.deposit.amount ?? ""} onChange={(e) => setPrep((p) => ({ ...p, deposit: { ...p.deposit, amount: e.target.value === "" ? null : Number(e.target.value) } }))} /></label>}
        {prep.deposit.mode === "waived" && <label className="block">Reason (internal, not printed)<input className={input} value={prep.deposit.reason} onChange={(e) => setPrep((p) => ({ ...p, deposit: { ...p.deposit, reason: e.target.value } }))} /></label>}
        <p className="text-[11px] text-muted-foreground">No Deposit and Deposit Waived keep the approved no-deposit wording. Deposit Required needs an Owner-approved template with deposit wording.</p>
      </Section>

      <Section title="Fees & Restrictions" open={false}>
        <dl className="grid grid-cols-[minmax(0,50%)_minmax(0,1fr)] gap-x-3 gap-y-1">
          {row("Late Payment", terms.fee_late_payment)}{row("Late Return", terms.fee_late_return)}{row("Smoking / Odor", terms.fee_smoking)}
          {row("Toll Processing Fee", terms.processing_fee)}{row("Service Area", terms.service_area)}{row("Termination Notice", terms.notice_hours ? `${terms.notice_hours} hours` : "")}
        </dl>
        <p className="text-[11px] text-muted-foreground">Set by the Owner in the Agreement Builder.</p>
      </Section>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background" role="dialog" aria-label="Prepare Agreement">
      <header className="flex shrink-0 flex-col gap-2 border-b bg-card px-3 py-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}><ArrowLeft className="h-4 w-4" /> Back</Button>
          <span className="truncate text-[14px] font-semibold">Prepare Agreement{m.driver_name ? ` — ${m.driver_name}` : ""}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {res?.fingerprint && <span className="font-mono text-[10.5px] text-muted-foreground" title={res.fingerprint}>Fingerprint {res.fingerprint.slice(0, 12)}…</span>}
          {(res?.companyMissing?.length ?? 0) > 0 && (
            <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={companyAck} onChange={(e) => setCompanyAck(e.target.checked)} /> Send with incomplete company details</label>
          )}
          <Button size="sm" disabled={!canSend} onClick={send} title={canSend ? undefined : "Resolve every item listed and wait for the preview to finish updating"}>
            <Send className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send For Signature"}
          </Button>
        </div>
      </header>
      <div className="flex shrink-0 border-b md:hidden" role="tablist">
        {(["details", "preview"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 py-2 text-[13px] ${tab === t ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>{t === "details" ? "Details" : "Preview"}</button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className={`${tab === "details" ? "block" : "hidden"} w-full overflow-y-auto bg-muted/20 md:block md:w-[35%] md:border-r`}>{details}</aside>
        <section className={`${tab === "preview" ? "flex" : "hidden"} min-w-0 flex-1 flex-col md:flex`}>
          <div className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2 text-[12px]">
            <span className="rounded bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">PREVIEW — NOT SENT</span>
            {rendering && <span className="text-muted-foreground">Updating…</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/40" data-testid="prep-preview">
            {res?.pdfBase64 ? <AgreementPdfViewer key={res.fingerprint ?? ""} base64={res.pdfBase64} /> :
              <p className="p-6 text-[12px] text-muted-foreground">{res ? "The document appears once every item on the left is resolved — blanks never reach a signature." : "Building the agreement…"}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export default PrepareAgreementDialog;
