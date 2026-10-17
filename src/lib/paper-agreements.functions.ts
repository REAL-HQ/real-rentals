import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// No registration/backfill, signing, URL generation or mutation on this read.
export const listPaperAgreementOriginals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ applicationId: z.string().uuid() }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.from("documents")
      .select("id,file_name,label,created_at,content_sha256,is_current,source")
      .eq("driver_id", data.applicationId).eq("category", "agreement")
      .eq("storage_bucket", "rental-agreements").eq("source", "paper")
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load paper agreements.");
    return rows ?? [];
  });