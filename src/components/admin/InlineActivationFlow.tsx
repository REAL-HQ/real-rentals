import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { approveApplication } from "@/lib/applications.functions";
import { adminListDriverDocuments, type VaultDocument } from "@/lib/documents.functions";
import { getVehicleProfile, type VehicleProfile, type VehicleSection } from "@/lib/vehicles.functions";
import { startInspection } from "@/lib/inspections.functions";
import { activationAgreementPatch, type ActivationDraft } from "@/lib/driver-list-activation";
import { updateApplicationLifecycle } from "@/lib/application-lifecycle.functions";
import { fillActivationEmail } from "@/lib/activation-contact.functions";
import type { Application, DriverScreening, Vehicle } from "./types";
import { ActivateRentalDialog } from "./ActivateRentalDialog";
import { ApplicantDocuments } from "./ApplicantDocuments";
import { InsuranceVerificationCard, InterviewTab } from "./DriverScreening";
import { AgreementsCard } from "./AgreementsCard";
import { InspectionRunner } from "./InspectionsPanel";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SectionDrawer } from "./VehicleProfile";

const button = "rounded-md bg-[#D03020] px-3 py-2 text-sm font-medium text-white disabled:opacity-50";
function Failure({ message }: { message: string | null }) {
  return message ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</p> : null;
}

/** Reuses the real guarded dialog. Resolver views replace its body, not the list or a profile tab. */
export function InlineActivationFlow({ driver, vehicles, isOwner, onClose, onActivated, onRefresh, renderPayments }: {
  driver: Application; vehicles: Vehicle[]; isOwner: boolean;
  onClose: () => void; onActivated: () => void; onRefresh: () => void;
  renderPayments?: () => ReactNode;
}) {
  const [fixVehicleId, setFixVehicleId] = useState<string | null>(null);
  return <ActivateRentalDialog driver={driver} vehicles={vehicles} isOwner={isOwner}
    onClose={onClose} onActivated={onActivated} onRefresh={() => { setFixVehicleId(null); onRefresh(); }}
    renderResolution={(key, context) => {
      const { onResolved, onNavigate, vehicleId } = context;
      if (key === "documents") return <DocumentsResolution id={driver.id} />;
      if (key === "insurance" || key === "interview") return <ScreeningResolution key={key} mode={key} driver={driver} isOwner={isOwner} onResolved={onResolved} />;
      if (key === "approval") return <ApproveResolution id={driver.id} onResolved={onResolved} />;
      if (key === "email") return <EmailResolution id={driver.id} onResolved={onResolved} />;
      if (key === "inspection") return <InspectionResolution vehicleId={vehicleId} vehicles={vehicles} onResolved={onResolved} />;
      if (key === "vehicle") return <VehicleResolution id={fixVehicleId ?? vehicleId} onResolved={() => { setFixVehicleId(null); onResolved(); }} />;
      if (key === "payments") return renderPayments?.() ?? <p>Card setup is not available for your role. No payment status was changed.</p>;
      return <AgreementResolution driver={driver} draft={context.draft} onRefresh={onRefresh}
        onFixVehicle={(id) => { setFixVehicleId(id); onNavigate("vehicle"); }}
        onOpenTab={(tab) => onNavigate(tab === "payments" ? "payments" : null)} />;
    }} />;
}

function DocumentsResolution({ id }: { id: string }) {
  const list = useServerFn(adminListDriverDocuments);
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true); setFailure(null);
    try { setDocs(await list({ data: { applicationId: id } })); }
    catch (e) { setFailure(e instanceof Error ? e.message : "Could not load documents"); }
    finally { setLoading(false); }
  }, [id, list]);
  useEffect(() => { void reload(); }, [reload]);
  return <div className="space-y-3"><h3 className="font-semibold">License Documents</h3><Failure message={failure} />
    {failure ? <button className={button} onClick={() => void reload()}>Retry Documents</button> :
      <ApplicantDocuments applicationId={id} docs={docs} loading={loading} onRefresh={reload} />}
  </div>;
}

