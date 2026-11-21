// Profile Decline button and the Approve confirmation. Source checks: the
// signed-in Drivers screen is not opened here.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { canDeclineApplication } from "@/lib/application-status";
import { declineApplicantSms, declineProfileLine } from "@/lib/fleet-profile-note";

const panel = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const dialog = readFileSync("src/components/admin/DeclineApplicationDialog.tsx", "utf8");

describe("profile decision controls", () => {
  test("Decline is a visible profile button and Approve confirms before it runs", () => {
    expect(panel).toContain('data-testid="profile-decline"');
    expect(panel).toContain('data-testid="profile-decline-mobile"');
    expect(panel).toContain("<DeclineApplicationDialog");
    expect(dialog).toContain("Decline Application");
    expect(panel).toContain("<ConfirmDialog");
    expect(panel).toContain('title="Approve Application"');
    expect(panel).toContain("function requestApprove()");
    expect(panel).toContain("requestApprove()");
    expect(panel).not.toMatch(/Review And Approve Application[\s\S]{0,240}approveOnly\(\)/);
    const approveOnly = panel.indexOf("async function approveOnly");
    const dialogCall = panel.indexOf("void approveOnly()");
    expect(approveOnly).toBeGreaterThan(0);
    expect(dialogCall).toBeGreaterThan(approveOnly);
    expect(panel).toContain("Approve ${who}? This sends the Approval Confirmation email.");
  });
  test("the decline dialog requires a reason and does not send a notice", () => {
    expect(dialog).toContain("Decline Reason");
    expect(dialog).toContain("does not send an email or a text");
    expect(dialog).toContain("Decline Application");
    expect(dialog).not.toContain("text-transform");
  });
  test("who may decline matches the staff lifecycle rules", () => {
    expect(canDeclineApplication("new", "coordinator", false)).toBe(true);
    expect(canDeclineApplication("reviewing", "manager", false)).toBe(true);
    expect(canDeclineApplication("approved", "coordinator", false)).toBe(false);
    expect(canDeclineApplication("approved", "manager", false)).toBe(true);
    expect(canDeclineApplication("new", "manager", true)).toBe(false);
    expect(canDeclineApplication("active", "owner", false)).toBe(false);
    expect(canDeclineApplication("declined", "owner", false)).toBe(false);
    expect(canDeclineApplication("closed", "coordinator", false)).toBe(false);
    expect(canDeclineApplication("closed", "owner", false)).toBe(true);
  });
  test("the applicant notice does not carry the internal reason", () => {
    const sms = declineApplicantSms("Damayia Quince", "(888) 833-8280");
    expect(sms.startsWith("Hi Damayia,")).toBe(true);
    expect(sms).toContain("Reply STOP to opt out");
    expect(sms).not.toContain("SECRET");
    const line = declineProfileLine("FLEET (automated)", new Date("2026-11-16T15:00:00Z"), "SECRET");
    expect(line).toBe("Declined by FLEET (automated) on Nov 16, 2026: SECRET");
  });
});
