import { createFileRoute } from "@tanstack/react-router";

// Public listing photos. The vehicle-photos bucket is private (staff-only at
// the storage layer). This route serves a file to anyone ONLY when a
// vehicle_media row marks that exact path as a published listing photo.
// Unpublished originals, unreviewed AI retouches and anything else in the
// bucket return 404 — same response as a path that doesn't exist.
const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
};

export const Route = createFileRoute("/api/public/vehicle-photos/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const path = decodeURIComponent((params as { _splat?: string })._splat ?? "");
        if (!path || path.length > 400 || path.includes("..")) return new Response("Not found", { status: 404 });
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        if (!MIME[ext]) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("vehicle_media")
          .select("id,mime_type")
          .eq("storage_bucket", "vehicle-photos")
          .eq("storage_path", path)
          .eq("published", true)
          .limit(1)
          .maybeSingle();
        if (!row) return new Response("Not found", { status: 404 });

        const { data: file, error } = await supabaseAdmin.storage.from("vehicle-photos").download(path);
        if (error || !file) return new Response("Not found", { status: 404 });

        return new Response(await file.arrayBuffer(), {
          headers: {
            "Content-Type": (row as any).mime_type || MIME[ext],
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
