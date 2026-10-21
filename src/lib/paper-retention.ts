export type Inventory = {
  complete: boolean;
  failedJobs: number;
  pendingJobs: number;
  retained: number;
  legalHold: boolean;
  operationalHold: boolean;
  storageVerifiedAbsent: boolean;
  databaseErasureVerified: boolean;
  error?: boolean;
};
export type Outcome = {
  outcome: "Retained" | "Pending" | "Failed" | "Completed";
  erasureComplete: boolean;
};
export function retentionOutcome(i: Inventory): Outcome {
  if (
    !i ||
    !["failedJobs", "pendingJobs", "retained"].every(
      (k) => Number.isSafeInteger(i[k as keyof Inventory]) && Number(i[k as keyof Inventory]) >= 0,
    ) ||
    ![
      "complete",
      "legalHold",
      "operationalHold",
      "storageVerifiedAbsent",
      "databaseErasureVerified",
    ].every((k) => typeof i[k as keyof Inventory] === "boolean") ||
    i.error ||
    !i.complete ||
    i.failedJobs > 0
  )
    return { outcome: "Failed", erasureComplete: false };
  if (i.legalHold || i.operationalHold || i.retained > 0)
    return { outcome: "Retained", erasureComplete: false };
  if (i.pendingJobs > 0 || !i.storageVerifiedAbsent || !i.databaseErasureVerified)
    return { outcome: "Pending", erasureComplete: false };
  return { outcome: "Completed", erasureComplete: true };
}
export function staffDeletionMessage(message: string) {
  return message.includes("PAPER_AUDIT_ACTOR_RETENTION_HOLD")
    ? "Retained — staff account deletion is blocked by immutable paper-audit attribution. Administrative retention review required."
    : message;
}
export async function reconcileCleanupJob(
  job: { id: string; attempts: number },
  storage: { error?: unknown; absenceVerified: boolean },
  persist: (
    id: string,
    patch: { status: string; attempts: number; last_error: string | null },
  ) => Promise<{ error: unknown; updatedIds: string[] }>,
) {
  const verified = !storage.error && storage.absenceVerified;
  try {
    const r = await persist(job.id, {
      status: verified ? "done" : "failed",
      attempts: job.attempts + 1,
      last_error: verified ? null : "Storage absence unverified",
    });
    if (r.error || r.updatedIds.length !== 1 || r.updatedIds[0] !== job.id)
      throw Error("Persistence unknown");
    return {
      outcome: verified ? "Completed" : "Failed",
      scope: "single_file_job",
      erasureComplete: false,
    };
  } catch {
    return { outcome: "Failed", scope: "single_file_job", erasureComplete: false };
  }
}
