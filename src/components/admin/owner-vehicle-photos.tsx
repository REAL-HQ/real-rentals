import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Private owner-vehicle-photos objects are read with a one-hour signed URL. */
export const OWNER_VEHICLE_PHOTO_TTL_SECONDS = 60 * 60;

/**
 * Short-lived URL for one object in the private owner-vehicle-photos bucket.
 * A preview URL skips signing so a test can render sample photos.
 */
export function useOwnerVehiclePhotoUrl(path: string | null | undefined, previewUrl?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(previewUrl ?? null);
  useEffect(() => {
    if (!path || previewUrl) return;
    let active = true;
    supabase.storage.from("owner-vehicle-photos").createSignedUrl(path, OWNER_VEHICLE_PHOTO_TTL_SECONDS).then(({ data }) => {
      if (active && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => {
      active = false;
    };
  }, [path, previewUrl]);
  return path ? url : null;
}

export function OwnerVehiclePhotoThumb({
  path,
  previewUrl,
}: {
  path: string | null | undefined;
  previewUrl?: string | null;
}) {
  const url = useOwnerVehiclePhotoUrl(path, previewUrl);
  if (!path) {
    return (
      <div
        data-testid="owner-photo-empty"
        className="grid h-14 w-20 shrink-0 place-items-center rounded-md border border-[#EDEDF0] bg-[#F4F4F6] px-1 text-center text-[10px] font-medium leading-tight text-[#55555E]"
      >
        No Photo
      </div>
    );
  }
  return (
    <div data-testid="owner-photo-thumb" className="h-14 w-20 shrink-0 overflow-hidden rounded-md border border-[#EDEDF0] bg-[#F4F4F6]">
      {url ? <img src={url} alt="Vehicle" className="h-full w-full object-cover" /> : null}
    </div>
  );
}

export function OwnerVehiclePhotoGrid({
  paths,
  previewUrls,
}: {
  paths: readonly string[];
  previewUrls?: Record<string, string>;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (!paths.length) return null;
  const current = open == null ? null : paths[open];
  return (
    <>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6" data-testid="owner-photo-grid">
        {paths.map((path, index) => (
          <OwnerVehiclePhotoButton
            key={`${path}-${index}`}
            path={path}
            index={index}
            previewUrl={previewUrls?.[path]}
            onOpen={() => setOpen(index)}
          />
        ))}
      </div>
      {current != null && open != null && (
        <FullSizePhoto
          path={current}
          previewUrl={previewUrls?.[current]}
          label={`Vehicle Photo ${open + 1}`}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function OwnerVehiclePhotoButton({
  path,
  index,
  previewUrl,
  onOpen,
}: {
  path: string;
  index: number;
  previewUrl?: string;
  onOpen: () => void;
}) {
  const url = useOwnerVehiclePhotoUrl(path, previewUrl);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open Photo ${index + 1}`}
      className="aspect-square overflow-hidden rounded-md border border-[#EDEDF0] bg-[#F4F4F6]"
    >
      {url ? <img src={url} alt={`Vehicle ${index + 1}`} className="h-full w-full object-cover" /> : null}
    </button>
  );
}

function FullSizePhoto({
  path,
  previewUrl,
  label,
  onClose,
}: {
  path: string;
  previewUrl?: string;
  label: string;
  onClose: () => void;
}) {
  const url = useOwnerVehiclePhotoUrl(path, previewUrl);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      role="dialog"
      aria-label={label}
      onClick={onClose}
    >
      <div className="max-h-[90vh] max-w-5xl" onClick={(event) => event.stopPropagation()}>
        {url ? <img src={url} alt={label} className="max-h-[80vh] max-w-full rounded-md bg-white object-contain" /> : null}
        <button type="button" onClick={onClose} className="mt-3 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-[#111114]">
          Close
        </button>
      </div>
    </div>
  );
}
