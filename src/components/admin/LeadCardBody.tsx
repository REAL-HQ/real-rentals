import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { LEAD_NEXT_STEP, LEAD_TONES, leadBadgeLabel, leadTiming } from "@/lib/lead-card";
import type { PriorityLead } from "@/lib/lead-priorities";

/** Presentational Lead Priorities card. Interactive pieces come in as slots. */
export function LeadCardBody({
  lead,
  today,
  name,
  status,
  draft,
  actions,
}: {
  lead: Pick<
    PriorityLead,
    "bucket" | "priority" | "contactLabel" | "created_at" | "contact_status_at" | "contact_follow_up_on" | "contact_status_note"
  >;
  today: string;
  name: ReactNode;
  status: ReactNode;
  draft?: ReactNode;
  actions: ReactNode;
}) {
  const tone = LEAD_TONES[lead.bucket];
  const timing = leadTiming(lead, today);
  return (
    <div
      data-lead-tone={tone.key}
      className={`flex h-full flex-col gap-2.5 rounded-lg border border-l-4 border-border bg-card p-4 text-card-foreground ${tone.accent}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1 break-words text-base font-semibold leading-5">{name}</div>
        <span data-lead-badge className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.badge}`}>
          {leadBadgeLabel(lead.bucket, lead.contactLabel, lead.priority)}
        </span>
      </div>
      <p data-lead-next className="text-sm font-medium text-card-foreground">{LEAD_NEXT_STEP[lead.bucket]}</p>
      <div className="flex flex-wrap items-center gap-2">{status}</div>
      {draft}
      <p data-lead-timing className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-4 text-muted-foreground">
        <CalendarDays aria-hidden="true" className="h-3 w-3 shrink-0" />
        {timing.map((t, i) => (
          <span key={t} className={i === 0 && lead.bucket === "overdue" ? "font-semibold text-red-700 dark:text-red-400" : undefined}>
            {i > 0 ? "· " : ""}
            {t}
          </span>
        ))}
      </p>
      {lead.contact_status_note && (
        <p className="line-clamp-2 break-words text-xs text-muted-foreground" title={lead.contact_status_note}>
          Note: {lead.contact_status_note.slice(0, 240)}
        </p>
      )}
      {actions}
    </div>
  );
}
