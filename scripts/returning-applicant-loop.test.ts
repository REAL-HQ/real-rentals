// Yolanda Pino (Nov 27): her application was in and complete. Every resume
// link opened her finished profile, whose only way forward was "Browse
// Vehicles" -> "Book This Car" -> the lead form, which recognised her and
// emailed another link back to the same page. Seven form fills, six emails.
// The page, the form and the email now each say there is nothing to re-apply
// or book online, and what happens next. No change to who gets a link.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@tanstack/react-start", () => ({
  useServerFn: () => async () => ({ ok: true, retryAfterSeconds: 120 }),
  createServerFn: () => {
    const chain: any = { inputValidator: () => chain, handler: () => chain, middleware: () => chain };
    return chain;
  },
}));
mock.module("@/lib/applications.functions", () => ({ requestApplicationLink: {} }));

const { WelcomeBack } = await import("@/components/site/WelcomeBack");
const ra = await import("@/lib/returning-applicant");

const render = (props: Record<string, unknown>) => {
  const html = renderToStaticMarkup(createElement(WelcomeBack, props as any));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  return { html, text };
};
const EMAIL = "dolmar.test@gmail.com";

describe("isAlreadySubmittedApplication", () => {
  test("reviewing is submitted whatever the step", () => {
    expect(ra.isAlreadySubmittedApplication({ status: "reviewing", current_step: "profile_complete" })).toBe(true);
    expect(ra.isAlreadySubmittedApplication({ status: "Reviewing", current_step: null })).toBe(true);
  });
  test("open status past Part 1 is submitted", () => {
    for (const step of ["submitted", "documents", "profile_complete", "done"]) {
      expect(ra.isAlreadySubmittedApplication({ status: "new", current_step: step })).toBe(true);
    }
  });
  test("still in Part 1, decided, or unknown is not", () => {
    expect(ra.isAlreadySubmittedApplication({ status: "partial", current_step: "rental" })).toBe(false);
    expect(ra.isAlreadySubmittedApplication({ status: "partial", current_step: "driving" })).toBe(false);
    expect(ra.isAlreadySubmittedApplication({ status: "approved", current_step: "profile_complete" })).toBe(false);
    expect(ra.isAlreadySubmittedApplication({ status: "declined", current_step: "profile_complete" })).toBe(false);
    expect(ra.isAlreadySubmittedApplication(null)).toBe(false);
  });
});

describe("lead form: returning panel says there is no need to re-apply", () => {
  test("in-progress match shows the next step", () => {
    const { text, html } = render({ email: EMAIL, initial: { status: "sent", retryAfterSeconds: 64 } });
    expect(text).toContain("You don't need to fill out this form again.");
    expect(text).toContain("choose your car and pickup time");
    expect(html).toContain("data-returning-next-step");
    expect(html).not.toContain(EMAIL);
  });
  test("throttled resend shows it too", () => {
    expect(render({ email: EMAIL, initial: { status: "recent", retryAfterSeconds: 30 } }).text).toContain(
      "You don't need to fill out this form again.",
    );
  });
  test("closed/declined match (fresh application) does not", () => {
    const { html } = render({ email: EMAIL, fresh: true, initial: { status: "sent", retryAfterSeconds: 64 } });
    expect(html).not.toContain("data-returning-next-step");
  });
  test("same words for every match: nothing about status", () => {
    expect(ra.RETURNING_NO_NEED_TO_REAPPLY).not.toMatch(/review|approv|declin/i);
  });
});

describe("wiring", () => {
  const fns = readFileSync("src/lib/applications.functions.ts", "utf8");
  const mail = readFileSync("src/lib/email.server.ts", "utf8");
  const wizard = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
  test("resume email gets the already-submitted note from the record on file", () => {
    expect(fns).toContain('.select("id, email, full_name, status, user_id, current_step")');
    expect(fns).toContain("alreadySubmitted: isAlreadySubmittedApplication(onFile)");
    expect(mail).toContain("alreadySubmitted?: boolean;");
    expect(mail).toContain("${submittedNote}");
  });
  test("finished profile says it is all set and how to ask about a car", () => {
    expect(wizard).toContain('(phase === "profile_complete" || doneCount === required.length)');
    expect(wizard).toContain("{PROFILE_ALL_SET_HEADING}");
    expect(wizard).toContain("{PROFILE_CAR_HINT}");
  });
});

describe("copy rules", () => {
  const all = [
    ra.RETURNING_NO_NEED_TO_REAPPLY,
    ra.RESUME_EMAIL_ALREADY_SUBMITTED,
    ra.PROFILE_ALL_SET_HEADING,
    ra.PROFILE_ALL_SET_BODY,
    ra.PROFILE_CAR_HINT,
  ].join(" ");
  test("no deposit wording, no phone other than the main line", () => {
    expect(all).not.toMatch(/deposit/i);
    expect(all.match(/\(\d{3}\) \d{3}-\d{4}/g) ?? []).toEqual(["(888) 833-8280"]);
  });
  test("heading is Title Case", () => {
    expect(ra.PROFILE_ALL_SET_HEADING).toBe("You're All Set. Your Application Is With Our Team.");
  });
});
