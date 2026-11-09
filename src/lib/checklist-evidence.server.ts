import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttestationInput, EvidenceEvent } from "./checklist-evidence";

// Reads and writes run as the signed-in user: RLS limits reads to Managers/Owners
// and public.record_checklist_evidence re-checks the role, revision and
// idempotency key, and writes the audit entry in the same transaction.

export async function readEvidenceEvents(supabase: SupabaseClient, applicationId: string): Promise<EvidenceEvent[]> {
  const { data, error } = await (supabase as any)
    .from("checklist_evidence_events")
    .select("id,application_id,field,revision,supersedes_id,state,source,note,actor_id,created_at,idempotency_key")
    .eq("application_id", applicationId)
    .order("revision", { ascending: true });
  if (error) throw new Error("Could Not Load Checklist Check-Offs. Try Again.");
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    applicationId: r.application_id,
    field: r.field,
    revision: r.revision,
    expectedRevision: r.revision - 1,
    supersedesId: r.supersedes_id,
    state: r.state,
    source: r.state === "collected" ? r.source : null,
    note: r.note ?? "",
    idempotencyKey: r.idempotency_key,
    actorId: r.actor_id,
    occurredAt: r.created_at,
  })) as EvidenceEvent[];
}

const ERRORS: Record<string, string> = {
  manager_required: "Only A Manager Or Owner Can Check This Off.",
  not_signed_in: "Sign In Again To Continue.",
  evidence_changed: "Someone Else Just Updated This Item. Refresh And Try Again.",
  application_not_found: "This Renter Could Not Be Found.",
  idempotency_conflict: "This Change Was Already Recorded Differently. Refresh And Try Again.",
};

export async function writeEvidenceEvent(supabase: SupabaseClient, input: AttestationInput) {
  const { data, error } = await (supabase as any).rpc("record_checklist_evidence", {
    _application_id: input.applicationId,
    _field: input.field,
    _state: input.state,
    _source: input.state === "collected" ? input.source : null,
    _note: input.note,
    _expected_revision: input.expectedRevision,
    _idempotency_key: input.idempotencyKey,
  });
  if (error) {
    const key = Object.keys(ERRORS).find((k) => String(error.message ?? "").includes(k));
    throw new Error(key ? ERRORS[key] : "Could Not Save This Check-Off. Try Again.");
  }
  return data as { id: string; revision: number; replayed: boolean };
}
