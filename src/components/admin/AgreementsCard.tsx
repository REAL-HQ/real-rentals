import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSignature, Send, Copy, Ban, RefreshCw, Loader2 } from "lucide-react";
import { SectionCard, StatusPill } from "./ui";
import {
  listAgreements,
  previewAgreement,
  sendAgreement,
  resendAgreement,
  voidAgreement,
  type AgreementRow,
} from "@/lib/agreements.functions";

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

  const [rows, setRows] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setRows(await load({ data: { applicationId } }));
    } catch {
      /* ignore */
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
      setPreview(res.body);
      setMissing(res.missing);
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
      toast.success("Agreement sent for signature");
      if (res.url) await navigator.clipboard?.writeText(res.url).catch(() => {});
      setPreview(null);
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
      title="Rental agreement"
      right={
        <button
          onClick={openPreview}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#D03020] text-white text-[12px] font-semibold px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSignature className="w-3.5 h-3.5" />}
          Prepare agreement
        </button>
      }
    >
      <div className="p-5 space-y-4">
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
                  <Send className="w-3.5 h-3.5" /> Send for signature
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
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {a.status !== "signed" && a.status !== "voided" ? (
                    <>
                      <button
                        title="Resend link"
                        onClick={async () => {
                          try {
                            const r = await doResend({ data: { agreementId: a.id } });
                            if (r.url) await navigator.clipboard?.writeText(r.url).catch(() => {});
                            toast.success("New signing link sent");
                            await refresh();
                          } catch (e: any) {
                            toast.error(e?.message || "Could not resend");
                          }
                        }}
                        className="p-1.5 rounded-md hover:bg-[#F4F4F6] text-[#55555E]"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
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
