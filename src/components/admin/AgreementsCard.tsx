import { saveAgreementPdf } from "@/lib/agreement-download";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSignature, Send, Ban, RefreshCw, Loader2, Download, Copy, AlertTriangle } from "lucide-react";
import { SectionCard } from "./ui";
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

const CH: Record<string, string> = { sent: "Sent", failed: "Failed", not_attempted: "Not Attempted" };
const chTone = (v: string) =>
  v === "sent" ? "text-[#1E7A32]" : v === "failed" ? "text-[#8A1F12] font-semibold" : "text-[#77777F]";

function toneFor(status: string) {
  if (status === "signed") return "bg-[#E9F9EC] text-[#1E7A32] border-[#CDEFD6]";
  if (status === "voided") return "bg-[#F4F4F6] text-[#77777F] border-[#E6E6EA]";
  if (status === "viewed") return "bg-[#FFF8E5] text-[#8A6A00] border-[#F6E7B8]";
  return "bg-[#EEF3FF] text-[#2B4FA0] border-[#DAE3FA]";
}

export function AgreementsCard({ applicationId }: { applicationId: string }) {
  const load = useServerFn(listAgreements);
  const doPreview = useServerFn(previewAgreement);
  const doSend = useServerFn(sendAgreement);
  const doResend = useServerFn(resendAgreement);
  const doVoid = useServerFn(voidAgreement);
  const doRetry = useServerFn(retryAgreementArchive);
  const doPdf = useServerFn(getAgreementPdf);

  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [blockers, setBlockers] = useState<
    { field: string; label: string; why: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Latest signing link per agreement, held only in memory for Copy.
  const [links, setLinks] = useState<Record<string, string>>({});

  function reportDelivery(d: { email: string; sms: string; delivered: boolean } | undefined, okMsg: string) {
    if (!d) return toast.success(okMsg);
    if (!d.delivered) toast.error("Signing link wasn't delivered — use Retry Delivery or Copy Signing Link.");
    else toast.success(`${okMsg} · Email ${CH[d.email] ?? d.email} · SMS ${CH[d.sms] ?? d.sms}`);
  }

  async function refresh() {
    try {
      const res = await load({ data: { applicationId } });
      // Whatever comes back, this component renders rows.length. A transport
      // that hands back null instead of a list would throw during render,
      // and this card is the first child of the Documents tab — so the error
      // boundary would replace the entire driver drawer with "This page
      // didn't load", and the documents beneath it with nothing at all.
      setRows(Array.isArray(res) ? res : []);
      setLoadError(Array.isArray(res) ? null : "Agreements came back in a shape we didn't expect.");
    } catch (e) {
      // Not swallowed. "No agreement sent yet" is a fact about this
      // applicant; a failed lookup is a fact about us, and showing the first
      // in place of the second is how a permissions error reads as a clean
      // record. The card says so and offers a retry; the rest of the tab,
      // documents included, still renders.
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
      const res = await doPreview({ data: { applicationId } });
      // The server withholds the body while anything blocks the send. Showing
      // an editable draft with blanks in it and a Send button next to it read
      // as permission to proceed, which is how a contract could be signed with
      // "__________" where its dates belong.
      setPreview(res.body);
      setMissing(res.missing);
      setBlockers((res as { blockers?: typeof blockers }).blockers ?? []);
      if (!res.body) setPreview(null);
    } catch (e: any) {
      toast.error(e?.message || "Could not build the agreement");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    try {
      const res = await doSend({ data: { applicationId, body: preview ?? undefined } });
      reportDelivery(res.delivery, "Agreement sent for signature");
      if (res.url) setLinks((l) => ({ ...l, [res.id]: res.url }));
      setPreview(null);
      setBlockers([]);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not send the agreement");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      padded={false}
      title="Rental Agreement"
      right={
        <button
          onClick={openPreview}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#D03020] text-white text-[12px] font-semibold px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSignature className="w-3.5 h-3.5" />}
          Prepare Agreement
        </button>
      }
    >
      <div className="p-5 space-y-4">
        {blockers.length > 0 ? (
          <div className="rounded-lg border border-[#F3C2BC] bg-[#FDF3F2] p-4">
            <div className="text-[12px] font-semibold text-[#8A1F12]">
              This agreement cannot be sent yet
            </div>
            <ul className="mt-2 space-y-2">
              {blockers.map((b) => (
                <li key={b.field} className="text-[12px] text-[#6B2A20]">
                  <span className="font-semibold">{b.label}.</span> {b.why}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[11.5px] text-[#8A6A00]">
              Driver, licence, rate and deposit details are on the Payments tab. Vehicle
              VIN, colour and model are on the vehicle's page in Fleet. Then prepare the
              agreement again.
            </p>
          </div>
        ) : null}
        {preview !== null ? (
          <div className="rounded-lg border border-[#EDEDF0] bg-[#FAFAFB]">
            <div className="px-4 py-2.5 border-b border-[#EDEDF0] flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[#111114]">Review before sending</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPreview(null)} className="text-[12px] text-[#55555E] px-2 py-1">
                  Cancel
                </button>
                <button
                  onClick={send}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#111114] text-white text-[12px] font-semibold px-3 py-1.5 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" /> Send for Signature
                </button>
              </div>
            </div>
            {missing.length ? (
              <div className="px-4 py-2 text-[11.5px] text-[#8A6A00] bg-[#FFF8E5] border-b border-[#F6E7B8]">
                Missing details: {missing.join(", ").replace(/_/g, " ")} — blanks appear as underscores.
              </div>
            ) : null}
            <textarea
              value={preview}
              onChange={(e) => setPreview(e.target.value)}
              rows={16}
              className="w-full bg-white p-4 text-[12.5px] leading-6 font-mono text-[#28282E] focus:outline-none"
            />
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
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-[#55555E]">
            No agreement sent yet. Prepare one to pre-fill it with this driver's details and assigned vehicle.
          </p>
        ) : (
          <ul className="divide-y divide-[#EDEDF0] border border-[#EDEDF0] rounded-lg overflow-hidden">
            {rows.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 bg-white">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[#111114] truncate">{a.title}</span>
                    <span className={`text-[10.5px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${toneFor(a.status)}`}>
                      {a.status}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-[#77777F] mt-0.5">
                    {a.signed_at
                      ? `Signed by ${a.signer_name ?? "renter"} · ${new Date(a.signed_at).toLocaleString()}`
                      : a.sent_at
                        ? `Sent ${new Date(a.sent_at).toLocaleString()}`
                        : `Created ${new Date(a.created_at).toLocaleString()}`}
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
                  {a.timeline?.length ? (
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] text-[#77777F]">
                      {a.timeline.map((t, i) => (
                        <span key={i} title={new Date(t.at).toLocaleString()} className={/failed/i.test(t.label) ? "text-[#8A1F12]" : ""}>
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
                      Retry save
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
                        title="Retry Delivery (issues a new link; the old one stops working)"
                        onClick={async () => {
                          try {
                            const r = await doResend({ data: { agreementId: a.id } });
                            if (r.url) setLinks((l) => ({ ...l, [a.id]: r.url }));
                            reportDelivery(r.delivery, "New signing link sent");
                            await refresh();
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
    </SectionCard>
  );
}

export default AgreementsCard;
