import { fmtDate } from "@/lib/date-format";
import type { PickupChecklist, PickupLink } from "@/lib/pickup-checklist";

/**
 * Shown on the driver dashboard only after PICKUP_CHECKLIST_ENABLED is on
 * and the signed-in driver is approved. It does not save or send anything.
 */
export function PickupReadinessCard({
  checklist,
  onNavigate,
}: {
  checklist: PickupChecklist;
  onNavigate: (tab: PickupLink) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-white p-6" aria-label="Pickup Readiness">
      <h2 className="text-xl font-semibold">Pickup Readiness</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Each step is read from your account. Nothing here is saved or sent.
      </p>
      <ol className="mt-4 space-y-3">
        {checklist.steps.map((step) => {
          const when = step.date
            ? [fmtDate(step.date) || step.date, step.time].filter(Boolean).join(" · ")
            : null;
          return (
            <li key={step.id} className="rounded-xl border border-border px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">{step.label}</div>
                <div className={`text-sm font-semibold ${step.done ? "text-foreground" : "text-muted-foreground"}`}>
                  {step.done ? "Done" : "Pending"}
                </div>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
              {when ? <p className="mt-1 text-sm text-foreground">{when}</p> : null}
              {step.link && step.linkLabel ? (
                <button
                  type="button"
                  onClick={() => onNavigate(step.link as PickupLink)}
                  className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-real-red"
                >
                  {step.linkLabel}
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
      <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-sm font-semibold">Pickup Address</dt>
          <dd className="mt-1 text-sm text-muted-foreground">{checklist.site.address}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">Pickup Hours</dt>
          <dd className="mt-1 text-sm text-muted-foreground">{checklist.site.hours}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">Pickup Rules</dt>
          <dd className="mt-1 text-sm text-muted-foreground">{checklist.site.rules}</dd>
        </div>
      </dl>
    </section>
  );
}
