/**
 * Server-side account confirmation for team invite and partner sign-up.
 * generateLink does not send mail, so we send a branded Resend message with
 * a drivereal.com confirm URL (hashed_token). Client signUp is not used —
 * that would let Supabase send its own supabase.co link.
 */
import { authUrlFromGenerateLink, publicAppUrl, safeAuthNextPath, type AuthOtpType } from "@/lib/public-app-url";

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function alreadyRegistered(message: string | undefined): boolean {
  const msg = (message || "").toLowerCase();
  return msg.includes("already") || msg.includes("registered") || msg.includes("exists");
}

export async function sendSignupConfirmForEmail(args: {
  email: string;
  password: string;
  next?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = args.email.trim().toLowerCase();
  const password = args.password;
  if (!EMAIL_OK.test(target) || target.length > 254) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (typeof password !== "string" || password.length < 6 || password.length > 200) {
    return { ok: false, error: "Choose a password that is at least 6 characters." };
  }
  const next = safeAuthNextPath(args.next) ?? "/login";
  const redirectTo = publicAppUrl(next);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "signup",
    email: target,
    password,
    options: { redirectTo },
  });

  let url: string | null = null;
  let type: AuthOtpType = "signup";

  if (!createErr) {
    url = authUrlFromGenerateLink(created, "signup", next);
  } else if (alreadyRegistered(createErr.message)) {
    const { findAuthUser } = await import("@/lib/portal-signin.server");
    const existing = await findAuthUser(supabaseAdmin, target);
    if (existing?.email_confirmed_at) {
      return { ok: false, error: "An account already exists for that email. Sign in instead." };
    }
    // Unconfirmed retry (or a confirmation email that did not send): mint a
    // fresh confirm link. The password from this attempt is not changed.
    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: target,
      options: { redirectTo },
    });
    if (linkErr) {
      console.error("[auth-signup] resend generateLink failed", linkErr.message);
      return { ok: false, error: "We couldn't send the confirmation email. Please try again." };
    }
    url = authUrlFromGenerateLink(link, "magiclink", next);
    type = "magiclink";
  } else {
    console.error("[auth-signup] generateLink failed", createErr.message);
    return { ok: false, error: "We couldn't create that account just now. Please try again." };
  }

  if (!url) {
    return { ok: false, error: "We couldn't create that account just now. Please try again." };
  }

  const { sendSignupConfirmEmail } = await import("@/lib/email.server");
  const sent = await sendSignupConfirmEmail({ to: target, url });
  if (!sent.ok) {
    console.error("[auth-signup] confirmation email failed", sent.error, { type });
    return { ok: false, error: "We couldn't send the confirmation email. Please try again." };
  }
  return { ok: true };
}
