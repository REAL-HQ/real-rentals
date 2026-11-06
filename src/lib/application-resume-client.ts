import { supabase } from "@/integrations/supabase/client";
import { APPLICATION_RESUME_ENABLED } from "@/lib/application-resume-flag";
import {
  OWN_DRAFT_COLUMNS,
  continueDraft,
  snapshotFromOwnRow,
  type ContinueDraft,
} from "@/lib/application-resume";

/**
 * Read a draft for the signed-in applicant. The account read is the
 * applicant's own RLS select. A token stashed in this tab is not read:
 * the next person on a shared device must not continue that application.
 * This call does not write or send a message.
 */
export async function loadContinueDraft(): Promise<ContinueDraft | null> {
  if (APPLICATION_RESUME_ENABLED !== true) return null;

  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id ?? null;
  if (!uid) return null;

  const { data: rows } = await supabase
    .from("applications")
    .select(OWN_DRAFT_COLUMNS)
    .eq("user_id", uid)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  for (const row of rows ?? []) {
    const draft = continueDraft(snapshotFromOwnRow(row as unknown as Record<string, unknown>), false);
    if (draft) return draft;
  }
  return null;
}
