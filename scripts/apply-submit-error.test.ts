/**
 * Step 1 save failures are shown in plain words next to Continue, and an
 * over-long ad attribution value no longer rejects the application.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { applySubmitErrorKind, applySubmitErrorMessage } from "../src/lib/apply-submit-error";

describe("applySubmitErrorMessage", () => {
  test("network failures on Chrome/Android and iOS Safari read as a connection problem", () => {
    for (const m of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
      expect(applySubmitErrorKind(new TypeError(m))).toBe("network");
      expect(applySubmitErrorMessage(new TypeError(m))).toContain("couldn't reach our server");
    }
  });
  test("server errors never show raw database or validation text", () => {
    const raw = [
      'column reference "phone" is ambiguous',
      '[{"code":"too_big","maximum":255,"path":["landing_page"]}]',
    ];
    for (const m of raw) {
      const out = applySubmitErrorMessage(new Error(m));
      expect(out).not.toContain("ambiguous");
      expect(out).not.toContain("too_big");
      expect(out).toContain("888-833-8280");
    }
  });
});

describe("forms keep the message on screen", () => {
  for (const file of ["src/routes/apply.tsx", "src/components/site/CityHeroLeadForm.tsx"]) {
    const src = readFileSync(file, "utf8");
    test(`${file} renders a role=alert and closes the keyboard`, () => {
      expect(src).toContain('role="alert"');
      expect(src).toContain("setSubmitError(message)");
      expect(src).toContain("dismissKeyboard()");
      expect(src).not.toMatch(/toast\.error\((e|error)\?\.message/);
    });
  }
});

describe("savePartialApplication attribution", () => {
  const src = readFileSync("src/lib/applications.functions.ts", "utf8");
  test("attribution fields use the clamping schema", () => {
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "landing_page", "referrer"]) {
      expect(src).toContain(`        ${k}: attributionString,`);
    }
  });
  test("an iOS Google Ads landing page over 255 chars is cut, not rejected", () => {
    const attributionString = z.string().max(4000).transform((v) => v.trim().slice(0, 255)).nullable().optional();
    const lp = "/tampa?gad_source=1&gad_campaignid=23140000000&gbraid=0AAAAA" + "x".repeat(60) + "&gclid=Cj0KCQ" + "y".repeat(90) + "&utm_source=google&utm_medium=cpc";
    expect(lp.length).toBeGreaterThan(255);
    const r = attributionString.safeParse(lp);
    expect(r.success).toBe(true);
    expect((r as any).data.length).toBe(255);
  });
});
