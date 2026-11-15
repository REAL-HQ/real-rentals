// Step 1 thank-you email (Automation Blueprint). No network: the controls
// reader, the link minting and the sender are all injected fakes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AUTOMATIONS, isAutomationOn, isDefaultOff, settingKeyForEmailWorkflow } from "@/lib/automation-catalog";
import {
  STEP1_EMAIL_BRAND, STEP1_EMAIL_COPY, STEP1_EMAIL_KEY, STEP1_EMAIL_LINE, STEP1_EMAIL_WORKFLOW, renderStepOneEmail, sendStepOneThankYouEmail,
} from "@/lib/step-one-email.server";

const URL = "https://drivereal.com/apply?resume=TEST";
function harness(controls: any) {
  const sent: any[] = [];
  const minted: string[] = [];
  const logged: any[] = [];
  return {
    sent, minted, logged,
    deps: {
      admin: { from: (t: string) => ({ insert: async (r: any) => { logged.push({ table: t, ...r }); return { error: null }; } }) },
      now: () => new Date("2026-11-15T12:00:00.000Z"),
      loadControls: async () => controls,
      mintLink: async (id: string) => { minted.push(id); return URL; },
      sendEmail: async (a: any) => { sent.push(a); return { ok: true }; },
    },
  };
}
const ON = { status: "ok", value: { off: {}, on: { [STEP1_EMAIL_KEY]: { at: "2026-11-14T00:00:00Z", by: null } } } };
const args = { applicationId: "app-1", to: "lead@example.com", firstName: "Jordan Smith" };

describe("Step 1 thank-you email switch", () => {
  test("catalogued, default OFF, and its workflow is gated by the same key", () => {
    const def = AUTOMATIONS.find((a) => a.key === STEP1_EMAIL_KEY)!;
    expect(def.defaultOn).toBe(false);
    expect(isDefaultOff(STEP1_EMAIL_KEY)).toBe(true);
    expect(def.emailWorkflows).toEqual([STEP1_EMAIL_WORKFLOW]);
    expect(settingKeyForEmailWorkflow(STEP1_EMAIL_WORKFLOW)).toBe(STEP1_EMAIL_KEY);
    expect(isAutomationOn({ off: {} }, STEP1_EMAIL_KEY)).toBe(false);
  });

  test("nothing saved yet (prod today): skipped, no link minted, nothing sent", async () => {
    const h = harness({ status: "absent", value: { off: {} } });
    expect(await sendStepOneThankYouEmail(args, h.deps as any)).toBe("off");
    expect(h.sent.length).toBe(0);
    expect(h.minted.length).toBe(0);
  });

  test("settings unreadable: held, nothing sent", async () => {
    const h = harness({ status: "error", value: null });
    expect(await sendStepOneThankYouEmail(args, h.deps as any)).toBe("held");
    expect(h.sent.length).toBe(0);
  });

  test("turned on: one email from the existing sender, tracked under the gated workflow", async () => {
    const h = harness(ON);
    expect(await sendStepOneThankYouEmail(args, h.deps as any)).toBe("sent");
    expect(h.sent.length).toBe(1);
    const m = h.sent[0];
    expect(m.to).toBe("lead@example.com");
    expect(m.from).toBeUndefined(); // sendEmail's default: REAL RENTALS <team@drivereal.com>
    expect(m.replyTo).toBe("team@drivereal.com");
    expect(m.track).toEqual({ workflow: STEP1_EMAIL_WORKFLOW });
    expect(m.subject).toBe("Step 2: Finish Your Application to Lock In Your Spot");
    expect(m.html).toContain(`href="${URL}"`);
    expect(m.html).toContain("Hi Jordan,");
    expect(h.minted).toEqual(["app-1"]);
    // Logged on the lead, which is what lets the follow-up skip its 5-minute email.
    expect(h.logged).toEqual([{ table: "outbound_messages", channel: "email", to_address: "lead@example.com", subject: m.subject,
      body: STEP1_EMAIL_COPY.headline, status: "sent", provider: "resend", kind: "step1_thank_you", application_id: "app-1", sent_at: "2026-11-15T12:00:00.000Z" }]);
  });

  test("off, held or failed: nothing logged, so the 5-minute email still goes out", async () => {
    for (const c of [{ status: "absent", value: { off: {} } }, { status: "error", value: null }]) {
      const h = harness(c);
      await sendStepOneThankYouEmail(args, h.deps as any);
      expect(h.logged).toEqual([]);
    }
    const h = harness(ON);
    await sendStepOneThankYouEmail(args, { ...h.deps, sendEmail: async () => ({ ok: false, error: "x" }) } as any);
    expect(h.logged).toEqual([]);
  });

  test("no email address: nothing sent", async () => {
    const h = harness(ON);
    expect(await sendStepOneThankYouEmail({ ...args, to: null }, h.deps as any)).toBe("no_email");
    expect(h.sent.length).toBe(0);
  });

  test("a failing sender never throws into the form submission", async () => {
    const h = harness(ON);
    const r = await sendStepOneThankYouEmail(args, { ...h.deps, sendEmail: async () => { throw new Error("boom"); } } as any);
    expect(r).toBe("failed");
  });
});

