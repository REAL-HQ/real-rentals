import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { approvalEmailMessage } from "../src/lib/approval-email";
import { settingKeyForEmailWorkflow } from "../src/lib/automation-catalog";

mock.module("@/lib/company.server", () => ({
  getBusinessPhone: async () => ({ display: "(888) 833-8280", tel: "tel:+18888338280" }),
}));

const { previewCapture } = await import("@/lib/automation-controls.server");
const email = await import("@/lib/email.server");

const APPLICATION_ID = "00000000-0000-4000-8000-000000000000";

describe("Approval Confirmation", () => {
  test("renders the short approval notice without account access or a reservation", async () => {
    const captured = await previewCapture(() => email.sendApprovalConfirmationEmail({
      to: "renter@example.com",
      firstName: "Jordan Sample",
      applicationId: APPLICATION_ID,
    }));
    expect(captured).toHaveLength(1);
    const message = captured[0]!;
    expect(message.to).toEqual(["renter@example.com"]);
    expect(message.subject).toBe("Your REAL RENTALS Application Is Approved");
    expect(message.workflow).toBe("approval_confirmation");
    expect(message.html).toContain("Hi Jordan, your qualification and verification checks are complete.");
    expect(message.html).toContain("Our team will be in touch to assign a vehicle and schedule your pickup.");
    expect(message.html).toContain("No vehicle is reserved yet.");
    expect(message.html).toContain("driver portal login and pickup details once your reservation is confirmed");
    expect(message.html).not.toContain("Set Your Password");
    expect(message.html).not.toContain("drivereal.com/portal");
    expect(message.html).not.toContain("drivereal.com/login");
  });

  test("uses a stable per-application idempotency key and an Owner automation switch", () => {
    const source = readFileSync("src/lib/email.server.ts", "utf8");
    expect(source).toContain('idempotencyKey: `approval-confirmation-${args.applicationId}`');
    expect(settingKeyForEmailWorkflow("approval_confirmation")).toBe("approval_confirmation");
  });

  test("sends only on the first transition to Approved and never sends login details", () => {
    const source = readFileSync("src/lib/applications.functions.ts", "utf8");
    const start = source.indexOf("export const approveApplication");
    const body = source.slice(start, source.indexOf("export const", start + 10));
    expect(body).toContain('const newlyApproved = app.status !== "approved"');
    expect(body).toContain("if (newlyApproved) {");
    expect(body).toContain("sendApprovalConfirmationEmail");
    expect(body).toContain('approvalEmail = result.ok ? "sent" : result.blocked ?? "failed"');
    expect(body).toContain('approvalEmail = "failed"');
    expect(body).not.toContain("provisionDriverAccount");
    expect(body).not.toContain("sendPortalInviteEmail");
  });

  test("staff see a concrete delivery outcome without changing the approval result", () => {
    expect(approvalEmailMessage("sent")).toBe("Approval Confirmation Sent.");
    expect(approvalEmailMessage("off")).toBe("Approval Confirmation Is Off.");
    expect(approvalEmailMessage("held")).toBe("Approval Confirmation Held.");
    expect(approvalEmailMessage("failed")).toBe("Approval Confirmation Could Not Be Sent.");
    expect(approvalEmailMessage("no_email")).toBe("No Approval Email: No Email On File.");
    expect(approvalEmailMessage("not_sent")).toBe("");
    expect(approvalEmailMessage(undefined)).toBe("");
  });
});
