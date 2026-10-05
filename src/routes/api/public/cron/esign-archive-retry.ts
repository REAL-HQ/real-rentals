import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

// Re-attempts PDF archiving for signed eSign documents whose archive failed
// (or was interrupted). Idempotent: archived rows are skipped.
export const Route = createFileRoute("/api/public/cron/esign-archive-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const secret = process.env["CRON_SECRET"] ?? "";
  const auth = request.headers.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const a = Buffer.from(provided), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b))
    return new Response("unauthorized", { status: 401 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { retryArchive } = await import("@/lib/esign.server");
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("agreements")
    .select("id")
    .eq("status", "signed")
    .in("archive_status", ["failed", "pending"])
    .lt("archive_attempts", 10)
    .lt("signed_at", cutoff)
    .limit(20);
  let ok = 0, failed = 0;
  for (const row of data ?? []) {
    try {
      (await retryArchive(supabaseAdmin, row.id as string, null)) ? ok++ : failed++;
    } catch {
      failed++;
    }
  }
  return Response.json({ ok: true, archived: ok, failed });
}
