import { supabase } from "@/integrations/supabase/client";
import {
  APPLICATION_RESUME_ENABLED,
  OWN_DRAFT_COLUMNS,
  continueDraft,
  snapshotFromOwnRow,
  snapshotFromWizard,
  type ContinueDraft,
} from "@/lib/application-resume";
import { readResumeToken } from "@/lib/resume-token";

/**
 * Read a draft for the signed-in applicant, or for this tab's resume token.
 * The account read is the applicant's own RLS select. The token read is
 * getApplicationForWizard. Neither call writes or sends a message.
 */
export async function loadContinueDraft(): Promise<ContinueDraft | null> {
  if (APPLICATION_RESUME_ENABLED !== true) return null;

  const token = readResumeToken();
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user?.id ?? null;

  if (uid) {
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
  }

  if (!token) return null;
  try {
    const { getApplicationForWizard } = await import("@/lib/applications.functions");
    const row = await getApplicationForWizard({ data: { token } });
    return continueDraft(snapshotFromWizard(row), true);
  } catch {
    return null;
  }
}
