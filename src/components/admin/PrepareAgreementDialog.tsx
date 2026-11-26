import { PhoneInput } from "@/components/ui/phone-input";
import { useEffect, useMemo, useState } from "react";
import { AppSelect } from "@/components/ui/app-select";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, Loader2, Plus, ScanText, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgreementPdfViewer } from "@/components/admin/AgreementPdfViewer";
import { previewAgreement, sendAgreement } from "@/lib/agreements.functions";
import { EMPTY_PREP, PAYMENT_METHODS, PAYMENT_SCHEDULES, fillBlankAgreementDetails, parseUsd, paymentRows, type AgreementDetails, type AgreementPrep, type AdditionalDriver } from "@/lib/agreement-prep";
import { defaultRentalEndIso } from "@/lib/agreement-dates";
import { layoutToText } from "@/lib/agreement-layout";
import { readAgreementLicense, readWrittenAgreement } from "@/lib/agreement-license.functions";
import { LIBRARY, DRAFT_STATUS_LABEL, OWNER_APPROVED_LIBRARY, acknowledgmentsOf } from "@/lib/agreement-library";
import { HOME_ADDRESS_LABEL, missingHomeAddressParts } from "@/lib/agreement-home-address";
import { DANGER_BADGE } from "@/lib/badge-tone";
import { listStaffAdditionalDrivers } from "@/lib/additional-drivers.functions";
import { prepDriversFromApproved } from "@/lib/additional-drivers";

type Blocker = { field: string; label: string; why: string; fix?: { tab: "payments" | "rental" } | { vehicleId: string } };
type Note = { field: string; label: string; why: string };
type Res = {
  body: string | null;
  pdfBase64: string | null;
  fingerprint: string | null;
  canSend: boolean;
  sendRefusal: string | null;
  blockers: Blocker[];
  notes?: Note[];
  companyMissing?: string[];
  merge: Record<string, string>;
  values: AgreementDetails;
  terms: Record<string, string> | null;
  /** Merge fields the chosen template prints. */
  templateFields?: string[];
  template: { label: string };
  reservationFeeAuto?: { enabled: boolean; amount: number };
  priceDefaults?: { weeklyRent: number | null; driverFee: number; damageWaiver: number | null; reservationFee: number };
  savedPrices?: {
    weeklyRent: number | null;
    drivers: { name: string; weeklyFee: number }[];
    damageWaiver: "accepted" | "declined" | null;
    damageWaiverFee: number | null;
    reservationMode: "required" | "not_required" | "not_applicable" | null;
    reservationAmount: number | null;
    priceNote: string | null;
  } | null;
};

function EditedTag() {
  return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-950">Edited</span>;
}

