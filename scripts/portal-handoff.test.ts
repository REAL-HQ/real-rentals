/**
 * Resume → portal handoff: approved/active applicants use /login, not the wizard.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
  isPortalHandoffStatus,
  portalOpenRefused,
} from "../src/lib/application-resume-flag";
import { portalLoginUrl, shouldHandoffToPortal } from "../src/lib/portal-handoff";
import { thankYouView } from "../src/lib/secure-link-copy";

describe("portal handoff", () => {
  it("treats approved and active as portal-only statuses", () => {
    assert.equal(isPortalHandoffStatus("approved"), true);
    assert.equal(isPortalHandoffStatus("ACTIVE"), true);
    assert.equal(isPortalHandoffStatus("  Approved "), true);
    assert.equal(isPortalHandoffStatus("new"), false);
    assert.equal(isPortalHandoffStatus("partial"), false);
    assert.equal(isPortalHandoffStatus("complete"), false);
  });

  it("refuses resume open for approved/active while keeping complete reviewable", () => {
    assert.equal(portalOpenRefused("approved", true), true);
    assert.equal(portalOpenRefused("active", true), true);
    assert.equal(portalOpenRefused("complete", true), false);
    assert.equal(portalOpenRefused("new", true), false);
    assert.equal(portalOpenRefused("declined", true), true);
  });

  it("builds a login URL with email prefilled and never invents a token", () => {
    assert.equal(portalLoginUrl("Pat@Example.COM"), "https://drivereal.com/login?email=pat%40example.com");
    assert.equal(portalLoginUrl(""), "https://drivereal.com/login");
    assert.equal(portalLoginUrl("not-an-email"), "https://drivereal.com/login");
  });

  it("hands off on status or linked driver role", async () => {
    const calls: string[] = [];
    const admin = {
      from(table: string) {
        calls.push(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: async () => ({ data: [{ role: "driver" }] }),
              }),
            }),
          }),
        };
      },
    };
    assert.equal(await shouldHandoffToPortal(admin as any, { status: "approved", email: "a@b.co" }), true);
    assert.equal(await shouldHandoffToPortal(admin as any, { status: "new", user_id: "u1" }), true);
    assert.equal(await shouldHandoffToPortal(admin as any, { status: "new" }), false);
    assert.ok(calls.includes("user_roles"));
  });

  it("exposes an approved thank-you view before the wizard", () => {
    assert.equal(thankYouView(undefined), "wait");
    assert.equal(thankYouView(null), "missing");
    assert.equal(thankYouView(""), "expired");
    assert.equal(thankYouView("tok"), "wizard");
    assert.equal(thankYouView(null, { email: "a@b.co" }), "approved");
    assert.equal(thankYouView("tok", { email: "a@b.co" }), "approved");
  });

  it("wires thank-you, login prefills, and mint refusal in source", () => {
    const thanks = readFileSync("src/routes/thank-you.tsx", "utf8");
    assert.match(thanks, /You're Approved — Sign In To Your Account/);
    assert.match(thanks, /portalLoginUrl|search=\{.*email/);
    assert.match(thanks, /r\.portal/);

    const login = readFileSync("src/routes/login.tsx", "utf8");
    assert.match(login, /emailPrefill/);
    assert.match(login, /email:/);

    const tokens = readFileSync("src/lib/resume-tokens.server.ts", "utf8");
    assert.match(tokens, /isPortalHandoffStatus/);
    assert.match(tokens, /inspectResumeToken/);
    assert.match(tokens, /Sign in to the driver portal instead/);

    const open = readFileSync("src/lib/applications.functions.ts", "utf8");
    assert.match(open, /inspectResumeToken/);
    assert.match(open, /sendPortalHandoffEmail/);

    const home = readFileSync("src/components/portal/ApplicantHome.tsx", "utf8");
    assert.match(home, /Next Step: Sign In To Finish Setup/);
    assert.match(home, /goDocuments/);
    assert.match(home, /Sign In To Your Account/);
    // Approved path must not offer Continue Application (wizard).
    const approvedBlock = home.slice(home.indexOf("approved ? ("), home.indexOf("{!approved &&"));
    assert.equal(approvedBlock.includes("Continue Application"), false);
    assert.equal(approvedBlock.includes("goWizard"), false);

    const email = readFileSync("src/lib/email.server.ts", "utf8");
    assert.match(email, /sendPortalHandoffEmail/);
    assert.match(email, /portal_handoff/);
  });
});
