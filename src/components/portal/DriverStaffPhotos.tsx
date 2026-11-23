import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Car } from "lucide-react";
import { PHOTO_THUMBNAIL_GRID_CLASS } from "@/components/photo-thumbnail-grid";
import { fmtDate, fmtDateTime } from "@/lib/date-format";
import type {
  DriverStaffAlbum,
  DriverStaffPhoto,
  DriverVehicleLabel,
  PhotoKind,
} from "@/lib/driver-staff-photos";
import { resolvePhotoUrl } from "@/lib/photoUrl";

type OpenPhoto = (photo: { id: string; kind: PhotoKind }) => Promise<{ url: string | null }>;

const photoKey = (photo: { id: string; kind: PhotoKind }) => `${photo.kind}:${photo.id}`;

function angleLabel(angle: string | null): string | null {
  if (!angle) return null;
  return angle
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function VehicleMark({ vehicle }: { vehicle: DriverVehicleLabel }) {
  const src = resolvePhotoUrl(vehicle.photo);
  const [broken, setBroken] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-soft text-muted-foreground">
        {src && !broken ? (
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <Car className="h-4 w-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0">
        {vehicle.name ? <div className="truncate text-sm font-medium">{vehicle.name}</div> : null}
        {vehicle.identity ? (
          <div className="truncate text-xs text-muted-foreground">{vehicle.identity}</div>
        ) : (
          <div className="text-xs text-muted-foreground">Vehicle</div>
        )}
      </div>
    </div>
  );
}

function PhotoTile({
  photo,
  url,
  waiting,
}: {
  photo: DriverStaffPhoto;
  url: string | null;
  waiting: boolean;
}) {
  const when = fmtDateTime(photo.at);
  const caption = [angleLabel(photo.angle), when ? `${photo.timeLabel} ${when}` : null]
    .filter(Boolean)
    .join(" · ");
  const frame = "block overflow-hidden rounded-xl border border-border";
  const body = !url ? (
    <div className="flex h-28 items-center justify-center bg-soft px-2 text-center text-[11px] text-muted-foreground">
      {waiting ? "Loading Photo" : "On File"}
    </div>
  ) : (
    <img
      src={url}
      alt={caption || "Condition photo"}
      loading="lazy"
      className="h-28 w-full object-cover"
    />
  );
  return (
    <figure data-testid="driver-staff-photo" data-event={photo.event} className="min-w-0">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className={frame}>
          {body}
        </a>
      ) : (
        <div className={frame}>{body}</div>
      )}
      {caption ? (
        <figcaption className="px-0.5 pt-1 text-[10px] text-muted-foreground">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

function PhotoGrid({
  photos,
  urls,
}: {
  photos: DriverStaffPhoto[];
  urls: Record<string, string | null>;
}) {
  if (!photos.length) {
    return <p className="text-sm text-muted-foreground">No Photos Yet.</p>;
  }
  return (
    <div className={PHOTO_THUMBNAIL_GRID_CLASS}>
      {photos.map((photo) => {
        const key = photoKey(photo);
        const known = Object.prototype.hasOwnProperty.call(urls, key);
        const url = known ? urls[key] : photo.url;
        const waiting = photo.preview === "prepare" && !known && !photo.url;
        return <PhotoTile key={key} photo={photo} url={url} waiting={waiting} />;
      })}
    </div>
  );
}

/**
 * Staff photos for the signed-in driver's own rentals. Read-only.
 * Pickup and return are inspection photos. Swap is the replacement car.
 */
export function DriverStaffPhotos({
  load,
  open,
  cacheKey = "self",
}: {
  load: () => Promise<DriverStaffAlbum>;
  open: OpenPhoto;
  /** Changes when staff preview switches driver, so the previous album is not reused. */
  cacheKey?: string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["driver-staff-photos", cacheKey],
    queryFn: () => load(),
  });
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    setUrls({});
  }, [cacheKey]);
  const openRef = useRef(open);
  openRef.current = open;

  const pending = (data?.rentals ?? []).flatMap((rental) =>
    [
      ...rental.pickup,
      ...rental.returnPhotos,
      ...rental.swaps.map((swap) => ({ photos: swap.photos })),
    ]
      .flatMap((block) => block.photos)
      .filter((photo) => photo.preview === "prepare"),
  );
  const pendingKey = pending.map(photoKey).join(",");
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    if (!pendingKey) return;
    let live = true;
    const queue = pendingRef.current;
    let index = 0;
    const step = async () => {
      while (live && index < queue.length) {
        const batch = queue.slice(index, index + 3);
        index += batch.length;
        await Promise.all(
          batch.map(async (photo) => {
            try {
              const result = await openRef.current({ id: photo.id, kind: photo.kind });
              if (live) setUrls((current) => ({ ...current, [photoKey(photo)]: result.url }));
            } catch {
              if (live) setUrls((current) => ({ ...current, [photoKey(photo)]: null }));
            }
          }),
        );
      }
    };
    void step();
    return () => {
      live = false;
    };
  }, [pendingKey]);

  return (
    <section
      data-testid="driver-staff-photos"
      className="rounded-2xl border border-border bg-white p-5"
    >
      <h3 className="font-semibold">Condition Photos</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Photos our team took when you picked up the car, when it was swapped, and when you brought
        it back.
      </p>

      {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading Photos…</p> : null}
      {isError ? (
        <p className="mt-4 text-sm text-muted-foreground">Condition Photos Could Not Be Loaded.</p>
      ) : null}

      {!isLoading && !isError && (data?.rentals.length ?? 0) === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No Photos Yet.</p>
      ) : null}

      {(data?.rentals ?? []).map((rental) => (
        <div key={rental.rentalId} className="mt-5 space-y-4" data-testid="driver-staff-rental">
          {(data?.rentals.length ?? 0) > 1 ? (
            <h4 className="text-sm font-semibold">
              {rental.stage === "active"
                ? "Current Rental"
                : `Returned ${fmtDate(rental.endDate) || ""}`.trim()}
            </h4>
          ) : null}

          <Event title="Pickup">
            {rental.pickup.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Photos Yet.</p>
            ) : (
              rental.pickup.map((block) => (
                <div key={block.vehicle.id} className="space-y-2">
                  <VehicleMark vehicle={block.vehicle} />
                  <PhotoGrid photos={block.photos} urls={urls} />
                </div>
              ))
            )}
          </Event>

          <Event title="Swap">
            {rental.swaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Photos Yet.</p>
            ) : (
              rental.swaps.map((swap) => (
                <div key={swap.swapId} className="space-y-2" data-testid="driver-staff-swap">
                  <VehicleMark vehicle={swap.vehicle} />
                  <PhotoGrid photos={swap.photos} urls={urls} />
                </div>
              ))
            )}
          </Event>

          <Event title="Return">
            {rental.returnPhotos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Photos Yet.</p>
            ) : (
              rental.returnPhotos.map((block) => (
                <div key={block.vehicle.id} className="space-y-2">
                  <VehicleMark vehicle={block.vehicle} />
                  <PhotoGrid photos={block.photos} urls={urls} />
                </div>
              ))
            )}
          </Event>
        </div>
      ))}
    </section>
  );
}

function Event({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="mt-2 space-y-3">{children}</div>
    </div>
  );
}
