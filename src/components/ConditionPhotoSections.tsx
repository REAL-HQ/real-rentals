import { MapPin } from "lucide-react";
import {
  ADMIN_ROLE_SUBSECTION,
  CONDITION_SECTIONS,
  ROLE_SUBSECTION,
  formatGps,
  groupConditionPhotos,
  type RoleAudience,
} from "@/lib/condition-photos";
import { fmtDateTime } from "@/lib/date-format";

/** Loose shape so admin lists and portal rows can share this grid. */
export type ConditionPhotoItem = {
  id: string;
  url?: string | null;
  phase?: string | null;
  angle?: string | null;
  caption?: string | null;
  media_type?: string | null;
  mediaType?: string | null;
  mime_type?: string | null;
  captured_by_role?: string | null;
  capturedByRole?: string | null;
  taken_at?: string | null;
  takenAt?: string | null;
  taken_at_source?: string | null;
  takenAtSource?: string | null;
  missing_exif_time?: boolean;
  created_at?: string | null;
  uploaded_at?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
};

const EMPTY = "No Photos Yet";

function roleOf(p: ConditionPhotoItem): string | null {
  return p.capturedByRole ?? p.captured_by_role ?? null;
}

function takenAtOf(p: ConditionPhotoItem): string | null {
  return p.taken_at ?? p.takenAt ?? p.uploaded_at ?? p.created_at ?? null;
}

function takenSourceOf(p: ConditionPhotoItem): string | null {
  return p.taken_at_source ?? p.takenAtSource ?? null;
}

function mediaTypeOf(p: ConditionPhotoItem): string {
  return String(p.media_type ?? p.mediaType ?? "photo").toLowerCase();
}

function angleLabel(p: ConditionPhotoItem): string {
  const raw = String(p.angle ?? "").trim();
  if (!raw) return "Photo";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isExifTime(p: ConditionPhotoItem): boolean {
  if (p.missing_exif_time) return false;
  return takenSourceOf(p) === "exif";
}

/**
 * Pickup / Return / Issues, each with Ours and Yours (portal) or Ours and
 * Renter (staff). Staff can turn on EXIF date/time and GPS; renters never see GPS.
 */
export function ConditionPhotoSections({
  photos,
  audience = "staff",
  showGps,
  onPreview,
}: {
  photos: ConditionPhotoItem[];
  audience?: RoleAudience;
  /** Staff-only. Defaults on for the staff audience. */
  showGps?: boolean;
  onPreview?: (url: string) => void;
}) {
  const gpsOn = showGps ?? audience === "staff";
  const labels = audience === "staff" ? ADMIN_ROLE_SUBSECTION : ROLE_SUBSECTION;
  const grouped = groupConditionPhotos(
    photos.map((p) => ({
      ...p,
      phase: p.phase ?? null,
      capturedByRole: roleOf(p),
    })),
  );

  return (
    <div className="space-y-4" data-testid="condition-photos">
      {CONDITION_SECTIONS.map((section) => {
        const bucket = grouped[section.key];
        return (
          <section
            key={section.key}
            className="space-y-3"
            data-testid={`condition-section-${section.key}`}
            aria-label={section.title}
          >
            <h3 className="text-[13px] font-semibold text-[#111114]">{section.title}</h3>
            <RoleBlock
              sectionKey={section.key}
              role="staff"
              title={labels.staff}
              items={bucket.staff}
              showGps={gpsOn}
              onPreview={onPreview}
            />
            <RoleBlock
              sectionKey={section.key}
              role="driver"
              title={labels.driver}
              items={bucket.driver}
              showGps={gpsOn}
              onPreview={onPreview}
            />
          </section>
        );
      })}
    </div>
  );
}

function RoleBlock({
  sectionKey,
  role,
  title,
  items,
  showGps,
  onPreview,
}: {
  sectionKey: string;
  role: "staff" | "driver";
  title: string;
  items: ConditionPhotoItem[];
  showGps: boolean;
  onPreview?: (url: string) => void;
}) {
  return (
    <div className="space-y-1.5" data-testid={`condition-role-${sectionKey}-${role}`}>
      <div className="text-[10px] font-semibold tracking-[0.12em] text-[#9A9AA3]">{title}</div>
      {items.length === 0 ? (
        <p className="text-[12px] text-[#9A9AA3]">{EMPTY}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {items.map((m) => (
            <PhotoTile
              key={String(m.id)}
              photo={m}
              showGps={showGps}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoTile({
  photo,
  showGps,
  onPreview,
}: {
  photo: ConditionPhotoItem;
  showGps: boolean;
  onPreview?: (url: string) => void;
}) {
  const url = photo.url ?? null;
  const when = takenAtOf(photo);
  const stamp = when ? fmtDateTime(when) : "No Time On File";
  const exif = isExifTime(photo);
  const gps = showGps ? formatGps(photo.gps_lat, photo.gps_lng) : null;
  const isVideo = mediaTypeOf(photo).startsWith("video");
  const isHeic = String(photo.mime_type ?? "").toLowerCase() === "image/heic";
  const alt = photo.caption ?? angleLabel(photo);

  const open = () => {
    if (url && onPreview) onPreview(url);
  };

  return (
    <figure className="rounded-lg overflow-hidden border border-[#EDEDF0] bg-white text-left">
      {isVideo && url ? (
        <video src={url} controls preload="metadata" className="h-24 w-full bg-black object-contain" />
      ) : url && isHeic ? (
        <button
          type="button"
          onClick={open}
          className="h-24 w-full grid place-items-center px-2 text-center text-[11px] text-[#55555E]"
        >
          HEIC Photo
        </button>
      ) : url ? (
        <button type="button" onClick={open} className="block w-full">
          <img src={url} alt={alt} className="h-24 w-full object-cover" />
        </button>
      ) : (
        <div className="h-24 w-full grid place-items-center text-[11px] text-[#9A9AA3]">Unavailable</div>
      )}
      <figcaption className="px-2 py-1.5 space-y-0.5">
        <div className="text-[11px] text-[#55555E] truncate">{angleLabel(photo)}</div>
        <div className="text-[10px] text-[#9A9AA3] leading-tight">
          {stamp}
          {when && !exif ? " · Upload Time" : ""}
        </div>
        {gps ? (
          <div
            className="flex items-center gap-0.5 text-[10px] text-[#55555E]"
            data-testid="condition-photo-gps"
            title="Location on file. Team only."
          >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">GPS {gps}</span>
          </div>
        ) : null}
      </figcaption>
    </figure>
  );
}
