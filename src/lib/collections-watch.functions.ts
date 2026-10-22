import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COLLECTIONS_WATCH_ENABLED } from "./collections-watch-flag";
import { readLiveCollectionsWatch } from "./collections-watch-read.server";
import { loadCollectionsDirectory, runCollectionsWatch, type CollectionsWatchResponse } from "./collections-watch.server";

/** Read-only. The flag returns before roles, driver rows, and Stripe. */
export const getCollectionsWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CollectionsWatchResponse> => {
    if (!COLLECTIONS_WATCH_ENABLED) return { status: "disabled", report: null };
    if (!context.userId) throw new Error("Forbidden");
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    return runCollectionsWatch({
      enabled: COLLECTIONS_WATCH_ENABLED,
      userId: context.userId,
      roles: roles.map((row) => row.role),
      load: () => loadCollectionsDirectory(context.supabase),
      readStripe: (window) => readLiveCollectionsWatch(window),
    });
  });
