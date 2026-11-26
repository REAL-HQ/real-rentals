import { PaperAgreements } from "./PaperAgreements";
import { FloridaAddendumPanel } from "./FloridaAddendumPanel";
import { saveAgreementPdf } from "@/lib/agreement-download";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSignature, Send, Ban, RefreshCw, Loader2, Download, Copy, AlertTriangle, Eye } from "lucide-react";
import { SectionCard } from "./ui";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton } from "./modal";
import { AppSelect } from "@/components/ui/app-select";
import {
  listAgreements,
  previewAgreement,
  sendAgreement,
  resendAgreement,
  voidAgreement,
  retryAgreementArchive,
  getAgreementPdf,
  type AgreementRow,
} from "@/lib/agreements.functions";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import { AgreementPdfViewer } from "./AgreementPdfViewer";
import { AgreementViewerDialog } from "./AgreementViewerDialog";
import { PrepareAgreementDialog } from "./PrepareAgreementDialog";
import { formatStatusLabel } from "@/lib/ui-display-labels";

const CH: Record<string, string> = { sent: "Sent", failed: "Failed", not_attempted: "Not Attempted" };
const chTone = (v: string) =>
  v === "sent" ? "text-[#1E7A32]" : v === "failed" ? "text-[#8A1F12] font-semibold" : "text-[#77777F]";

function toneFor(status: string) {
  if (status === "signed") return "bg-[#E9F9EC] text-[#1E7A32] border-[#CDEFD6]";
  if (status === "voided") return "bg-[#F4F4F6] text-[#77777F] border-[#E6E6EA]";
  if (status === "viewed") return "bg-[#FFF8E5] text-[#8A6A00] border-[#F6E7B8]";
  return "bg-[#EEF3FF] text-[#2B4FA0] border-[#DAE3FA]";
}

type Blocker = { field: string; label: string; why: string; fix?: { tab: "payments" | "rental" } | { vehicleId: string } };
type Note = { field: string; label: string; why: string };
type PreviewRes = {
  pdfBase64: string | null;
  fingerprint: string | null;
  template: { label: string; version: number; approvalStatus: string; effectiveDate: string | null; versioningActive: boolean };
  canSend: boolean;
  companyMissing?: string[];
  companyFallback?: { field: string; value: string }[];
  sendRefusal: string | null;
  missing: string[];
  blockers: Blocker[];
  notes?: Note[];
  generatedAt: string;
};

