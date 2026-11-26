/**
 * Server-side password reset. generateLink does not send mail, so we send a
 * branded Resend message with a drivereal.com confirm URL (hashed_token).
 * Always fails closed and silent: the caller must not learn whether the
 * address has an account.
 */
import { recoveryUrlFromGenerateLink, publicAppUrl } from "@/lib/public-app-url";

export async function sendPasswordResetForEmail(email: string): Promise<void> {
  const target = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) || target.length > 254) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The Driver Portal opens at pickup (t466u). A renter who has not picked up
  // gets their secure documents link instead of a password. Staff are never
  // gated (their sign-in is /admin).
  if (await prePickupRenter(supabaseAdmin, target)) {
    try {
      const { prePickupApplicationForEmail } = await import("@/lib/portal-pickup-gate.server");
      const app = await prePickupApplicationForEmail(supabaseAdmin, target);
      if (app) {
        const { sendDocumentsLinkEmail } = await import("@/lib/email.server");
        await sendDocumentsLinkEmail({ to: app.email, firstName: app.full_name, applicationId: app.id });
      }
    } catch (e) {
      console.error("[password-reset] documents link failed", e);
    }
    return;
  }
  const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: target,
    options: { redirectTo: publicAppUrl("/set-password") },
  });
  if (error) return;
  const url = recoveryUrlFromGenerateLink(link);
  if (!url) return;
  const { sendPasswordResetEmail } = await import("@/lib/email.server");
  await sendPasswordResetEmail({ to: target, url });
}

async function prePickupRenter(admin: any, email: string): Promise<boolean> {
  try {
    const { findAuthUser } = await import("@/lib/portal-signin.server");
    const user = await findAuthUser(admin, email);
    if (user) {
      const { data } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      if ((data ?? []).some((r: any) => ["admin", "team", "coordinator", "partner"].includes(String(r.role)))) return false;
    }
    const { portalGateForEmail } = await import("@/lib/portal-pickup-gate.server");
    return (await portalGateForEmail(admin, email)) === "pre_pickup";
  } catch {
    // Fail closed: a gate that cannot be read sends no password link.
    return true;
  }
}
