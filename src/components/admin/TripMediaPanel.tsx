/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase service-role rows, as elsewhere in src/lib */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MapPin, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import {
  listTripTargets,
  listTripMedia,
  createTripMediaUploadUrl,
  confirmTripMedia,
  type TripTarget,
} from "@/lib/trip-media.functions";
import { deleteConditionMedia } from "@/lib/inspections.functions";
import { CONDITION_SECTIONS, ROLE_SUBSECTION, groupConditionPhotos } from "@/lib/condition-photos";
import { TRIP_MEDIA_ACCEPT, TRIP_MEDIA_MAX_BYTES } from "@/lib/trip-media";
import { MicroLabel } from "./ui";

type Media = Awaited<ReturnType<typeof listTripMedia>>[number];

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        timeZone: "America/New_York",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

/**
 * Pictures on a renter's profile: Pickup / Return / Issues, each Ours and
 * Yours. Staff drop a batch of photos or videos into Ours for the trip they
 * pick; Yours is what the renter sent from the portal. Nothing is filed until
 * a trip is chosen — no guessing which booking a file belongs to.
 */
export function TripMediaPanel({ applicationId }: { applicationId: string }) {
  const fetchTargets = useServerFn(listTripTargets);
  const fetchMedia = useServerFn(listTripMedia);
  const startUpload = useServerFn(createTripMediaUploadUrl);
  const confirm = useServerFn(confirmTripMedia);
  const remove = useServerFn(deleteConditionMedia);

  const [targets, setTargets] = useState<TripTarget[] | null>(null);
  const [targetKey, setTargetKey] = useState<string>("");
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMedia(await fetchMedia({ data: { applicationId } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load pictures");
    }
  }, [applicationId, fetchMedia]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([
      fetchTargets({ data: { applicationId } }),
      fetchMedia({ data: { applicationId } }),
    ])
      .then(([t, m]) => {
        if (!live) return;
        setTargets(t);
        setMedia(m);
        setTargetKey("");
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not load pictures"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [applicationId, fetchTargets, fetchMedia]);

  const target = (targets ?? []).find((t) => t.key === targetKey) ?? null;
  const shown = useMemo(
    () =>
      target
        ? media.filter((m) =>
            target.rentalId ? m.rental_id === target.rentalId : m.rental_id === null,
          )
        : [],
    [media, target],
  );
  const grouped = useMemo(
    () => groupConditionPhotos(shown.map((m) => ({ ...m, capturedByRole: m.captured_by_role }))),
    [shown],
  );

  async function uploadOne(
    phase: string,
    t: TripTarget,
    file: File,
    onProgress: (p: number) => void,
  ) {
    onProgress(10);
    const signed = await startUpload({
      data: {
        applicationId,
        rentalId: t.rentalId,
        phase: phase as any,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      },
    });
    onProgress(30);
    // The File as picked: original bytes, camera metadata included.
    const { error } = await supabase.storage
      .from(signed.bucket)
      .uploadToSignedUrl(signed.path, signed.token, file, { contentType: signed.mimeType });
    if (error) throw new Error(error.message);
    onProgress(80);
    await confirm({
      data: {
        applicationId,
        rentalId: t.rentalId,
        phase: phase as any,
        path: signed.path,
        fileName: file.name,
        mimeType: signed.mimeType,
        sizeBytes: file.size,
      },
    });
    onProgress(100);
  }

  async function drop(m: Media) {
    if (!window.confirm("Delete this file? It is evidence and can't be recovered.")) return;
    try {
      await remove({ data: { id: m.id } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#9A9AA3]">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading pictures…
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-label="Trip Pictures">
      <div className="rounded-xl border border-[#EDEDF0] bg-white p-4 space-y-2">
        <MicroLabel>Trip</MicroLabel>
        {(targets ?? []).length === 0 ? (
          <p className="text-[13px] text-[#55555E]">
            No trip or assigned vehicle on this application yet, so there is nowhere to file
            pictures.
          </p>
        ) : (
          <select
            aria-label="Trip"
            value={targetKey}
            onChange={(e) => setTargetKey(e.target.value)}
            className="w-full rounded-md border border-[#EDEDF0] px-2 py-1.5 text-[13px]"
          >
            <option value="">Choose a trip…</option>
            {(targets ?? []).map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} · {t.vehicleLabel}
                {t.status ? ` · ${t.status}` : ""}
              </option>
            ))}
          </select>
        )}
        {target && !target.rentalId && (
          <p className="text-[11px] text-[#55555E]">
            Filed to this application and its assigned vehicle, not to a booking. The renter doesn't
            see these.
          </p>
        )}
      </div>

      {target &&
        CONDITION_SECTIONS.map((section) => {
          const phase = section.key === "during" ? "damage" : section.uploadPhase;
          const bucket = grouped[section.key];
          return (
            <section
              key={section.key}
              className="rounded-xl border border-[#EDEDF0] bg-white p-4 space-y-3"
            >
              <h3 className="font-semibold text-sm">{section.title}</h3>
              <div className="space-y-2">
                <MicroLabel>{ROLE_SUBSECTION.staff}</MicroLabel>
                <FileUploader
                  key={`${target.key}-${section.key}`}
                  variant="zone"
                  title={`Drop ${section.title} Photos Or Videos`}
                  label="Choose Files"
                  context={`${section.title} · ${ROLE_SUBSECTION.staff} · ${target.label}`}
                  hint="JPEG, PNG, WebP, HEIC, MP4 or MOV · up to 50 MB each"
                  accept={TRIP_MEDIA_ACCEPT}
                  maxBytes={TRIP_MEDIA_MAX_BYTES}
                  multiple
                  upload={(file, { onProgress }) => uploadOne(phase, target, file, onProgress)}
                  onAllDone={() => void refresh()}
                />
                <Grid items={bucket.staff} onDelete={drop} />
              </div>
              <div className="space-y-2">
                <MicroLabel>{ROLE_SUBSECTION.driver}</MicroLabel>
                <Grid items={bucket.driver} onDelete={drop} empty="Nothing from the renter yet." />
              </div>
            </section>
          );
        })}
    </div>
  );
}

function Grid({
  items,
  onDelete,
  empty = "Nothing yet.",
}: {
  items: Media[];
  onDelete: (m: Media) => void;
  empty?: string;
}) {
  if (!items.length) return <p className="text-[12px] text-[#9A9AA3]">{empty}</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {items.map((m) => (
        <figure
          key={m.id}
          className="rounded-lg border border-[#EDEDF0] overflow-hidden bg-[#FAFAFB]"
        >
          {m.media_type === "video" ? (
            <video
              src={m.url ?? undefined}
              controls
              preload="metadata"
              className="h-32 w-full bg-black object-contain"
            />
          ) : m.url && m.mime_type === "image/heic" ? (
            <a
              href={m.url}
              target="_blank"
              rel="noreferrer"
              className="h-32 grid place-items-center text-center px-2 text-[11px] text-[#55555E]"
            >
              HEIC photo · opens in Safari or download (most browsers can&apos;t preview HEIC)
            </a>
          ) : m.url ? (
            <a href={m.url} target="_blank" rel="noreferrer">
              <img src={m.url} alt={m.file_name ?? "Photo"} className="h-32 w-full object-cover" />
            </a>
          ) : (
            <div className="h-32 grid place-items-center text-[11px] text-[#9A9AA3]">
              No preview
            </div>
          )}
          <figcaption className="p-1.5 text-[10px] leading-tight text-[#55555E] space-y-0.5">
            <div>Taken {fmt(m.taken_at) ?? "— no camera time"}</div>
            <div>Uploaded {fmt(m.uploaded_at)}</div>
            <div>
              {!m.rental_id
                ? "Before rental · team only"
                : m.renter_preview
                  ? "Renter sees a location-free copy"
                  : "Renter sees the entry only (no safe preview)"}
            </div>
            <div className="flex items-center gap-1">
              {m.has_gps && (
                <span
                  title="Location on file — team only"
                  className="inline-flex items-center gap-0.5"
                >
                  <MapPin className="w-3 h-3" /> Team only
                </span>
              )}
              <button
                type="button"
                onClick={() => onDelete(m)}
                aria-label="Delete"
                className="ml-auto text-[#9A9AA3] hover:text-red-700"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
