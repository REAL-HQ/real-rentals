import { describe, expect, test } from "bun:test";
import { profileCompleteSkips, stepCopyFor } from "../src/lib/automations.server";
import { renderStepOneEmail, STEP1_EMAIL_COPY } from "../src/lib/step-one-email.server";

const step = {
  body: "upload a screenshot of your gig app profile",
  subject: "Subject",
  body_not_driving: "upload your proof of income (an income document or an earnings screenshot)",
  subject_not_driving: null,
  skip_when_profile_complete: true,
};

describe("follow-up copy for not-yet drivers (t352u)", () => {
  test("gig drivers keep the original body", () => {
    expect(stepCopyFor(step, false).body).toBe(step.body);
  });
  test("not-yet drivers get the income-proof body", () => {
    const c = stepCopyFor(step, true);
    expect(c.body).toContain("proof of income (an income document or an earnings screenshot)");
    expect(c.body).not.toContain("gig app profile");
    expect(c.subject).toBe("Subject");
  });
  test("a step without alternate wording sends its body to everyone", () => {
    expect(stepCopyFor({ ...step, body_not_driving: null }, true).body).toBe(step.body);
    expect(stepCopyFor({ ...step, body_not_driving: "  " }, true).body).toBe(step.body);
  });
  test("profile_complete skips gig drivers, but not a not-yet driver missing income proof", () => {
    const app = { current_step: "profile_complete" };
    expect(profileCompleteSkips(step, app, false, false)).toBe(true);
    expect(profileCompleteSkips(step, app, true, false)).toBe(false);
    expect(profileCompleteSkips(step, app, true, true)).toBe(true);
    expect(profileCompleteSkips(step, { current_step: "documents" }, false, true)).toBe(false);
  });
});

describe("Step 1 thank-you email", () => {
  const url = "https://drivereal.com/thank-you?t=abc";
  test("gig-driver copy unchanged", () => {
    const { html } = renderStepOneEmail({ firstName: "Ann", continueUrl: url });
    expect(html).toContain("Gig App Profile Screenshot");
    for (const line of STEP1_EMAIL_COPY.ready) expect(html).toContain(line.replace(/'/g, "&#39;"));
  });
  test("not-yet drivers are asked for income proof, not a gig screenshot", () => {
    const { html } = renderStepOneEmail({ firstName: "Ann", continueUrl: url, notDrivingYet: true });
    expect(html).toContain("Proof of Income (an Income Document or an Earnings Screenshot)");
    expect(html).not.toContain("Gig App Profile Screenshot");
    expect(html).not.toMatch(/broker|carrier/i);
  });
});
