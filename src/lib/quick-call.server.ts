import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { tierFromRoles } from "./roles";
import { quickCallPatch } from "./quick-call";
import type { z } from "zod";
import type { quickCallInput, quickCallNotesInput } from "./quick-call";

export async function recordQuickCall(input: z.infer<typeof quickCallInput>, context: { supabase: SupabaseClient<Database>; userId: string; claims: { email?: unknown } }) {
  const { data: roles, error: roleError } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
  const tier = tierFromRoles((roles ?? []).map((row) => row.role));
  if (roleError || !tier) throw new Error("Only Staff Can Record A Completed Call.");
  const occurred = new Date(input.occurredAt).getTime();
  if (!Number.isFinite(occurred) || occurred > Date.now()) throw new Error("The Completed Call Cannot Be In The Future.");
  const { data: app, error: appError } = await context.supabase.from("applications").select("id,deleted_at,status").eq("id", input.applicationId).maybeSingle();
  if (appError || !app || app.deleted_at || app.status === "closed") throw new Error("This Driver Is Not Available For Call Recording.");
  const { data: current, error: readError } = await context.supabase.from("driver_screenings").select("*").eq("lead_id", input.applicationId).maybeSingle();
  if (readError) throw new Error("Could Not Read The Interview. Nothing Was Changed.");
  if (current?.interview_completed_at) return { screening: current, alreadyComplete: true, auditWarning: null };

  const actor = { userId: context.userId, email: typeof context.claims.email === "string" ? context.claims.email : null };
  const operationId = crypto.randomUUID();
  // Privileged access only to append staff audit evidence, after RLS role checks.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const attribution = { actor_user_id: actor.userId, actor_email: actor.email, actor_role: tier === "owner" ? "admin" : tier === "manager" ? "team" : "coordinator", entity_type: "application", entity_id: input.applicationId };
  const metadata = { operation_id: operationId, source: "phone", occurred_at: input.occurredAt, note: input.note, screening_id: current?.id ?? null, changes_stage: false };
  const { error: attemptError } = await supabaseAdmin.from("audit_log").insert({ ...attribution, action: "interview.call_recording_requested", summary: "Staff requested recording of a completed phone call", metadata });
  if (attemptError) throw new Error("Could Not Record Who Completed The Call. Nothing Was Changed.");

  const patch = quickCallPatch(current ?? {}, input, actor);
  const write = current
    ? context.supabase.from("driver_screenings").update(patch).eq("id", current.id).eq("updated_at", current.updated_at).is("interview_completed_at", null)
    : context.supabase.from("driver_screenings").insert({ lead_id: input.applicationId, ...patch });
  const { data: saved, error: writeError } = await write.select("*").maybeSingle();
  if (writeError || !saved) {
    const { error: refusedAuditError } = await supabaseAdmin.from("audit_log").insert({ ...attribution, action: "interview.call_recording_refused", summary: "Call recording did not change the screening", metadata: { operation_id: operationId } });
    if (refusedAuditError) throw new Error("The Call Was Not Saved. The Request Was Recorded, But Its Refusal Audit Could Not Be Saved. Refresh Before Retrying.");
    throw new Error("The Interview Could Not Be Saved Or Changed While You Were Reviewing It. Refresh And Try Again.");
  }
  const { error: outcomeError } = await supabaseAdmin.from("audit_log").insert({ ...attribution, action: "interview.call_recorded", summary: "Completed phone call recorded by staff", metadata: { ...metadata, screening_id: saved.id } });
  return { screening: saved, alreadyComplete: false, auditWarning: outcomeError ? "Call Saved With Staff Attribution; The Final Audit Confirmation Could Not Be Saved." : null };
}

/** Edit only the saved note. Completion, interviewer, answers and stage are immutable here. */
export async function updateQuickCallNotes(input: z.infer<typeof quickCallNotesInput>, context: { supabase: SupabaseClient<Database>; userId: string; claims: { email?: unknown } }) {
  const { data: roles, error: roleError } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
  const tier = tierFromRoles((roles ?? []).map((row) => row.role));
  if (roleError || !tier) throw new Error("Only Staff Can Edit Call Notes.");
  const { data: app, error: appError } = await context.supabase.from("applications").select("id,deleted_at,status").eq("id", input.applicationId).maybeSingle();
  if (appError || !app || app.deleted_at || app.status === "closed") throw new Error("This Driver Is Not Available For Call Note Editing.");
  const { data: current, error: readError } = await context.supabase.from("driver_screenings").select("*").eq("lead_id", input.applicationId).maybeSingle();
  if (readError) throw new Error("Could Not Read The Interview. Nothing Was Changed.");
  if (!current?.interview_completed_at) throw new Error("Complete The Call Before Editing Its Notes.");
  if ((current.interview_notes ?? "") === input.note) return { screening: current, auditWarning: null };

  const actor = { userId: context.userId, email: typeof context.claims.email === "string" ? context.claims.email : null };
  const operationId = crypto.randomUUID();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const attribution = { actor_user_id: actor.userId, actor_email: actor.email, actor_role: tier === "owner" ? "admin" : tier === "manager" ? "team" : "coordinator", entity_type: "application", entity_id: input.applicationId };
  const metadata = { operation_id: operationId, source: "phone", previous_notes: current.interview_notes ?? null, notes: input.note, screening_id: current.id, changes_stage: false, changes_completion: false };
  const { error: attemptError } = await supabaseAdmin.from("audit_log").insert({ ...attribution, action: "interview.call_notes_update_requested", summary: "Staff requested editing completed phone call notes", metadata });
  if (attemptError) throw new Error("Could Not Record Who Edited The Call Notes. Nothing Was Changed.");

  const { data: saved, error: writeError } = await context.supabase
    .from("driver_screenings")
    .update({ interview_notes: input.note })
    .eq("id", current.id)
    .eq("updated_at", current.updated_at)
    .eq("interview_completed_at", current.interview_completed_at)
    .select("*")
    .maybeSingle();
  if (writeError || !saved) {
    const { error: refusedAuditError } = await supabaseAdmin.from("audit_log").insert({ ...attribution, action: "interview.call_notes_update_refused", summary: "Call note editing did not change the screening", metadata: { operation_id: operationId } });
    if (refusedAuditError) throw new Error("The Call Notes Were Not Saved. The Request Was Recorded, But Its Refusal Audit Could Not Be Saved. Refresh Before Retrying.");
    throw new Error("The Call Notes Could Not Be Saved Or Changed While You Were Reviewing Them. Refresh And Try Again.");
  }
  const { error: outcomeError } = await supabaseAdmin.from("audit_log").insert({ ...attribution, action: "interview.call_notes_updated", summary: "Completed phone call notes edited by staff", metadata });
  return { screening: saved, auditWarning: outcomeError ? "Call Notes Saved With Staff Attribution; The Final Audit Confirmation Could Not Be Saved." : null };
}