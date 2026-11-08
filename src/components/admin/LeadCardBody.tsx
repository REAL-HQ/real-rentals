import type { ReactNode } from "react";
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
  const isHighPriority = lead.priority === "High";
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="min-w-0 break-words text-base font-semibold leading-5">{name}</div>
      <p data-lead-next className="text-[13px] font-medium leading-5 text-card-foreground">
        {LEAD_NEXT_STEP[lead.bucket]}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {status}
        <span
          data-lead-badge
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isHighPriority ? "bg-destructive/10 text-destructive" : tone.badge
          }`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${lead.bucket === "overdue" || isHighPriority ? "bg-brand" : "bg-muted-foreground/40"}`} />
          {leadBadgeLabel(lead.bucket, lead.contactLabel, lead.priority)}
        </span>
      </div>
      {draft}
      <p data-lead-timing className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-4 text-muted-foreground">
        {timing.map((t, i) => (
          <span key={t} className={i === 0 && lead.bucket === "overdue" ? "font-medium text-brand" : undefined}>
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
