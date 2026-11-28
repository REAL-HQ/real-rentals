import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** Private owner-vehicle-photos objects are read with a one-hour signed URL. */
export const OWNER_VEHICLE_PHOTO_TTL_SECONDS = 60 * 60;

/**
 * Short-lived URL for one object in the private owner-vehicle-photos bucket.
 * A preview URL skips signing so a test can render sample photos.
 */
export function useOwnerVehiclePhotoUrl(
  path: string | null | undefined,
  previewUrl?: string | null,
): string | null {
  const [url, setUrl] = useState<string | null>(previewUrl ?? null);
  useEffect(() => {
    if (!path || previewUrl) return;
    let active = true;
    supabase.storage
      .from("owner-vehicle-photos")
      .createSignedUrl(path, OWNER_VEHICLE_PHOTO_TTL_SECONDS)
      .then(({ data }) => {
        if (active && data?.signedUrl) setUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [path, previewUrl]);
  return path ? url : null;
}

/** Next or previous index, wrapping at the ends. A single photo does not move. */
export function stepPhotoIndex(index: number, total: number, delta: number): number | null {
  if (total <= 1 || delta === 0) return null;
  return (((index + delta) % total) + total) % total;
}

function adjacentPhotoIndexes(index: number, total: number): number[] {
  const previous = stepPhotoIndex(index, total, -1);
  const next = stepPhotoIndex(index, total, 1);
  if (previous == null || next == null) return [];
  return previous === next ? [next] : [previous, next];
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
    <div
      data-testid="owner-photo-thumb"
      className="h-14 w-20 shrink-0 overflow-hidden rounded-md border border-[#EDEDF0] bg-[#F4F4F6]"
    >
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
      {open != null && paths[open] != null && (
        <OwnerVehiclePhotoLightbox
          paths={paths}
          index={open}
          previewUrls={previewUrls}
          onIndex={setOpen}
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
      {url ? (
        <img src={url} alt={`Vehicle ${index + 1}`} className="h-full w-full object-cover" />
      ) : null}
    </button>
  );
}

/**
 * Enlarged owner-vehicle photo. Partners and Fleet Owners both open this from
 * OwnerVehiclePhotoGrid. Signing stays in useOwnerVehiclePhotoUrl.
 */
export function OwnerVehiclePhotoLightbox({
  paths,
  index,
  previewUrls,
  onIndex,
  onClose,
}: {
  paths: readonly string[];
  index: number;
  previewUrls?: Record<string, string>;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const [known, setKnown] = useState<Record<string, string>>({});
  const remember = useCallback((path: string, url: string) => {
    setKnown((current) => (current[path] === url ? current : { ...current, [path]: url }));
  }, []);
  const total = paths.length;
  const safeIndex = total > 0 ? ((index % total) + total) % total : 0;
  const path = paths[safeIndex];
  const multiple = total > 1;
  const go = useCallback(
    (delta: number) => {
      const next = stepPhotoIndex(safeIndex, total, delta);
      if (next == null) return;
      onIndex(next);
    },
    [onIndex, safeIndex, total],
  );

  useEffect(() => {
    if (!path) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select"));
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (typing) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [go, onClose, path]);

  if (!path) return null;
  const label = `Vehicle Photo ${safeIndex + 1}`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid="owner-photo-lightbox"
      onClick={onClose}
    >
      <div className="max-h-[90vh] max-w-5xl" onClick={(event) => event.stopPropagation()}>
        <PhotoFrame
          key={`${safeIndex}-${path}`}
          path={path}
          label={label}
          previewUrl={known[path] ?? previewUrls?.[path]}
          multiple={multiple}
          onReady={remember}
          onStep={go}
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-[#111114]"
          >
            Close
          </button>
          <span
            data-testid="owner-photo-counter"
            className="text-sm font-medium tabular-nums text-white"
          >
            {safeIndex + 1} / {total}
          </span>
        </div>
      </div>
      {adjacentPhotoIndexes(safeIndex, total).map((photoIndex) => {
        const adjacentPath = paths[photoIndex];
        return (
          <PreloadOwnerPhoto
            key={`${photoIndex}-${adjacentPath}`}
            path={adjacentPath}
            previewUrl={known[adjacentPath] ?? previewUrls?.[adjacentPath]}
            onReady={remember}
          />
        );
      })}
    </div>
  );
}

function PhotoFrame({
  path,
  label,
  previewUrl,
  multiple,
  onReady,
  onStep,
}: {
  path: string;
  label: string;
  previewUrl?: string;
  multiple: boolean;
  onReady: (path: string, url: string) => void;
  onStep: (delta: number) => void;
}) {
  const url = useOwnerVehiclePhotoUrl(path, previewUrl);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (url) onReady(path, url);
  }, [onReady, path, url]);

  function onTouchStart(event: ReactTouchEvent) {
    if (!multiple) return;
    if (event.target instanceof Element && event.target.closest("button")) {
      touchStart.current = null;
      return;
    }
    const touch = event.changedTouches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function onTouchEnd(event: ReactTouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    onStep(dx < 0 ? 1 : -1);
  }

  return (
    <div
      className="relative inline-block max-w-full touch-pan-y"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {url ? (
        <img
          src={url}
          alt={label}
          className="block max-h-[80vh] max-w-full rounded-md bg-white object-contain"
        />
      ) : (
        <div className="h-[50vh] w-[min(80vw,48rem)] rounded-md bg-[#111114]" aria-hidden="true" />
      )}
      {multiple && (
        <>
          <PhotoStepButton direction="previous" onClick={() => onStep(-1)} />
          <PhotoStepButton direction="next" onClick={() => onStep(1)} />
        </>
      )}
    </div>
  );
}

function PhotoStepButton({
  direction,
  onClick,
}: {
  direction: "previous" | "next";
  onClick: () => void;
}) {
  const next = direction === "next";
  const label = next ? "Next Photo" : "Previous Photo";
  const Icon = next ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={next ? "owner-photo-next" : "owner-photo-previous"}
      className={`absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[#E4E4E7] bg-white text-[#111114] shadow-md hover:bg-[#F4F4F6] ${next ? "right-3" : "left-3"}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/** Signs and fetches the neighbor so the next frame is already decoded. */
function PreloadOwnerPhoto({
  path,
  previewUrl,
  onReady,
}: {
  path: string;
  previewUrl?: string;
  onReady: (path: string, url: string) => void;
}) {
  const url = useOwnerVehiclePhotoUrl(path, previewUrl);
  useEffect(() => {
    if (!url) return;
    onReady(path, url);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  }, [onReady, path, url]);
  return null;
}
