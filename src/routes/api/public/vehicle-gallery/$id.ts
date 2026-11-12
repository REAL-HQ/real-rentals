import { createFileRoute } from "@tanstack/react-router";
import {
  isGalleryImagePath,
  isPublicVehicleId,
  listingHasPublishedPhoto,
  pickGalleryFallback,
  type GalleryCandidate,
} from "@/lib/gallery-photo";
import { stripJpegMetadata } from "@/lib/jpeg-metadata";

// One gallery original for a vehicle the public site already lists, and only
// when that vehicle has no published listing photo. The path-based route
// (/api/public/vehicle-photos) still serves a file only when a person
// published it. This route does not take a storage path, does not sign a
// URL, and does not read inspection, checklist, document, or retouched rows.
// The bucket stays private. Anon still cannot read vehicle_media.
//
// The bytes are a phone JPEG. Exif, XMP, comments, and other metadata
// segments — including GPS — are removed before the response. A JPEG this
// filter cannot clean, and every other format, is a 404 so the page shows
// the bundled photo instead.

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

export const Route = createFileRoute("/api/public/vehicle-gallery/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = (params as { id?: string }).id ?? "";
        if (!isPublicVehicleId(id)) return notFound();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: listed, error: listedError } = await supabaseAdmin
          .from("vehicles_public")
          .select("id,photos")
          .eq("id", id)
          .maybeSingle();
        if (listedError || !listed) return notFound();
        if (listingHasPublishedPhoto(listed.photos)) return notFound();

        const { data: rows, error: mediaError } = await supabaseAdmin
          .from("vehicle_media")
          .select("kind,storage_bucket,storage_path,mime_type,is_primary,sort_order,created_at")
          .eq("vehicle_id", id)
          .eq("kind", "original")
          .eq("storage_bucket", "vehicle-photos")
          .order("is_primary", { ascending: false })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(50);
        if (mediaError || !rows) return notFound();

        const chosen = pickGalleryFallback(rows as GalleryCandidate[]);
        const path = chosen?.storage_path;
        if (!path || !isGalleryImagePath(path)) return notFound();

        const { data: file, error: downloadError } = await supabaseAdmin.storage
          .from("vehicle-photos")
          .download(path);
        if (downloadError || !file) return notFound();

        const raw = new Uint8Array(await file.arrayBuffer());
        const cleaned = stripJpegMetadata(raw);
        if (!cleaned) return notFound();
        const body = new ArrayBuffer(cleaned.byteLength);
        new Uint8Array(body).set(cleaned);

        return new Response(body, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
