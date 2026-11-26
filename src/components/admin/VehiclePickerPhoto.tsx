import { useEffect, useState, type SyntheticEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Car } from "lucide-react";
import { listVehicleMedia } from "@/lib/vehicle-media.functions";
import { loadStaffPhoto } from "@/lib/photoUrl";
import { vehiclePickerThumbnailPath } from "./vehicle-picker-thumbnail";

/** Staff-chosen confirmed car thumbnail for one vehicle; refreshes when the profile changes. */
export type EnlargedPhoto = { url: string; label: string };

export function VehiclePickerPhoto({
  vehicleId,
  className = "h-9 w-12 rounded-md",
  iconClassName = "h-4 w-4",
  onEnlarge,
  label = "Car",
}: {
  vehicleId: string;
  className?: string;
  iconClassName?: string;
  /** When given and a photo exists, the thumbnail becomes a button that opens the larger photo without selecting the row. */
  onEnlarge?: (photo: EnlargedPhoto) => void;
  label?: string;
}) {
  const loadMedia = useServerFn(listVehicleMedia);
  const [photo, setPhoto] = useState<{ vehicleId: string; url: string } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("vehicle-profile-refresh", h);
    return () => window.removeEventListener("vehicle-profile-refresh", h);
  }, []);
  useEffect(() => {
    let live = true;
    void loadMedia({ data: { vehicleId } }).then(async (result) => {
      const path = vehiclePickerThumbnailPath(vehicleId, result);
      if (!live) return;
      if (!path) { setPhoto(null); return; }
      const url = await loadStaffPhoto(path);
      if (live) setPhoto(url ? { vehicleId, url } : null);
    }).catch(() => {});
    return () => { live = false; };
  }, [vehicleId, loadMedia, tick]);
  const hasPhoto = photo?.vehicleId === vehicleId;
  const frame = `grid shrink-0 place-items-center overflow-hidden border border-border bg-muted text-muted-foreground ${className}`;
  if (hasPhoto && onEnlarge) {
    const swallow = (e: SyntheticEvent) => e.stopPropagation();
    return <button
      type="button"
      data-testid="vehicle-thumb-enlarge"
      aria-label={`Enlarge Photo Of ${label}`}
      title="Click To Enlarge"
      className={`${frame} cursor-zoom-in p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      onPointerDown={swallow}
      onMouseDown={swallow}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEnlarge({ url: photo!.url, label }); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onEnlarge({ url: photo!.url, label }); } }}
    >
      <img src={photo!.url} alt={`${label} Thumbnail`} loading="lazy" className="h-full w-full object-cover" />
    </button>;
  }
  return <span className={frame}>
    {hasPhoto ? <img src={photo!.url} alt="Car Photo" loading="lazy" className="h-full w-full object-cover" /> : <Car aria-label="No Confirmed Car Photo" className={iconClassName} />}
  </span>;
}
