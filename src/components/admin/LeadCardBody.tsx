import type { ReactNode } from "react";
import { AlarmClock, Clock, Flame, Quote, UserPlus, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { personInitials } from "@/lib/display-normalize";
import {
  leadContactMeta,
  leadContextLine,
  leadHeat,
  leadUrgencyStat,
  type LeadHeat,
} from "@/lib/lead-card";
import type { PriorityLead } from "@/lib/lead-priorities";
import { cn } from "@/lib/utils";

/** Solid urgency fill. Same hue on the avatar and the day count. */
const SOLID: Record<LeadHeat, { avatar: string; figure: string }> = {
  overdue: { avatar: "bg-brand", figure: "text-brand" },
  today: { avatar: "bg-amber-500", figure: "text-amber-600" },
  fresh: { avatar: "bg-emerald-600", figure: "text-emerald-700" },
  quiet: { avatar: "bg-zinc-400", figure: "text-foreground" },
};

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
    | "source"
    | "vehicle_size"
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
}) {
  const stat = leadUrgencyStat(lead, today);
  const heat = stat?.heat ?? leadHeat(lead.bucket);
  const tone = SOLID[heat];
  const note = lead.contact_status_note?.trim() || "";
  const context = leadContextLine(lead);
  return (
    <div className="group relative flex h-full flex-col gap-4 rounded-2xl border border-border bg-white p-4 text-card-foreground shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-md">
      <div className="flex min-w-0 items-start gap-3 pointer-events-none">
        <div
          aria-hidden="true"
          className={cn(
            "grid h-14 w-14 shrink-0 place-items-center rounded-full text-sm font-semibold text-white",
            tone.avatar,
          )}
        >
          {personInitials(displayName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="min-w-0 break-words text-lg font-bold leading-6 tracking-tight">{name}</div>
                <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">{status}</div>
              </div>
              {context && <p className="mt-1 text-[11px] text-muted-foreground">{context}</p>}
            </div>
            {stat && (
              <div data-lead-urgency title={stat.title} className="shrink-0 text-right">
                <div
                  className={cn(
                    "font-semibold leading-none tracking-tight tabular-nums",
                    stat.figure.length > 3 ? "text-lg" : "text-4xl",
                    tone.figure,
                  )}
                >
                  {stat.figure}
                </div>
                <div className="mt-1 text-[10px] font-semibold tracking-wide text-muted-foreground">{stat.unit}</div>
              </div>
            )}
            {menu && <div className="pointer-events-auto shrink-0">{menu}</div>}
          </div>
        </div>
      </div>
      {draft && <div className="pointer-events-auto">{draft}</div>}
      <div className="flex flex-wrap items-center gap-2 pointer-events-none">
        <p
          data-lead-timing
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
        >
          <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>{leadContactMeta(lead)}</span>
        </p>
      </div>
      {note && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                className="flex cursor-default items-start gap-1.5 text-[13px] italic leading-5 text-muted-foreground line-clamp-1 pointer-events-auto"
                title={note}
              >
                <Quote aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="min-w-0 flex-1 truncate">{note}</span>
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{note}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <div className="mt-auto pointer-events-none">{actions}</div>
      {view}
    </div>
  );
}

export function leadCallClass() {
  return "pointer-events-auto h-9 rounded-full bg-brand px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-brand/90";
}

export function leadTextClass() {
  return "pointer-events-auto h-9 rounded-full border-border bg-white px-3.5 text-xs font-semibold text-foreground shadow-sm hover:bg-secondary";
}

export function leadStatTiles() {
  return [
    {
      label: "New Leads",
      next: "new" as const,
      Icon: UserPlus,
      tile: "border-border bg-white text-foreground",
      icon: "bg-emerald-600 text-white",
    },
    {
      label: "Hot Leads",
      next: "interested" as const,
      Icon: Flame,
      tile: "border-border bg-white text-foreground",
      icon: "bg-amber-500 text-white",
    },
    {
      label: "Overdue",
      next: "follow_up_due" as const,
      Icon: AlarmClock,
      tile: "border-border bg-white text-foreground",
      icon: "bg-brand text-white",
    },
  ] satisfies { label: string; next: "new" | "interested" | "follow_up_due"; Icon: LucideIcon; tile: string; icon: string }[];
}
