import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";

/** Fill a missing email only. Never change a linked login, identity, stage or insurance. */
export const fillActivationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid(), email: z.string().trim().email().max(160) }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before, error } = await supabaseAdmin.from("applications")
      .select("id,email,user_id").eq("id", data.applicationId).is("deleted_at", null).maybeSingle();
    if (error) throw new Error("Could not read the application. Nothing was changed.");
    if (!before) throw new Error("Application not found");
    if (String(before.email ?? "").trim()) throw new Error("An email is already on file. Refresh before continuing; this action cannot replace it.");
    if (before.user_id) {
      const account = await supabaseAdmin.auth.admin.getUserById(before.user_id);
      if (account.error || account.data?.user?.email?.toLowerCase() !== data.email.toLowerCase()) {
        throw new Error("This application is linked to a different login. Its email cannot be changed here.");
      }
    }
    let write = supabaseAdmin.from("applications").update({ email: data.email })
      .eq("id", data.applicationId).is("deleted_at", null);
    write = before.email === null ? write.is("email", null) : write.eq("email", before.email);
    write = before.user_id === null ? write.is("user_id", null) : write.eq("user_id", before.user_id);
    const confirmed = await write.select("id,email").maybeSingle();
    if (confirmed.error || !confirmed.data || confirmed.data.email !== data.email) {
      throw new Error("The email could not be confirmed. Your draft is still here; refresh and retry.");
    }
    try {
      await logAudit(actor, { action: "application.activation_email_filled", entityType: "application", entityId: data.applicationId, summary: "Filled missing activation email",
        metadata: { from: before.email, to: data.email } });
      return { ok: true, email: confirmed.data.email, auditError: null };
    } catch {
      return { ok: true, email: confirmed.data.email, auditError: "Email saved, but its activity entry could not be recorded. Please report this." };
    }
  });
