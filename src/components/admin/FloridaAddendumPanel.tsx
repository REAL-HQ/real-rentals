// Staff preview of the Florida 812.155 Addendum for this renter. Read-only:
// it never sends, texts, emails or saves anything. While the addendum wording
// is not Owner-approved the PDF carries the PREVIEW - NOT SENT watermark.
//
// The card is hidden when the current signed agreement already includes the
// s. 812.155(6) notice. That decision is getFloridaAddendumStatus. This file
// does not compare template versions.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Eye, Loader2 } from "lucide-react";
import { getFloridaAddendumStatus, previewFloridaAddendum } from "@/lib/florida-addendum.functions";
import { FL_ADDENDUM_TITLE, FL_ADDENDUM_VERSION } from "@/lib/agreement-fl-addendum";
import { AgreementPdfViewer } from "./AgreementPdfViewer";

type Status = Awaited<ReturnType<typeof getFloridaAddendumStatus>>;
type Res = Awaited<ReturnType<typeof previewFloridaAddendum>>;

export function FloridaAddendumPanel({ applicationId }: { applicationId: string }) {
  const loadStatus = useServerFn(getFloridaAddendumStatus);
  const load = useServerFn(previewFloridaAddendum);
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Res | null>(null);

  useEffect(() => {
    let live = true;
    setStatus(null);
    setFailed(false);
    setRes(null);
    loadStatus({ data: { applicationId } })
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
    // loadStatus is the server function for this card. applicationId is the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  // Unknown (the check failed) stays visible, same as a missing version.
  // outstanding is needs812155Addendum. A covered agreement is neither outstanding nor signed-here.
  const signed = !failed && status?.state === "signed";
  const needed = failed || status?.outstanding === true;
  if (!signed && !needed) return null;
  const state = signed ? "signed" : "needed";

  async function open() {
    setBusy(true);
    try {
      setRes(await load({ data: { applicationId } }));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not build the addendum");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="mx-5 mb-5 rounded-lg border border-[#EDEDF0] bg-[#FAFAFB]"
      data-testid="florida-addendum"
      data-addendum-state={state}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[12px] font-semibold text-[#111114]">
              {FL_ADDENDUM_TITLE} (v{FL_ADDENDUM_VERSION})
            </div>
            <span
              className={
                signed
                  ? "rounded-md border border-[#CDEFD6] bg-[#E9F9EC] px-1.5 py-0.5 text-[10px] font-semibold text-[#1E7A32]"
                  : "rounded-md border border-[#F6E7B8] bg-[#FFF8E5] px-1.5 py-0.5 text-[10px] font-semibold text-[#8A6A00]"
              }
              data-testid="florida-addendum-state"
            >
              {signed ? "Signed" : "Needed"}
            </span>
          </div>
          <div className="text-[11px] text-[#55555E]">
            {signed
              ? "Complete"
              : "For renters whose signed agreement predates v1.14, or who signed on paper."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {res && (
            <button onClick={() => setRes(null)} className="px-2 py-1 text-[12px] text-[#55555E]">
              Close
            </button>
          )}
          <button
            onClick={open}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E6E6EA] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#28282E] disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}{" "}
            {signed ? "View Addendum" : "Preview Addendum"}
          </button>
        </div>
      </div>
      {res && (
        <div className="space-y-2 border-t border-[#EDEDF0] px-4 py-3 text-[12px]">
          {!res.approvedForRenters && (
            <p className="rounded-md border border-[#F6E7B8] bg-[#FFF8E5] px-3 py-2 text-[#8A6A00]">
              Not Approved For Renters. This preview is for Owner and attorney review only. Do not
              give it to a renter.
            </p>
          )}
          <p className="text-[#55555E]">
            Agreement Number:{" "}
            <span className="font-semibold">
              {res.agreementNumber ?? "Not On File (Prints ___)"}
            </span>
          </p>
          {res.blockers.length > 0 && (
            <div className="rounded-md border border-[#F3C2BC] bg-[#FDF3F2] px-3 py-2 text-[#8A1F12]">
              <p className="font-semibold">Missing Before This Addendum Can Be Used:</p>
              {res.blockers.map((b) => (
                <p key={b.field}>- {b.label}</p>
              ))}
            </div>
          )}
          <div className="max-h-[75vh] overflow-y-auto bg-[#EDEDF0]">
            <AgreementPdfViewer base64={res.pdfBase64} />
          </div>
        </div>
      )}
    </div>
  );
}

export default FloridaAddendumPanel;
