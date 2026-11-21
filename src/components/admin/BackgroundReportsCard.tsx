import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Plus, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileUploader } from "@/components/FileUploader";
import { SectionCard } from "./ui";
import { useDriverDocumentUpload } from "./use-driver-document-upload";
import { listDriverBackgroundReports, saveDriverBackgroundReport } from "@/lib/background-report.functions";
import {
  BACKGROUND_PROVIDERS,
  BACKGROUND_REPORT_TYPES,
  CRIMINAL_RESULTS,
  DEFAULT_REPORT_TYPE,
  LICENSE_STATUSES,
  MAX_FILES_PER_REPORT,
  PROVIDER_LABELS,
  REPORT_TYPE_LABELS,
  cleanReference,
  criminalRecordLabel,
  identityResultLabel,
  licenseStatusLabel,
  normalizeOrderId,
  parseCaseLines,
  parseReportRef,
  parseRentidReportText,
  reportPageUrl,
  reportTitle,
  reportTone,
  type BackgroundProvider,
  type BackgroundReportType,
  type BackgroundReportWithFiles,
  type CriminalResult,
  type LicenseStatus,
} from "@/lib/background-report";
import { fmtDateTime } from "@/lib/date-format";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";
const small =
  "inline-flex h-7 items-center justify-center gap-1 rounded-md border border-[#D6D6DB] bg-white px-2.5 text-[12px] font-medium text-[#111114] hover:bg-[#FAFAFB]";
const TONE: Record<string, string> = {
  red: "bg-[#FDECEA] text-[#B42318]",
  yellow: "bg-[#FEF6E7] text-[#B54708]",
  green: "bg-[#E9F7EF] text-[#067647]",
  gray: "bg-[#F2F2F5] text-[#55555E]",
};
const CRIMINAL_OPTIONS: Record<CriminalResult, string> = { not_detected: "Not Detected", detected: "Detected", unavailable: "Not Available" };
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif";
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Screening tab: Background Reports (Dolmar, t582u / t592u). Background
 * screenings, DMV license checks and other checks, each with any number of
 * files (team only). FLEET can file them too when its switch is on. A record,
 * not a decision: nothing here approves, verifies or declines anyone, and no
 * license or background status changes.
 */
export function BackgroundReportsCard({ applicationId, canAdd }: { applicationId: string; canAdd: boolean }) {
  const list = useServerFn(listDriverBackgroundReports);
  const [state, setState] = useState<{ loading: boolean; installed: boolean; reports: BackgroundReportWithFiles[]; error: string | null }>({ loading: true, installed: true, reports: [], error: null });
  const [dialog, setDialog] = useState<{ report: BackgroundReportWithFiles | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await list({ data: { applicationId } });
      setState({ loading: false, installed: r.installed, reports: r.reports, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Could Not Load Background Reports." }));
    }
  }, [applicationId, list]);
  useEffect(() => { void load(); }, [load]);

  return (
    <SectionCard
      title="Background Reports"
      subtitle="Background Screenings, DMV License Checks And Other Checks. A Record, Not A Decision."
      icon={<ShieldCheck className="h-4 w-4" />}
      right={canAdd && state.installed ? (
        <button type="button" className={secondary} onClick={() => setDialog({ report: null })} data-testid="add-background-report">
          <Plus className="h-3.5 w-3.5" /> Add Background Report
        </button>
      ) : null}
    >
      {state.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : state.error ? (
        <div className="text-sm text-[#B42318]">{state.error}</div>
      ) : !state.installed ? (
        <div className="text-sm text-muted-foreground">Background Reports Are Not Turned On Yet. Report Files Can Still Go Under Documents → Screening.</div>
      ) : state.reports.length === 0 ? (
        <div className="text-sm text-muted-foreground">No Background Report On File.</div>
      ) : (
        <div className="space-y-4" data-testid="background-reports">
          {state.reports.map((r) => <ReportRow key={r.id} r={r} onAddFiles={canAdd ? () => setDialog({ report: r }) : undefined} />)}
        </div>
      )}
      {dialog ? <ReportDialog applicationId={applicationId} existing={dialog.report} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load(); }} /> : null}
    </SectionCard>
  );
}