function Section({ title, children, open = true, badge }: { title: string; children: React.ReactNode; open?: boolean; badge?: number }) {
  return (
    <details open={open} className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[13px] font-medium">
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {badge ? <span className={`rounded-full ${DANGER_BADGE} px-2 py-0.5 text-[11px]`}>{badge} To Fix</span> : null}
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
  const doReadLicense = useServerFn(readAgreementLicense);
  const doReadAgreement = useServerFn(readWrittenAgreement);
  const loadExtraDrivers = useServerFn(listStaffAdditionalDrivers);
  // Weekly by card autopay is how every rental is paid today (and what Move
  // Forward / FLEET sends); staff can change either. The Damage Waiver stays
  // unanswered until staff record the renter's choice.
  const [prep, setPrep] = useState<AgreementPrep>({ ...EMPTY_PREP, payment: { schedule: "weekly", method: "Card Autopay" } });
  const [res, setRes] = useState<Res | null>(null);
  const [reviewedKey, setReviewedKey] = useState<string>("");
  const [rendering, setRendering] = useState(false);
  const [companyAck, setCompanyAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [templateKey, setTemplateKey] = useState<string>("");
  const [licenseReading, setLicenseReading] = useState(false);
  const [licenseReadAttempted, setLicenseReadAttempted] = useState(false);
  const [agreementReading, setAgreementReading] = useState(false);
  const [agreementReadAttempted, setAgreementReadAttempted] = useState(false);
  // Send refused because the preview went stale: kept on screen (a toast can
  // be missed) until staff regenerate the preview and review it again.
  const [staleRefusal, setStaleRefusal] = useState<string | null>(null);
  const [regen, setRegen] = useState(0);
  // The Reservation Fee switch preselects Required (once); staff can still change it.
  const [feeDefaulted, setFeeDefaulted] = useState(false);
  const [driversPrefilled, setDriversPrefilled] = useState(false);
  const [pricesRestored, setPricesRestored] = useState(false);
  const key = useMemo(() => JSON.stringify({ prep, templateKey }), [prep, templateKey]);
  function chooseTemplate(k: string) {
    // Switching templates invalidates the previous preview and its fingerprint.
    setRes(null); setReviewedKey(""); setCompanyAck(false); setTemplateKey(k);
  }

  useEffect(() => {
    if (driversPrefilled) return;
    let live = true;
    void loadExtraDrivers({ data: { applicationId } }).then((res) => {
      if (!live) return;
      setDriversPrefilled(true);
      const listed = prepDriversFromApproved(res.rows);
      if (!listed.length) return;
      setPrep((current) => current.drivers.mode !== "none" || current.drivers.list.length
        ? current
        : { ...current, drivers: { mode: "listed", list: listed } });
    }).catch(() => { if (live) setDriversPrefilled(true); });
    return () => { live = false; };
  }, [applicationId, driversPrefilled, loadExtraDrivers]);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      setRendering(true);
      try {
        const r = (await doPreview({ data: { applicationId, prep, templateKey: (templateKey || undefined) as any } })) as Res;
        if (!stale) {
          setRes(r);
          setReviewedKey(key);
          setStaleRefusal(null);
          if (!prep.details && r.values) {
            setPrep((current) => current.details ? current : { ...current, details: r.values });
          }
          if (!feeDefaulted) {
            setFeeDefaulted(true);
            const savedFee = r.savedPrices?.reservationMode === "required" ? r.savedPrices.reservationAmount : null;
            if (savedFee != null) {
              setPrep((current) => current.reservation.mode === "not_required" && current.reservation.amount == null
                ? { ...current, reservation: { mode: "required", amount: savedFee } } : current);
            } else {
              const fee = r.reservationFeeAuto;
              if (fee?.enabled && fee.amount > 0) {
                setPrep((current) => current.reservation.mode === "not_required" && current.reservation.amount == null
                  ? { ...current, reservation: { mode: "required", amount: fee.amount } } : current);
              }
            }
          }
        }
      } catch (e: any) {
        if (!stale) toast.error(e?.message ?? "Could not build the agreement");
      } finally { if (!stale) setRendering(false); }
    }, 600);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, applicationId, regen]);

  useEffect(() => {
    if (pricesRestored || !driversPrefilled || !res?.savedPrices) return;
    const saved = res.savedPrices;
    setPricesRestored(true);
    setPrep((current) => {
      const list = current.drivers.list.map((d) => {
        if (d.weeklyFee != null || !d.name.trim()) return d;
        const match = saved.drivers.find((row) => row.name.trim().toLowerCase() === d.name.trim().toLowerCase());
        return match ? { ...d, weeklyFee: match.weeklyFee } : d;
      });
      return {
        ...current,
        drivers: { ...current.drivers, list },
        damageWaiver: current.damageWaiver ?? saved.damageWaiver,
        damageWaiverFee: current.damageWaiverFee ?? saved.damageWaiverFee,
        priceNote: current.priceNote || saved.priceNote || undefined,
      };
    });
  }, [pricesRestored, driversPrefilled, res?.savedPrices]);

  const m = res?.merge ?? {};
  const terms = res?.terms ?? {};
  const defaults = res?.priceDefaults;
  const upToDate = reviewedKey === key && !rendering;
  const needsAck = (res?.companyMissing?.length ?? 0) > 0 && !companyAck;
  // Home Address is required before Send (the server refuses it too).
  const homeMissing = missingHomeAddressParts(prep.details ?? res?.values ?? {});
  const canSend = !!res?.fingerprint && res.canSend && upToDate && !needsAck && !busy && homeMissing.length === 0;
  const byField = (f: string) => (res?.blockers ?? []).filter((b) => b.field === f).length;
  // v1.14 (Insurance Included) prints these; earlier templates never show the section.
  const usesV114 = (res?.templateFields ?? []).some((f) => ["damage_waiver", "payment_amount", "payment_method", "balance_due", "vehicle_owner"].includes(f));

  const setDriver = (i: number, patch: Partial<AdditionalDriver>) =>
    setPrep((p) => ({ ...p, drivers: { ...p.drivers, list: p.drivers.list.map((d, j) => (j === i ? { ...d, ...patch } : d)) } }));

  const values = prep.details ?? res?.values ?? null;
  const live = values && prep.damageWaiver && prep.payment?.schedule
    ? paymentRows(prep, {
        weeklyRate: Number(values.weeklyRate) > 0 ? Number(values.weeklyRate) : null,
        waiverFee: prep.damageWaiverFee ?? parseUsd(terms.damage_waiver_fee),
        additionalDriverWeeklyFee: defaults?.driverFee ?? parseUsd(terms.fee_additional_driver) ?? 100,
        catalogWeeklyRate: defaults?.weeklyRent ?? null,
        defaults: defaults ? { weekly: defaults.weeklyRent, driverFee: defaults.driverFee, waiver: defaults.damageWaiver, reservation: defaults.reservationFee } : undefined,
      })
    : null;
  const weeklyEdited = !!(defaults?.weeklyRent != null && values && values.weeklyRate.trim() !== "" && Number(values.weeklyRate) !== defaults.weeklyRent);
  const driverEdited = prep.drivers.list.some((d) => d.weeklyFee != null && d.weeklyFee !== (defaults?.driverFee ?? 100));
  const waiverEdited = prep.damageWaiver === "accepted" && prep.damageWaiverFee != null && prep.damageWaiverFee !== defaults?.damageWaiver;
  const reservationEdited = prep.reservation.mode === "required" && prep.reservation.amount != null && prep.reservation.amount !== (defaults?.reservationFee ?? 50);
  const priceEdited = weeklyEdited || driverEdited || waiverEdited || reservationEdited || (prep.priceNote ?? "").trim().length > 0;
  const updateDetails = (patch: Partial<AgreementDetails>) => {
    if (!values) return;
    setPrep((current) => ({ ...current, details: { ...(current.details ?? values), ...patch } }));
  };

  async function readAgreement() {
    if (agreementReading || !values) return;
    setAgreementReadAttempted(true);
    setAgreementReading(true);
    try {
      const result = await doReadAgreement({ data: { applicationId } });
      let added = 0;
      setPrep((current) => {
        const base = current.details ?? values;
        const next = fillBlankAgreementDetails(base, result.details);
        added = Object.keys(next).filter((key) => next[key as keyof AgreementDetails] !== base[key as keyof AgreementDetails]).length;
        return { ...current, details: next };
      });
      if (added > 0) toast.success(`${added} Written Agreement ${added === 1 ? "Detail" : "Details"} Added — Review Before Saving`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not read the written agreement. Enter the details manually.");
    } finally {
      setAgreementReading(false);
    }
  }

  async function readLicense(manual: boolean) {
    if (licenseReading || !values) return;
    setLicenseReadAttempted(true);
    setLicenseReading(true);
    try {
      const result = await doReadLicense({ data: { applicationId } });
      let added = 0;
      setPrep((current) => {
        const base = current.details ?? values;
        const next = fillBlankAgreementDetails(base, result.details);
        added = Object.keys(next).filter((key) => next[key as keyof AgreementDetails] !== base[key as keyof AgreementDetails]).length;
        return { ...current, details: next };
      });
      if (manual || added > 0) {
        toast.success(added ? `${added} License ${added === 1 ? "Detail" : "Details"} Added — Review Before Sending` : "No New License Details Found");
      }
    } catch (error: any) {
      if (manual) toast.error(error?.message ?? "Could not read the driver's license");
    } finally {
      setLicenseReading(false);
    }
  }

  useEffect(() => {
    if (!res?.values || agreementReadAttempted || agreementReading) return;
    const current = prep.details ?? res.values;
    if (Object.values(current).some((value) => !value.trim())) void readAgreement();
    else setAgreementReadAttempted(true);
    // One blank-only read per dialog opening; staff corrections always win.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res?.values, agreementReadAttempted]);

  useEffect(() => {
    if (!res?.values || licenseReadAttempted || licenseReading) return;
    const current = prep.details ?? res.values;
    const needsLicenseRead = [current.address, current.city, current.state, current.zip, current.dob, current.licenseNumber, current.licenseState, current.licenseExpiration]
      .some((value) => !value.trim());
    if (needsLicenseRead) void readLicense(false);
    else setLicenseReadAttempted(true);
    // One blank-only read per dialog opening; later edits are never overwritten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res?.values, licenseReadAttempted]);

  async function send() {
    if (!canSend || !res?.fingerprint) return;
    setBusy(true);
    try {
      const r = await doSend({ data: { applicationId, fingerprint: res.fingerprint, companyAck: companyAck || undefined, prep, templateKey: (templateKey || undefined) as any } });
      onSent(r);
    } catch (e: any) {
      const msg = e?.message ?? "Could not send the agreement";
      if (/changed since it was previewed/.test(msg)) {
        // The reviewed preview is no longer what Send would deliver: block
        // Send until a fresh preview has been generated and looked at.
        setReviewedKey("");
        setStaleRefusal(msg);
      } else toast.error(msg);
    } finally { setBusy(false); }
  }

  function fix(b: Blocker) {
    const editableHere = new Set([
      "driver_name", "driver_email", "driver_phone", "driver_address", "driver_dob",
      "license_number", "license_state", "license_expiration", "license_plate",
      "vehicle_vin", "vehicle_color", "weekly_rate", "card_on_file",
      "insurance_carrier", "insurance_policy", "contract_start_date", "contract_end_date",
    ]);
    if (editableHere.has(b.field)) return null;
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
      {res && (res.notes?.length ?? 0) > 0 && (
        <div className="space-y-1 rounded-md border px-3 py-2 text-[12px] text-muted-foreground" data-testid="prep-notes">
          {res.notes!.map((n, i) => <p key={i}>{n.label}: {n.why}</p>)}
        </div>
      )}
      {res?.sendRefusal && <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px]">{res.sendRefusal}</p>}

      <Section title="Agreement Template">
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
          <input type="radio" className="mt-0.5" checked={templateKey === ""} onChange={() => chooseTemplate("")} />
          <span><span className="font-medium">Current Agreement In Use</span><br /><span className="text-muted-foreground">{templateKey === "" && res?.template?.label ? res.template.label : "The template Send uses today (Vehicle Rental Agreement v1.17, Insurance Included)."}</span></span>
        </label>
        {LIBRARY.filter((t) => !t.retired).map((t) => (
          <label key={t.key} className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
            <input type="radio" className="mt-0.5" checked={templateKey === t.key} onChange={() => chooseTemplate(t.key)} />
            <span className="min-w-0">
              <span className="font-medium">{t.name}</span> <span className="text-muted-foreground">v{t.displayVersion}</span><br />
              <span className="text-muted-foreground">{t.insuranceIncluded ? "Insurance Included" : t.insuranceRequired ? "Insurance Required" : "No Insurance Required"} · {acknowledgmentsOf(t.body).length} Initials</span><br />
              {OWNER_APPROVED_LIBRARY[t.key]
                ? <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10.5px] text-success">Owner Approved {OWNER_APPROVED_LIBRARY[t.key].at}</span>
                : <span className="text-warning-foreground rounded bg-warning/15 px-1.5 py-0.5 text-[10.5px]">{DRAFT_STATUS_LABEL} — Preview Only</span>}
            </span>
          </label>
        ))}
        <p className="text-[11px] text-muted-foreground">Only Owner-approved templates can be sent. Retired templates (v1.10 and v1.10.2) are not listed. Choosing a template does not establish insurance coverage or rental eligibility.</p>
      </Section>

      <Section title="Rental Details">
        <div data-testid="agreement-missing-fields">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">License autofill fills blanks only. Review every value against the original document.</p>
          <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[11px]" disabled={licenseReading || !values} onClick={() => void readLicense(true)}>
            {licenseReading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />}
            {licenseReading ? "Reading…" : "Read License"}
          </Button>
        </div>
        {values ? (
          <div className="space-y-4">
            <div>
              <p className="mb-2 font-medium">Driver</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2">Full Name<input className={input} value={values.driverName} onChange={(e) => updateDetails({ driverName: e.target.value })} /></label>
                <label>Email<input type="email" className={input} value={values.driverEmail} onChange={(e) => updateDetails({ driverEmail: e.target.value })} /></label>
                <label>Phone<PhoneInput className={input} value={values.driverPhone} onValueChange={(driverPhone) => updateDetails({ driverPhone })} /></label>
                <label className="col-span-2">Home Street Address <span className="text-destructive">*</span><input required aria-required="true" aria-invalid={homeMissing.includes("Street")} className={input} value={values.address} onChange={(e) => updateDetails({ address: e.target.value })} /></label>
                <label>City <span className="text-destructive">*</span><input required aria-required="true" aria-invalid={homeMissing.includes("City")} className={input} value={values.city} onChange={(e) => updateDetails({ city: e.target.value })} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label>State <span className="text-destructive">*</span><input required aria-required="true" aria-invalid={homeMissing.includes("State")} className={input} value={values.state} onChange={(e) => updateDetails({ state: e.target.value.toUpperCase() })} /></label>
                  <label>ZIP <span className="text-destructive">*</span><input required aria-required="true" aria-invalid={homeMissing.includes("ZIP")} className={input} value={values.zip} onChange={(e) => updateDetails({ zip: e.target.value })} /></label>
                </div>
                {homeMissing.length > 0 && (
                  <p className="col-span-2 text-[11px] text-destructive" data-testid="home-address-required">{HOME_ADDRESS_LABEL} Is Required Before Sending. Missing: {homeMissing.join(", ")}. It is the renter's address for legal notices.</p>
                )}
                <label>Date Of Birth<input type="date" className={input} value={values.dob} onChange={(e) => updateDetails({ dob: e.target.value })} /></label>
                <label>License Number<input className={input} value={values.licenseNumber} onChange={(e) => updateDetails({ licenseNumber: e.target.value })} /></label>
                <label>Issuing State<input maxLength={2} className={input} value={values.licenseState} onChange={(e) => updateDetails({ licenseState: e.target.value.toUpperCase() })} /></label>
                <label>License Expiration<input type="date" className={input} value={values.licenseExpiration} onChange={(e) => updateDetails({ licenseExpiration: e.target.value })} /></label>
              </div>
            </div>

            <div>
              <p className="mb-2 font-medium">Vehicle</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2">Description<input className={input} value={values.vehicleDescription} onChange={(e) => updateDetails({ vehicleDescription: e.target.value })} /></label>
                <label>Color<input className={input} value={values.vehicleColor} onChange={(e) => updateDetails({ vehicleColor: e.target.value })} /></label>
                <label>Plate<input className={input} value={values.licensePlate} onChange={(e) => updateDetails({ licensePlate: e.target.value.toUpperCase() })} /></label>
                <label className="col-span-2">VIN<input maxLength={17} className={`${input} font-mono`} value={values.vehicleVin} onChange={(e) => updateDetails({ vehicleVin: e.target.value.toUpperCase() })} /></label>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-medium">Rental</p>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={!values.startDate} onClick={() => updateDetails({ endDate: defaultRentalEndIso(values.startDate) ?? "" })}>Reset 4 Weeks</Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label>Start Date<input type="date" className={input} value={values.startDate} onChange={(e) => updateDetails({ startDate: e.target.value, endDate: defaultRentalEndIso(e.target.value) ?? "" })} /></label>
                <label>End Date<input type="date" min={defaultRentalEndIso(values.startDate) ?? undefined} className={input} value={values.endDate} onChange={(e) => updateDetails({ endDate: e.target.value })} /></label>
                <label className="col-span-2">Weekly Rent ($)
                  <span className="mb-1 flex items-center gap-2">
                    {defaults?.weeklyRent != null && values.weeklyRate.trim() !== "" && Number(values.weeklyRate) !== defaults.weeklyRent ? <EditedTag /> : null}
                    {defaults?.weeklyRent != null ? <button type="button" className="text-[11px] font-medium text-[#111114] underline" onClick={() => updateDetails({ weeklyRate: String(defaults.weeklyRent) })}>Reset To Default</button> : null}
                  </span>
                  <input type="number" min={0} step="0.01" aria-label="Weekly Rent" className={input} value={values.weeklyRate} onChange={(e) => updateDetails({ weeklyRate: e.target.value })} />
                </label>
                <label>Payment Method<input className={input} value={values.cardOnFile} onChange={(e) => updateDetails({ cardOnFile: e.target.value })} /></label>
                <label>Insurance Carrier<input className={input} value={values.insuranceCarrier} onChange={(e) => updateDetails({ insuranceCarrier: e.target.value })} /></label>
                <label>Policy Number<input className={input} value={values.insurancePolicy} onChange={(e) => updateDetails({ insurancePolicy: e.target.value })} /></label>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Four-week minimum. Changing Start presets End to four weeks later; staff can choose a later date. Minimum Term: {terms.min_term_weeks ? `${terms.min_term_weeks} weeks — ends ${m.min_term_end || "Not Set"}` : "Not Set"}.</p>
            </div>

            <dl className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t pt-3">
              {row("Agreement Number", m.agreement_number)}{row("Template", res?.template.label)}
            </dl>
          </div>
        ) : <p className="text-muted-foreground">Loading Details…</p>}
        <p className="text-[11px] text-muted-foreground">Blank or invalid driver and vehicle fields are saved to the records when you send. A correction of a value already on file stays on this agreement only. The vehicle description, payment method and fleet rate are not written back. Preparing an agreement never charges the card.</p>
        </div>
      </Section>

      <Section title="Authorized Drivers" badge={byField("additional_drivers")}>
        <Radio checked={prep.drivers.mode === "none"} onChange={() => setPrep((p) => ({ ...p, drivers: { mode: "none", list: [] } }))} label="No Additional Drivers (Prints None Authorized)" />
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
            <label className="block">Additional Driver Fee ($ Per Week)
              <span className="mb-1 flex items-center gap-2">
                {d.weeklyFee != null && d.weeklyFee !== (defaults?.driverFee ?? 100) ? <EditedTag /> : null}
                <button type="button" className="text-[11px] font-medium text-[#111114] underline" onClick={() => setDriver(i, { weeklyFee: null })}>Reset To Default</button>
              </span>
              <input type="number" min={0} step="0.01" aria-label={`Additional Driver Fee ${i + 1}`} className={input} value={d.weeklyFee ?? ""} placeholder={String(defaults?.driverFee ?? 100)} onChange={(e) => setDriver(i, { weeklyFee: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
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
            <label className="block">Reservation Fee ($)
              <span className="mb-1 flex items-center gap-2">
                {prep.reservation.amount != null && prep.reservation.amount !== (defaults?.reservationFee ?? 50) ? <EditedTag /> : null}
                <button type="button" className="text-[11px] font-medium text-[#111114] underline" onClick={() => setPrep((p) => ({ ...p, reservation: { mode: "required", amount: defaults?.reservationFee ?? 50 } }))}>Reset To Default</button>
              </span>
              <input type="number" min={0} step="0.01" aria-label="Reservation Fee" className={input} value={prep.reservation.amount ?? ""} onChange={(e) => setPrep((p) => ({ ...p, reservation: { mode: "required", amount: e.target.value === "" ? null : Number(e.target.value) } }))} />
            </label>
            {usesV114
              ? <p className="text-[11px] text-muted-foreground">Terms (Section 4): due when the renter signs and applied in full to the first payment. Refunded in full if we cannot set up the Renter Policy, cannot provide a vehicle (or a similar one within 1–2 days), fail pickup inspection without a swap, change confirmed terms the renter declines, deny them after a check we run after they pay, or charged the fee in error. Not refunded for a no-show, a change of mind, a missed pickup without notice, or false or mismatched information. It is not a security deposit.</p>
              : <p className="text-[11px] text-muted-foreground">Terms (Section 2): due when pickup or delivery is scheduled and applied in full to the first week. Refunded in full if we cannot set up the Renter Policy, cannot provide a vehicle, fail pickup inspection without a swap, change confirmed terms the renter declines, deny them after a check we run after they pay, or charged the fee in error. Not refunded for a no-show, a change of mind, a missed pickup without notice, or false or mismatched information. It is not a security deposit.</p>}
          </>
        )}
      </Section>

      {usesV114 && (
        <Section title="Payment & Damage Waiver" badge={byField("damage_waiver") + byField("payment_method") + byField("payment_amount") + byField("vehicle_owner")}>
          <p className="font-medium">Optional Damage Waiver{terms.damage_waiver_fee ? ` (${terms.damage_waiver_fee} Per Week)` : ""}</p>
          <Radio checked={prep.damageWaiver === "accepted"} onChange={() => setPrep((p) => ({ ...p, damageWaiver: "accepted" }))} label="Accepted By Renter" />
          <Radio checked={prep.damageWaiver === "declined"} onChange={() => setPrep((p) => ({ ...p, damageWaiver: "declined" }))} label="Declined By Renter" />
          {prep.damageWaiver === "accepted" ? (
            <label className="block">Damage Waiver ($ Per Week)
              <span className="mb-1 flex items-center gap-2">
                {prep.damageWaiverFee != null && prep.damageWaiverFee !== defaults?.damageWaiver ? <EditedTag /> : null}
                <button type="button" className="text-[11px] font-medium text-[#111114] underline" onClick={() => setPrep((p) => ({ ...p, damageWaiverFee: null }))}>Reset To Default</button>
              </span>
              <input type="number" min={0} step="0.01" aria-label="Damage Waiver" className={input} value={prep.damageWaiverFee ?? ""} placeholder={defaults?.damageWaiver != null ? String(defaults.damageWaiver) : ""} onChange={(e) => setPrep((p) => ({ ...p, damageWaiverFee: e.target.value === "" ? null : Number(e.target.value) }))} />
            </label>
          ) : null}
          <p className="text-[11px] text-muted-foreground">Ask the renter before sending. The agreement prints the choice and the renter initials it when signing. $0 is allowed.</p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label>Payment Schedule
              <AppSelect aria-label="Payment Schedule" className={input} value={prep.payment?.schedule ?? ""} onChange={(e) => setPrep((p) => ({ ...p, payment: { schedule: (e.target.value || null) as any, method: p.payment?.method ?? null } }))}>
                <option value="">Choose…</option>
                {PAYMENT_SCHEDULES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </AppSelect>
            </label>
            <label>Payment Method
              <AppSelect aria-label="Payment Method" className={input} value={prep.payment?.method ?? ""} onChange={(e) => setPrep((p) => ({ ...p, payment: { schedule: p.payment?.schedule ?? null, method: (e.target.value || null) as any } }))}>
                <option value="">Choose…</option>
                {PAYMENT_METHODS.map((o) => <option key={o} value={o}>{o}</option>)}
              </AppSelect>
            </label>
            <label className="col-span-2">Vehicle Owner (As Shown On The Registration)
              <input className={input} value={prep.vehicleOwner ?? ""} onChange={(e) => setPrep((p) => ({ ...p, vehicleOwner: e.target.value }))} />
            </label>
          </div>
          <dl className="grid grid-cols-[minmax(0,50%)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t pt-2">
            {row("Weekly Rent", live?.billing ? `$${live.billing.baseRent.toFixed(2)}` : m.weekly_rate)}
            {row("Reservation Fee", prep.reservation.mode === "required" && prep.reservation.amount != null ? `$${prep.reservation.amount.toFixed(2)}` : "None")}
            {row("Amount Due Each Payment", live?.payment_amount || m.payment_amount)}
            {row("Balance Due At Pickup", live?.balance_due || m.balance_due)}
          </dl>
          {priceEdited || (live?.blockers ?? []).some((b) => b.field === "price_note") ? (
            <label className="block">Price Change Note (Not Printed)
              <input aria-label="Price Change Note" className={input} value={prep.priceNote ?? ""} onChange={(e) => setPrep((p) => ({ ...p, priceNote: e.target.value }))} />
            </label>
          ) : null}
          {m._driver_fee_note ? <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950" role="status">{m._driver_fee_note}</p> : null}
          <p className="text-[11px] text-muted-foreground">Balance Due At Pickup is the first payment less the Reservation Fee. Amount Due Each Payment includes the Weekly Rate, each approved Additional Driver, and the Damage Waiver when it is accepted.</p>
        </Section>
      )}

      <Section title="Security Deposit" badge={byField("deposit_amount")}>
        <Radio checked={prep.deposit.mode === "none"} onChange={() => setPrep((p) => ({ ...p, deposit: { mode: "none", amount: null, reason: "" } }))} label="No Deposit" />
        <Radio checked={prep.deposit.mode === "required"} onChange={() => setPrep((p) => ({ ...p, deposit: { mode: "required", amount: p.deposit.amount, reason: "" } }))} label="Deposit Required" />
        <Radio checked={prep.deposit.mode === "waived"} onChange={() => setPrep((p) => ({ ...p, deposit: { mode: "waived", amount: null, reason: p.deposit.reason } }))} label="Deposit Waived" />
        {prep.deposit.mode === "required" && <label className="block">Amount ($)<input type="number" min={0} step="0.01" className={input} value={prep.deposit.amount ?? ""} onChange={(e) => setPrep((p) => ({ ...p, deposit: { ...p.deposit, amount: e.target.value === "" ? null : Number(e.target.value) } }))} /></label>}
        {prep.deposit.mode === "waived" && <label className="block">Reason (Internal, Not Printed)<input className={input} value={prep.deposit.reason} onChange={(e) => setPrep((p) => ({ ...p, deposit: { ...p.deposit, reason: e.target.value } }))} /></label>}
        <p className="text-[11px] text-muted-foreground">No Deposit and Deposit Waived keep the approved no-deposit wording. Deposit Required needs an Owner-approved template with deposit wording.</p>
      </Section>

      <Section title="Fees & Restrictions" open={false}>
        <dl className="grid grid-cols-[minmax(0,50%)_minmax(0,1fr)] gap-x-3 gap-y-1">
          {row("Late Payment", terms.fee_late_payment)}{row("Late Return", terms.fee_late_return)}{row("Smoking / Odor", terms.fee_smoking)}
          {terms.fee_citation_admin ? row("Citation Admin Fee", terms.fee_citation_admin) : row("Toll Processing Fee", terms.processing_fee)}{row("Service Area", terms.service_area)}{row("Termination Notice", terms.notice_hours ? `${terms.notice_hours} hours` : "")}
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
            <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={companyAck} onChange={(e) => setCompanyAck(e.target.checked)} /> Send With Incomplete Company Details</label>
          )}
          <Button size="sm" disabled={!canSend} onClick={send} title={canSend ? undefined : homeMissing.length ? `${HOME_ADDRESS_LABEL} Is Required Before Sending` : "Resolve every item listed and wait for the preview to finish updating"}>
            <Send className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send For Signature"}
          </Button>
        </div>
      </header>
      {staleRefusal && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-warning/40 bg-warning/10 px-3 py-2 text-[12px] sm:flex-row sm:items-center" role="alert" data-testid="stale-preview-refusal">
          <p className="min-w-0 flex-1">{staleRefusal}</p>
          <Button size="sm" variant="outline" disabled={rendering} onClick={() => setRegen((n) => n + 1)}>
            {rendering ? "Regenerating…" : "Regenerate Preview"}
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row" data-testid="prepare-layout">
        <aside className="w-full overflow-y-auto bg-muted/20 md:w-[35%] md:border-r">{details}</aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2 text-[12px]">
            <span className={`rounded ${DANGER_BADGE} px-2 py-0.5 font-semibold`}>PREVIEW — NOT SENT</span>
            {rendering && <span className="text-muted-foreground">Updating…</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/40" data-testid="prep-preview">
            {res?.pdfBase64 ? <AgreementPdfViewer key={res.fingerprint ?? ""} base64={res.pdfBase64} /> :
              res?.body ? <pre className="whitespace-pre-wrap p-6 font-serif text-[13px] leading-relaxed text-foreground">{layoutToText(res.body)}</pre> :
              <p className="p-6 text-[12px] text-muted-foreground">{res ? "The document appears once every item on the left is resolved — blanks never reach a signature." : "Building the agreement…"}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export default PrepareAgreementDialog;
