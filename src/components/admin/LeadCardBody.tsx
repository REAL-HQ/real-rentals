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

export type LeadCardSurface = "light" | "glass";

const RING: Record<LeadHeat, string> = {
  overdue: "bg-gradient-to-br from-rose-300 to-brand shadow-[0_0_16px_0_var(--real-red)]",
  today: "bg-gradient-to-br from-amber-200 to-amber-500 shadow-[0_0_16px_0_rgb(245,158,11)]",
  fresh: "bg-gradient-to-br from-emerald-300 to-emerald-600 shadow-[0_0_16px_0_rgb(16,185,129)]",
  quiet: "bg-gradient-to-br from-zinc-200 to-zinc-400 shadow-[0_0_12px_0_rgb(161,161,170)]",
};

const BAND: Record<LeadCardSurface, Record<LeadHeat, string>> = {
  light: {
    overdue: "from-rose-100/90",
    today: "from-amber-100/90",
    fresh: "from-emerald-100/80",
    quiet: "from-zinc-100/80",
  },
  glass: {
    overdue: "from-rose-400/25",
    today: "from-amber-300/20",
    fresh: "from-emerald-300/20",
    quiet: "from-white/10",
  },
};

const FIGURE: Record<LeadHeat, string> = {
  overdue: "text-brand",
  today: "text-amber-600",
  fresh: "text-emerald-700",
  quiet: "text-foreground",
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
  surface = "light",
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
  surface?: LeadCardSurface;
}) {
  const stat = leadUrgencyStat(lead, today);
  const heat = stat?.heat ?? leadHeat(lead.bucket);
  const note = lead.contact_status_note?.trim() || "";
  const context = leadContextLine(lead);
  const glass = surface === "glass";
  return (
    <div
      data-lead-surface={surface}
      className={cn(
        "group relative flex h-full flex-col gap-4 rounded-2xl border p-4 transition duration-200 hover:-translate-y-1 hover:scale-[1.015] hover:shadow-xl",
        glass
          ? "border-white/20 bg-gradient-to-b from-white/20 via-white/10 to-white/[0.06] text-white shadow-[0_18px_50px_-28px_rgba(0,0,0,0.85)] backdrop-blur-xl"
          : "border-black/5 bg-white text-card-foreground shadow-[0_10px_30px_-18px_rgba(17,17,20,0.35)]",
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-2xl bg-gradient-to-b to-transparent",
          BAND[surface][heat],
        )}
      />
      <div className="relative z-10 flex min-w-0 items-start gap-3 pointer-events-none">
        <div
          aria-hidden="true"
          className={cn("grid h-16 w-16 shrink-0 place-items-center rounded-full p-1", RING[heat])}
        >
          <div
            className={cn(
              "grid h-full w-full place-items-center rounded-full text-sm font-semibold",
              glass ? "bg-zinc-950 text-white" : "bg-white text-foreground",
            )}
          >
            {personInitials(displayName)}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="min-w-0 break-words text-lg font-bold leading-6 tracking-tight">{name}</div>
                <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">{status}</div>
              </div>
              {context && (
                <p className={cn("mt-1 text-[11px]", glass ? "text-white/55" : "text-muted-foreground")}>{context}</p>
              )}
            </div>
            {stat && (
              <div data-lead-urgency title={stat.title} className="shrink-0 text-right">
                <div
                  className={cn(
                    "font-semibold leading-none tracking-tight tabular-nums",
                    stat.figure.length > 3 ? "text-lg" : "text-4xl",
                    glass && heat === "overdue" ? "text-rose-300" : glass && heat === "today" ? "text-amber-200" : FIGURE[heat],
                  )}
                >
                  {stat.figure}
                </div>
                <div className={cn("mt-1 text-[10px] font-semibold tracking-wide", glass ? "text-white/60" : "text-muted-foreground")}>
                  {stat.unit}
                </div>
                <div
                  aria-hidden="true"
                  className={cn("mt-1.5 ml-auto h-1 w-14 overflow-hidden rounded-full", glass ? "bg-white/15" : "bg-black/5")}
                >
                  <div
                    className={cn(
                      "h-full rounded-full",
                      heat === "overdue" ? "bg-brand" : heat === "today" ? "bg-amber-500" : "bg-zinc-400",
                    )}
                    style={{ width: `${stat.meter}%` }}
                  />
                </div>
              </div>
            )}
            {menu && <div className="pointer-events-auto shrink-0">{menu}</div>}
          </div>
        </div>
      </div>
      {draft && <div className="relative z-10 pointer-events-auto">{draft}</div>}
      <div className="relative z-10 flex flex-wrap items-center gap-2 pointer-events-none">
        <p
          data-lead-timing
          className={cn(
            "inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            glass ? "bg-white/10 text-white/70" : "bg-black/[0.04] text-muted-foreground",
          )}
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
                className={cn(
                  "relative z-10 flex items-start gap-1.5 line-clamp-1 cursor-default text-[13px] italic leading-5 pointer-events-auto",
                  glass ? "text-white/75" : "text-muted-foreground",
                )}
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
      <div className="relative z-10 mt-auto pointer-events-none">{actions}</div>
      {view}
    </div>
  );
}

export function leadCallClass() {
  return "pointer-events-auto h-9 rounded-full bg-brand px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-brand/90";
}

export function leadTextClass(surface: LeadCardSurface = "light") {
  return surface === "glass"
    ? "pointer-events-auto h-9 rounded-full border-white/25 bg-white/10 px-3.5 text-xs font-semibold text-white shadow-none hover:bg-white/15"
    : "pointer-events-auto h-9 rounded-full border-border bg-white px-3.5 text-xs font-semibold text-foreground shadow-sm hover:bg-secondary";
}

export function leadStatTiles(surface: LeadCardSurface = "light") {
  const glass = surface === "glass";
  return [
    {
      label: "New Leads",
      next: "new" as const,
      Icon: UserPlus,
      tile: glass
        ? "border-emerald-300/30 bg-gradient-to-br from-emerald-400/25 to-white/5 text-white"
        : "border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white text-emerald-950",
      icon: "bg-emerald-500 text-white",
    },
    {
      label: "Hot Leads",
      next: "interested" as const,
      Icon: Flame,
      tile: glass
        ? "border-amber-300/30 bg-gradient-to-br from-amber-300/25 to-white/5 text-white"
        : "border-amber-200/80 bg-gradient-to-br from-amber-50 to-white text-amber-950",
      icon: "bg-amber-500 text-white",
    },
    {
      label: "Overdue",
      next: "follow_up_due" as const,
      Icon: AlarmClock,
      tile: glass
        ? "border-rose-300/40 bg-gradient-to-br from-rose-400/30 to-white/5 text-white"
        : "border-rose-200/80 bg-gradient-to-br from-rose-50 to-white text-rose-950",
      icon: "bg-brand text-white",
    },
  ] satisfies { label: string; next: "new" | "interested" | "follow_up_due"; Icon: LucideIcon; tile: string; icon: string }[];
}
