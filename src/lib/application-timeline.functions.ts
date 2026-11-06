import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  APPLICATION_TIMELINE_ENABLED,
  buildApplicationTimeline,
  identityClear,
  type ApplicationTimeline,
} from "@/lib/application-timeline";

/**
 * The signed-in applicant's own timeline.
 *
 * The browser does not name an application. Rows are read with the caller's
 * user id only, the same way portal access finds their application. Nothing
 * is written or emailed. The answer is driver-facing labels, not staff notes
 * or the stored status words.
 *
 * While APPLICATION_TIMELINE_ENABLED is false this returns before any read.
 */

export type MyApplicationTimeline = { enabled: false } | ({ enabled: true } & ApplicationTimeline);

type AppRow = {
  id: string;
  status: string | null;
  license_photo_url: string | null;
  insurance_doc_url: string | null;
  background_check_status: string | null;
  mvr_status: string | null;
};

function fail(error: { message?: string | null } | null, what: string): never {
  throw new Error(error?.message || `${what} could not be loaded.`);
}

export const getMyApplicationTimeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyApplicationTimeline> => {
    if (APPLICATION_TIMELINE_ENABLED !== true) return { enabled: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const apps = await supabaseAdmin
      .from("applications")
      .select("id,status,license_photo_url,insurance_doc_url,background_check_status,mvr_status")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (apps.error) fail(apps.error, "Your application");
    const app = ((apps.data ?? []) as AppRow[])[0] ?? null;
    if (!app) return { enabled: true, show: false, steps: [], missing: [] };

    const rentals = await supabaseAdmin
      .from("rentals")
      .select("id")
      .eq("driver_id", userId)
      .eq("status", "active")
      .limit(1);
    if (rentals.error) fail(rentals.error, "Your rental");

    const docs = await supabaseAdmin
      .from("documents")
      .select("category,is_current")
      .eq("driver_id", app.id)
      .in("category", ["license_front", "license_back", "insurance"]);
    if (docs.error) fail(docs.error, "Your documents");

    const current = new Set(
      ((docs.data ?? []) as { category: string | null; is_current: boolean | null }[])
        .filter((d) => d.is_current !== false && d.category)
        .map((d) => d.category as string),
    );
    const onFile = (photo: string | null, categories: string[]) =>
      Boolean(photo && photo.trim()) || categories.some((c) => current.has(c));

    return {
      enabled: true,
      ...buildApplicationTimeline({
        status: app.status,
        hasActiveRental: (rentals.data ?? []).length > 0,
        licenseOnFile: onFile(app.license_photo_url, ["license_front", "license_back"]),
        insuranceOnFile: onFile(app.insurance_doc_url, ["insurance"]),
        identityClear: identityClear(app.background_check_status, app.mvr_status),
      }),
    };
  });
