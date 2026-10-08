import { createFileRoute } from "@tanstack/react-router";

// Fleet Inbox background worker. Woken by the database when a job is queued,
// and by a 1-minute retry timer that exists only while open jobs remain.
// Token-protected (private.cron_tokens 'fleet-inbox'); single-flight via a
// database lease; bounded work per run; exponential backoff with jitter;
// dead-letter after max attempts; AI credit/policy errors pause the queue.
const JOBS_PER_RUN = 2;
const JOB_LEASE_SECONDS = 180;
const RUN_LEASE_SECONDS = 240;

export const Route = createFileRoute("/api/public/cron/fleet-inbox")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async () => new Response("method not allowed", { status: 405 }),
    },
  },
});

function backoffSeconds(attempt: number): number {
  const base = Math.min(1800, 30 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

async function handle(request: Request): Promise<Response> {
  const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
  const auth = request.headers.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const { data: expected, error: tokErr } = await sb.rpc("get_cron_token", { _name: "fleet-inbox" });
  if (tokErr || !expected) return new Response("token config missing", { status: 500 });
  if (!provided || provided !== expected) return new Response("unauthorized", { status: 401 });

  const { data: got } = await sb.rpc("fleet_inbox_acquire_lease", { _seconds: RUN_LEASE_SECONDS });
  if (!got) return Response.json({ ok: true, skipped: "another run in progress" });

  const summary = { processed: 0, succeeded: 0, retried: 0, dead: 0, skipped: 0, paused: false as boolean | string };
  try {
    const { data: state } = await sb.from("fleet_inbox_worker_state").select("paused_reason").eq("id", 1).single();
    const paused = !!state?.paused_reason;
    // While paused, at most one probe job per run.
    const { data: jobs } = await sb.rpc("fleet_inbox_claim_jobs", { _limit: paused ? 1 : JOBS_PER_RUN, _lease_seconds: JOB_LEASE_SECONDS });
    const { analyzeItemCore, refreshBatchStatus } = await import("@/lib/fleet-inbox-core.server");

    for (const job of (jobs ?? []) as any[]) {
      summary.processed++;
      const now = new Date();
      const finish = (patch: Record<string, unknown>) => {
        if ("finished_at" in patch) patch.finished_at = new Date().toISOString();
        return
        sb.from("fleet_inbox_jobs").update({ lease_expires_at: null, ...patch } as any).eq("id", job.id); };
      try {
        let r = await analyzeItemCore(job.item_id, { allowStuck: job.attempts >= 3 });
        if (!r.ok && r.notClaimed) {
          const { data: it } = await sb.from("fleet_import_items").select("status").eq("id", job.item_id).maybeSingle();
          if (it?.status === "analyzing" && job.attempts < job.max_attempts) {
            // A staff-started analysis may still be running; check again shortly.
            await finish({ state: "retry_wait", next_run_at: new Date(now.getTime() + 120_000).toISOString(), last_error: "Waiting for an analysis already in progress." });
            summary.retried++;
            continue;
          }
          await finish({ state: "skipped", finished_at: now.toISOString(), last_error: "Already analyzed." });
          summary.skipped++;
          continue;
        }
        if (r.ok) {
          await finish({ state: "succeeded", finished_at: now.toISOString(), last_error: null });
          summary.succeeded++;
          if (paused) await sb.from("fleet_inbox_worker_state").update({ paused_reason: null, paused_at: null }).eq("id", 1);
          continue;
        }
        if (r.providerStatus === 402 || r.providerStatus === 403) {
          // Credits/policy: pause the whole queue; this attempt doesn't count.
          const reason = r.providerStatus === 402 ? "AI credits exhausted" : "AI access blocked by workspace policy";
          await sb.from("fleet_inbox_worker_state").update({ paused_reason: reason, paused_at: now.toISOString() }).eq("id", 1);
          await finish({ state: "retry_wait", attempts: Math.max(0, job.attempts - 1), next_run_at: new Date(now.getTime() + 300_000).toISOString(), last_error: reason });
          await sb.from("fleet_import_items").update({ status: "uploaded", error: `Paused: ${reason}.` }).eq("id", job.item_id);
          summary.paused = reason;
          break;
        }
        if (r.retryable && job.attempts < job.max_attempts) {
          const secs = backoffSeconds(job.attempts);
          await finish({ state: "retry_wait", next_run_at: new Date(now.getTime() + secs * 1000).toISOString(), last_error: r.error });
          await sb.from("fleet_import_items").update({ status: "uploaded", error: `Retrying automatically (attempt ${job.attempts + 1} of ${job.max_attempts}).` }).eq("id", job.item_id);
          summary.retried++;
          continue;
        }
        // Permanent failure or attempts exhausted: dead-letter; item stays Failed with Retry Analysis available.
        await finish({ state: "dead", finished_at: now.toISOString(), last_error: r.error });
        if (r.retryable) await sb.from("fleet_import_items").update({ status: "failed", error: `Analysis failed after ${job.attempts} attempts: ${r.error}` }).eq("id", job.item_id);
        summary.dead++;
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        console.error("[fleet-inbox-worker] job crashed", job.id, msg);
        const dead = job.attempts >= job.max_attempts;
        await finish(dead
          ? { state: "dead", finished_at: now.toISOString(), last_error: msg }
          : { state: "retry_wait", next_run_at: new Date(now.getTime() + backoffSeconds(job.attempts) * 1000).toISOString(), last_error: msg });
        await sb.from("fleet_import_items").update(dead
          ? { status: "failed", error: `Analysis failed after ${job.attempts} attempts.` }
          : { status: "uploaded", error: "Retrying automatically." }).eq("id", job.item_id);
        dead ? summary.dead++ : summary.retried++;
      } finally {
        await refreshBatchStatus(job.batch_id);
      }
    }
    await sb.rpc("fleet_inbox_disarm_if_idle");
  } finally {
    await sb.rpc("fleet_inbox_release_lease", { _summary: summary as any });
  }
  return Response.json({ ok: true, ...summary });
}
