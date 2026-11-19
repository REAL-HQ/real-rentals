import type { ReactNode } from "react";
import { AlarmClock, Clock, Flame, UserPlus, type LucideIcon } from "lucide-react";
import { personInitials } from "@/lib/display-normalize";
import { leadContactMeta, leadContextLine, leadHeat, leadUrgencyStat, type LeadHeat } from "@/lib/lead-card";
import type { PriorityLead } from "@/lib/lead-priorities";
import { cn } from "@/lib/utils";

/** Solid urgency fill. Same hue on the avatar and the day count. */
const SOLID: Record<LeadHeat, { avatar: string; figure: string }> = {
  overdue: { avatar: "bg-brand", figure: "text-brand" },
  today: { avatar: "bg-amber-500", figure: "text-amber-600" },
  fresh: { avatar: "bg-emerald-600", figure: "text-emerald-700" },
  quiet: { avatar: "bg-zinc-400", figure: "text-foreground" },
};

const DARK_FIGURE: Record<LeadHeat, string> = {
  overdue: "text-rose-400",
  today: "text-amber-300",
  fresh: "text-emerald-400",
  quiet: "text-zinc-200",
};

const NOTE: Record<LeadHeat, string> = {
  overdue: "bg-rose-50",
  today: "bg-amber-50",
  fresh: "bg-emerald-50",
  quiet: "bg-zinc-100",
};

const TINT: Record<LeadHeat, string> = {
  overdue: "bg-rose-50",
  today: "bg-amber-50",
  fresh: "bg-emerald-50",
  quiet: "bg-zinc-50",
};

const DEEP: Record<LeadHeat, string> = {
  overdue: "bg-rose-100",
  today: "bg-amber-100",
  fresh: "bg-emerald-100",
  quiet: "bg-zinc-200",
};

const DARK_NOTE: Record<LeadHeat, string> = {
  overdue: "bg-rose-950 text-rose-100",
  today: "bg-amber-950 text-amber-100",
  fresh: "bg-emerald-950 text-emerald-100",
  quiet: "bg-zinc-800 text-zinc-200",
};

export type LeadCardLook = "white" | "dark" | "tint" | "split";

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
  /** Unit under the status value: Days Overdue, Due, or Scheduled. */
  caption: string | null;
  title?: string;
};

/** Status value for the card. The unit stays with the figure. */
export function leadFace(lead: FaceLead, today: string, look: LeadCardLook = "white"): LeadFace {
  const stat = leadUrgencyStat(lead, today);
  const heat = stat?.heat ?? leadHeat(lead.bucket);
  return {
    heat,
    avatar: SOLID[heat].avatar,
    figureClass: look === "dark" ? DARK_FIGURE[heat] : SOLID[heat].figure,
    figure: stat?.figure ?? null,
    caption: stat?.unit ?? null,
    title: stat?.title,
  };
}

function noteClass(look: LeadCardLook, heat: LeadHeat) {
  if (look === "dark") return DARK_NOTE[heat];
  if (look === "tint") return DEEP[heat];
  return NOTE[heat];
}

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
  look = "white",
}: {
  lead: FaceLead;
  today: string;
  name: ReactNode;
  /** Used for the avatar. Falls back when a caller only passes the name node. */
  displayName?: string;
  status?: ReactNode;
  draft?: ReactNode;
  actions: ReactNode;
  /** Optional ⋮ menu, pinned beside the name. */
  menu?: ReactNode;
  /** Optional stretched control. The list row already opens the applicant. */
  view?: ReactNode;
  /** Review-page chrome. Overview uses white. */
  look?: LeadCardLook;
}) {
  const face = leadFace(lead, today, look);
  const note = lead.contact_status_note?.trim() || "";
  const context = leadContextLine(lead);
  const dark = look === "dark";
  const meta = (
    <p className={cn("mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4", dark ? "text-zinc-400" : "text-muted-foreground")}>
      {context && (
        <>
          <span>{context}</span>
          <span aria-hidden="true" className={dark ? "text-zinc-600" : "text-zinc-300"}>
            ·
          </span>
        </>
      )}
      <span data-lead-timing className="inline-flex items-center gap-1">
        <Clock aria-hidden="true" className="h-3 w-3 shrink-0" />
        {leadContactMeta(lead)}
      </span>
    </p>
  );
  const noteBlock = note ? (
    <p
      className={cn("line-clamp-2 rounded-xl px-3 py-2 text-xs leading-5", noteClass(look, face.heat))}
      title={note}
    >
      {note}
    </p>
  ) : null;
  const figure = face.figure ? (
    <div data-lead-urgency title={face.title} className={cn("shrink-0 text-right", look === "split" && "text-center")}>
      <div
        className={cn(
          "font-semibold leading-none tracking-tight tabular-nums",
          face.figure.length > 3 ? "text-sm" : "text-2xl",
          face.figureClass,
        )}
      >
        {face.figure}
      </div>
      {face.caption && (
        <div className={cn("mt-1 text-[10px] font-medium leading-3", dark ? "text-zinc-400" : "text-muted-foreground")}>
          {face.caption}
        </div>
      )}
    </div>
  ) : null;
  const avatar = (
    <div
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white",
        look === "split" ? "h-10 w-10 text-xs" : "h-11 w-11 text-sm",
        face.avatar,
      )}
    >
      {personInitials(displayName)}
    </div>
  );
  const shell = cn(
    "flex h-full flex-col gap-3 rounded-2xl border p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md",
    look === "dark" && "border-zinc-800 bg-zinc-900 text-white",
    look === "tint" && cn("border-border text-foreground", TINT[face.heat]),
    (look === "white" || look === "split") && "border-border bg-white text-card-foreground",
    look === "split" && "p-0",
  );

  if (look === "split") {
    return (
      <div className={shell}>
        <div className="flex min-h-full min-w-0 flex-1">
          <div className="flex w-[6.75rem] shrink-0 flex-col items-center justify-center gap-2 border-r border-border bg-zinc-50 px-2 py-4">
            {avatar}
            {figure}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
            <div className="flex items-start gap-2 pointer-events-none">
              <div className="min-w-0 flex-1">
                <div className="break-words text-[15px] font-semibold leading-5 tracking-tight">{name}</div>
                {status && <div className="pointer-events-auto mt-1.5 flex flex-wrap items-center gap-1">{status}</div>}
                {meta}
              </div>
              {menu && <div className="pointer-events-auto shrink-0">{menu}</div>}
            </div>
            {draft && <div className="pointer-events-auto">{draft}</div>}
            {noteBlock}
            <div className="mt-auto pointer-events-none">{actions}</div>
          </div>
        </div>
        {view}
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="flex min-w-0 items-start gap-3 pointer-events-none">
        {avatar}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="break-words text-[15px] font-semibold leading-5 tracking-tight">{name}</div>
              {status && <div className="pointer-events-auto mt-1.5 flex flex-wrap items-center gap-1">{status}</div>}
            </div>
            {figure}
            {menu && <div className="pointer-events-auto shrink-0">{menu}</div>}
          </div>
          {meta}
        </div>
      </div>
      {draft && <div className="pointer-events-auto">{draft}</div>}
      {noteBlock}
      <div className="mt-auto pointer-events-none">{actions}</div>
      {view}
    </div>
  );
}

export function leadCallClass() {
  return "pointer-events-auto h-8 rounded-full bg-brand px-3 text-xs font-semibold text-white shadow-sm hover:bg-brand/90";
}

export function leadTextClass() {
  return "pointer-events-auto h-8 rounded-full border-border bg-white px-3 text-xs font-semibold text-foreground shadow-sm hover:bg-secondary";
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
