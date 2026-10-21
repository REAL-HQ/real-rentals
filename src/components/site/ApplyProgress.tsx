import {
  APPLY_PROFILE_ITEMS,
  APPLY_PROGRESS_ENABLED,
  applyProgressView,
} from "@/lib/apply-progress";

/**
 * Sticky step indicator and, at the start of the flow, the documents the
 * profile form already asks for. Rendered only when the flag is exactly true.
 * No requests, no field changes.
 */
export function ApplyProgress({
  stepKey,
  showNeeded,
  className = "",
}: {
  stepKey: string;
  showNeeded: boolean;
  className?: string;
}) {
  if (APPLY_PROGRESS_ENABLED !== true) return null;
  const view = applyProgressView(stepKey);
  if (!view) return null;
  return (
    <>
      <div className={`sticky top-0 z-20 border-b border-border bg-white/95 backdrop-blur ${className}`}>
        <p className="flex min-h-11 items-center text-sm font-semibold">{view.heading}</p>
        {view.timeLabel ? <p className="pb-3 text-sm text-muted-foreground">{view.timeLabel}</p> : null}
      </div>
      {showNeeded ? (
        <section className={`mt-3 mb-4 rounded-xl border border-border bg-white px-4 py-3 ${className}`}>
          <h2 className="text-base font-semibold">What You'll Need</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            No documents needed to apply. Your licence, insurance and gig screenshots are what we need
            before you can pick a car up.
          </p>
          <ul className="mt-2">
            {APPLY_PROFILE_ITEMS.map((item) => (
              <li key={item.key} className="flex min-h-11 flex-col justify-center py-1">
                <span className="text-sm font-medium">{item.title}</span>
                <span className="text-sm text-muted-foreground">{item.blurb}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
