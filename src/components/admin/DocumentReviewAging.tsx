import {
  DOCUMENT_REVIEW_AGING_ENABLED,
  type DocumentReviewAgingResult,
  type DocumentReviewRow,
  waitingDayLabel,
} from "@/lib/document-review-aging";

const LABELS: Record<string, string> = {
  license_front: "License Front",
  license_back: "License Back",
  insurance_card: "Insurance",
  driver_profile_screenshot: "Gig Profile",
};

function labelFor(key: string): string {
  return LABELS[key] ?? "Document";
}

function ReviewRow({ row }: { row: DocumentReviewRow }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-t border-[#EDEDF0] px-3 py-2">
      <span className="text-[#111114]">{row.name}</span>
      <span className="shrink-0 text-[#55555E]">{waitingDayLabel(row.days)}</span>
    </li>
  );
}

export function DocumentReviewAging({
  canView,
  result,
}: {
  canView: boolean;
  result: DocumentReviewAgingResult | null;
}) {
  if (DOCUMENT_REVIEW_AGING_ENABLED !== true || canView !== true) return null;
  const failed = result?.failed === true;
  const categories = result?.categories ?? [];
  return (
    <section className="mb-4 rounded-lg border border-border bg-white" data-document-review-aging>
      <div className="border-b border-border px-3 py-2.5">
        <h2 className="text-[13px] font-semibold text-[#111114]">Document Review</h2>
        <p className="text-[12px] text-[#55555E]">Days Waiting By Category</p>
      </div>
      <div className="px-3 py-2 text-[12px] text-[#55555E]">
        {failed ? <p>Could Not Load Document Review</p> : null}
        {result && !failed && result.truncated ? (
          <p>Showing The First {result.cap} Uploads. Later Uploads Were Not Read.</p>
        ) : null}
        {!result && !failed ? <p>…</p> : null}
        {result && !failed && categories.length === 0 ? <p>Nothing Waiting</p> : null}
      </div>
      {result && !failed
        ? categories.map((category) => (
            <div key={category.key} className="border-t border-[#EDEDF0]">
              <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                <h3 className="text-[12px] font-semibold text-[#111114]">{labelFor(category.key)}</h3>
                <p className="text-[12px] text-[#55555E]">
                  {category.count} Waiting
                  {category.oldestDays == null ? "" : ` · Oldest ${waitingDayLabel(category.oldestDays)}`}
                </p>
              </div>
              <ul>
                {category.rows.map((row) => (
                  <ReviewRow key={row.id} row={row} />
                ))}
              </ul>
            </div>
          ))
        : null}
    </section>
  );
}
