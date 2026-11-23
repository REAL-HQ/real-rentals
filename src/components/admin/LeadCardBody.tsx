import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { personInitials } from "@/lib/display-normalize";
import {
  LEAD_AVATAR_CLASS,
  leadActivity,
  leadUrgency,
  leadVisibleNextStep,
  type LeadAvatarQuality,
} from "@/lib/lead-card";
import type { PriorityLead } from "@/lib/lead-priorities";
import { cn } from "@/lib/utils";

/** Presentational Lead Priorities card. Interactive pieces come in as slots. */
export function LeadCardBody({
  lead,
  today,
  name,
  displayName = "Applicant",
  status,
  draft,
  actions,
  menu,
  view,
  quality = "neutral",
  emailBad = false,
}: {
  lead: Pick<
    PriorityLead,
    | "bucket"
    | "contact_status"
    | "priority"
    | "contactLabel"
    | "created_at"
    | "contact_status_at"
    | "contact_follow_up_on"
    | "contact_status_note"
  >;
  today: string;
  name: ReactNode;
  /** Used for the avatar. Falls back when a caller only passes the name node. */
  displayName?: string;
  status: ReactNode;
  draft?: ReactNode;
  actions: ReactNode;
  /** Optional ⋮ menu, pinned to the card's top-right corner beside the name. */
  menu?: ReactNode;
  /** Stretched link. Sits under the text so a click on the card opens the applicant. */
  view?: ReactNode;
  /** Readiness bucket for the avatar. Neutral when readiness was not provided. */
  quality?: LeadAvatarQuality;
  /** Email to this lead bounced (or is a typo/test domain). Automated email to it is off. */
  emailBad?: boolean;
}) {
  const urgency = leadUrgency(lead, today);
  const next = leadVisibleNextStep(lead.bucket);
  const note = lead.contact_status_note?.trim() || "";
  const activity = leadActivity(lead);
  const activityTitle = activity.when
    ? `${activity.label} · ${activity.when.long}`
    : activity.label;
  return (
    <div className="@container relative flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
      <div className="relative z-10 flex min-w-0 items-start gap-3 pointer-events-none">
        <div
          aria-hidden="true"
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold",
            LEAD_AVATAR_CLASS[quality],
          )}
          data-lead-avatar={quality}
        >
          {personInitials(displayName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <div className="min-w-0 break-words text-base font-semibold leading-5">{name}</div>
              {urgency && (
                <span
                  data-lead-urgency
                  title={urgency.title}
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    urgency.prominent
                      ? "bg-[#F9D0CC] text-[#111114]"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {urgency.label}
                </span>
              )}
              {emailBad && (
                <span
                  data-lead-bad-email
                  title="Email to this address bounced. Automated emails to it are off. Text them for a correct email."
                  className="inline-flex shrink-0 items-center rounded-full bg-[#FBE3C2] px-2 py-0.5 text-[11px] font-semibold text-[#111114]"
                >
                  Bad Email
                </span>
              )}
            </div>
            {menu && <div className="pointer-events-auto shrink-0">{menu}</div>}
          </div>
          {next && (
            <p data-lead-next className="mt-0.5 text-xs leading-4 text-muted-foreground">
              {next}
            </p>
          )}
          <div className="pointer-events-auto mt-2 flex flex-wrap items-center gap-1.5">
            {status}
          </div>
        </div>
      </div>
      {draft && <div className="relative z-10 pointer-events-auto">{draft}</div>}
      <p
        data-lead-timing
        title={activityTitle}
        className="relative z-10 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs leading-4 text-muted-foreground pointer-events-none"
      >
        <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {activity.label}
          {activity.when && (
            <>
              <span className="@min-[16rem]:hidden"> · {activity.when.short}</span>
              <span className="hidden @min-[16rem]:inline"> · {activity.when.long}</span>
            </>
          )}
        </span>
      </p>
      {note && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="relative z-10 line-clamp-1 cursor-default break-words text-xs text-muted-foreground pointer-events-auto"
                title={note}
              >
                {note}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{note}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <div className="relative z-10 mt-auto w-full pointer-events-none">{actions}</div>
      {view}
    </div>
  );
}
