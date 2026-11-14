import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionCard, MicroLabel, EmptyState } from "./ui";
import { listStudioMedia } from "@/lib/photo-studio-media.functions";
import { generateMarketingShots, getPhotoStudioStatus, reviewMarketingShot, setCarMarketingPublished } from "@/lib/photo-studio.functions";
import { SHOT_SLOTS, SLOT_LABELS, carSetStatus, type ShotSlot } from "@/lib/photo-studio";

type Media = Awaited<ReturnType<typeof listStudioMedia>>["items"][number];

/** Marketing shots for one car: template grid, AI badge, per-shot review,
 * originals side by side (team-only, signed URLs). */
export function PhotoStudioPanel({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const list = useServerFn(listStudioMedia);
  const status = useServerFn(getPhotoStudioStatus);
  const gen = useServerFn(generateMarketingShots);
  const review = useServerFn(reviewMarketingShot);
  const publish = useServerFn(setCarMarketingPublished);
  const [items, setItems] = useState<Media[]>([]);
  const [st, setSt] = useState<Awaited<ReturnType<typeof getPhotoStudioStatus>> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [l, s] = await Promise.all([list({ data: { vehicleId } }), status()]);
    setItems(l.items as Media[]); setSt(s);
  }, [vehicleId, list, status]);
  useEffect(() => { void load(); }, [load]);

  const originals = items.filter((m: any) => m.kind === "original");
  const shots = items.filter((m: any) => m.kind === "marketing" && m.studio_review_status !== "rejected");
  const bySlot = new Map(shots.map((s: any) => [s.shot_slot as ShotSlot, s]));
  const setStatus = carSetStatus(shots.map((s: any) => ({ id: s.id, slot: s.shot_slot, status: s.studio_review_status })));
  const published = shots.some((s: any) => s.published);

  const run = async (slots?: ShotSlot[]) => {
    setBusy(true);
    try {
      const r = await gen({ data: { vehicleId, slots } });
      if (!r.ok) toast.error(r.error);
      else {
        const saved = r.outcomes.filter((o) => o.status === "saved").length;
        const rejected = r.outcomes.filter((o) => o.status === "rejected");
        toast.success(`${saved} shot(s) ready for review${rejected.length ? `, ${rejected.length} rejected by the plate/VIN check` : ""}.`);
      }
      await load();
    } finally { setBusy(false); }
  };
  const decide = async (id: string, decision: "approved" | "rejected") => {
    const r = await review({ data: { mediaId: id, decision } });
    if (!r.ok) toast.error(r.error); await load();
  };

  return (
    <SectionCard title="Marketing Photos (AI Studio)">
      {!st?.enabled && <p className="text-sm text-muted-foreground">Photo Studio is off. The Owner can turn it on in Settings.</p>}
      {st?.enabled && !st.configured && <p className="text-sm text-amber-700">The image provider is not configured yet.</p>}
      {st && <p className="text-xs text-muted-foreground">This month: ${(st.usage.monthCents / 100).toFixed(2)} of ${(st.monthlyCapCents / 100).toFixed(2)} · today {st.usage.todayImages}/{st.dailyImageLimit} images · {st.model}</p>}
      <div className="flex flex-wrap items-center gap-2 my-2">
        <Badge variant={setStatus === "approved" ? "default" : "secondary"}>Set: {setStatus}</Badge>
        {published && <Badge>On website</Badge>}
        {canEdit && <Button size="sm" disabled={busy || !st?.enabled || originals.length === 0} onClick={() => run()}>{shots.length ? "Regenerate All" : "Generate Shots"}</Button>}
        {st?.canPublish && setStatus === "approved" && (
          <Button size="sm" variant="outline" onClick={async () => { const r = await publish({ data: { vehicleId, published: !published } }); if (!r.ok) toast.error(r.error); await load(); }}>
            {published ? "Take Off Website" : "Publish To Website"}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {SHOT_SLOTS.map((slot) => {
          const s: any = bySlot.get(slot);
          return (
            <div key={slot} className="rounded border p-2">
              <MicroLabel>{SLOT_LABELS[slot]}</MicroLabel>
              {s ? (<>
                <div className="relative">
                  <img src={s.url ?? ""} alt={`${SLOT_LABELS[slot]} (AI-generated)`} className="w-full aspect-[4/3] object-cover rounded" />
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-white">AI-generated</span>
                  {s.studio_check?.inferred && <span className="absolute right-1 top-1 rounded bg-amber-600 px-1 text-[10px] text-white">angle inferred</span>}
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs">
                  <Badge variant="outline">{s.studio_review_status}</Badge>
                  {canEdit && s.studio_review_status === "pending" && (<>
                    <Button size="sm" variant="ghost" onClick={() => decide(s.id, "approved")}>Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(s.id, "rejected")}>Reject</Button>
                  </>)}
                  {canEdit && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run([slot])}>Redo</Button>}
                </div>
              </>) : <div className="aspect-[4/3] grid place-items-center text-xs text-muted-foreground">No shot</div>}
            </div>
          );
        })}
      </div>
      <div className="mt-4">
        <MicroLabel>Originals (Team Only)</MicroLabel>
        {originals.length === 0 ? <EmptyState title="No Originals Yet" hint="Car photos linked in Fleet Inbox appear here." /> : (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-1">
            {originals.map((o: any) => (
              <a key={o.id} href={o.url ?? "#"} target="_blank" rel="noreferrer" className="block">
                <img src={o.url ?? ""} alt={o.photo_class ?? "original"} className="w-full aspect-square object-cover rounded" />
                <span className="text-[10px] text-muted-foreground">{o.photo_class ?? "unknown"}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
