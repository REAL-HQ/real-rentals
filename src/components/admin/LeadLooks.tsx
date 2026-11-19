import type { ReactNode } from "react";
import { ArrowUpRight, MessageSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { personInitials } from "@/lib/display-normalize";
import type { LeadHeat } from "@/lib/lead-card";
import type { PriorityLead } from "@/lib/lead-priorities";
import { cn } from "@/lib/utils";
import { LeadCardBody, leadCallClass, leadFace, leadStatTiles, leadTextClass } from "./LeadCardBody";

export type LookId = "a" | "b" | "c" | "d" | "e";

export const LEAD_LOOKS: { id: LookId; title: string; blurb: string }[] = [
  { id: "a", title: "Look A — Clean White", blurb: "White cards, even border, solid avatars. Overview uses this look." },
  { id: "b", title: "Look B — Dark Luxe", blurb: "Charcoal cards, white type, solid red, amber, and green accents." },
  { id: "c", title: "Look C — Solid Tint", blurb: "Each card is a flat tint matched to urgency, with a bold count." },
  { id: "d", title: "Look D — Compact Rows", blurb: "One line per lead: avatar, name, status pill, icon buttons." },
  { id: "e", title: "Look E — Big Number", blurb: "The status count leads. The name stays small. Actions are icons." },
];

export type LookLead = { lead: PriorityLead; name: string; phone: string };
export type LookCounts = { fresh: number; hot: number; overdue: number };

const DARK_FIGURE: Record<LeadHeat, string> = {
  overdue: "text-rose-400",
  today: "text-amber-300",
  fresh: "text-emerald-400",
  quiet: "text-zinc-200",
};

const TINT: Record<LeadHeat, string> = {
  overdue: "bg-rose-50",
  today: "bg-amber-50",
  fresh: "bg-emerald-50",
  quiet: "bg-zinc-50",
};

function Avatar({ name, className }: { name: string; className: string }) {
  return (
    <div aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white", className)}>
      {personInitials(name)}
    </div>
  );
}

function LabeledActions({ phone, arrow = false }: { phone: string; arrow?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" className={leadCallClass()}>
        <a href={`tel:${phone}`} aria-label="Call">
          <Phone aria-hidden="true" />
          Call
        </a>
      </Button>
      <Button variant="outline" size="sm" aria-label="Text" className={leadTextClass()}>
        <MessageSquare aria-hidden="true" />
        Text
      </Button>
      {arrow && <ArrowUpRight aria-hidden="true" className="ml-auto h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

function IconActions({ phone, dark = false }: { phone: string; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <a
        href={`tel:${phone}`}
        aria-label="Call"
        className="grid h-10 w-10 place-items-center rounded-full bg-brand text-white"
      >
        <Phone aria-hidden="true" className="h-4 w-4" />
      </a>
      <button
        type="button"
        aria-label="Text"
        className={cn(
          "grid h-10 w-10 place-items-center rounded-full border",
          dark ? "border-white/25 text-white" : "border-border bg-white text-foreground",
        )}
      >
        <MessageSquare aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

function Count({ face, className, captionClass }: { face: ReturnType<typeof leadFace>; className: string; captionClass: string }) {
  if (!face.figure) return null;
  return (
    <div data-lead-urgency title={face.title} className="shrink-0 text-right">
      <div className={cn("font-semibold leading-none tracking-tight tabular-nums", face.figure.length > 3 ? "text-xl" : className, face.figureClass)}>
        {face.figure}
      </div>
      {face.caption && <div className={cn("mt-1 text-[10px] font-medium tracking-wide", captionClass)}>{face.caption}</div>}
    </div>
  );
}

function StatTrio({
  counts,
  tile,
  number,
  label,
}: {
  counts: LookCounts;
  tile: string;
  number: string;
  label: string;
}) {
  const items = [
    { label: "New", value: counts.fresh, icon: "bg-emerald-600" },
    { label: "Hot", value: counts.hot, icon: "bg-amber-500" },
    { label: "Overdue", value: counts.overdue, icon: "bg-brand" },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((item) => (
        <div key={item.label} className={cn("flex min-h-[96px] flex-col items-start justify-between rounded-2xl border px-4 py-4", tile)}>
          <span className={cn("grid h-7 w-7 place-items-center rounded-lg text-white", item.icon)}>
            <span className="h-2 w-2 rounded-full bg-white" />
          </span>
          <span className={cn("mt-4 text-4xl font-semibold leading-none tabular-nums", number)}>{item.value}</span>
          <span className={cn("mt-1.5 text-sm font-medium", label)}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function LookA({ leads, today, counts }: { leads: LookLead[]; today: string; counts: LookCounts }) {
  const tiles = leadStatTiles();
  const values = [counts.fresh, counts.hot, counts.overdue];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((tile, index) => (
          <div key={tile.label} className={cn("flex min-h-[96px] flex-col items-start justify-between rounded-2xl border px-4 py-4 shadow-sm", tile.tile)}>
            <span className={cn("grid h-7 w-7 place-items-center rounded-lg", tile.icon)}>
              <tile.Icon aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
            <span className="mt-4 text-4xl font-semibold leading-none tabular-nums">{values[index]}</span>
            <span className="mt-1.5 text-sm font-medium text-muted-foreground">{tile.label}</span>
          </div>
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {leads.map(({ lead, name, phone }) => (
          <li key={lead.id}>
            <LeadCardBody lead={lead} today={today} displayName={name} name={name} actions={<LabeledActions phone={phone} arrow />} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function LookB({ leads, today, counts }: { leads: LookLead[]; today: string; counts: LookCounts }) {
  return (
    <div className="space-y-4 rounded-3xl bg-zinc-950 p-4 text-white sm:p-5">
      <StatTrio counts={counts} tile="border-zinc-800 bg-zinc-900 text-white" number="text-white" label="text-zinc-400" />
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {leads.map(({ lead, name, phone }) => {
          const face = leadFace(lead, today);
          return (
            <li key={lead.id}>
              <div className="flex h-full flex-col justify-between gap-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                <div className="flex min-w-0 items-center gap-4">
                  <Avatar name={name} className={cn("h-14 w-14 text-sm", face.avatar)} />
                  <div className="min-w-0 flex-1 break-words text-xl font-semibold leading-7 tracking-tight">{name}</div>
                  {face.figure && (
                    <div title={face.title} className="shrink-0 text-right">
                      <div className={cn("font-semibold leading-none tabular-nums", face.figure.length > 3 ? "text-xl" : "text-4xl", DARK_FIGURE[face.heat])}>
                        {face.figure}
                      </div>
                      {face.caption && <div className="mt-1 text-[10px] font-medium tracking-wide text-zinc-400">{face.caption}</div>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <a href={`tel:${phone}`} aria-label="Call" className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white">
                    <Phone aria-hidden="true" className="h-4 w-4" />
                    Call
                  </a>
                  <button type="button" aria-label="Text" className="inline-flex h-10 items-center gap-2 rounded-full border border-white/25 px-4 text-sm font-semibold text-white">
                    <MessageSquare aria-hidden="true" className="h-4 w-4" />
                    Text
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LookC({ leads, today, counts }: { leads: LookLead[]; today: string; counts: LookCounts }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "New", value: counts.fresh, tile: "border-border bg-emerald-50" },
          { label: "Hot", value: counts.hot, tile: "border-border bg-amber-50" },
          { label: "Overdue", value: counts.overdue, tile: "border-border bg-rose-50" },
        ].map((item) => (
          <div key={item.label} className={cn("flex min-h-[96px] flex-col justify-end rounded-2xl border px-4 py-4", item.tile)}>
            <span className="text-4xl font-semibold leading-none tabular-nums">{item.value}</span>
            <span className="mt-2 text-sm font-medium text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {leads.map(({ lead, name, phone }) => {
          const face = leadFace(lead, today);
          return (
            <li key={lead.id}>
              <div className={cn("flex h-full flex-col justify-between gap-8 rounded-2xl border border-border p-5", TINT[face.heat])}>
                <div className="flex min-w-0 items-center gap-4">
                  <Avatar name={name} className={cn("h-14 w-14 text-sm", face.avatar)} />
                  <div className="min-w-0 flex-1 break-words text-xl font-semibold leading-7 tracking-tight">{name}</div>
                  <Count face={face} className="text-5xl" captionClass="text-muted-foreground" />
                </div>
                <LabeledActions phone={phone} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function statusPill(face: ReturnType<typeof leadFace>) {
  if (!face.figure) return null;
  const text = face.caption ? `${face.figure} ${face.caption}` : face.figure;
  const tone =
    face.heat === "overdue"
      ? "bg-brand text-white"
      : face.heat === "today"
        ? "bg-amber-500 text-white"
        : face.heat === "fresh"
          ? "bg-emerald-600 text-white"
          : "bg-zinc-200 text-foreground";
  return <span className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-semibold", tone)}>{text}</span>;
}

function LookD({ leads, today, counts }: { leads: LookLead[]; today: string; counts: LookCounts }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["New", counts.fresh],
          ["Hot", counts.hot],
          ["Overdue", counts.overdue],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-border bg-white px-4 py-3">
            <div className="text-3xl font-semibold leading-none tabular-nums">{value}</div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <ul className="space-y-2">
        {leads.map(({ lead, name, phone }) => {
          const face = leadFace(lead, today);
          return (
            <li key={lead.id} className="flex items-center gap-3 rounded-2xl border border-border bg-white px-3 py-2.5 shadow-sm">
              <Avatar name={name} className={cn("h-12 w-12 text-sm", face.avatar)} />
              <div className="min-w-0 flex-1 truncate text-base font-semibold">{name}</div>
              {statusPill(face)}
              <IconActions phone={phone} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LookE({ leads, today, counts }: { leads: LookLead[]; today: string; counts: LookCounts }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["New", counts.fresh],
          ["Hot", counts.hot],
          ["Overdue", counts.overdue],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-border bg-white px-4 py-5">
            <div className="text-5xl font-semibold leading-none tabular-nums">{value}</div>
            <div className="mt-2 text-xs font-medium tracking-wide text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {leads.map(({ lead, name, phone }) => {
          const face = leadFace(lead, today);
          return (
            <li key={lead.id} className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
              {face.figure && (
                <div className={cn("min-w-[4.5rem] text-5xl font-semibold leading-none tabular-nums", face.figureClass)}>
                  {face.figure}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <Avatar name={name} className={cn("h-10 w-10 text-xs", face.avatar)} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{name}</div>
                    {face.caption && <div className="text-[10px] font-medium text-muted-foreground">{face.caption}</div>}
                  </div>
                </div>
              </div>
              <IconActions phone={phone} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const BOARDS: Record<LookId, (props: { leads: LookLead[]; today: string; counts: LookCounts }) => ReactNode> = {
  a: LookA,
  b: LookB,
  c: LookC,
  d: LookD,
  e: LookE,
};

export function LeadLookBoard({
  id,
  leads,
  today,
  counts,
}: {
  id: LookId;
  leads: LookLead[];
  today: string;
  counts: LookCounts;
}) {
  const Board = BOARDS[id];
  return <Board leads={leads} today={today} counts={counts} />;
}