function ScreeningResolution({ mode, driver, isOwner, onResolved }: {
  mode: "insurance" | "interview"; driver: Application; isOwner: boolean; onResolved: () => void;
}) {
  const [screening, setScreening] = useState<DriverScreening | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setFailure(null);
    void (async () => {
      try {
        const result = await supabase.from("driver_screenings").select("*").eq("lead_id", driver.id).maybeSingle();
        if (result.error) throw result.error;
        if (live) setScreening(result.data as DriverScreening | null);
      } catch { if (live) setFailure("Could not read screening. No verification or interview was changed."); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [driver.id, revision]);
  if (loading) return <p role="status">Loading Screening…</p>;
  if (failure) return <><Failure message={failure} /><button className={button} onClick={() => setRevision((n) => n + 1)}>Retry Screening</button></>;
  return mode === "insurance" ? <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Review the evidence before recording a decision. Choosing Active does not verify insurance or change the Owner exception setting.</p>
    <InsuranceVerificationCard leadId={driver.id} screening={screening} isOwner={isOwner} canDecide onScreening={(next) => { setScreening(next); if (next.insurance_verified) onResolved(); }} />
  </div> : <InterviewTab stepped driver={driver} screening={screening} onSaved={onResolved} />;
}

function ApproveResolution({ id, onResolved }: { id: string; onResolved: () => void }) {
  const approve = useServerFn(approveApplication);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = useRef(false);
  async function save() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setFailure(null);
    try {
      const result = await approve({ data: { id } });
      if (!result.ok) throw new Error(result.error ?? "Could not approve this application");
      onResolved();
    } catch (e) { setFailure(e instanceof Error ? e.message : "Could not approve"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="space-y-3"><h3 className="font-semibold">Approve Application</h3>
    <p className="text-sm">Approval uses the existing server checks and may send the normal portal invitation. It does not start a rental or verify insurance.</p>
    <Failure message={failure} /><button className={button} onClick={() => void save()} disabled={busy}>{busy ? "Approving…" : "Approve Application"}</button>
  </div>;
}

function EmailResolution({ id, onResolved }: { id: string; onResolved: () => void }) {
  const fill = useServerFn(fillActivationEmail);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function save() {
    if (busy) return;
    setBusy(true); setFailure(null);
    try {
      const result = await fill({ data: { applicationId: id, email } });
      if (result.auditError) { setFailure(result.auditError); return; }
      onResolved();
    } catch (e) { setFailure(e instanceof Error ? e.message : "Could not save email"); }
    finally { setBusy(false); }
  }
  return <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <h3 className="font-semibold">Add Missing Email</h3>
    <p className="text-sm">Use the driver's confirmed email. This only fills an empty application email; it cannot replace a linked login or send a message.</p>
    <label className="block text-sm">Email<input aria-label="Driver Email" type="email" required maxLength={160} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 block h-9 w-full rounded-md border bg-white px-3" /></label>
    <Failure message={failure} /><button type="submit" className={button} disabled={busy}>{busy ? "Saving…" : "Save Email"}</button>
  </form>;
}

function InspectionResolution({ vehicleId, vehicles, onResolved }: { vehicleId: string; vehicles: Vehicle[]; onResolved: () => void }) {
  const start = useServerFn(startInspection);
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [odometer, setOdometer] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await supabase.from("inspection_templates").select("id,name").eq("is_active", true).eq("inspection_type", "pre_delivery").order("name");
      if (!live) return;
      if (result.error) setFailure("Could not load the inspection checklists.");
      else { setTemplates(result.data ?? []); setTemplateId(result.data?.[0]?.id ?? ""); }
    })().catch(() => { if (live) setFailure("Could not load the inspection checklists."); });
    return () => { live = false; };
  }, [vehicleId]);
  const vehicle = vehicles.find((row) => row.id === vehicleId);
  const label = vehicle ? [vehicle.unit_number, vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "Selected Vehicle";
  if (inspectionId) return <InspectionRunner id={inspectionId} vehicleLabel={() => label} onBack={onResolved} backLabel="Back To Activation" />;
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    if (busy || !vehicleId || !templateId) return;
    setBusy(true); setFailure(null);
    void start({ data: { vehicleId, templateId, odometer: odometer.trim() ? Number(odometer) : null } })
      .then((result) => setInspectionId(result.id))
      .catch((e) => setFailure(e instanceof Error ? e.message : "Could not start inspection"))
      .finally(() => setBusy(false));
  }}>
    <h3 className="font-semibold">Pre-Delivery Inspection</h3><p className="text-sm">{label}</p>
    <div className="text-sm">Checklist<Select value={templateId || undefined} onValueChange={setTemplateId}>
      <SelectTrigger aria-label="Inspection Checklist" className="mt-1 bg-white"><SelectValue placeholder="Choose A Checklist" /></SelectTrigger>
      <SelectContent className="z-[70] bg-white">{templates.map((row) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}</SelectContent>
    </Select></div>
    <label className="block text-sm">Odometer<input aria-label="Inspection Odometer" type="number" min={0} step={1} value={odometer} onChange={(e) => setOdometer(e.target.value)} className="mt-1 block h-9 w-full rounded-md border bg-white px-3" /></label>
    <Failure message={failure} /><button className={button} type="submit" disabled={busy || !vehicleId || !templateId}>{busy ? "Starting…" : "Start Inspection"}</button>
  </form>;
}

