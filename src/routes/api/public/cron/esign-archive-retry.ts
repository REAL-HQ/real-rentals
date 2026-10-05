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

const MAX_ATTEMPTS = 10;
/** Exponential backoff: 5 min, 10, 20 … capped at 12 h between attempts. */
const backoffMs = (attempts: number) => Math.min(5 * 60_000 * 2 ** Math.max(0, attempts - 1), 12 * 3600_000);

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const auth = request.headers.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const { data: expected } = await supabaseAdmin.rpc("get_cron_token", { _name: "esign-archive-retry" });
  const a = Buffer.from(provided), b = Buffer.from(String(expected ?? ""));
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b))
    return new Response("unauthorized", { status: 401 });

  const { retryArchive } = await import("@/lib/esign.server");
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("agreements")
    .select("id,archive_attempts,archive_last_attempt_at")
    .eq("status", "signed")
    .in("archive_status", ["failed", "pending"])
    .lt("archive_attempts", MAX_ATTEMPTS)
    .lt("signed_at", cutoff)
    .order("archive_last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(50);
  const now = Date.now();
  const due = (data ?? []).filter((r: any) =>
    !r.archive_last_attempt_at || now - new Date(r.archive_last_attempt_at).getTime() >= backoffMs(r.archive_attempts ?? 0),
  ).slice(0, 20);
  let ok = 0, failed = 0;
  // One broken document never stops the batch.
  for (const row of due) {
    try {
      (await retryArchive(supabaseAdmin, row.id as string, null)) ? ok++ : failed++;
    } catch {
      failed++;
    }
  }
  return Response.json({ ok: true, considered: data?.length ?? 0, attempted: due.length, archived: ok, failed });
}