describe("Step 1 thank-you email copy", () => {
  const { html } = renderStepOneEmail({ firstName: null, continueUrl: URL });
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  test("blueprint sections and wording", () => {
    for (const s of [
      "You're in Line. Finish Step 2 Now to Hold Your Spot.", "What You Get", "Have These Ready", "Why We Ask for Each Item",
      "INSURANCE INCLUDED. We pay for it, at no extra cost to you.", "Gig App Profile Screenshot Showing Your # of Trips/Deliveries and Rating",
      "Optional: Earnings Screenshots or Other Proof of Income", "this is the main one", "It takes about 5 minutes.",
      "Continue to Step 2", "Questions? Call or text us at (888) 833-8280", "The Real Rentals Team",
      "What Happens Next", "Thanks for applying with REAL RENTALS.",
    ]) expect(text).toContain(s);
    expect(html).toContain('href="tel:+18888338280"');
  });
  test("same brand and main line as the live site and every other message", () => {
    expect(STEP1_EMAIL_BRAND).toBe("REAL RENTALS");
    expect(text).toContain("REAL RENTALS");
    expect(/drive\s*real(?!\.com)/i.test(text)).toBe(false);
    expect(/813|212-4174/.test(html)).toBe(false);
  });
  test("matches the thank-you page: same steps, checklist, brand and line (when the page is in the tree)", async () => {
    let page: any = null;
    try { page = await import("@/lib/step-one-thank-you"); } catch { /* PR 362 not in this tree */ }
    if (!page) return;
    const P = page.STEP_ONE_THANK_YOU;
    expect(STEP1_EMAIL_COPY.steps).toEqual(P.steps);
    expect([...STEP1_EMAIL_COPY.ready]).toEqual([...P.ready]);
    expect(P.brand).toBe(STEP1_EMAIL_BRAND);
    expect(page.STEP_ONE_LINE.display).toBe(STEP1_EMAIL_LINE.display);
  });
  test("does not contradict the follow-up texts and emails (when that copy is in the tree)", async () => {
    let f: any = null;
    try { f = await import("@/lib/applicant-followup-copy"); } catch { /* PR 365 not in this tree */ }
    if (!f) return;
    const all = f.APPLICANT_FOLLOWUP_COPY.map((x: any) => `${x.subject ?? ""} ${x.body}`).join(" ");
    // Every follow-up asks for the same main document, with earnings optional, as this email does.
    expect(all).toMatch(/gig app profile/i);
    expect(text).toMatch(/Gig App Profile Screenshot/);
    expect(text).toMatch(/Optional: Earnings/);
    // Neither side asks for an insurance card or claims consent was already given.
    for (const t of [all, text]) {
      expect(t).not.toMatch(/insurance card|already agreed|already consented/i);
    }
    // One phone number across both: the follow-ups use {{company_phone}} (the 888 line).
    expect(all).not.toMatch(/813|212-4174/);
  });
  test("blueprint placeholders are resolved, and no broker or carrier is named", () => {
    expect(text).not.toMatch(/\[X\]|\[confirm/i);
    expect(text).not.toMatch(/progressive|geico|state farm|allstate|hagerty|buckle|broker|carrier|underwrit/i);
    expect(text).not.toContain("Hi ,");
    // Sent at Step 1, before the consent step: must not claim consent was already given.
    expect(text).not.toMatch(/already agreed/i);
    expect(text).toContain("You'll confirm this in a short consent step.");
  });
  test("every blueprint list has its four items", () => {
    expect(STEP1_EMAIL_COPY.get.length).toBe(4);
    expect(STEP1_EMAIL_COPY.ready.length).toBe(4);
    expect(STEP1_EMAIL_COPY.why.length).toBe(4);
  });
});

describe("Step 1 wiring", () => {
  test("sent only from the new-application branch, after the token is minted, without awaiting", () => {
    const s = readFileSync("src/lib/applications.functions.ts", "utf8");
    const at = s.indexOf("sendStepOneThankYouEmail({");
    expect(at).toBeGreaterThan(s.indexOf("const token = await issueResumeToken(supabaseAdmin, row.id);"));
    expect(s.slice(at - 8, at)).toContain("void ");
    expect(s.split("sendStepOneThankYouEmail({").length).toBe(2);
  });
  test("Back Office preview renders without minting a token", () => {
    const s = readFileSync("src/lib/automation-preview.server.ts", "utf8");
    expect(s).toMatch(/step1_thank_you:[\s\S]*mintLink: async \(\) => PREVIEW_LINK/);
  });
});

describe("one welcome email, not two", () => {
  test("the 5-minute follow-up EMAIL is skipped only when the thank-you went out in the last 24 hours", async () => {
    const { shouldSkipForStepOneEmail } = await import("@/lib/automations.server");
    const now = new Date("2026-11-15T12:10:00Z");
    const sent = "2026-11-15T12:00:00Z";
    expect(shouldSkipForStepOneEmail({ channel: "email", delay_minutes: 5 }, sent, now)).toBe(true);
    // Texts and later steps always go.
    expect(shouldSkipForStepOneEmail({ channel: "sms", delay_minutes: 5 }, sent, now)).toBe(false);
    expect(shouldSkipForStepOneEmail({ channel: "email", delay_minutes: 1440 }, sent, now)).toBe(false);
    expect(shouldSkipForStepOneEmail({ channel: "email", delay_minutes: 2880 }, sent, now)).toBe(false);
    // No thank-you (switch off or failed) → the 5-minute email goes as today.
    expect(shouldSkipForStepOneEmail({ channel: "email", delay_minutes: 5 }, null, now)).toBe(false);
    // Thank-you long ago (applicant came back days later) → the 5-minute email is a fresh confirmation.
    expect(shouldSkipForStepOneEmail({ channel: "email", delay_minutes: 5 }, "2026-11-13T12:00:00Z", now)).toBe(false);
  });
  test("the engine applies it before sending, alongside the profile-complete skip", () => {
    const s = readFileSync("src/lib/automations.server.ts", "utf8");
    expect(s).toMatch(/const skipThis =\s*shouldSkipForCompleteProfile\(step as any, app\) \|\|\s*\(step\.channel === "email" &&\s*shouldSkipForStepOneEmail\(/);
    expect(s).toMatch(/\.eq\("kind", STEP1_EMAIL_LOG_KIND\)/);
  });
});
