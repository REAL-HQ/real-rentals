import { createFileRoute } from "@tanstack/react-router";
import { isShareMediaEligible, VEHICLE_SHARE_TOKEN_RE } from "@/lib/vehicle-share";

const TOKEN = VEHICLE_SHARE_TOKEN_RE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const NOT_FOUND = () => new Response("Not found", { status: 404 });

export const Route = createFileRoute("/share/vehicle-photo/$token/$mediaId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { token, mediaId } = params as { token: string; mediaId: string };
        if (!TOKEN.test(token) || !UUID.test(mediaId)) return NOT_FOUND();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadVehicleShareByToken } = await import("@/lib/vehicle-share.server");
        const found = await loadVehicleShareByToken(supabaseAdmin, token);
        if (!found || !found.pkg.mediaIds.includes(mediaId)) return NOT_FOUND();
        const { data: photo } = await supabaseAdmin
          .from("vehicle_media")
          .select("*")
          .eq("id", mediaId)
          .eq("vehicle_id", found.pkg.vehicleId)
          .maybeSingle();
        if (!photo || !isShareMediaEligible(photo)) return NOT_FOUND();
        if (!new Set(["vehicle-photos", "vehicle-originals"]).has(photo.storage_bucket)) return NOT_FOUND();
        const mime = String(photo.mime_type ?? "").toLowerCase().split(";")[0];
        if (!MIME.has(mime) || typeof photo.storage_path !== "string" || photo.storage_path.length > 400 || photo.storage_path.includes("..")) return NOT_FOUND();
        const { data: file, error } = await supabaseAdmin.storage.from(photo.storage_bucket).download(photo.storage_path);
        if (error || !file) return NOT_FOUND();
        return new Response(await file.arrayBuffer(), {
          headers: {
            "Content-Type": mime,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Content-Disposition": "inline",
          },
        });
      },
    },
  },
});
