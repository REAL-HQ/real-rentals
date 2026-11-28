import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, CheckCircle, Clock, RefreshCw, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SectionCard, MicroLabel, EmptyState } from "./ui";
import { listStudioMedia, setOriginalPhotoClass } from "@/lib/photo-studio-media.functions";
import { generateMarketingShots, getPhotoStudioStatus, reviewMarketingShot, setCarMarketingPublished } from "@/lib/photo-studio.functions";
import { SHOT_SLOTS, SLOT_LABELS, carSetStatus, marketingShotNote, type PhotoClass, type ShotSlot } from "@/lib/photo-studio";
import { PhotoClassLabel, PhotoClassSelect } from "./PhotoClassSelect";
import { AutoLabelPhotos } from "./AutoLabelPhotos";
import { PhotoStudioFleet } from "./PhotoStudioFleet";
import { approveAndPublishStudio } from "@/lib/photo-studio-fleet.functions";
import { FAILED_CHECK_ATTENTION, carReadyToPublish } from "@/lib/photo-studio-fleet";
import { formatStatusLabel } from "@/lib/ui-display-labels";

type Media = Awaited<ReturnType<typeof listStudioMedia>>["items"][number];

const iconButtonClass = "h-7 w-7 shrink-0";

/** Icon control with a Title Case tooltip. The label is also the accessible name. */
function ShotIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={iconButtonClass}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Current review state. Filled so it reads as selected next to the ghost actions. */
function ShotStatusIcon({ status }: { status: string | null | undefined }) {
  const label = formatStatusLabel(status);
  const key = String(status ?? "").trim().toLowerCase();
  const icon =
    key === "approved" ? (
      <CheckCircle className="size-4" strokeWidth={1.75} aria-hidden />
    ) : key === "rejected" ? (
      <XCircle className="size-4" strokeWidth={1.75} aria-hidden />
    ) : (
      <Clock className="size-4" strokeWidth={1.75} aria-hidden />
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="img"
          aria-label={label}
          aria-current="true"
          className={`inline-flex ${iconButtonClass} items-center justify-center rounded-lg bg-primary text-primary-foreground`}
        >
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ShotActionRow({ children }: { children: ReactNode }) {
  return <div className="mt-1 flex w-full min-w-0 flex-wrap items-center gap-1">{children}</div>;
}

/** One template angle. Actions are icon buttons so the row stays inside the card. */
function MarketingShotCard({
  label,
  shot,
  failedCheck,
  reason,
  canEdit,
  regenerateDisabled,
  onApprove,
  onReject,
  onRegenerate,
}: {
  label: string;
  shot: { url: string; note: string; status: string | null } | null;
  failedCheck: boolean;
  reason: string | null;
  canEdit: boolean;
  regenerateDisabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="min-w-0 rounded border p-2">
      <MicroLabel>{label}</MicroLabel>
      <TooltipProvider delayDuration={200}>
        {shot ? (
          <>
            <img src={shot.url} alt={label} className="w-full aspect-[4/3] object-cover rounded" />
            <p className="mt-1 text-[11px] leading-snug text-[#55555E]">{shot.note}</p>
            <ShotActionRow>
              <ShotStatusIcon status={shot.status} />
              {canEdit && shot.status === "pending" && (
                <>
                  <ShotIconButton label="Approve" onClick={onApprove}>
                    <Check strokeWidth={1.75} aria-hidden />
                  </ShotIconButton>
                  <ShotIconButton label="Reject" onClick={onReject}>
                    <X strokeWidth={1.75} aria-hidden />
                  </ShotIconButton>
                </>
              )}
              {canEdit && (
                <ShotIconButton label="Regenerate" disabled={regenerateDisabled} onClick={onRegenerate}>
                  <RefreshCw strokeWidth={1.75} aria-hidden />
                </ShotIconButton>
              )}
            </ShotActionRow>
          </>
        ) : failedCheck || reason ? (
          <>
            <div className="aspect-[4/3] grid place-items-center rounded bg-[#F4F4F6] px-3 text-center text-[11px] font-medium leading-snug text-[#111114]">{reason || FAILED_CHECK_ATTENTION}</div>
            {canEdit && (
              <ShotActionRow>
                <ShotIconButton label="Regenerate" disabled={regenerateDisabled} onClick={onRegenerate}>
                  <RefreshCw strokeWidth={1.75} aria-hidden />
                </ShotIconButton>
              </ShotActionRow>
            )}
          </>
        ) : (
          <div className="aspect-[4/3] grid place-items-center text-xs text-muted-foreground">No Shot</div>
        )}
      </TooltipProvider>
    </div>
  );
}

/** Marketing shots for one car: template grid, AI badge, per-shot review,
 * originals side by side (team-only, signed URLs). */
export function PhotoStudioPanel({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const list = useServerFn(listStudioMedia);
  const status = useServerFn(getPhotoStudioStatus);
  const gen = useServerFn(generateMarketingShots);
  const review = useServerFn(reviewMarketingShot);
  const publish = useServerFn(setCarMarketingPublished);
  const setClass = useServerFn(setOriginalPhotoClass);
  const approvePublish = useServerFn(approveAndPublishStudio);
  const [items, setItems] = useState<Media[]>([]);
  const [attentionSlots, setAttentionSlots] = useState<string[]>([]);
  const [slotReasons, setSlotReasons] = useState<Record<string, string>>({});
  const [classAvailable, setClassAvailable] = useState(true);
  const [st, setSt] = useState<Awaited<ReturnType<typeof getPhotoStudioStatus>> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([list({ data: { vehicleId } }), status()]);
      setItems(l.items as Media[]);
      setAttentionSlots(l.attentionSlots ?? []);
      setSlotReasons(l.slotReasons ?? {});
      setClassAvailable(l.photoClassAvailable !== false);
      setSt(s);
    } catch {
      setItems([]);
      setAttentionSlots([]);
      setSlotReasons({});
    }
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate.");
    } finally { setBusy(false); }
  };
  const labelOriginal = async (id: string, photoClass: PhotoClass) => {
    try {
      const r = await setClass({ data: { mediaId: id, photoClass } });
      if (!r.ok) {
        if ("unavailable" in r && r.unavailable) setClassAvailable(false);
        toast.error(r.error);
        return;
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error && e.message === "Forbidden" ? "Setting the angle is Manager-only." : "Could not update.");
    }
  };
  const decide = async (id: string, decision: "approved" | "rejected") => {
    const r = await review({ data: { mediaId: id, decision } });
    if (!r.ok) toast.error(r.error); await load();
  };

  const ready = carReadyToPublish(shots.map((s: any) => ({
    slot: s.shot_slot ?? null, status: s.studio_review_status ?? null, published: !!s.published, check: s.studio_check ?? null,
  })));
  const approveThis = async () => {
    if (!window.confirm("Approve and publish this set? Only shots that passed the identity check are included.")) return;
    setBusy(true);
    try {
      const r = await approvePublish({ data: { vehicleId } });
      if (!r.ok) toast.error(r.error);
      else toast.success("Approved and published.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error && e.message === "Forbidden" ? "Publishing is Owner-only." : "Could not publish.");
    } finally { setBusy(false); }
  };

  return (
    <>
    <PhotoStudioFleet onChanged={() => void load()} />
    <SectionCard title="Marketing Photos (AI Studio)">
      {!st?.enabled && <p className="text-sm text-muted-foreground">Photo Studio is off. The Owner can turn it on in Settings.</p>}
      {st?.enabled && !st.configured && <p className="text-sm text-amber-700">The image provider is not configured yet.</p>}
      {st && <p className="text-xs text-muted-foreground">This month: ${(st.usage.monthCents / 100).toFixed(2)} of ${(st.monthlyCapCents / 100).toFixed(2)} · today {st.usage.todayImages}/{st.dailyImageLimit} images · {st.model}</p>}
      <div className="flex flex-wrap items-center gap-2 my-2">
        <Badge variant={setStatus === "approved" ? "default" : "secondary"}>Set: {formatStatusLabel(setStatus)}</Badge>
        {published && <Badge>On website</Badge>}
        {canEdit && <Button size="sm" disabled={busy || !st?.enabled || originals.length === 0} onClick={() => run()}>{shots.length ? "Regenerate All" : "Generate Shots"}</Button>}
        {st?.canPublish && ready && !published && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void approveThis()}>Approve & Publish</Button>
        )}
        {st?.canPublish && setStatus === "approved" && (
          <Button size="sm" variant="outline" onClick={async () => { const r = await publish({ data: { vehicleId, published: !published } }); if (!r.ok) toast.error(r.error); await load(); }}>
            {published ? "Take Off Website" : "Publish To Website"}
          </Button>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
        {SHOT_SLOTS.map((slot) => {
          const s: any = bySlot.get(slot);
          return (
            <MarketingShotCard
              key={slot}
              label={SLOT_LABELS[slot]}
              shot={s ? { url: s.url ?? "", note: marketingShotNote(!!s.studio_check?.inferred), status: s.studio_review_status ?? null } : null}
              failedCheck={!s && attentionSlots.includes(slot)}
              reason={s ? null : slotReasons[slot] ?? null}
              canEdit={canEdit}
              regenerateDisabled={s ? busy : busy || !st?.enabled}
              onApprove={() => decide(s.id, "approved")}
              onReject={() => decide(s.id, "rejected")}
              onRegenerate={() => run([slot])}
            />
          );
        })}
      </div>
      <div className="mt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <MicroLabel>Originals (Team Only)</MicroLabel>
          {canEdit && classAvailable && <AutoLabelPhotos vehicleId={vehicleId} onDone={() => void load()} />}
        </div>
        {originals.length === 0 ? <EmptyState title="No Originals Yet" hint="Car photos linked in Fleet Inbox appear here." /> : (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-1">
            {originals.map((o: any) => (
              <div key={o.id} className="block">
                <a href={o.url ?? "#"} target="_blank" rel="noreferrer">
                  <img src={o.url ?? ""} alt={o.photo_class ?? "original"} className="w-full aspect-square object-cover rounded" />
                </a>
                {classAvailable ? (
                  canEdit
                    ? <PhotoClassSelect value={o.photo_class} disabled={busy} onChange={(photoClass) => void labelOriginal(o.id, photoClass)} />
                    : <PhotoClassLabel value={o.photo_class} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
    </>
  );
}
