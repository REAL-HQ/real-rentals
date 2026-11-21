import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, Loader2, ShieldCheck, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionCard } from "./ui";
import { useDriverDocumentUpload } from "./use-driver-document-upload";
import { attachRentidReport, listDriverRentidReports } from "@/lib/rentid-report.functions";
import type { RentidReportWithFile } from "@/lib/rentid-report";
import {
  RENTID_CRIMINAL_RESULTS,
  RENTID_LICENSE_STATUSES,
  criminalRecordLabel,
  identityResultLabel,
  licenseStatusLabel,
  normalizeOrderId,
  parseCaseLines,
  parseReportRef,
  parseRentidReportText,
  reportPageUrl,
  reportTone,
  type RentidCriminalResult,
  type RentidLicenseStatus,
} from "@/lib/rentid-report";
import { fmtDateTime } from "@/lib/date-format";

const input = "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm";
const primary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";
const TONE: Record<string, string> = {
  red: "bg-[#FDECEA] text-[#B42318]",
  yellow: "bg-[#FEF6E7] text-[#B54708]",
  green: "bg-[#E9F7EF] text-[#067647]",
  gray: "bg-[#F2F2F5] text-[#55555E]",
};
const CRIMINAL_OPTIONS: Record<RentidCriminalResult, string> = { not_detected: "Not Detected", detected: "Detected", unavailable: "Not Available" };

/**
 * Screening tab: RentID reports on file (Dolmar, t582u). Staff attach the
 * portal result (screenshot or PDF) with the order number and the summary;
 * FLEET can file them too when its switch is on. A record, not a decision:
 * nothing here approves, verifies or declines anyone.
 */
export function RentidReportsCard({ applicationId, canAttach }: { applicationId: string; canAttach: boolean }) {
  const list = useServerFn(listDriverRentidReports);
  const [state, setState] = useState<{ loading: boolean; installed: boolean; reports: RentidReportWithFile[]; error: string | null }>({ loading: true, installed: true, reports: [], error: null });
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await list({ data: { applicationId } });
      setState({ loading: false, installed: r.installed, reports: r.reports, error: null });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Could Not Load RentID Reports." }));
    }
  }, [applicationId, list]);
  useEffect(() => { void load(); }, [load]);

  return (
    <SectionCard
      title="RentID Reports"
      subtitle="License Status And Criminal Record Check From RentID. A Record, Not A Decision."
      icon={<ShieldCheck className="h-4 w-4" />}
      right={canAttach && state.installed ? (
        <button type="button" className={secondary} onClick={() => setOpen(true)} data-testid="attach-rentid-report">
          <Upload className="h-3.5 w-3.5" /> Attach RentID Report
        </button>
      ) : null}
    >
      {state.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : state.error ? (
        <div className="text-sm text-[#B42318]">{state.error}</div>
      ) : !state.installed ? (
        <div className="text-sm text-muted-foreground">RentID Reports Are Not Turned On Yet. The Report Screenshot Can Still Go Under Documents → Screening.</div>
      ) : state.reports.length === 0 ? (
        <div className="text-sm text-muted-foreground">No RentID Report On File.</div>
      ) : (
        <div className="space-y-4" data-testid="rentid-reports">
          {state.reports.map((r) => <ReportRow key={r.id} r={r} />)}
        </div>
      )}
      {open ? <AttachDialog applicationId={applicationId} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await load(); }} /> : null}
    </SectionCard>
  );
}

