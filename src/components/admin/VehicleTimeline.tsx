import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, FileText } from "lucide-react";
import { getVehicleTimeline } from "@/lib/maintenance.functions";
import { TIMELINE_FILTERS, type TimelineEvent } from "@/lib/maintenance-rules";
import { EmptyState } from "./ui";
import { useOpenEvidence } from "./VehicleService";

const when = (s: string) => new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// The vehicle's story, read from the canonical records — nothing stored twice.
export function VehicleTimeline({ vehicleId }: { vehicleId: string }) {
  const load = useServerFn(getVehicleTimeline);
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [filter, setFilter] = useState("all");
  const openEvidence = useOpenEvidence();
  useEffect(() => { load({ data: { vehicleId } }).then((r) => setEvents(r.events)).catch(() => setEvents([])); }, [vehicleId, load]);

  const filters = useMemo(() => TIMELINE_FILTERS.filter((f) => f.key === "all" || (events ?? []).some((e) => f.kinds.includes(e.kind))), [events]);
  if (!events) return <div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const kinds = TIMELINE_FILTERS.find((f) => f.key === filter)?.kinds ?? [];
  const shown = kinds.length ? events.filter((e) => kinds.includes(e.kind)) : events;

  return (
    <div className="space-y-4">
      {filters.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`h-8 rounded-full px-3 text-[13px] ${filter === f.key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{f.label}</button>
          ))}
        </div>
      )}
      {shown.length === 0 ? <EmptyState title="No Events Yet" /> : (
        <ol className="relative space-y-0 border-l border-border pl-5">
          {shown.map((e) => (
            <li key={e.id} className="relative pb-5">
              <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-foreground/70" />
              <div className="text-[12px] text-muted-foreground">{when(e.at)}</div>
              <div className="text-[14px] font-medium">{e.title}</div>
              {e.detail && <div className="text-[13px] text-muted-foreground">{e.detail}</div>}
              {e.evidenceDocumentId && (
                <button className="mt-1 inline-flex items-center gap-1 text-[12px] underline-offset-2 hover:underline" onClick={() => openEvidence(e.evidenceDocumentId!)}>
                  <FileText className="h-3.5 w-3.5" /> View Evidence
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
