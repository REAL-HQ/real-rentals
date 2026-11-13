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
