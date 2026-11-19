import type { ReactNode } from "react";
import { AlarmClock, Flame, UserPlus, type LucideIcon } from "lucide-react";
import { personInitials } from "@/lib/display-normalize";
import { leadHeat, leadUrgencyStat, type LeadHeat } from "@/lib/lead-card";
import type { PriorityLead } from "@/lib/lead-priorities";
import { cn } from "@/lib/utils";

/** Solid urgency fill. Same hue on the avatar and the day count. */
const SOLID: Record<LeadHeat, { avatar: string; figure: string }> = {
  overdue: { avatar: "bg-brand", figure: "text-brand" },
  today: { avatar: "bg-amber-500", figure: "text-amber-600" },
  fresh: { avatar: "bg-emerald-600", figure: "text-emerald-700" },
  quiet: { avatar: "bg-zinc-400", figure: "text-foreground" },
};

type FaceLead = Pick<
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

export type LeadFace = {
  heat: LeadHeat;
  avatar: string;
  figureClass: string;
  figure: string | null;
  /** Tiny unit under a day count. Dates and "Today" stand alone. */
  caption: string | null;
  title?: string;
};

/** The one status value on the card. Notes, stage, and source stay off the face. */
export function leadFace(lead: FaceLead, today: string): LeadFace {
  const stat = leadUrgencyStat(lead, today);
  const heat = stat?.heat ?? leadHeat(lead.bucket);
  const tone = SOLID[heat];
  return {
    heat,
    avatar: tone.avatar,
    figureClass: tone.figure,
    figure: stat?.figure ?? null,
    caption: stat?.heat === "overdue" ? (stat.figure === "1" ? "Day" : "Days") : null,
    title: stat?.title,
  };
}

/** Presentational Lead Priorities card. Actions come in as a slot. */
export function LeadCardBody({
  lead,
  today,
  name,
  displayName = "Applicant",
  actions,
  view,
}: {
  lead: FaceLead;
  today: string;
  name: ReactNode;
  /** Used for the avatar. Falls back when a caller only passes the name node. */
  displayName?: string;
  actions: ReactNode;
  /** Optional stretched control. The list row already opens the applicant. */
  view?: ReactNode;
}) {
  const face = leadFace(lead, today);
  return (
    <div className="flex h-full flex-col justify-between gap-8 rounded-2xl border border-border bg-white p-5 text-card-foreground shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-md">
      <div className="flex min-w-0 items-center gap-4 pointer-events-none">
        <div
          aria-hidden="true"
          className={cn(
            "grid h-14 w-14 shrink-0 place-items-center rounded-full text-sm font-semibold text-white",
            face.avatar,
          )}
        >
          {personInitials(displayName)}
        </div>
        <div className="min-w-0 flex-1 break-words text-xl font-semibold leading-7 tracking-tight">{name}</div>
        {face.figure && (
          <div data-lead-urgency title={face.title} className="shrink-0 text-right">
            <div
              className={cn(
                "font-semibold leading-none tracking-tight tabular-nums",
                face.figure.length > 3 ? "text-xl" : "text-4xl",
                face.figureClass,
              )}
            >
              {face.figure}
            </div>
            {face.caption && (
              <div className="mt-1 text-[10px] font-medium tracking-wide text-muted-foreground">{face.caption}</div>
            )}
          </div>
        )}
      </div>
      <div className="pointer-events-none">{actions}</div>
      {view}
    </div>
  );
}

export function leadCallClass() {
  return "pointer-events-auto h-10 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand/90";
}

export function leadTextClass() {
  return "pointer-events-auto h-10 rounded-full border-border bg-white px-4 text-sm font-semibold text-foreground shadow-sm hover:bg-secondary";
}

export function leadStatTiles() {
  return [
    {
      label: "New",
      next: "new" as const,
      Icon: UserPlus,
      tile: "border-border bg-white text-foreground",
      icon: "bg-emerald-600 text-white",
    },
    {
      label: "Hot",
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
