import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { collectionsWatchEnabled } from "./collections-watch-flag";
import { readLiveCollectionsWatch } from "./collections-watch-read.server";
import { loadCollectionsDirectory, runCollectionsWatch, type CollectionsWatchResponse } from "./collections-watch.server";

/** Read-only. The flag returns before roles, driver rows, and Stripe. */
export const getCollectionsWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CollectionsWatchResponse> => {
    if (!collectionsWatchEnabled()) return { status: "disabled", report: null };
    if (!context.userId) throw new Error("Forbidden");
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    return runCollectionsWatch({
      enabled: collectionsWatchEnabled(),
      userId: context.userId,
      roles: roles.map((row) => row.role),
      load: () => loadCollectionsDirectory(context.supabase),
      readStripe: (window) => readLiveCollectionsWatch(window),
    });
  });
