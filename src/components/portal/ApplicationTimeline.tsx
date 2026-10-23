import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { APPLICATION_TIMELINE_ENABLED, type TimelineState } from "@/lib/application-timeline";
import { getMyApplicationTimeline, type MyApplicationTimeline } from "@/lib/application-timeline.functions";

const STATE_LABEL: Record<TimelineState, string> = {
  done: "Done",
  current: "Current",
  upcoming: "Upcoming",
};

/**
 * Fetches only when mounted. Parents mount this while the flag is on and the
 * person is not approved and not renting.
 */
export function ApplicationTimelineSection() {
  const fetchTimeline = useServerFn(getMyApplicationTimeline);
  const { data, isLoading, error } = useQuery({
    queryKey: ["application-timeline"],
    queryFn: () => fetchTimeline(),
    enabled: APPLICATION_TIMELINE_ENABLED,
  });
  if (!APPLICATION_TIMELINE_ENABLED) return null;
  return <ApplicationTimelineCard data={data} loading={isLoading} failed={Boolean(error)} />;
}

export function ApplicationTimelineCard({
  data,
  loading,
  failed,
}: {
  data: MyApplicationTimeline | undefined;
  loading: boolean;
  failed: boolean;
}) {
  if (failed) {
    return (
      <section className="rounded-2xl border border-border bg-white p-6" data-application-timeline="error">
        <h2 className="text-lg font-semibold">Application Status</h2>
        <p className="mt-2 text-sm text-muted-foreground">Could not load your application status. Refresh and try again.</p>
      </section>
    );
  }
  if (loading || !data) {
    return <section className="rounded-2xl border border-border bg-white p-6 text-sm text-muted-foreground">Loading Application Status…</section>;
  }
  if (!data.enabled || !data.show) return null;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-white p-6" data-application-timeline="ready">
      <h2 className="text-lg font-semibold">Application Status</h2>
      <ol className="mt-4 space-y-3">
        {data.steps.map((step) => (
          <li key={step.key} className="flex items-center justify-between gap-3">
            <span className={`text-sm ${step.state === "upcoming" ? "text-muted-foreground" : "font-medium text-foreground"}`}>
              {step.label}
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">{STATE_LABEL[step.state]}</span>
          </li>
        ))}
      </ol>
      {data.missing.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Still Needed</h3>
          <ul className="mt-2 space-y-1">
            {data.missing.map((item) => (
              <li key={item.key} className="text-sm text-foreground">
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
