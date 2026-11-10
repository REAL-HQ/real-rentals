import { useMemo, useState } from "react";
import { IncidentsPanel } from "./IncidentsPanel";
import { DriverIssuesPanel } from "./DriverIssuesPanel";

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
    <div className="space-y-6" data-testid="issues-panel">
      <div className="admin-sticky-bar flex flex-col gap-2 pb-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111114]">Issues</h1>
          <p className="mt-1 text-[13px] text-[#55555E]">
            Accidents, Claims, Breakdowns And Driver Reports
          </p>
        </div>
        <div className="flex gap-1.5 max-lg:overflow-x-auto" role="tablist" aria-label="Issue Source">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={source === s.id}
              data-source={s.id}
              onClick={() => setSource(s.id)}
              className={`h-9 shrink-0 rounded-full px-3 text-[13px] font-medium border ${
                source === s.id
                  ? "bg-[#111114] text-white border-[#111114]"
                  : "bg-white text-[#55555E] border-[#EDEDF0]"
              }`}
            >
              {s.label}
            </button>
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
