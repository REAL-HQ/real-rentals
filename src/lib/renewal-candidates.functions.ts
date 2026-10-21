import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RENEWAL_CANDIDATES_ENABLED } from "@/lib/renewal-candidates-flag";
import type { RenewalCandidateList } from "@/lib/renewal-candidates";

/** Read-only. Refuses before the role check and before any table read while the flag is off. */
export const listRenewalCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RenewalCandidateList> => {
    if (RENEWAL_CANDIDATES_ENABLED !== true) throw new Error("Renewal candidates are not enabled.");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { loadRenewalCandidates } = await import("@/lib/renewal-candidates.server");
    return loadRenewalCandidates();
  });
