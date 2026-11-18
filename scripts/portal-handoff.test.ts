/**
 * Resume → portal handoff: only renters who picked up the car use /login.
 * Approved renters before pickup keep the secure link for documents (t466u).
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
  it("treats only active as a portal-only status", () => {
    assert.equal(isPortalHandoffStatus("approved"), false);
    assert.equal(isPortalHandoffStatus("ACTIVE"), true);
    assert.equal(isPortalHandoffStatus("  Approved "), false);
    assert.equal(isPortalHandoffStatus("new"), false);
    assert.equal(isPortalHandoffStatus("partial"), false);
    assert.equal(isPortalHandoffStatus("complete"), false);
  });

  it("refuses resume open for active, opens approved for documents, keeps complete reviewable", () => {
    assert.equal(portalOpenRefused("approved", true), false);
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

  it("hands off on pickup only, never on a linked login or driver role", async () => {
    const calls: string[] = [];
    const rentalsByApp: Record<string, string[]> = { reserved1: ["reserved"], started1: ["active"], returned1: ["closed"] };
    const admin = {
      from(table: string) {
        calls.push(table);
        let appId = "";
        const q: any = {
          select: () => q,
          eq: (_k: string, v: string) => ((appId = v), q),
          limit: async () => ({ data: (rentalsByApp[appId] ?? []).map((status) => ({ status })) }),
          maybeSingle: async () => ({ data: null }),
        };
        return q;
      },
    };
    assert.equal(await shouldHandoffToPortal(admin as any, { status: "active", email: "a@b.co" }), true);
    assert.equal(await shouldHandoffToPortal(admin as any, { id: "reserved1", status: "approved", user_id: "u1" }), false);
    assert.equal(await shouldHandoffToPortal(admin as any, { id: "started1", status: "approved" }), true);
    assert.equal(await shouldHandoffToPortal(admin as any, { id: "returned1", status: "approved" }), true);
    assert.equal(await shouldHandoffToPortal(admin as any, { status: "new", user_id: "u1" }), false);
    assert.equal(calls.includes("user_roles"), false);
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
    assert.match(thanks, /Sign In To Your Driver Portal/);
    assert.match(thanks, /ApplicantDocumentsPanel/);
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
