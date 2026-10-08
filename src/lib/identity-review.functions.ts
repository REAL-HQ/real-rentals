import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager, requireStaff } from "@/lib/roles.server";

/**
 * Durable identity reviews (application_identity_reviews). Rows are written
 * only by the server on submit; staff read through RLS (private.is_staff);
 * only Manager+ resolve, audited. AI scoring never touches this table.
 */
export const listIdentityReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireStaff(context.userId);
    const { data: rows, error } = await context.supabase
      .from("application_identity_reviews")
      .select("id,kind,submitted_full_name,submitted_email,submitted_phone,source,status,resolution,resolution_note,resolved_at,created_at")
      .eq("application_id", data.applicationId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load identity reviews. Please retry.");
    return { rows: rows ?? [] };
  });

export const resolveIdentityReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      resolution: z.enum(["same_person", "different_person", "dismissed"]),
      note: z.string().trim().min(3).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireManager(context.userId);
    const { data: result, error } = await context.supabase.rpc("resolve_application_identity_review", {
      _review_id: data.id, _resolution: data.resolution, _note: data.note,
    });
    if (error) throw new Error("Could not resolve identity review. Please retry.");
    return z.object({ ok: z.literal(true), changed: z.boolean() }).parse(result);
  });