export function AgreementsCard({ applicationId, onOpenTab, applicationStatus }: { applicationId: string; onOpenTab?: (tab: string) => void; applicationStatus?: string | null }) {
  const beforeApproval = applicationStatus != null && !["approved", "active"].includes(String(applicationStatus).toLowerCase());
  const load = useServerFn(listAgreements);
  const doPreview = useServerFn(previewAgreement);
  const doSend = useServerFn(sendAgreement);
  const [companyAck, setCompanyAck] = useState(false);
  const doResend = useServerFn(resendAgreement);
  const doVoid = useServerFn(voidAgreement);
  const doRetry = useServerFn(retryAgreementArchive);
  const doPdf = useServerFn(getAgreementPdf);

  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; title: string | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Latest signing link per agreement, held only in memory for Copy.
  const [links, setLinks] = useState<Record<string, string>>({});
  const [resendFor, setResendFor] = useState<AgreementRow | null>(null);
  const [resendWho, setResendWho] = useState("all");
  const [emailOnly, setEmailOnly] = useState(false);

  function reportDelivery(d: { email: string; sms: string; delivered: boolean } | undefined, okMsg: string) {
    if (!d) return toast.success(okMsg);
    if (!d.delivered) toast.error("Signing link wasn't delivered — use Retry Delivery or Copy Signing Link.");
    else toast.success(`${okMsg} · Email ${CH[d.email] ?? d.email} · SMS ${CH[d.sms] ?? d.sms}`);
  }

  async function refresh() {
    try {
      const res = await load({ data: { applicationId } });
      // A non-list transport result must not crash the driver drawer.
      setRows(Array.isArray(res) ? res : []);
      setLoadError(Array.isArray(res) ? null : "Agreements came back in a shape we didn't expect.");
    } catch (e) {
      // Not swallowed: a failed lookup must not read as "no agreement".
      setRows([]);
      setLoadError(e instanceof Error ? e.message : "Could not load agreements.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  async function openPreview() {
    setBusy(true);
    try {
      setPreview((await doPreview({ data: { applicationId } })) as PreviewRes);
    } catch (e: any) {
      toast.error(e?.message || "Could not build the agreement");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!preview?.fingerprint || !preview.canSend) return;
    setBusy(true);
    try {
      const res = await doSend({ data: { applicationId, fingerprint: preview.fingerprint, companyAck: companyAck || undefined } });
      setCompanyAck(false);
      reportDelivery(res.delivery, "Agreement sent for signature");
      if (res.url) setLinks((l) => ({ ...l, [res.id]: res.url }));
      setPreview(null);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not send the agreement");
    } finally {
      setBusy(false);
    }
  }

  async function runResend(agreementId: string, signerId?: string, channels?: "email" | "email_and_sms") {
    const r = await doResend({ data: { agreementId, signerId, channels } });
    const url = r.url;
    if (url) setLinks((l) => ({ ...l, [agreementId]: url }));
    reportDelivery(r.delivery, "Signing link sent");
    await refresh();
  }

  function fixLink(b: Blocker) {
    if (!b.fix) return null;
    if ("vehicleId" in b.fix)
      return (
        <a href={`/admin?tab=vehicles&id=${b.fix.vehicleId}`} target="_blank" rel="noreferrer" className="ml-1 font-semibold underline">
          Open Vehicle
        </a>
      );
    const tab = b.fix.tab;
    return onOpenTab ? (
      <button onClick={() => onOpenTab(tab)} className="ml-1 font-semibold underline">
        {tab === "payments" ? "Open Payments" : "Open Rental"}
      </button>
    ) : null;
  }

  const t = preview?.template;

  return (
    <SectionCard
      padded={false}
      title="Rental Agreement"
      right={
        <button
          onClick={() => setPrepOpen(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#D03020] text-white text-[12px] font-semibold px-3 py-1.5 disabled:opacity-50"
        >
          {busy && !preview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSignature className="w-3.5 h-3.5" />}
          Prepare Agreement
        </button>
      }
    >
      {viewing && <AgreementViewerDialog agreementId={viewing.id} title={viewing.title} onClose={() => setViewing(null)} />}
      {resendFor ? (
        <ModalShell onClose={() => setResendFor(null)} size="sm" label="Resend Signing Link">
          <ModalHeader title="Resend Signing Link" subtitle="Each signer gets their own link." onClose={() => setResendFor(null)} />
          <ModalBody>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-foreground">Send To</span>
              <AppSelect aria-label="Send To" value={resendWho} onChange={(e) => setResendWho(e.target.value)} className="h-11 w-full">
                <option value="all">All Unsigned Signers</option>
                {(resendFor.signers ?? []).filter((s) => s.status !== "signed" && !s.signed_at).map((s) => (
                  <option key={s.id} value={s.id}>{s.name || s.email || "Signer"}</option>
                ))}
              </AppSelect>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-foreground">
              <input type="checkbox" checked={emailOnly} onChange={(e) => setEmailOnly(e.target.checked)} />
              Email Only
            </label>
          </ModalBody>
          <ModalFooter>
            <ModalButton onClick={() => setResendFor(null)}>Cancel</ModalButton>
            <ModalButton
              variant="primary"
              disabled={busy}
              onClick={async () => {
                const id = resendFor.id;
                const signerId = resendWho === "all" ? undefined : resendWho;
                const channels = emailOnly ? "email" : "email_and_sms";
                setBusy(true);
                try {
                  await runResend(id, signerId, channels);
                  setResendFor(null);
                } catch (e: any) {
                  toast.error(e?.message || "Could not resend");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Resend Link
            </ModalButton>
          </ModalFooter>
        </ModalShell>
      ) : null}
      {prepOpen && (
        <PrepareAgreementDialog
          applicationId={applicationId}
          onOpenTab={onOpenTab}
          onClose={() => setPrepOpen(false)}
          onSent={async (res: any) => {
            reportDelivery(res.delivery, "Agreement sent for signature");
            if (res.url) setLinks((l) => ({ ...l, [res.id]: res.url }));
            setPrepOpen(false);
            await refresh();
          }}
        />
      )}
      <div className="p-5 space-y-4">
        {preview ? (
          <div className="rounded-lg border border-[#EDEDF0] bg-[#FAFAFB]" data-testid="agreement-preview">
            <div className="px-4 py-2.5 border-b border-[#EDEDF0] flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-[#111114]">Agreement Preview — Not Sent</div>
                <div className="text-[11px] text-[#55555E]">
                  Template: <span className="font-semibold">{t?.label}</span>
                  {" · "}Effective: {t?.effectiveDate ? fmtDate(t.effectiveDate) : "Not Set"}
                  {" · "}Generated {fmtDateTime(preview.generatedAt)}
                </div>
                {preview.fingerprint ? (
                  <div className="text-[10.5px] font-mono text-[#9A9AA2] truncate" title={preview.fingerprint}>
                    Fingerprint {preview.fingerprint.slice(0, 16)}…
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPreview(null)} className="text-[12px] text-[#55555E] px-2 py-1">
                  Close
                </button>
                <button
                  onClick={openPreview}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#E6E6EA] bg-white text-[12px] font-semibold px-3 py-1.5 text-[#28282E] disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Regenerate
                </button>
              </div>
            </div>

            {t && !t.versioningActive ? (
              <div className="px-4 py-2 text-[11.5px] text-[#8A6A00] bg-[#FFF8E5] border-b border-[#F6E7B8]">
                This wording is Draft v1 and has not been approved by the Owner or reviewed by a lawyer. Template approval isn't switched on yet.
              </div>
            ) : null}

            {preview.blockers.length > 0 ? (
              <div className="m-4 rounded-lg border border-[#F3C2BC] bg-[#FDF3F2] p-4">
                <div className="text-[12px] font-semibold text-[#8A1F12]">This agreement cannot be sent yet</div>
                <ul className="mt-2 space-y-2">
                  {preview.blockers.map((b, i) => (
                    <li key={b.field + i} className="text-[12px] text-[#6B2A20]">
                      <span className="font-semibold">{b.label}.</span> {b.why}
                      {fixLink(b)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[11.5px] text-[#8A6A00]">Correct the details, then press Regenerate.</p>
              </div>
            ) : null}
            {(preview.notes?.length ?? 0) > 0 ? (
              <div className="m-4 rounded-lg border border-[#E6E6EA] bg-[#FAFAFB] p-4" data-testid="agreement-notes">
                <ul className="space-y-1">
                  {preview.notes!.map((n, i) => (
                    <li key={n.field + i} className="text-[12px] text-[#55555E]">
                      <span className="font-semibold">{n.label}.</span> {n.why}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.sendRefusal ? (
              <div className="m-4 rounded-lg border border-[#F3C2BC] bg-[#FDF3F2] p-3 text-[12px] text-[#8A1F12]">{preview.sendRefusal}</div>
            ) : null}

            {preview.pdfBase64 ? (
              <div className="max-h-[75vh] overflow-y-auto bg-[#EDEDF0]">
                <AgreementPdfViewer base64={preview.pdfBase64} />
              </div>
            ) : null}
          </div>
        ) : null}

        {preview && (preview.companyMissing?.length ?? 0) > 0 ? (
          <div className="rounded-lg border border-[#F2D7A6] bg-[#FFF8EC] px-4 py-3 text-[12px] text-[#6B4A12] space-y-1.5" data-testid="company-warning">
            <p className="font-semibold">Company Details Incomplete</p>
            <p>Missing in Settings → Company: {preview.companyMissing!.join(", ")}.</p>
            {preview.companyFallback?.length ? <p>Fallback values in this agreement: {preview.companyFallback.map((f) => `${f.field.replace("company_", "")} "${f.value}"`).join(", ")}.</p> : null}
            <label className="flex items-center gap-2"><input type="checkbox" checked={companyAck} onChange={(e) => setCompanyAck(e.target.checked)} /> I understand and want to send with these values (not a legal approval).</label>
          </div>
        ) : null}

        {preview ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#EDEDF0] bg-white px-4 py-3">
            <p className="text-[11.5px] text-[#55555E] min-w-0">
              Send Agreement emails exactly this document to the driver. If any detail changes first, sending is refused until you regenerate.
            </p>
            <button
              onClick={send}
              disabled={busy || !preview.canSend || ((preview.companyMissing?.length ?? 0) > 0 && !companyAck)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#111114] text-white text-[12px] font-semibold px-3 py-1.5 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send Agreement
            </button>
          </div>
        ) : null}

        {loading ? (
          <p className="text-[13px] text-[#55555E]">Loading agreements…</p>
        ) : loadError ? (
          <div className="rounded-lg border border-[#F3C2BC] bg-[#FDF3F2] p-4">
            <div className="text-[12px] font-semibold text-[#8A1F12]">
              Couldn't load this applicant's agreements
            </div>
            <p className="mt-1 text-[12px] text-[#6B2A20]">{loadError}</p>
            <button
              onClick={() => {
                setLoading(true);
                setLoadError(null);
                void refresh();
              }}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-[#F3C2BC] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#8A1F12]"
            >
              Try Again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-[#55555E]">
            {beforeApproval
              ? "No agreement yet. It goes out after approval: once the applicant is approved, has a car and confirms the terms (a YES text), FLEET sends it for signature. You can still prepare one by hand."
              : "No agreement sent yet. Prepare one to pre-fill it with this driver's details and assigned vehicle."}
          </p>
        ) : (
          <ul className="divide-y divide-[#EDEDF0] border border-[#EDEDF0] rounded-lg overflow-hidden">
            {rows.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[#111114] truncate">{a.title}</span>
                    <span className={`text-[10.5px] font-semibold tracking-wide rounded-full border px-2 py-0.5 ${toneFor(a.status)}`}>
                      {formatStatusLabel(a.status)}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-[#77777F] mt-0.5">
                    {a.signed_at
                      ? `Signed by ${a.signer_name ?? "renter"} · ${fmtDateTime(a.signed_at)}`
                      : a.sent_at
                        ? `Sent ${fmtDateTime(a.sent_at)}`
                        : `Created ${fmtDateTime(a.created_at)}`}
                  </div>
                  {a.status === "signed" && a.archive_status !== "archived" ? (
                    <div className="mt-1 text-[11.5px] font-medium text-[#8A1F12]">
                      {a.archive_status === "failed"
                        ? "Signed, but the PDF copy failed to save."
                        : "Signed — saving the PDF copy…"}
                    </div>
                  ) : null}
                  {a.status !== "voided" && a.status !== "draft" && !a.signed_at ? (
                    <div className="mt-1 text-[11px] text-[#55555E]">
                      Email: <span className={chTone(a.email_status)} title={a.email_error ?? ""}>{CH[a.email_status] ?? a.email_status}</span>
                      {"  ·  "}SMS: <span className={chTone(a.sms_status)} title={a.sms_error ?? ""}>{CH[a.sms_status] ?? a.sms_status}</span>
                    </div>
                  ) : null}
                  {!a.signed_at && a.status !== "voided" && a.email_status !== "sent" && a.sms_status !== "sent" ? (
                    <div className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#8A1F12]">
                      <AlertTriangle className="w-3.5 h-3.5" /> Signing link wasn't delivered
                    </div>
                  ) : null}
                  {a.company_signer_name ? (
                    <div className="mt-0.5 text-[10.5px] text-[#9A9AA2]">
                      Company signer: {a.company_signer_name}{a.company_signer_title ? `, ${a.company_signer_title}` : ""}
                    </div>
                  ) : null}
                  {(a.signers ?? []).length > 1 ? (
                    <div className="mt-1 text-[11px] text-[#55555E]">
                      {a.signers.map((s) => `${s.name || s.email || "Signer"}: ${s.status === "signed" || s.signed_at ? "Signed" : "Unsigned"}`).join(" · ")}
                    </div>
                  ) : null}
                  {a.timeline?.length ? (
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] text-[#77777F]">
                      {a.timeline.map((t, i) => (
                        <span key={i} title={fmtDateTime(t.at)} className={/failed/i.test(t.label) ? "text-[#8A1F12]" : ""}>
                          {i ? "→ " : ""}{t.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {a.sha256 ? (
                    <div className="mt-0.5 text-[10.5px] font-mono text-[#9A9AA2] truncate" title={a.sha256}>
                      SHA-256 {a.sha256.slice(0, 16)}…
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {a.status === "signed" && a.archive_status === "archived" ? (
                    <button
                      title="View Signed Agreement"
                      data-testid="view-agreement"
                      onClick={() => setViewing({ id: a.id, title: a.title })}
                      className="inline-flex items-center gap-1 rounded-md border border-[#E6E6EA] px-2 py-1 text-[11px] font-semibold text-[#55555E] hover:bg-[#F4F4F6]"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                  ) : null}
                  {a.status === "signed" && a.archive_status === "archived" ? (
                    <button
                      title="Download Signed PDF"
                      onClick={async () => {
                        try {
                          saveAgreementPdf(await doPdf({ data: { agreementId: a.id } }));
                        } catch (e: any) {
                          toast.error(e?.message || "Could not open the PDF");
                        }
                      }}
                      className="p-1.5 rounded-md hover:bg-[#F4F4F6] text-[#55555E]"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                  {a.status === "signed" && a.archive_status !== "archived" ? (
                    <button
                      onClick={async () => {
                        try {
                          await doRetry({ data: { agreementId: a.id } });
                          toast.success("Signed PDF saved");
                          await refresh();
                        } catch (e: any) {
                          toast.error(e?.message || "Retry failed");
                        }
                      }}
                      className="text-[11px] font-semibold text-[#8A1F12] border border-[#F3C2BC] rounded-md px-2 py-1"
                    >
                      Retry Save
                    </button>
                  ) : null}
                  {a.status !== "signed" && a.status !== "voided" && a.status !== "signing" ? (
                    <>
                      {links[a.id] ? (
                        <button
                          title="Copy Signing Link"
                          onClick={async () => {
                            await navigator.clipboard?.writeText(links[a.id]).catch(() => {});
                            toast.success("Signing link copied");
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#55555E] border border-[#E6E6EA] rounded-md px-2 py-1"
                        >
                          <Copy className="w-3.5 h-3.5" /> Copy Signing Link
                        </button>
                      ) : null}
                      <button
                        title="Resend the signing link"
                        onClick={async () => {
                          if ((a.signers ?? []).length > 1) {
                            setResendWho("all");
                            setEmailOnly(false);
                            setResendFor(a);
                            return;
                          }
                          try {
                            await runResend(a.id);
                          } catch (e: any) {
                            toast.error(e?.message || "Could not resend");
                          }
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#55555E] border border-[#E6E6EA] rounded-md px-2 py-1"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Retry Delivery
                      </button>
                      <button
                        title="Void"
                        onClick={async () => {
                          try {
                            await doVoid({ data: { agreementId: a.id } });
                            toast.success("Agreement voided");
                            await refresh();
                          } catch (e: any) {
                            toast.error(e?.message || "Could not void");
                          }
                        }}
                        className="p-1.5 rounded-md hover:bg-[#F4F4F6] text-[#55555E]"
                      >
                        <Ban className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    <FloridaAddendumPanel applicationId={applicationId} />
    <PaperAgreements applicationId={applicationId} />
    </SectionCard>
  );
}

export default AgreementsCard;
