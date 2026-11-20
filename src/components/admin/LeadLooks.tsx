import { ArrowUpRight, MessageSquare, MoreVertical, Phone } from "lucide-react";
import type { PriorityLead } from "@/lib/lead-priorities";
import { cn } from "@/lib/utils";
import { LeadCardBody, leadStatTiles, type LeadCardLook } from "./LeadCardBody";

export type LookId = "a" | "b" | "c" | "d";

export const LEAD_LOOKS: { id: LookId; title: string; blurb: string; look: LeadCardLook }[] = [
  { id: "a", title: "Look A — Clean White", blurb: "White cards, even border, full details. Overview uses this look.", look: "white" },
  { id: "b", title: "Look B — Dark Luxe", blurb: "Charcoal cards, white type, solid red, amber, and green accents.", look: "dark" },
  { id: "c", title: "Look C — Solid Tint", blurb: "Each card is a flat tint matched to urgency. The note sits in a deeper solid.", look: "tint" },
  { id: "d", title: "Look D — Two Columns", blurb: "Status and date on the left. Details on the right. An even divider between them.", look: "split" },
];

export type LookLead = { lead: PriorityLead; name: string; phone: string; tags: string[] };
export type LookCounts = { fresh: number; hot: number; overdue: number };

function QuietTags({ tags, dark }: { tags: string[]; dark?: boolean }) {
  return (
    <>
      {tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            dark ? "bg-zinc-800 text-zinc-300" : "bg-zinc-100 text-zinc-600",
          )}
        >
          {tag}
        </span>
      ))}
    </>
  );
}

function Actions({ phone, dark }: { phone: string; dark?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <a href={`tel:${phone}`} aria-label="Call" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3 text-xs font-semibold text-white">
        <Phone aria-hidden="true" className="h-3.5 w-3.5" />
        Call
      </a>
      <button
        type="button"
        aria-label="Text"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold",
          dark ? "border-white/25 text-white" : "border-border bg-white text-foreground",
        )}
      >
        <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
        Text
      </button>
      <ArrowUpRight aria-hidden="true" className={cn("ml-auto h-4 w-4", dark ? "text-zinc-400" : "text-muted-foreground")} />
    </div>
  );
}

function Menu({ name, dark }: { name: string; dark?: boolean }) {
  return (
    <button
      type="button"
      aria-label={`Lead Actions For ${name}`}
      className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md", dark ? "text-zinc-300" : "text-muted-foreground")}
    >
      <MoreVertical aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

function Tiles({ counts, tone }: { counts: LookCounts; tone: "white" | "dark" | "tint" }) {
  const items = [
    { label: "New", value: counts.fresh, icon: "bg-emerald-600", tile: tone === "tint" ? "border-border bg-emerald-50" : "" },
    { label: "Hot", value: counts.hot, icon: "bg-amber-500", tile: tone === "tint" ? "border-border bg-amber-50" : "" },
    { label: "Overdue", value: counts.overdue, icon: "bg-brand", tile: tone === "tint" ? "border-border bg-rose-50" : "" },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            "flex min-h-[88px] flex-col items-start justify-between rounded-2xl border px-4 py-3",
            tone === "dark" && "border-zinc-800 bg-zinc-900 text-white",
            tone === "white" && "border-border bg-white",
            tone === "tint" && item.tile,
          )}
        >
          <span className={cn("grid h-7 w-7 place-items-center rounded-lg text-white", item.icon)}>
            <span className="h-2 w-2 rounded-full bg-white" />
          </span>
          <span className="mt-3 text-3xl font-semibold leading-none tabular-nums">{item.value}</span>
          <span className={cn("mt-1 text-xs font-medium", tone === "dark" ? "text-zinc-400" : "text-muted-foreground")}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function Board({
  leads,
  today,
  counts,
  look,
}: {
  leads: LookLead[];
  today: string;
  counts: LookCounts;
  look: LeadCardLook;
}) {
  const dark = look === "dark";
  const cards = (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {leads.map(({ lead, name, phone, tags }) => (
        <li key={lead.id}>
          <LeadCardBody
            lead={lead}
            today={today}
            look={look}
            displayName={name}
            name={name}
            status={<QuietTags tags={tags} dark={dark} />}
            menu={<Menu name={name} dark={dark} />}
            actions={<Actions phone={phone} dark={dark} />}
          />
        </li>
      ))}
    </ul>
  );
  if (dark) {
    return (
      <div className="space-y-4 rounded-3xl bg-zinc-950 p-4 sm:p-5">
        <Tiles counts={counts} tone="dark" />
        {cards}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {look === "white" ? <WhiteTiles counts={counts} /> : <Tiles counts={counts} tone={look === "tint" ? "tint" : "white"} />}
      {cards}
    </div>
  );
}

function WhiteTiles({ counts }: { counts: LookCounts }) {
  const values = [counts.fresh, counts.hot, counts.overdue];
  return (
    <div className="grid grid-cols-3 gap-3">
      {leadStatTiles().map((tile, index) => (
        <div key={tile.label} className={cn("flex min-h-[88px] flex-col items-start justify-between rounded-2xl border px-4 py-3 shadow-sm", tile.tile)}>
          <span className={cn("grid h-7 w-7 place-items-center rounded-lg", tile.icon)}>
            <tile.Icon aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
          <span className="mt-3 text-3xl font-semibold leading-none tabular-nums">{values[index]}</span>
          <span className="mt-1 text-xs font-medium text-muted-foreground">{tile.label}</span>
        </div>
      ))}
    </div>
  );
}

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
  const spec = LEAD_LOOKS.find((item) => item.id === id)!;
  return <Board leads={leads} today={today} counts={counts} look={spec.look} />;
}
