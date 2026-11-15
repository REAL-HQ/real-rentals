// Step 1 thank-you email (Automation Blueprint). No network: the controls
// reader, the link minting and the sender are all injected fakes.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AUTOMATIONS, isAutomationOn, isDefaultOff, settingKeyForEmailWorkflow } from "@/lib/automation-catalog";
import {
  STEP1_EMAIL_COPY, STEP1_EMAIL_KEY, STEP1_EMAIL_WORKFLOW, renderStepOneEmail, sendStepOneThankYouEmail,
} from "@/lib/step-one-email.server";

const URL = "https://drivereal.com/apply?resume=TEST";
function harness(controls: any) {
  const sent: any[] = [];
  const minted: string[] = [];
  return {
    sent, minted,
    deps: {
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
      "Continue to Step 2", "Questions? Call or text us at (813) 212-4174", "The Drive Real Team",
    ]) expect(text).toContain(s);
    expect(html).toContain('href="tel:+18132124174"');
  });
  test("blueprint placeholders are resolved, and no broker or carrier is named", () => {
    expect(text).not.toMatch(/\[X\]|\[confirm/i);
    expect(text).not.toMatch(/progressive|geico|state farm|allstate|hagerty|buckle|broker|carrier|underwrit/i);
    expect(text).not.toContain("Hi ,");
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
