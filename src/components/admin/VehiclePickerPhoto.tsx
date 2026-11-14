import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Car } from "lucide-react";
import { listVehicleMedia } from "@/lib/vehicle-media.functions";
import { loadStaffPhoto } from "@/lib/photoUrl";
import { vehiclePickerThumbnailPath } from "./vehicle-picker-thumbnail";

/** Staff-chosen confirmed car thumbnail for one vehicle; refreshes when the profile changes. */
export function VehiclePickerPhoto({
  vehicleId,
  className = "h-9 w-12 rounded-md",
  iconClassName = "h-4 w-4",
}: { vehicleId: string; className?: string; iconClassName?: string }) {
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
  return <span className={`grid shrink-0 place-items-center overflow-hidden border border-border bg-muted text-muted-foreground ${className}`}>
    {photo?.vehicleId === vehicleId ? <img src={photo.url} alt="Car Photo" loading="lazy" className="h-full w-full object-cover" /> : <Car aria-label="No Confirmed Car Photo" className={iconClassName} />}
  </span>;
}
