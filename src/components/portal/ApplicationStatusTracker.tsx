import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ApplicationStatusView } from "@/lib/application-status-tracker";

const STATE_LABEL = { done: "Done", current: "In Progress", waiting: "Not Yet" } as const;

/**
 * Read-only. Mounted only while APPLICATION_STATUS_TRACKER_ENABLED is true.
 */
export function ApplicationStatusTracker({ read }: { read: () => Promise<ApplicationStatusView | null> }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["application-status-tracker"],
    queryFn: () => read(),
  });

  if (isLoading) return <p className="mt-8 text-sm text-muted-foreground">Loading…</p>;
  if (error) {
    return <p className="mt-8 text-sm text-real-red">{error instanceof Error ? error.message : "Could not load application status."}</p>;
  }
  if (!data) return null;

  return (
    <section className="mt-8 rounded-xl border border-border p-6">
      <h2 className="text-sm font-semibold">Application Status</h2>
      <p className="mt-1 text-xs text-muted-foreground">Eastern Time</p>
      <ol className="mt-4 space-y-4">
        {data.steps.map((step) => (
          <li key={step.title}>
            <div className="text-sm font-medium">{step.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {STATE_LABEL[step.state]}
              {step.date ? ` · ${step.date}` : ""}
            </div>
            {step.detail ? <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p> : null}
          </li>
        ))}
      </ol>
      {data.received.length > 0 ? (
        <ul className="mt-4 space-y-1 text-sm">
          {data.received.map((doc) => (
            <li key={doc.label}>
              {doc.label}
              {doc.date ? ` · ${doc.date}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {data.missing.length > 0 ? <p className="mt-4 text-xs text-muted-foreground">Not recorded: {data.missing.join(", ")}</p> : null}
      {data.omitted.length > 0 ? <p className="mt-2 text-xs text-muted-foreground">Not shown: {data.omitted.join(", ")}</p> : null}
      {data.applyHref ? (
        <Link to={data.applyHref} className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-real-red">
          Apply
        </Link>
      ) : null}
    </section>
  );
}
