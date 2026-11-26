import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FileUploader } from "@/components/FileUploader";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  SWAP_PICKUP_PHOTO_ACCEPT,
  SWAP_PICKUP_PHOTO_MAX_BYTES,
  SWAP_PICKUP_PHOTO_MAX_COUNT,
  applyFetchedPickupPhotos,
  createPickupListGate,
  swapPickupVehicleLine,
  withSavedPickupPhoto,
  type ShownPickupPhoto,
} from "@/lib/swap-pickup-photos";
import {
  listSwapPickupPhotos,
  reserveSwapPickupPhoto,
  saveSwapPickupPhoto,
} from "@/lib/swap-pickup-photos.functions";
import type { VehicleLabelSource } from "@/lib/vehicle-label";
import { PHOTO_THUMBNAIL_GRID_CLASS } from "@/components/photo-thumbnail-grid";
import { VehiclePickerPhoto, type EnlargedPhoto } from "./VehiclePickerPhoto";

type Photo = ShownPickupPhoto;

/**
 * Pickup Photos on one swap entry. Works for every status, including Completed.
 * The upload inserts photos only; the swap row is not updated.
 */
export function SwapPickupPhotos({
  swapId,
  vehicleId,
  vehicle,
}: {
  swapId: string;
  vehicleId: string;
  vehicle?: VehicleLabelSource | null;
}) {
  const load = useServerFn(listSwapPickupPhotos);
  const reserve = useServerFn(reserveSwapPickupPhoto);
  const save = useServerFn(saveSwapPickupPhoto);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState(0);
  const [enlarged, setEnlarged] = useState<EnlargedPhoto | null>(null);
  const gate = useRef(createPickupListGate()).current;

  const refresh = useCallback(
    async (reportError: boolean) => {
      const ticket = gate.begin();
      try {
        const r = await load({ data: { swapId } });
        if (!gate.accept(ticket)) return;
        setInstalled(r.installed);
        setPhotos((prev) => {
          const next = applyFetchedPickupPhotos(prev, r.photos);
          for (const photo of prev) {
            const kept = next.find((item) => item.id === photo.id);
            if (photo.url?.startsWith("blob:") && kept?.url && kept.url !== photo.url) {
              URL.revokeObjectURL(photo.url);
            }
          }
          return next;
        });
        setError(null);
      } catch {
        if (reportError && gate.accept(ticket)) setError("Pickup Photos Could Not Be Loaded.");
      }
    },
    [gate, load, swapId],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  function noteSaved(file: File, id: string, mimeType: string) {
    // Invalidate any list fetch that started before this save, then show the
    // photo immediately. Waiting for the uploader's batch callback left the
    // count at 0 until a full page reload.
    gate.noteSaved();
    const url = URL.createObjectURL(file);
    setPhotos((prev) =>
      withSavedPickupPhoto(prev, {
        id,
        fileName: file.name,
        mimeType,
        createdAt: new Date().toISOString(),
        url,
      }),
    );
  }

  const identity = vehicle ? swapPickupVehicleLine(vehicle) : "";
  const label = identity || "New Vehicle";
  const room = Math.max(0, SWAP_PICKUP_PHOTO_MAX_COUNT - photos.length);

  async function uploadOne(file: File, onProgress: (pct: number) => void) {
    onProgress(8);
    const reserved = await reserve({
      data: { swapId, fileName: file.name, mimeType: file.type || "", sizeBytes: file.size },
    });
    if (!reserved.ok) throw new Error(String(reserved.error ?? "Could not start the upload."));
    onProgress(30);
    const stored = await supabase.storage
      .from(String(reserved.bucket))
      .uploadToSignedUrl(String(reserved.path), String(reserved.token), file, {
        contentType: String(reserved.mimeType || file.type || "application/octet-stream"),
      });
    if (stored.error) throw new Error(stored.error.message);
    onProgress(75);
    const saved = await save({
      data: {
        swapId,
        path: String(reserved.path),
        fileName: file.name,
        mimeType: String(reserved.mimeType || file.type || ""),
        sizeBytes: file.size,
      },
    });
    if (!saved.ok || !saved.id) throw new Error(String(saved.error ?? "Could not save the photo."));
    noteSaved(file, saved.id, String(reserved.mimeType || file.type || "image/jpeg"));
    await refresh(false);
    onProgress(100);
  }

  return (
    <div
      data-testid="swap-pickup-photos"
      className="mt-3 rounded-md border border-[#EDEDF0] bg-[#FAFAFB] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13px] font-medium text-[#111114]">Pickup Photos</h4>
        <span data-testid="swap-pickup-count" className="text-[11px] text-[#55555E]">
          {photos.length} {photos.length === 1 ? "Photo" : "Photos"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-[#9A9AA3]">Saving Photos Does Not Change The Swap.</p>
      <div className="mt-2 flex items-center gap-2">
        <VehiclePickerPhoto
          vehicleId={vehicleId}
          label={label}
          onEnlarge={setEnlarged}
          className="h-10 w-14 rounded-md"
        />
        <div className="min-w-0 text-[12px]">
          <div className="font-medium text-[#111114]">New Vehicle</div>
          {identity ? <div className="truncate text-[#55555E]">{identity}</div> : null}
        </div>
      </div>
      {error ? <p className="mt-2 text-[12px] text-[#D03020]">{error}</p> : null}
      {installed === false ? (
        <p className="mt-2 text-[12px] text-[#55555E]">
          Pickup Photos Need The Database Update Before They Can Be Saved.
        </p>
      ) : installed === null ? (
        error ? null : (
          <p className="mt-2 text-[12px] text-[#9A9AA3]">Loading Pickup Photos</p>
        )
      ) : (
        <>
          {photos.length === 0 ? (
            <p className="mt-2 text-[12px] text-[#9A9AA3]">No Pickup Photos Yet.</p>
          ) : null}
          {photos.length > 0 ? (
            <ul data-testid="swap-pickup-photo-grid" className={`mt-2 ${PHOTO_THUMBNAIL_GRID_CLASS}`}>
              {photos.map((photo, index) => {
                const name = photo.fileName || `Pickup Photo ${index + 1}`;
                const heic = photo.mimeType === "image/heic";
                return (
                  <li key={photo.id}>
                    {photo.url && !heic ? (
                      <button
                        type="button"
                        data-testid="swap-pickup-photo"
                        className="block w-full overflow-hidden rounded-md border border-[#EDEDF0] bg-white"
                        aria-label={`Enlarge Pickup Photo ${name}`}
                        title="Click To Enlarge"
                        onClick={() => setEnlarged({ url: photo.url!, label: name })}
                      >
                        <img
                          src={photo.url}
                          alt={name}
                          loading="lazy"
                          className="h-20 w-full object-cover"
                        />
                      </button>
                    ) : photo.url && heic ? (
                      <a
                        href={photo.url}
                        target="_blank"
                        rel="noreferrer"
                        data-testid="swap-pickup-photo"
                        className="grid h-20 place-items-center rounded-md border border-[#EDEDF0] bg-white px-1 text-center text-[10px] text-[#55555E]"
                      >
                        HEIC Photo
                      </a>
                    ) : (
                      <div className="grid h-20 place-items-center rounded-md border border-[#EDEDF0] bg-white text-[10px] text-[#9A9AA3]">
                        No Preview
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="mt-3">
            <FileUploader
              key={batch}
              variant="zone"
              multiple
              listLayout="grid"
              accept={SWAP_PICKUP_PHOTO_ACCEPT}
              maxBytes={SWAP_PICKUP_PHOTO_MAX_BYTES}
              maxFiles={room}
              title="Drop Pickup Photos"
              label="Add Pickup Photos"
              context={identity ? `Pickup Photos · ${identity}` : "Pickup Photos · New Vehicle"}
              hint="JPEG, PNG, WebP or HEIC · Up To 50 MB Each · Up To 80 Photos"
              upload={(file, ctx) => uploadOne(file, ctx.onProgress)}
              onSettled={() => {
                void refresh(false);
              }}
              onAllDone={() => setBatch((n) => n + 1)}
            />
          </div>
        </>
      )}
      <Dialog
        open={!!enlarged}
        onOpenChange={(o) => {
          if (!o) setEnlarged(null);
        }}
      >
        <DialogContent
          data-testid="swap-pickup-lightbox"
          overlayClassName="z-[300]"
          className="z-[301] w-[min(56rem,calc(100vw-1.5rem))] max-w-none gap-2 border-0 bg-black p-2 sm:rounded-lg [&>button]:text-white"
        >
          <DialogTitle className="pr-8 text-sm font-medium text-white">
            {enlarged?.label}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Larger pickup photo. Press Escape or Close to return to the swap.
          </DialogDescription>
          {enlarged ? (
            <img
              src={enlarged.url}
              alt={`${enlarged.label} Photo`}
              className="max-h-[75vh] w-full rounded-md object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