function VehicleResolution({ id, onResolved }: { id: string; onResolved: () => void }) {
  const fetch = useServerFn(getVehicleProfile);
  const [profile, setProfile] = useState<VehicleProfile | null>(null);
  const [section, setSection] = useState<VehicleSection>("identity");
  const [failure, setFailure] = useState<string | null>(null);
  const load = useCallback(async () => {
    setFailure(null);
    try {
      const result = await fetch({ data: { id } });
      if (!result?.canEdit) throw new Error("This vehicle cannot be edited with your role.");
      setProfile(result);
      if (!result.vehicle.vin || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(result.vehicle.vin)) setSection("dmv");
    } catch (e) { setFailure(e instanceof Error ? e.message : "Could not load vehicle"); }
  }, [fetch, id]);
  useEffect(() => { void load(); }, [load]);
  if (failure) return <><Failure message={failure} /><button className={button} onClick={() => void load()}>Retry Vehicle</button></>;
  if (!profile) return <p role="status">Loading Vehicle…</p>;
  return <SectionDrawer inline key={section} section={section} vehicleId={id} vehicle={profile.vehicle} canTitle={profile.canSeeFinance} onClose={onResolved} onSaved={onResolved} onRefresh={load} onOpenSection={setSection} />;
}

function AgreementResolution({ driver, draft, onFixVehicle, onOpenTab, onRefresh }: {
  driver: Application; draft: ActivationDraft; onFixVehicle: (id: string) => void; onOpenTab: (tab: string) => void; onRefresh: () => void;
}) {
  const save = useServerFn(updateApplicationLifecycle);
  const matches = driver.vehicle_id === draft.vehicleId && Number(driver.weekly_rent) === draft.weeklyRate &&
    Number(driver.deposit_amount) === draft.depositAmount && driver.contract_start_date === draft.startDate &&
    (driver.contract_end_date || null) === draft.endDate;
  const [prepared, setPrepared] = useState(matches);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function prepare() {
    if (busy) return;
    setBusy(true); setFailure(null);
    try {
      const patch = activationAgreementPatch(draft);
      const confirmed = await save({ data: { id: driver.id, patch } });
      if (Object.entries(patch).some(([key, value]) => String(confirmed[key] ?? "") !== String(value ?? ""))) throw new Error("The rental details could not be confirmed. Recheck before preparing the agreement.");
      setPrepared(true); onRefresh();
    } catch (e) { setFailure(e instanceof Error ? e.message : "Could not save the rental details"); }
    finally { setBusy(false); }
  }
  if (prepared) return <AgreementsCard applicationId={driver.id} inlinePreparation onFixVehicle={onFixVehicle} onOpenTab={onOpenTab} />;
  return <div className="space-y-3"><h3 className="font-semibold">Prepare Rental Agreement</h3>
    <p className="text-sm">Save the selected vehicle, weekly rate, deposit amount and dates to this application so the agreement uses these exact details. This does not activate the rental, collect a payment or send a message.</p>
    <p className="text-sm">${draft.weeklyRate} Weekly · Starts {draft.startDate}{draft.endDate ? ` · Ends ${draft.endDate}` : ""}</p>
    <Failure message={failure} /><button className={button} disabled={busy} onClick={() => void prepare()}>{busy ? "Saving…" : "Save Details & Prepare Agreement"}</button>
  </div>;
}
