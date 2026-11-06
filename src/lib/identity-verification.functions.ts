import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  IDENTITY_VERIFICATION_ENABLED,
  IDENTITY_VERIFICATION_HOLD,
} from "@/lib/identity-verification";

/**
 * Record a verified approval_identity review for one application.
 *
 * The flag is checked before the manager lookup and before either RPC.
 * preview_approval_identity and verify_approval_identity run on the
 * manager's own JWT. The preview jsonb is what the verifier stores, so the
 * decision matches the snapshot the database just returned.
 */
export const verifyApprovalIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        note: z.string().trim().min(3).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!IDENTITY_VERIFICATION_ENABLED) throw new Error(IDENTITY_VERIFICATION_HOLD);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const db = context.supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    const preview = await db.rpc("preview_approval_identity", {
      _application_id: data.applicationId,
    });
    if (preview.error) throw new Error(preview.error.message || "Could not preview this identity.");
    const verified = await db.rpc("verify_approval_identity", {
      _application_id: data.applicationId,
      _reviewed_evidence: preview.data,
      _note: data.note,
    });
    if (verified.error) throw new Error(verified.error.message || "Identity verification was refused.");
    return { ok: true as const, reviewId: String(verified.data) };
  });
