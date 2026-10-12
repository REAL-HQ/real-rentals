import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/roles.server";
import { tierAllows } from "@/lib/roles";
import {
  APPLICANT_WINDOW,
  NOTIFICATION_SELECT,
  OVERVIEW_APPLICANT_SELECT,
  projectNotification,
  projectOverviewApplicant,
  type NotificationsResult,
  type OverviewApplicantsResult,
  type RawRow,
  type ReadinessByApplicant,
} from "@/lib/admin-overview";
import {
  buildReadinessIndex,
  READINESS_APPLICATION_SELECT,
  READINESS_DOCUMENT_SELECT,
  READINESS_SCREENING_SELECT,
} from "@/lib/readiness-index";

/**
 * The two admin dashboard reads of `applications`, moved to the server.
 *
 * They were `supabase.from("applications")` in the browser, which worked only
 * because `authenticated` held a blanket SELECT on the table. Migration 0030
 * replaces that with a column allow-list that excludes `deleted_at` — which
 * every one of these queries filters on — so all three break, for an Owner
 * and a Manager as much as for a Coordinator.
 *
 * So the reads happen here, through the service role, and the tier decides
 * what comes back. The identity columns readiness is derived from never
 * leave the server at all: the verdict is computed here and the evidence
 * stays behind. See src/lib/admin-overview.ts for the field policy.
 *
 * Errors are thrown, never swallowed. A dashboard that renders 0 because a
 * query failed is worse than one that says it could not load: the first is a
 * confident lie about the pipeline, and somebody will act on it.
 */

/** Rows that keep an applicant's own readiness evidence out of the answer. */
type ReadinessRow = RawRow & { lead_id?: string | null };

export const getAdminNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NotificationsResult> => {
    // Owner, Manager or Coordinator. A driver or an anonymous caller is
    // refused here, before a single row is read.
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("applications")
      .select(NOTIFICATION_SELECT)
      .is("deleted_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(15);
    if (error) throw new Error(error.message);

    return {
      rows: ((data ?? []) as unknown as RawRow[])
        .map(projectNotification)
        .filter((r): r is NonNullable<typeof r> => r !== null),
    };
  });

export const getOverviewApplicants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OverviewApplicantsResult> => {
    const actor = await requireStaff(context.userId);
    const canSeeReadiness = tierAllows(actor.tier, "manager");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // One applicant read feeds both the list and the readiness verdict, as it
    // did in the browser. The readiness columns are selected but never
    // returned — they are consumed by buildReadinessIndex below.
    const [newAppsQ, pendingAppsQ, appsQ] = await Promise.all([
      // New = finished the wizard AND nobody has opened it. Status alone
      // would keep counting work somebody already read and left alone.
      supabaseAdmin
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("status", "new")
        .is("reviewed_at", null)
        .is("deleted_at", null),
      supabaseAdmin
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("status", "partial")
        .is("deleted_at", null),
      supabaseAdmin
        .from("applications")
        .select(`${OVERVIEW_APPLICANT_SELECT},${READINESS_APPLICATION_SELECT}`)
        .neq("status", "duplicate")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(APPLICANT_WINDOW),
    ]);
    for (const q of [newAppsQ, pendingAppsQ, appsQ]) {
      if (q.error) throw new Error(q.error.message);
    }

    // Cast: the generated client cannot type a select built from a shared
    // column list, so the shape is guaranteed by the *_SELECT constants
    // rather than by inference — as it was in the browser.
    const rows = (appsQ.data ?? []) as unknown as RawRow[];
    const applicants = rows
      .map(projectOverviewApplicant)
      .filter((r): r is NonNullable<typeof r> => r !== null);

    let readiness: ReadinessByApplicant = {};
    if (canSeeReadiness) {
      // Only fetched when it will be used. A Coordinator's request never
      // reads a screening or a document row at all.
      const [screeningsQ, leadDocsQ] = await Promise.all([
        supabaseAdmin.from("driver_screenings").select(READINESS_SCREENING_SELECT),
        supabaseAdmin
          .from("documents")
          .select(READINESS_DOCUMENT_SELECT)
          .not("driver_id", "is", null),
      ]);
      for (const q of [screeningsQ, leadDocsQ]) {
        if (q.error) throw new Error(q.error.message);
      }
      const index = buildReadinessIndex(
        rows as never,
        (screeningsQ.data ?? []) as unknown as ReadinessRow[] as never,
        (leadDocsQ.data ?? []) as unknown as ReadinessRow[] as never,
      );
      readiness = Object.fromEntries(index);
    }

    return {
      newApps: newAppsQ.count ?? 0,
      pendingApps: pendingAppsQ.count ?? 0,
      applicants,
      readiness,
      canSeeReadiness,
    };
  });
