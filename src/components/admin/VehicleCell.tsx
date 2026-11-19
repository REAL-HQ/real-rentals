import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getVehicleCards, type VehicleCardData } from "@/lib/vehicle-cards.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { vehicleCellParts, type VehicleCellInput } from "@/lib/vehicle-cell";
import { VehicleStaffPhoto } from "./VehicleStaffPhoto";

/**
 * The one way a vehicle appears in a list: thumbnail (click to enlarge),
 * year make model, plate and last 6 of the VIN, unit optional. Missing
 * pieces are skipped, never shown as "undefined" or hanging separators.
 */
export function VehicleCell({
  vehicle,
  thumbnailPath = null,
  showUnit = true,
  size = "md",
  className = "",
}: {
  vehicle: VehicleCellInput | null | undefined;
  thumbnailPath?: string | null;
  showUnit?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const p = vehicleCellParts(showUnit ? vehicle : { ...vehicle, unitNumber: null });
  const box = size === "sm" ? "h-7 w-10" : "h-8 w-11";
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`} data-testid="vehicle-cell">
      {thumbnailPath ? (
        <button
          type="button"
          aria-label={`Enlarge Photo Of ${p.title}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className={`${box} shrink-0 overflow-hidden rounded-md border border-border bg-soft cursor-zoom-in`}
        >
          <VehicleStaffPhoto path={thumbnailPath} name={p.title} className="h-full w-full object-cover" />
        </button>
      ) : (
        <span className={`${box} shrink-0 overflow-hidden rounded-md border border-border bg-soft`}>
          <VehicleStaffPhoto path={null} name={p.title} className="h-full w-full object-cover" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium leading-tight" data-vehicle-title>{p.title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground" data-vehicle-details>{p.detailLine}</span>
      </span>
      {thumbnailPath ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>{p.title}</DialogTitle>
            </DialogHeader>
            <div className="overflow-hidden rounded-lg bg-soft">
              <VehicleStaffPhoto path={thumbnailPath} name={p.title} className="max-h-[70vh] w-full object-contain" />
            </div>
            <p className="text-sm text-muted-foreground">{p.detailLine}</p>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

type Pending = { resolve: (c: VehicleCardData | null) => void; reject: (e: unknown) => void };
let queue = new Map<string, Pending[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** One server read for every row that asked within the same 25 ms, not one per row. */
function batchedVehicleCard(id: string, load: (ids: string[]) => Promise<VehicleCardData[]>): Promise<VehicleCardData | null> {
  return new Promise((resolve, reject) => {
    queue.set(id, [...(queue.get(id) ?? []), { resolve, reject }]);
    if (timer) return;
    timer = setTimeout(async () => {
      const batch = queue;
      queue = new Map();
      timer = null;
      const ids = [...batch.keys()];
      try {
        for (let i = 0; i < ids.length; i += 200) {
          const part = ids.slice(i, i + 200);
          const cards = new Map((await load(part)).map((c) => [c.id, c]));
          for (const pid of part) for (const w of batch.get(pid) ?? []) w.resolve(cards.get(pid) ?? null);
        }
      } catch (e) {
        for (const waiters of batch.values()) for (const w of waiters) w.reject(e);
      }
    }, 25);
  });
}

/**
 * For cards and lists that only hold a vehicle id: fetches photo, plate,
 * VIN last 6 and year make model once per id (cached), then renders VehicleCell.
 * `fallback` fields show while loading or if the read fails.
 */
export function LinkedVehicleCell({
  vehicleId,
  fallback,
  ...rest
}: {
  vehicleId: string | null | undefined;
  fallback?: VehicleCellInput;
} & Omit<React.ComponentProps<typeof VehicleCell>, "vehicle" | "thumbnailPath">) {
  const fetchCards = useServerFn(getVehicleCards);
  const q = useQuery({
    queryKey: ["vehicle-card", vehicleId],
    enabled: !!vehicleId,
    staleTime: 5 * 60_000,
    queryFn: () => batchedVehicleCard(vehicleId as string, (ids) => fetchCards({ data: { vehicleIds: ids } })),
  });
  if (!vehicleId) return <span className="text-sm text-muted-foreground">No Vehicle Assigned</span>;
  const c = q.data;
  return <VehicleCell vehicle={c ? { ...fallback, ...c } : fallback} thumbnailPath={c?.thumbnailPath ?? null} {...rest} />;
}

/** LinkedVehicleCell when the row has a vehicle id; otherwise the plain label it already had. */
export function VehicleOrLabel({ vehicleId, label, ...rest }: { vehicleId?: string | null; label?: string | null } & Omit<React.ComponentProps<typeof LinkedVehicleCell>, "vehicleId" | "fallback">) {
  if (!vehicleId) return <span>{label || "—"}</span>;
  return <LinkedVehicleCell vehicleId={vehicleId} fallback={{ label }} {...rest} />;
}
