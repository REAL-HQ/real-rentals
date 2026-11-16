/**
 * Step 1 confirmation email (Automation Blueprint, Nov 14).
 *
 * Sent once, right after a NEW application is saved by Step 1, from the
 * site's existing sender (team@drivereal.com). Behind the Back Office →
 * Automations switch "step1_thank_you_email", which is OFF until an Owner
 * turns it on. sendEmail checks the same switch again through the
 * "application_step1_thank_you" workflow, so an Off can never leak.
 *
 * Never names an insurance broker or carrier.
 */
import { gateFor, loadAutomationControls } from "@/lib/automation-controls.server";

export const STEP1_EMAIL_KEY = "step1_thank_you_email";
export const STEP1_EMAIL_WORKFLOW = "application_step1_thank_you";
/** The main business line: same number as the site header, the thank-you page and the follow-up texts. */
export const STEP1_EMAIL_LINE = { display: "(888) 833-8280", tel: "tel:+18888338280" } as const;
/** Same applicant-facing brand as the live site and every other message. */
export const STEP1_EMAIL_BRAND = "REAL RENTALS";

export const STEP1_EMAIL_COPY = {
  subject: "Step 2: Finish Your Application to Lock In Your Spot",
  headline: "You're In Line. Finish Step 2 Now to Hold Your Spot.",
  intro:
    "Thanks for applying with REAL RENTALS. We have a limited number of cars, and they go first come, first served. Priority goes to drivers who send a complete application, because that's how we verify you quickly and set up your insurance.",
  getTitle: "What You Get",
  get: [
    "INSURANCE INCLUDED. We pay for it, at no extra cost to you. It's already included in your weekly rental rate, with your name on the card.",
    "A car ready for rideshare and delivery apps",
    "Simple 4-week rentals you can renew",
    "A real team behind you if anything goes wrong on the road",
  ],
  // Same four steps, in the same words, as the thank-you page.
  nextTitle: "What Happens Next",
  steps: [
    { title: "Upload Your Documents", note: "Step 2, about 5 minutes" },
    { title: "Quick Background Check", note: "Usually same day" },
    { title: "Short Call With Our Team", note: "Answer your questions" },
    { title: "Pick Your Car and Pickup Time", note: "Tampa pickup location" },
  ],
  readyTitle: "Have These Ready",
  ready: [
    "Driver's License (Front)",
    "Gig App Profile Screenshot Showing Your # of Trips/Deliveries and Rating",
    "Your Current Home Address",
    "Optional: Earnings Screenshots or Other Proof of Income",
  ],
  whyTitle: "Why We Ask for Each Item",
  why: [
    "Driver's license: confirms it's really you, and it's needed to set up your insurance.",
    "Home address: insurance is priced by where you live.",
    "Gig app profile screenshot: this is the main one. Your number of trips/deliveries and your rating show you're an active driver, so we can approve you faster.",
    "Optional proof of income (earnings screenshots or other income): helps confirm the weekly rent will work for you.",
  ],
  // Blueprint said "You already agreed to this in the consent form", but this
  // email goes out at Step 1, before the applicant reaches the consent step.
  privacy:
    "You'll confirm this in a short consent step. We use your info only to verify you and set up your insurance. It's stored securely and never sold.",
  cta: "Click the button below to continue to Step 2. It takes about 5 minutes.",
  button: "Continue to Step 2",
  signOff: `Questions? Call or text us at ${STEP1_EMAIL_LINE.display}.`,
  team: "The Real Rentals Team",
} as const;

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderStepOneEmail(args: { firstName: string | null; continueUrl: string }): { subject: string; html: string } {
  const c = STEP1_EMAIL_COPY;
  const name = (args.firstName || "").trim().split(/\s+/)[0] || "";
  const h2 = (t: string) => `<h2 style="margin:22px 0 8px;font-size:16px;color:#111">${esc(t)}</h2>`;
  const list = (items: readonly string[]) =>
    `<ul style="margin:0;padding-left:20px;color:#333;font-size:15px;line-height:1.55">${items.map((i) => `<li style="margin:0 0 6px">${esc(i)}</li>`).join("")}</ul>`;
  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #eee">
      <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#D03020;font-weight:700">${STEP1_EMAIL_BRAND}</div>
      <h1 style="margin:12px 0 8px;font-size:22px;color:#111;line-height:1.3">${esc(c.headline)}</h1>
      ${name ? `<p style="color:#444;font-size:15px;line-height:1.55;margin:0 0 8px">Hi ${esc(name)},</p>` : ""}
      <p style="color:#444;font-size:15px;line-height:1.55;margin:0">${esc(c.intro)}</p>
      ${h2(c.getTitle)}${list(c.get)}
      ${h2(c.nextTitle)}<ol style="margin:0;padding-left:20px;color:#333;font-size:15px;line-height:1.55">${c.steps.map((s) => `<li style="margin:0 0 6px"><strong>${esc(s.title)}</strong>: ${esc(s.note)}</li>`).join("")}</ol>
      ${h2(c.readyTitle)}${list(c.ready)}
      ${h2(c.whyTitle)}${list(c.why)}
      <p style="color:#666;font-size:13px;line-height:1.55;margin:10px 0 0">${esc(c.privacy)}</p>
      <p style="color:#444;font-size:15px;line-height:1.55;margin:22px 0 14px">${esc(c.cta)}</p>
      <a href="${esc(args.continueUrl)}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">${esc(c.button)}</a>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#444;font-size:14px;margin:0">Questions? Call or text us at <a href="${STEP1_EMAIL_LINE.tel}" style="color:#111">${STEP1_EMAIL_LINE.display}</a>.</p>
      <p style="color:#444;font-size:14px;margin:6px 0 0">${esc(c.team)}</p>
    </div>
  </div>
</body></html>`;
  return { subject: c.subject, html };
}

type Deps = {
  admin?: any;
  loadControls?: typeof loadAutomationControls;
  sendEmail?: (a: { to: string; subject: string; html: string; replyTo?: string; track?: { workflow: string } }) => Promise<{ ok: boolean; error?: string }>;
  mintLink?: (applicationId: string) => Promise<string>;
  now?: () => Date;
};

export type StepOneEmailOutcome = "sent" | "off" | "held" | "no_email" | "failed";

/** Fire-and-forget from savePartialApplication. Never throws. */
export async function sendStepOneThankYouEmail(
  args: { applicationId: string; to: string | null; firstName: string | null; token?: string },
  deps: Deps = {},
): Promise<StepOneEmailOutcome> {
  try {
    if (!args.to) return "no_email";
    const state = await (deps.loadControls ?? loadAutomationControls)(deps.admin);
    const gate = gateFor(state, STEP1_EMAIL_KEY);
    if (gate !== "send") return gate;
    let url: string;
    if (deps.mintLink) url = await deps.mintLink(args.applicationId);
    else {
      const admin = deps.admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
      const { issueResumeToken, resumeUrl } = await import("@/lib/resume-tokens.server");
      url = resumeUrl(args.token ?? (await issueResumeToken(admin, args.applicationId)));
    }
    const { subject, html } = renderStepOneEmail({ firstName: args.firstName, continueUrl: url });
    const send = deps.sendEmail ?? (await import("@/lib/email.server")).sendEmail;
    const { EMAIL_REPLY_TO } = await import("@/lib/email.server");
    const res = await send({ to: args.to, subject, html, replyTo: EMAIL_REPLY_TO, track: { workflow: STEP1_EMAIL_WORKFLOW } });
    if (!res.ok) return "failed";
    // Logged on the lead. The follow-up workflow reads this row to skip its
    // 5-minute email, so the applicant never gets two welcome emails.
    try {
      const admin = deps.admin ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
      await admin.from("outbound_messages").insert({
        channel: "email",
        to_address: args.to,
        subject,
        body: STEP1_EMAIL_COPY.headline,
        status: "sent",
        provider: "resend",
        kind: "step1_thank_you",
        application_id: args.applicationId,
        sent_at: (deps.now ?? (() => new Date()))().toISOString(),
      });
    } catch (e) {
      console.error("[step1-email] log failed", e);
    }
    return "sent";
  } catch (e) {
    console.error("[step1-email] failed", e);
    return "failed";
  }
}
