import { createFileRoute } from "@tanstack/react-router";
import {
  galleryContentType,
  isGalleryImagePath,
  isPublicVehicleId,
  listingHasPublishedPhoto,
  pickGalleryFallback,
  type GalleryCandidate,
} from "@/lib/gallery-photo";

// One gallery original for a vehicle the public site already lists, and only
// when that vehicle has no published listing photo. The path-based route
// (/api/public/vehicle-photos) still serves a file only when a person
// published it. This route does not take a storage path, does not sign a
// URL, and does not read inspection, checklist, document, or retouched rows.
// The bucket stays private. Anon still cannot read vehicle_media.

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

        return new Response(await file.arrayBuffer(), {
          headers: {
            "Content-Type": galleryContentType(path, chosen?.mime_type),
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
