import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, X } from "lucide-react";
import { getAgreementPdf } from "@/lib/agreements.functions";
import { saveAgreementPdf, type AgreementPdfPayload } from "@/lib/agreement-download";
import { AgreementPdfViewer } from "@/components/admin/AgreementPdfViewer";

/**
 * Review a signed agreement on screen, without downloading it. The one viewer
 * used wherever agreements are listed (driver Documents tab, booking dialog).
 * The PDF comes from our own server (getAgreementPdf), which applies the same
 * access rules as the download; Download stays one click away.
 */
export function AgreementViewerDialog({
  agreementId,
  title,
  onClose,
}: {
  agreementId: string;
  title?: string | null;
  onClose: () => void;
}) {
  const pdf = useServerFn(getAgreementPdf);
  const [payload, setPayload] = useState<AgreementPdfPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPayload(null);
    setError(null);
    pdf({ data: { agreementId } })
      .then((r) => live && setPayload(r as AgreementPdfPayload))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not open that agreement."));
    return () => {
      live = false;
    };
  }, [agreementId, pdf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? "Signed Agreement"}
      data-testid="agreement-viewer"
    >
      <div className="mx-auto max-w-3xl rounded-xl bg-white p-3" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-semibold text-[#111114]">{title ?? "Signed Agreement"}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!payload}
              onClick={() => payload && saveAgreementPdf(payload)}
              data-testid="agreement-viewer-download"
              className="inline-flex items-center gap-1.5 rounded-md border border-[#EDEDF0] px-2.5 py-1 text-[12px] font-medium disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-[#9A9AA3] hover:text-[#111114]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {error ? (
          <p className="p-6 text-center text-[13px] text-[#8A1F12]" role="alert">{error}</p>
        ) : payload ? (
          <AgreementPdfViewer base64={payload.base64} />
        ) : (
          <div className="flex items-center justify-center gap-2 p-10 text-[13px] text-[#55555E]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading Agreement…
          </div>
        )}
      </div>
    </div>
  );
}
