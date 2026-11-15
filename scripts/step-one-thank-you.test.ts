// Step 1 thank-you page (Automation Blueprint). Renders the real component
// to static HTML and checks the copy rules. No network, no database.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StepOneThankYou } from "@/components/site/StepOneThankYou";
import { STEP_ONE_LINE, STEP_ONE_THANK_YOU as C, stepOneThankYouStrings } from "@/lib/step-one-thank-you";

const html = renderToStaticMarkup(createElement(StepOneThankYou, { onContinue: () => {} }));
const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

const SMALL = new Set(["a", "an", "and", "the", "of", "in", "to", "for", "or", "on", "with", "your", "you", "our", "at", "by", "is"]);
function titleCase(s: string) {
  return s
    .replace(/[!?.]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .every((w, i) => {
      if (/^[^A-Za-z]/.test(w)) return true;
      if (i > 0 && SMALL.has(w.toLowerCase())) return true;
      return /^[A-Z]/.test(w);
    });
}

describe("Step 1 thank-you page", () => {
  test("required headlines and buttons, in Title Case", () => {
    for (const s of ["You're In! Application Received", "What Happens Next", "Have These Ready", "Upload Documents", "Text Us", "Insurance Included in Your Weekly Rate"]) {
      expect(text).toContain(s);
    }
    for (const s of [C.headline, C.primaryCta, C.secondaryCta, C.insuranceTitle, C.nextTitle, C.readyTitle, ...C.steps.map((x) => x.title), ...C.ready]) {
      expect(titleCase(s)).toBe(true);
    }
  });

  test("insurance highlight wording", () => {
    expect(text).toContain("We pay for it. No extra cost to you.");
  });

  test("about 120 words on the page", () => {
    const n = words(stepOneThankYouStrings().join(" "));
    expect(n).toBeGreaterThanOrEqual(100);
    expect(n).toBeLessThanOrEqual(140);
    // The rendered page says the same thing (the CTA appears twice: top and pinned bar).
    expect(Math.abs(words(text) - n - words(C.primaryCta) - C.steps.length)).toBeLessThanOrEqual(2);
  });

  test("gig app profile screenshot is the main document; earnings are optional", () => {
    const gig = C.ready.findIndex((r) => /Gig App Profile Screenshot/.test(r) && /Trips\/Deliveries/.test(r) && /Rating/.test(r));
    const earn = C.ready.findIndex((r) => /Earnings/.test(r));
    expect(gig).toBeGreaterThanOrEqual(0);
    expect(C.ready[earn].startsWith("Optional:")).toBe(true);
    expect(gig).toBeLessThan(earn);
  });

  test("Tampa contact line and buttons point at (813) 212-4174", () => {
    expect(STEP_ONE_LINE.e164).toBe("+18132124174");
    expect(text).toContain("Questions? Call or text (813) 212-4174");
    expect(html).toContain('href="sms:+18132124174"');
    expect(html).toContain('href="tel:+18132124174"');
    expect((html.match(/>Upload Documents</g) ?? []).length).toBe(2);
  });

  test("never names an insurance broker or carrier", () => {
    const banned = /progressive|geico|state farm|allstate|liberty mutual|nationwide|farmers|usaa|travelers|hagerty|buckle|insurify|broker|carrier|underwrit|agency/i;
    expect(banned.test(text)).toBe(false);
    const src = readFileSync("src/lib/step-one-thank-you.ts", "utf8") + readFileSync("src/components/site/StepOneThankYou.tsx", "utf8");
    expect(/progressive|geico|state farm|allstate|hagerty|buckle/i.test(src)).toBe(false);
  });

  test("solid colors only (no gradients)", () => {
    expect(/gradient/i.test(readFileSync("src/components/site/StepOneThankYou.tsx", "utf8"))).toBe(false);
  });

  test("both Step 1 forms mark the hand-off; /thank-you shows the page first", () => {
    for (const f of ["src/routes/apply.tsx", "src/components/site/CityHeroLeadForm.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s).toMatch(/markStepOneJustSubmitted\(\);\s*navigate\(\{ to: "\/thank-you"/);
    }
    const ty = readFileSync("src/routes/thank-you.tsx", "utf8");
    expect(ty).toContain("stepOneJustSubmitted()");
    expect(ty).toMatch(/if \(welcome\)[\s\S]*<StepOneThankYou/);
    expect(ty).toMatch(/clearStepOneJustSubmitted\(\)/);
  });
});