function ReportRow({ r, onAddFiles }: { r: BackgroundReportWithFiles; onAddFiles?: () => void }) {
  const tone = reportTone(r);
  const isDmv = r.report_type === "dmv_license_check";
  return (
    <div className="rounded-xl border border-[#EDEDF0] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-[#111114]">{reportTitle(r)}</span>
        {r.reference ? <span className="text-[12px] text-[#55555E]">Ref {r.reference}</span> : null}
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>{r.status === "ordered" ? "Ordered · No Result Yet" : "Reported"}</span>
        <span className="text-[11px] text-[#9A9AA3]">
          {r.checked_at ? `Checked ${fmtDateTime(r.checked_at)}` : r.ordered_at ? `Ordered ${fmtDateTime(r.ordered_at)}` : `Filed ${fmtDateTime(r.created_at)}`}
          {r.recorded_by_label ? ` · By ${r.recorded_by_label}` : ""}
        </span>
        {onAddFiles ? <button type="button" className={`${small} ml-auto`} onClick={onAddFiles}><Paperclip className="h-3 w-3" /> Add Files</button> : null}
      </div>
      {r.status === "reported" && (r.license_status || r.criminal_record || r.identity_result) ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
          {r.license_status || isDmv ? <div><dt className="text-[11px] text-[#9A9AA3]">License Status (As Reported)</dt><dd className="font-medium">{licenseStatusLabel(r.license_status)}{r.license_state ? ` (${r.license_state})` : ""}</dd></div> : null}
          {r.criminal_record ? <div><dt className="text-[11px] text-[#9A9AA3]">Criminal Record Check</dt><dd className="font-medium">{criminalRecordLabel(r.criminal_record, r.criminal_case_count)}</dd></div> : null}
          {r.identity_result ? <div><dt className="text-[11px] text-[#9A9AA3]">ID And Biometrics</dt><dd className="font-medium">{identityResultLabel(r.identity_result)}</dd></div> : null}
        </dl>
      ) : r.status === "ordered" && r.products.length ? (
        <div className="mt-2 text-[12px] text-[#55555E]">Ordered: {r.products.join(", ")}</div>
      ) : null}
      {r.criminal_cases.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-medium text-[#111114]">{r.criminal_cases.length} Distinct {r.criminal_cases.length === 1 ? "Case" : "Cases"}{r.criminal_case_count && r.criminal_case_count > r.criminal_cases.length ? ` (Report Lists ${r.criminal_case_count}; Duplicates From Two Sources Merged)` : ""}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[#9A9AA3]"><tr><th className="py-1 pr-3 font-medium">Offense Date</th><th className="py-1 pr-3 font-medium">Filed</th><th className="py-1 pr-3 font-medium">Charges</th><th className="py-1 pr-3 font-medium">Degree</th><th className="py-1 pr-3 font-medium">Disposition</th><th className="py-1 pr-3 font-medium">Court / County</th><th className="py-1 font-medium">Case #</th></tr></thead>
              <tbody>
                {r.criminal_cases.map((c, i) => (
                  <tr key={i} className="border-t border-[#F2F2F5]"><td className="py-1 pr-3">{c.date ?? ""}</td><td className="py-1 pr-3">{c.file_date ?? ""}</td><td className="py-1 pr-3">{c.offense ?? ""}</td><td className="py-1 pr-3">{c.level ?? ""}</td><td className="py-1 pr-3">{c.disposition ?? ""}</td><td className="py-1 pr-3">{c.jurisdiction ?? ""}</td><td className="py-1">{c.case_number ?? ""}{c.alt_case_numbers?.length ? <span className="block text-[11px] text-[#9A9AA3]">Also {c.alt_case_numbers.join(", ")}</span> : null}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : r.criminal_record === "detected" ? (
        <div className="mt-2 text-[12px] text-[#9A9AA3]">Case List Not Attached. See The Report Files Or The Source Report.</div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
        {r.files.length ? r.files.map((f) => f.url ? (
          <a key={f.document_id} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[#D03020] hover:underline"><FileText className="h-3.5 w-3.5" /> {f.name ?? "Report File"}</a>
        ) : <span key={f.document_id} className="text-[#9A9AA3]">{f.name ?? "Report File"} (Documents → Screening)</span>) : <span className="text-[#9A9AA3]">No Files Attached</span>}
        {r.report_ref ? <a href={reportPageUrl(r.report_ref)} target="_blank" rel="noreferrer" className="font-medium text-[#55555E] hover:underline">Open Source Report</a> : null}
        {r.note ? <span className="text-[#55555E]">Note: {r.note}</span> : null}
      </div>
    </div>
  );
}

function ReportDialog({ applicationId, existing, onClose, onSaved }: { applicationId: string; existing: BackgroundReportWithFiles | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const save = useServerFn(saveDriverBackgroundReport);
  const upload = useDriverDocumentUpload(applicationId, () => undefined);
  const addFilesOnly = Boolean(existing);
  const [provider, setProvider] = useState<BackgroundProvider>(existing?.provider ?? "rentid");
  const [providerName, setProviderName] = useState(existing?.provider_name ?? "");
  const [reportType, setReportType] = useState<BackgroundReportType>(existing?.report_type ?? "background_screening");
  const [files, setFiles] = useState<File[]>([]);
  const [paste, setPaste] = useState("");
  const [reference, setReference] = useState("");
  const [reportLink, setReportLink] = useState("");
  const [license, setLicense] = useState<LicenseStatus | "">("");
  const [licState, setLicState] = useState("");
  const [criminal, setCriminal] = useState<CriminalResult | "">("");
  const [count, setCount] = useState("");
  const [caseLines, setCaseLines] = useState("");
  const [checkedOn, setCheckedOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ index: number; pct: number } | null>(null);

  function chooseProvider(p: BackgroundProvider) {
    setProvider(p);
    setReportType(DEFAULT_REPORT_TYPE[p]);
    if (p !== "rentid") setReportLink("");
  }

  function fillFromPaste(text: string) {
    setPaste(text);
    const p = parseRentidReportText(text);
    if (provider === "rentid" && p.order_id && !reference) setReference(p.order_id);
    if (provider === "rentid" && p.report_ref && !reportLink) setReportLink(reportPageUrl(p.report_ref));
    if (p.license_status) setLicense(p.license_status);
    if (p.license_state) setLicState(p.license_state);
    if (p.criminal_record) setCriminal(p.criminal_record);
    if (p.criminal_case_count != null) setCount(String(p.criminal_case_count));
  }

  const isRentid = provider === "rentid";
  const isDmv = reportType === "dmv_license_check";
  const ref = isRentid && reportLink.trim() ? parseReportRef(reportLink) : null;
  const refValue = isRentid
    ? normalizeOrderId(reference) ?? (reference.trim() === "" && ref ? ref.order : null)
    : cleanReference(reference);
  const cases = parseCaseLines(caseLines);
  const countNum = count.trim() === "" ? null : Number(count);
  const blockers: string[] = [];
  if (addFilesOnly) {
    if (!files.length) blockers.push("Add At Least One File.");
  } else {
    if (provider === "other" && !providerName.trim()) blockers.push("Name The Source.");
    if (isRentid && reference.trim() && !normalizeOrderId(reference)) blockers.push("Enter The Order Number (INV-… Or The 8-Character Order).");
    if (isRentid && !refValue && !files.length && !license && !criminal) blockers.push("Enter The Order Number, A File Or A Result.");
    if (!isRentid && refValue === undefined) blockers.push("Reference Must Be 60 Characters Or Fewer.");
    if (!isRentid && !files.length && !license && !criminal) blockers.push("Add A File Or Enter A Result.");
    if (reportLink.trim() && !ref) blockers.push("The Report Link Should Look Like rent-id.io/rentid/req_….");
    if (ref && refValue && ref.order !== String(refValue).replace(/^INV-/, "")) blockers.push(`The Report Link Is For Order ${ref.order}.`);
    if (countNum != null && (!Number.isInteger(countNum) || countNum < 0 || countNum > 999)) blockers.push("Case Count Must Be 0–999.");
    if (criminal === "not_detected" && ((countNum ?? 0) > 0 || cases.length)) blockers.push("Not Detected Can't Have Cases.");
  }

  async function submit() {
    if (blockers.length) return;
    setBusy(true);
    try {
      const documentIds: string[] = [];
      const label = `Background Report${(existing?.reference ?? refValue) ? ` ${existing?.reference ?? refValue}` : ""}`;
      for (const [index, file] of files.entries()) {
        const id = await upload("screening", file, (pct) => setProgress({ index, pct }), { label });
        if (!id) throw new Error(`File ${index + 1} Was Uploaded But Could Not Be Linked. It Is Under Documents → Screening.`);
        documentIds.push(id);
      }
      await save({ data: addFilesOnly ? {
        applicationId, reportId: existing!.id, provider: existing!.provider, documentIds, note: note.trim() || null,
      } : {
        applicationId, provider, providerName: provider === "other" ? providerName.trim() : null, reportType,
        reference: refValue || null, reportRef: ref ? ref.ref : null,
        licenseStatus: license || null, licenseState: licState.trim() ? licState.trim().toUpperCase() : null,
        criminalRecord: isDmv ? null : criminal || null, criminalCaseCount: isDmv ? null : countNum, criminalCases: isDmv ? [] : cases,
        checkedAt: checkedOn ? new Date(`${checkedOn}T12:00:00`).toISOString() : null,
        documentIds, note: note.trim() || null,
      } });
      toast.success(addFilesOnly ? "Files Added To The Background Report" : "Background Report Saved");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save The Background Report.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader><DialogTitle>{addFilesOnly ? "Add Files To Background Report" : "Add Background Report"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-[12px] text-[#55555E]">{addFilesOnly ? reportTitle(existing!) : "A background screening, DMV license check or other check, with every file that goes with it."} Saving does not approve, verify or decline anyone, and no license or background status changes.</p>
          {!addFilesOnly ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="text-[12px] font-medium">Source</span>
                <select className={input} value={provider} onChange={(e) => chooseProvider(e.target.value as BackgroundProvider)} data-testid="background-provider">
                  {BACKGROUND_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
                </select>
              </label>
              <label className="block"><span className="text-[12px] font-medium">Report Type</span>
                <select className={input} value={reportType} onChange={(e) => setReportType(e.target.value as BackgroundReportType)}>
                  {BACKGROUND_REPORT_TYPES.map((t) => <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>)}
                </select>
              </label>
              {provider === "other" ? (
                <label className="block sm:col-span-2"><span className="text-[12px] font-medium">Source Name</span>
                  <input className={input} value={providerName} maxLength={80} onChange={(e) => setProviderName(e.target.value)} />
                </label>
              ) : null}
            </div>
          ) : null}
          <FileUploader
            value={files}
            onChange={setFiles}
            accept={ACCEPT}
            multiple
            maxFiles={MAX_FILES_PER_REPORT}
            maxBytes={MAX_BYTES}
            disabled={busy}
            busy={busy}
            title="Drop Report Files Here"
            hint="PDF Certificates Or Screenshots, Several At Once. Team Only; Drivers Never See These."
          />
          {progress ? <div className="text-[12px] text-[#55555E]">Uploading File {progress.index + 1} Of {files.length} · {progress.pct}%</div> : null}
          {!addFilesOnly ? (
            <>
              <label className="block"><span className="text-[12px] font-medium">Paste The Report Text (Optional, Fills The Fields)</span>
                <textarea className={`${input} h-20`} value={paste} onChange={(e) => fillFromPaste(e.target.value)} placeholder="Criminal Record Check: Detected (18 cases)" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="text-[12px] font-medium">{isRentid ? "Order Number" : "Reference (Optional)"}</span>
                  <input className={input} value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} placeholder={isRentid ? "INV-4H7F2YTY" : ""} data-testid="background-reference" />
                </label>
                <label className="block"><span className="text-[12px] font-medium">Checked On</span>
                  <input type="date" className={input} value={checkedOn} onChange={(e) => setCheckedOn(e.target.value)} />
                </label>
                {isRentid ? (
                  <label className="block sm:col-span-2"><span className="text-[12px] font-medium">Source Report Link (Optional)</span>
                    <input className={input} value={reportLink} onChange={(e) => setReportLink(e.target.value)} placeholder="https://rent-id.io/rentid/req_…" />
                  </label>
                ) : null}
                <label className="block"><span className="text-[12px] font-medium">License Status (As Reported, Optional)</span>
                  <select className={input} value={license} onChange={(e) => setLicense(e.target.value as LicenseStatus | "")}>
                    <option value="">Not Recorded</option>
                    {LICENSE_STATUSES.map((s) => <option key={s} value={s}>{licenseStatusLabel(s)}</option>)}
                  </select>
                </label>
                <label className="block"><span className="text-[12px] font-medium">License State</span>
                  <input className={input} value={licState} maxLength={2} onChange={(e) => setLicState(e.target.value)} placeholder="FL" />
                </label>
                {!isDmv ? (
                  <>
                    <label className="block"><span className="text-[12px] font-medium">Criminal Record Check</span>
                      <select className={input} value={criminal} onChange={(e) => setCriminal(e.target.value as CriminalResult | "")}>
                        <option value="">Not Recorded</option>
                        {CRIMINAL_RESULTS.map((s) => <option key={s} value={s}>{CRIMINAL_OPTIONS[s]}</option>)}
                      </select>
                    </label>
                    <label className="block"><span className="text-[12px] font-medium">Number Of Cases</span>
                      <input className={input} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ""))} placeholder="18" />
                    </label>
                  </>
                ) : null}
              </div>
              {!isDmv ? (
                <label className="block"><span className="text-[12px] font-medium">Cases (One Per Line, Optional)</span>
                  <textarea className={`${input} h-24 font-mono text-[12px]`} value={caseLines} onChange={(e) => setCaseLines(e.target.value)} placeholder="Offense Date | Charges | Degree | Disposition | Court / County | Case #" />
                  {cases.length ? <span className="text-[11px] text-[#9A9AA3]">{cases.length} Distinct {cases.length === 1 ? "Case" : "Cases"}</span> : null}
                </label>
              ) : null}
            </>
          ) : null}
          <label className="block"><span className="text-[12px] font-medium">Note (Optional)</span>
            <input className={input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          {blockers.length ? <ul className="text-[12px] text-[#B54708]">{blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}
        </div>
        <DialogFooter>
          <button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={primary} onClick={() => void submit()} disabled={busy || blockers.length > 0} data-testid="save-background-report">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : addFilesOnly ? "Add Files" : "Save Report"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
