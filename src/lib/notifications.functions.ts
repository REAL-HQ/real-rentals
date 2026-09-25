import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOwner } from "@/lib/roles.server";

// Telling the operator whether applicant alerts can actually be delivered.
//
// The alert path is fire-and-forget by design: a failed email must never cost
// us an application. The cost of that is silence — a missing RESEND_API_KEY
// looks exactly like a delivered email from the back office, and an address
// typed into Settings looks configured whether or not anything can send.
//
// So the settings screen gets to ask two questions directly: is sending
// possible at all, and what happens if we try right now.
//
// Owner-only. The status reveals which integrations exist, and the test send
// puts mail in someone's inbox.

export type EmailDiagnostics = {
  /** Is an API key present in the running environment? Never the key itself. */
  providerConfigured: boolean;
  /** Addresses an alert would go to right now, after all fallbacks. */
  recipients: string[];
  /** Where those came from, so a surprising address is traceable. */
  source: "settings" | "environment" | "default";
  onNew: boolean;
  onComplete: boolean;
  fromAddress: string;
};

export const getEmailDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EmailDiagnostics> => {
    await requireOwner(context.userId);
    const { getLeadAlertPrefs } = await import("@/lib/email.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const prefs = await getLeadAlertPrefs();

    // Work out which rung of the fallback ladder actually supplied the
    // addresses, because "why is it emailing that?" is the next question.
    let source: EmailDiagnostics["source"] = "default";
    try {
      const { data } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", "notifications")
        .maybeSingle();
      const configured = String((data?.value as any)?.admin_email ?? "").trim();
      if (configured.includes("@")) source = "settings";
      else if ((process.env.LEAD_ALERT_TO ?? "").includes("@")) source = "environment";
    } catch {
      /* the recipients above are still correct; only the label is unknown */
    }

    return {
      providerConfigured: Boolean(process.env.RESEND_API_KEY),
      recipients: prefs.recipients,
      source,
      onNew: prefs.onNew,
      onComplete: prefs.onComplete,
      fromAddress: "team@drivereal.com",
    };
  });

export const sendTestAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; sentTo: string[]; error?: string }> => {
    const actor = await requireOwner(context.userId);
    const { sendEmail, getLeadAlertPrefs } = await import("@/lib/email.server");

    const prefs = await getLeadAlertPrefs();
    if (!prefs.recipients.length) {
      return { ok: false, sentTo: [], error: "No recipient address is configured." };
    }

    // Deliberately shaped like a real alert, so a test that lands in spam
    // tells you the real one would too.
    const result = await sendEmail({
      to: prefs.recipients,
      subject: "Test: REAL RENTALS applicant alerts are working",
      html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
        <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#D03020;font-weight:700">REAL RENTALS</div>
        <h1 style="margin:12px 0 8px;font-size:20px">Applicant alerts are working</h1>
        <p style="font-size:15px;line-height:1.6;color:#444">
          If you are reading this, new-applicant notifications will reach this address.
        </p>
        <p style="font-size:14px;line-height:1.6;color:#444">
          You will get <strong>New Driver Lead</strong> when someone starts or returns to an
          application, and <strong>Wizard Completed</strong> when they finish.
        </p>
        <p style="color:#888;font-size:12px;margin-top:24px">
          Sent from Settings → Notifications by ${escapeHtml(actor.email ?? "an owner")}.
        </p>
      </div>`,
    });

    return { ok: result.ok, sentTo: prefs.recipients, error: result.error };
  });

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