function ReportRow({ r }: { r: RentidReportWithFile }) {
  const tone = reportTone(r);
  return (
    <div className="rounded-xl border border-[#EDEDF0] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-[#111114]">Order {r.order_id}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>{r.status === "ordered" ? "Ordered · No Result Yet" : "Reported"}</span>
        <span className="text-[11px] text-[#9A9AA3]">
          {r.checked_at ? `Checked ${fmtDateTime(r.checked_at)}` : r.ordered_at ? `Ordered ${fmtDateTime(r.ordered_at)}` : `Filed ${fmtDateTime(r.created_at)}`}
          {r.recorded_by_label ? ` · By ${r.recorded_by_label}` : ""}
        </span>
      </div>
      {r.status === "reported" ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
          <div><dt className="text-[11px] text-[#9A9AA3]">Driver's License Status</dt><dd className="font-medium">{licenseStatusLabel(r.license_status)}{r.license_state ? ` (${r.license_state})` : ""}</dd></div>
          <div><dt className="text-[11px] text-[#9A9AA3]">Criminal Record Check</dt><dd className="font-medium">{criminalRecordLabel(r.criminal_record, r.criminal_case_count)}</dd></div>
          {r.identity_result ? <div><dt className="text-[11px] text-[#9A9AA3]">ID And Biometrics</dt><dd className="font-medium">{identityResultLabel(r.identity_result)}</dd></div> : null}
        </dl>
      ) : r.products.length ? (
        <div className="mt-2 text-[12px] text-[#55555E]">Ordered: {r.products.join(", ")}</div>
      ) : null}
      {r.criminal_cases.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-medium text-[#111114]">{r.criminal_cases.length} Distinct {r.criminal_cases.length === 1 ? "Case" : "Cases"}{r.criminal_case_count && r.criminal_case_count > r.criminal_cases.length ? ` (RentID Lists ${r.criminal_case_count}; Duplicates From Two Sources Merged)` : ""}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[#9A9AA3]"><tr><th className="py-1 pr-3 font-medium">Offense Date</th><th className="py-1 pr-3 font-medium">Filed</th><th className="py-1 pr-3 font-medium">Offense</th><th className="py-1 pr-3 font-medium">Level</th><th className="py-1 pr-3 font-medium">Disposition</th><th className="py-1 pr-3 font-medium">County / Court</th><th className="py-1 font-medium">Case #</th></tr></thead>
              <tbody>
                {r.criminal_cases.map((c, i) => (
                  <tr key={i} className="border-t border-[#F2F2F5]"><td className="py-1 pr-3">{c.date ?? ""}</td><td className="py-1 pr-3">{c.file_date ?? ""}</td><td className="py-1 pr-3">{c.offense ?? ""}</td><td className="py-1 pr-3">{c.level ?? ""}</td><td className="py-1 pr-3">{c.disposition ?? ""}</td><td className="py-1 pr-3">{c.jurisdiction ?? ""}</td><td className="py-1">{c.case_number ?? ""}{c.alt_case_numbers?.length ? <span className="block text-[11px] text-[#9A9AA3]">Also {c.alt_case_numbers.join(", ")}</span> : null}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : r.criminal_record === "detected" ? (
        <div className="mt-2 text-[12px] text-[#9A9AA3]">Case List Not Attached. Open The Order In RentID To See Each Case.</div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
        {r.file?.url ? (
          <a href={r.file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[#D03020] hover:underline"><FileText className="h-3.5 w-3.5" /> View Report File</a>
        ) : r.document_id ? <span className="text-[#9A9AA3]">Report File Under Documents → Screening</span> : <span className="text-[#9A9AA3]">No Report File Attached</span>}
        {r.report_ref ? (
          <a href={reportPageUrl(r.report_ref)} target="_blank" rel="noreferrer" className="font-medium text-[#55555E] hover:underline">Open In RentID</a>
        ) : null}
        {r.note ? <span className="text-[#55555E]">Note: {r.note}</span> : null}
      </div>
    </div>
  );
}

function AttachDialog({ applicationId, onClose, onSaved }: { applicationId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const attach = useServerFn(attachRentidReport);
  const upload = useDriverDocumentUpload(applicationId, () => undefined);
  const [paste, setPaste] = useState("");
  const [orderId, setOrderId] = useState("");
  const [reportLink, setReportLink] = useState("");
  const [license, setLicense] = useState<RentidLicenseStatus | "">("");
  const [state, setStateCode] = useState("");
  const [criminal, setCriminal] = useState<RentidCriminalResult | "">("");
  const [count, setCount] = useState("");
  const [caseLines, setCaseLines] = useState("");
  const [checkedOn, setCheckedOn] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  function fillFromPaste(text: string) {
    setPaste(text);
    const p = parseRentidReportText(text);
    if (p.order_id && !orderId) setOrderId(p.order_id);
    if (p.report_ref && !reportLink) setReportLink(reportPageUrl(p.report_ref));
    if (p.license_status) setLicense(p.license_status);
    if (p.license_state) setStateCode(p.license_state);
    if (p.criminal_record) setCriminal(p.criminal_record);
    if (p.criminal_case_count != null) setCount(String(p.criminal_case_count));
  }

  const ref = reportLink.trim() ? parseReportRef(reportLink) : null;
  const order = normalizeOrderId(orderId) ?? (orderId.trim() === "" && ref ? ref.order : null);
  const cases = parseCaseLines(caseLines);
  const countNum = count.trim() === "" ? null : Number(count);
  const blockers: string[] = [];
  if (!order) blockers.push("Enter The RentID Order Number.");
  if (reportLink.trim() && !ref) blockers.push("The Report Link Should Look Like rent-id.io/rentid/req_….");
  if (ref && order && ref.order !== order.replace(/^INV-/, "")) blockers.push(`The Report Link Is For Order ${ref.order}.`);
  if (!file && !license && !criminal) blockers.push("Attach The Report File Or Enter A Result.");
  if (countNum != null && (!Number.isInteger(countNum) || countNum < 0 || countNum > 999)) blockers.push("Case Count Must Be 0–999.");
  if (criminal === "not_detected" && ((countNum ?? 0) > 0 || cases.length)) blockers.push("Not Detected Can't Have Cases.");

  async function save() {
    if (blockers.length || !order) return;
    setBusy(true);
    try {
      let documentId: string | null = null;
      if (file) documentId = await upload("screening", file, setProgress, { label: `RentID Report ${order}` });
      await attach({ data: {
        applicationId, orderId: order, reportRef: ref ? ref.ref : null,
        licenseStatus: license || null, licenseState: state.trim() ? state.trim().toUpperCase() : null,
        criminalRecord: criminal || null, criminalCaseCount: countNum, criminalCases: cases,
        checkedAt: checkedOn ? new Date(`${checkedOn}T12:00:00`).toISOString() : null,
        documentId, note: note.trim() || null,
      } });
      toast.success("RentID Report Saved");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Save The RentID Report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader><DialogTitle>Attach RentID Report</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-[12px] text-[#55555E]">In RentID (rent-id.io/rentid, team@ login), open the order, then attach a screenshot or PDF of the result. Saving does not approve, verify or decline anyone.</p>
          <label className="block"><span className="text-[12px] font-medium">Report File (Screenshot Or PDF)</span>
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/heic" className={input} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="rentid-file" />
          </label>
          <label className="block"><span className="text-[12px] font-medium">Paste The RentID Result Text (Optional, Fills The Fields)</span>
            <textarea className={`${input} h-20`} value={paste} onChange={(e) => fillFromPaste(e.target.value)} placeholder="Criminal Record Check: Detected (18 cases)" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="text-[12px] font-medium">Order Number</span>
              <input className={input} value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="INV-4H7F2YTY" data-testid="rentid-order" />
            </label>
            <label className="block sm:col-span-2"><span className="text-[12px] font-medium">RentID Report Link (Optional)</span>
              <input className={input} value={reportLink} onChange={(e) => setReportLink(e.target.value)} placeholder="https://rent-id.io/rentid/req_…" />
            </label>
            <label className="block"><span className="text-[12px] font-medium">Checked On</span>
              <input type="date" className={input} value={checkedOn} onChange={(e) => setCheckedOn(e.target.value)} />
            </label>
            <label className="block"><span className="text-[12px] font-medium">Driver's License Status</span>
              <select className={input} value={license} onChange={(e) => setLicense(e.target.value as RentidLicenseStatus | "")}>
                <option value="">Not Checked</option>
                {RENTID_LICENSE_STATUSES.map((s) => <option key={s} value={s}>{licenseStatusLabel(s)}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-[12px] font-medium">License State</span>
              <input className={input} value={state} maxLength={2} onChange={(e) => setStateCode(e.target.value)} placeholder="FL" />
            </label>
            <label className="block"><span className="text-[12px] font-medium">Criminal Record Check</span>
              <select className={input} value={criminal} onChange={(e) => setCriminal(e.target.value as RentidCriminalResult | "")}>
                <option value="">Not Checked</option>
                {RENTID_CRIMINAL_RESULTS.map((s) => <option key={s} value={s}>{CRIMINAL_OPTIONS[s]}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-[12px] font-medium">Number Of Cases</span>
              <input className={input} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ""))} placeholder="18" />
            </label>
          </div>
          <label className="block"><span className="text-[12px] font-medium">Cases (One Per Line, Optional)</span>
            <textarea className={`${input} h-24 font-mono text-[12px]`} value={caseLines} onChange={(e) => setCaseLines(e.target.value)} placeholder="Offense Date | Charges | Degree | Disposition | Court / County | Case #" />
            {cases.length ? <span className="text-[11px] text-[#9A9AA3]">{cases.length} {cases.length === 1 ? "Case" : "Cases"} Listed</span> : null}
          </label>
          <label className="block"><span className="text-[12px] font-medium">Note (Optional)</span>
            <input className={input} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          {blockers.length ? <ul className="text-[12px] text-[#B54708]">{blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}
        </div>
        <DialogFooter>
          <button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={primary} onClick={() => void save()} disabled={busy || blockers.length > 0} data-testid="save-rentid-report">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {progress > 0 && progress < 100 ? `Uploading ${progress}%` : "Saving…"}</> : "Save Report"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
