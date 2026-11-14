import { useEffect, useState } from "react";
import { Car } from "lucide-react";
import { loadStaffPhoto } from "@/lib/photoUrl";

/** Staff-confirmed private vehicle photo; never substitutes listing or document images. */
export function VehicleStaffPhoto({ path, name, className }: { path: string | null; name: string; className: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    if (path) {
      void loadStaffPhoto(path).then((next) => {
        if (live) { setUrl(next); setFailed(!next); }
      });
    }
    return () => { live = false; };
  }, [path]);

  if (url && !failed) {
    return <img src={url} alt={name} loading="lazy" className={className} onError={() => setFailed(true)} />;
  }
  return (
    <span
      className="grid h-full w-full place-items-center text-muted-foreground"
      title={!path ? "No Vehicle Photo" : failed ? "Photo Unavailable" : "Loading Photo…"}
    >
      <Car className="h-4 w-4" aria-label={!path ? "No Vehicle Photo" : failed ? "Photo Unavailable" : "Loading Photo…"} />
    </span>
  );
}
