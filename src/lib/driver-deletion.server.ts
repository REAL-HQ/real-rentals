// Removes files queued by purge_application from private storage.
// Missing files count as done; failures stay visible and retryable.
import { ARCHIVE_DELETION_GUARD_ENABLED } from "@/lib/record-rental-live-path";

export async function processFileJobs(applicationId: string | null) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin.from("deletion_file_jobs").select("id,bucket,path,attempts").neq("status", "done").limit(200);
  if (applicationId) q = q.eq("application_id", applicationId);
  const { data: jobs } = await q;
  let done = 0;
  let failed = 0;
  for (const j of (jobs ?? []) as any[]) {
    // refuseArchiveDeletion rejects the whole rental-agreements bucket. Leave it
    // off until signed-archive protection is installed, or today's deletions fail.
    let error: { message: string } | null = null;
    if (ARCHIVE_DELETION_GUARD_ENABLED) {
      const { refuseArchiveDeletion } = await import("@/lib/signed-archive-protection.server");
      try {
        refuseArchiveDeletion(j.bucket, j.path);
        ({ error } = await supabaseAdmin.storage.from(j.bucket).remove([j.path]));
      } catch (e) {
        error = { message: e instanceof Error ? e.message : "Archive retained" };
      }
    } else {
      ({ error } = await supabaseAdmin.storage.from(j.bucket).remove([j.path]));
    }
    const ok = !error || /not found/i.test(error.message);
    await supabaseAdmin
      .from("deletion_file_jobs")
      .update({
        status: ok ? "done" : "failed",
        attempts: j.attempts + 1,
        last_error: ok ? null : String(error?.message ?? "").slice(0, 300),
        updated_at: new Date().toISOString(),
      })
      .eq("id", j.id);
    ok ? done++ : failed++;
  }
  return { done, failed };
}
