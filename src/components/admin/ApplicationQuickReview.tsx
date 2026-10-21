import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText } from "lucide-react";
import { getApplicationQuickReview } from "@/lib/application-quick-review.functions";
import type { QuickReview, QuickReviewDocument } from "@/lib/application-quick-review";
import { quickReviewDocumentLink } from "@/lib/vault-signed-url";

/**
 * Read-only. A live signed URL is the one adminListDriverDocuments already
 * attached. When that URL's exp has passed, onRefreshDocuments calls that
 * same list so withUrls signs a fresh one. Nothing here builds a public URL.
 */
export function ApplicationQuickReview({
  applicationId,
  documents,
  onRefreshDocuments,
  onOpenDocuments,
}: {
  applicationId: string;
  documents: { id: string; url: string | null }[];
  onRefreshDocuments: () => Promise<void> | void;
  onOpenDocuments: () => void;
}) {
  const load = useServerFn(getApplicationQuickReview);
  const { data } = useQuery({
    queryKey: ["application-quick-review", applicationId],
    queryFn: () => load({ data: { applicationId } }),
  });
  if (!data?.show) return null;
  return (
    <ApplicationQuickReviewPanel
      review={data}
      documents={documents}
      onRefreshDocuments={onRefreshDocuments}
      onOpenDocuments={onOpenDocuments}
    />
  );
}

function isImage(doc: QuickReviewDocument): boolean {
  return (doc.mimeType ?? "").startsWith("image/");
}

function ApplicationQuickReviewPanel({
  review,
  documents,
  onRefreshDocuments,
  onOpenDocuments,
}: {
  review: QuickReview;
  documents: { id: string; url: string | null }[];
  onRefreshDocuments: () => Promise<void> | void;
  onOpenDocuments: () => void;
}) {
  const [refreshState, setRefreshState] = useState<"idle" | "pending" | "done">("idle");
  const shouldRefresh = review.documents.some((doc) =>
    quickReviewDocumentLink({
      url: documents.find((item) => item.id === doc.id)?.url ?? null,
      refreshState,
    }).shouldRefresh,
  );
  useEffect(() => {
    if (!shouldRefresh || refreshState !== "idle") return;
    setRefreshState("pending");
    void Promise.resolve(onRefreshDocuments()).finally(() => setRefreshState("done"));
  }, [shouldRefresh, refreshState, onRefreshDocuments]);

  return (
    <section className="rounded-2xl border border-[#EDEDF0] bg-white p-5 space-y-5">
      <h3 className="text-[13px] font-semibold text-[#111114]">Application Quick Review</h3>

      {review.fields.length > 0 ? (
        <div>
          <div className="text-[11px] font-semibold text-[#55555E]">Driver Info</div>
          <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
            {review.fields.map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="text-[10px] text-[#9A9AA3]">{field.label}</dt>
                <dd className="text-[12px] text-[#111114] truncate">{field.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {review.documents.length > 0 ? (
        <div>
          <div className="text-[11px] font-semibold text-[#55555E]">Documents</div>
          <ul className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {review.documents.map((doc) => {
              const stored = documents.find((item) => item.id === doc.id)?.url ?? null;
              const link = quickReviewDocumentLink({ url: stored, refreshState });
              const image = Boolean(link.href) && isImage(doc);
              return (
                <li key={doc.id} className="min-w-0">
                  {link.href ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className="block">
                      <span className="relative block aspect-[16/10] rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] overflow-hidden">
                        {image ? (
                          <img src={link.href} alt={doc.label} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <span className="absolute inset-0 grid place-items-center text-[#9A9AA3]">
                            <FileText className="w-6 h-6" />
                          </span>
                        )}
                      </span>
                    </a>
                  ) : (
                    <span className="relative block aspect-[16/10] rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] overflow-hidden">
                      <span className="absolute inset-0 grid place-items-center text-[#9A9AA3]">
                        <FileText className="w-6 h-6" />
                      </span>
                    </span>
                  )}
                  {link.showExpired ? (
                    <button type="button" onClick={onOpenDocuments} className="mt-1.5 text-left text-[11px] font-medium text-[#8A1F12]">
                      Link expired, open in Documents
                    </button>
                  ) : null}
                  <div className="mt-1.5 text-[12px] font-medium text-[#111114] leading-tight">{doc.label}</div>
                  {doc.fileName ? <div className="text-[11px] text-[#9A9AA3] truncate">{doc.fileName}</div> : null}
                  {doc.expiryLabel ? <div className="text-[11px] text-[#8A6A00]">{doc.expiryLabel}</div> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {review.identity ? (
        <div>
          <div className="text-[12px] font-semibold text-[#111114]">{review.identity.label}</div>
          {review.identity.detail ? <p className="mt-1 text-[12px] text-[#55555E]">{review.identity.detail}</p> : null}
          {review.identity.submitted ? <p className="mt-1 text-[11px] text-[#9A9AA3]">{review.identity.submitted}</p> : null}
        </div>
      ) : null}

      {review.esign ? (
        <div>
          <div className="text-[12px] font-semibold text-[#111114]">{review.esign.label}</div>
          <p className="mt-1 text-[12px] text-[#55555E]">{review.esign.detail}</p>
        </div>
      ) : null}

      {review.missing.length > 0 ? (
        <div>
          <div className="text-[11px] font-semibold text-[#55555E]">Still Needed</div>
          <ul className="mt-2 divide-y divide-[#EDEDF0]">
            {review.missing.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-[12px] font-medium text-[#111114]">{item.label}</span>
                {item.detail ? <span className="text-[12px] text-[#55555E] text-right">{item.detail}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
