import { useMemo, useState } from "react";
import { IncidentsPanel } from "./IncidentsPanel";
import { DriverIssuesPanel } from "./DriverIssuesPanel";

/**
 * One Issues page for fleet incidents and driver reports.
 * Keeps both tables; this is a unified view only. Incident Board stays flag-gated elsewhere.
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
    <div className="space-y-6">
      <div className="admin-sticky-bar flex flex-col gap-2 pb-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#111114]">Issues</h1>
          <p className="mt-1 text-[13px] text-[#55555E]">
            Accidents, claims, breakdowns and other reports in one place.
          </p>
        </div>
        <div className="flex gap-1.5 max-lg:overflow-x-auto" role="tablist" aria-label="Issue Source">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={source === s.id}
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
          {source === "all" ? (
            <h2 className="mb-3 text-[15px] font-semibold text-[#111114]">Incident</h2>
          ) : null}
          <IncidentsPanel seedIssueId={seedIssueId} />
        </section>
      )}
      {(source === "all" || source === "driver") && (
        <section aria-label="Driver Reports">
          {source === "all" ? (
            <h2 className="mb-3 mt-2 text-[15px] font-semibold text-[#111114]">Driver</h2>
          ) : null}
          <DriverIssuesPanel />
        </section>
      )}
    </div>
  );
}
