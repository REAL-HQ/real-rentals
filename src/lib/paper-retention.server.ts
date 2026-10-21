// Inventory only. purgeDriver does not call this; permanent deletion stays on the live owner path.
import { paperClient } from "./paper-database";
import { retentionOutcome } from "./paper-retention";
export async function readPaperRetention(applicationId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = paperClient(supabaseAdmin);
  // Exact head counts cover all matching rows, never only the first API page.
  const results = await Promise.all([
    client
      .from("applications")
      .select("id,legal_hold,deleted_at,purged_at")
      .eq("id", applicationId)
      .single(),
    client
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", applicationId),
    client
      .from("paper_upload_operations")
      .select("operation_id", { count: "exact", head: true })
      .eq("driver_id", applicationId),
    client
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .in("action", ["paper_agreement.uploaded", "paper_agreement.note_updated"])
      .contains("metadata", { application_id: applicationId }),
    client
      .from("deletion_file_jobs")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId)
      .neq("status", "done")
      .neq("status", "failed"),
    client
      .from("deletion_file_jobs")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId)
      .eq("status", "failed"),
    // Two equality filters. An interpolated .or() would let a non-uuid widen the match.
    client
      .from("rentals")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId)
      .eq("status", "active"),
    client
      .from("rentals")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", applicationId)
      .eq("status", "active"),
    client
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", applicationId)
      .not("status", "in", "(paid,refunded,waived,void)"),
    client
      .from("toll_charges")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId)
      .in("status", ["new", "assigned", "disputed"]),
  ]);
  if (results.some((r) => r.error) || results.slice(1).some((r) => r.count === null))
    throw Error("Retention inventory incomplete; missing contract or query error.");
  const app = results[0].data!;
  const counts = results.slice(1).map((r) => r.count!);
  const inventory = {
    complete: true,
    retained: 1 + counts[0] + counts[1] + counts[2],
    pendingJobs: counts[3],
    failedJobs: counts[4],
    legalHold: app.legal_hold === true,
    operationalHold: counts.slice(5).some((n) => n > 0),
    storageVerifiedAbsent: false,
    databaseErasureVerified: false,
  };
  // Tombstone and other application history remain. These reads NEVER attest global erasure.
  return {
    ...retentionOutcome(inventory),
    inventory,
    scope: "paper copies and cleanup jobs; complete person-erasure inventory not established",
    alreadyPurged: !!app.purged_at,
  };
}
