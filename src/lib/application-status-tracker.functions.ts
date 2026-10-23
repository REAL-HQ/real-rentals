import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertApplicationStatusTrackerEnabled,
  buildApplicationStatus,
  isApprovedStatus,
  type ApplicationStatusView,
  type TrackerDocument,
} from "@/lib/application-status-tracker";

/**
 * Read-only. The caller's own client, so existing row security applies.
 * Nothing here writes.
 */
export const getApplicationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => input ?? {})
  .handler(async ({ context }): Promise<ApplicationStatusView | null> => {
    assertApplicationStatusTrackerEnabled();

    const applications = await context.supabase
      .from("applications")
      .select("id,status,reviewed_at,waitlist_signed_up_at")
      .eq("user_id", context.userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (applications.error) throw new Error(applications.error.message);
    const app = applications.data?.[0];
    if (!app || isApprovedStatus(app.status)) return null;

    const documents = await context.supabase
      .from("documents")
      .select("category,created_at,is_current")
      .eq("driver_id", app.id);
    const rows = documents.error ? null : ((documents.data ?? []) as TrackerDocument[]);

    return buildApplicationStatus(
      {
        status: app.status,
        reviewed_at: app.reviewed_at,
        waitlist_signed_up_at: app.waitlist_signed_up_at,
      },
      rows,
      { applyRouteLive: true },
    );
  });
