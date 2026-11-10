import { useMemo, useState } from "react";
import { IncidentsPanel } from "./IncidentsPanel";
import { DriverIssuesPanel } from "./DriverIssuesPanel";
import { Button } from "@/components/ui/button";

/**
 * One Issues page for fleet incidents and driver reports.
 * Owns the page title (shell header is suppressed for this tab) so All /
 * Incident / Driver chips sit on the same row. Nested panels render section
 * chrome without a second sticky bar, so status chips are never clipped.
 */
const SOURCES = [
  { id: "all", label: "All" },
  { id: "incident", label: "Incident" },
  { id: "driver", label: "Driver" },
] as const;

export function IssuesPanel({
  seedIssueId = null,
  initialSource = "all",
}: {
  seedIssueId?: string | null;
  initialSource?: string;
}) {
  const start = useMemo(() => {
    const hit = SOURCES.find((s) => s.id === initialSource);
    return hit ? hit.id : "all";
  }, [initialSource]);
  const [source, setSource] = useState<(typeof SOURCES)[number]["id"]>(start);

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="issues-panel">
      <div data-admin-flow className="admin-sticky-bar flex flex-col gap-3 pb-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-normal text-foreground">Issues</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Accidents, Claims, Breakdowns And Driver Reports
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5" role="tablist" aria-label="Issue Source">
          {SOURCES.map((s) => (
            <Button
              key={s.id}
              type="button"
              variant={source === s.id ? "default" : "outline"}
              role="tab"
              aria-selected={source === s.id}
              data-source={s.id}
              onClick={() => setSource(s.id)}
              className={`h-9 shrink-0 rounded-full border px-3 text-[13px] shadow-none ${source === s.id ? "border-primary" : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>
      {(source === "all" || source === "incident") && (
        <section aria-label="Incidents">
          <IncidentsPanel seedIssueId={seedIssueId} embedded />
        </section>
      )}
      {(source === "all" || source === "driver") && (
        <section aria-label="Driver Reports">
          <DriverIssuesPanel embedded />
        </section>
      )}
    </div>
  );
}
