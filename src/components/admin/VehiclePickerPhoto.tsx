import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Car } from "lucide-react";
import { listVehicleMedia } from "@/lib/vehicle-media.functions";
import { loadStaffPhoto } from "@/lib/photoUrl";
import { vehiclePickerThumbnailPath } from "./vehicle-picker-thumbnail";

export function VehiclePickerPhoto({ vehicleId }: { vehicleId: string }) {
  const loadMedia = useServerFn(listVehicleMedia);
  const [photo, setPhoto] = useState<{ vehicleId: string; url: string } | null>(null);
  useEffect(() => {
    let live = true;
    void loadMedia({ data: { vehicleId } }).then(async (result) => {
      const path = vehiclePickerThumbnailPath(vehicleId, result);
      if (!live || !path) return;
      const url = await loadStaffPhoto(path);
      if (live && url) setPhoto({ vehicleId, url });
    }).catch(() => {});
    return () => { live = false; };
  }, [vehicleId, loadMedia]);
  return <span className="grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground">
    {photo?.vehicleId === vehicleId ? <img src={photo.url} alt="Car Photo" loading="lazy" className="h-full w-full object-cover" /> : <Car aria-label="No Confirmed Car Photo" className="h-4 w-4" />}
  </span>;
}