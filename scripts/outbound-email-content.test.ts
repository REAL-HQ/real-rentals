import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import {
  PRODUCTION_ORIGIN,
  authConfirmUrl,
  findDisallowedOutboundUrls,
  inspectOutboundUrl,
  isPrivateOrLocalHost,
  outboundRefusalMessage,
  publicAppOrigin,
  publicAppUrl,
  recoveryUrlFromGenerateLink,
} from "../src/lib/public-app-url";
import { portalLoginUrl } from "../src/lib/portal-handoff";
import { vehicleShareUrl } from "../src/lib/vehicle-share.server";
import { DEFAULT_TEMPLATES } from "../src/lib/rent-reminders";
import { htmlToText } from "../src/lib/email.server";

const src = (path: string) => readFileSync(path, "utf8");

describe("public app origin", () => {
  test("is always https://drivereal.com", () => {
    expect(publicAppOrigin()).toBe(PRODUCTION_ORIGIN);
    expect(publicAppOrigin("http://localhost:8080")).toBe(PRODUCTION_ORIGIN);
    expect(publicAppOrigin("https://id-preview--x.lovable.app")).toBe(PRODUCTION_ORIGIN);
    expect(publicAppUrl("/share/vehicle/abc")).toBe("https://drivereal.com/share/vehicle/abc");
    expect(publicAppUrl("portal")).toBe("https://drivereal.com/portal");
  });

  test("flags localhost, loopback, and private hosts", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "10.0.0.8",
      "192.168.1.4",
      "172.16.0.2",
      "169.254.1.1",
      "app.localhost",
      "printer.local",
    ]) {
      expect(isPrivateOrLocalHost(host), host).toBe(true);
    }
    expect(isPrivateOrLocalHost("drivereal.com")).toBe(false);
    expect(isPrivateOrLocalHost("invoice.stripe.com")).toBe(false);
  });

  test("inspects outbound URLs for local hosts, shorteners, and raw supabase auth links", () => {
    expect(inspectOutboundUrl("http://localhost:8080/share/vehicle/abc")?.reason).toBe("local_or_private");
    expect(inspectOutboundUrl("https://127.0.0.1/login")?.reason).toBe("local_or_private");
    expect(inspectOutboundUrl("https://bit.ly/abc")?.reason).toBe("shortener");
    expect(
      inspectOutboundUrl(
        "https://yuyzdsnrbfhkmfzpvhwx.supabase.co/auth/v1/verify?token=abc&type=recovery&redirect_to=https://drivereal.com/set-password",
      )?.reason,
    ).toBe("supabase_auth_verify");
    expect(inspectOutboundUrl("https://drivereal.com/login")).toBeNull();
    expect(inspectOutboundUrl("https://invoice.stripe.com/i/acct_x/in_y")).toBeNull();
    expect(findDisallowedOutboundUrls('<a href="http://localhost:8080/x">x</a>')).toHaveLength(1);
    expect(findDisallowedOutboundUrls("See https://drivereal.com/portal")).toHaveLength(0);
    expect(outboundRefusalMessage({ url: "http://localhost/", reason: "local_or_private" })).toMatch(/local or private/);
    expect(outboundRefusalMessage({ url: "https://bit.ly/x", reason: "shortener" })).toMatch(/shortener/);
  });
});

describe("auth confirm links", () => {
  test("are built from hashed_token on drivereal.com, never action_link", () => {
    const url = authConfirmUrl("abcTOKEN", "recovery");
    expect(url).toBe("https://drivereal.com/auth/confirm?token_hash=abcTOKEN&type=recovery");
    expect(url).not.toContain("supabase.co");
    expect(
      recoveryUrlFromGenerateLink({
        properties: {
          hashed_token: "hash-1",
          action_link: "https://yuyzdsnrbfhkmfzpvhwx.supabase.co/auth/v1/verify?token=raw",
        },
      }),
    ).toBe("https://drivereal.com/auth/confirm?token_hash=hash-1&type=recovery");
    expect(recoveryUrlFromGenerateLink({ properties: { action_link: "https://supabase.co/auth/v1/verify?token=x" } })).toBeNull();
  });
});

describe("call sites use the canonical origin", () => {
  const prev = process.env.PUBLIC_SITE_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = prev;
  });

  test("portal login and vehicle share ignore localhost and PUBLIC_SITE_URL", () => {
    process.env.PUBLIC_SITE_URL = "http://localhost:8080";
    expect(portalLoginUrl("pat@example.com")).toBe("https://drivereal.com/login?email=pat%40example.com");
    expect(vehicleShareUrl("http://localhost:8080", "a".repeat(64))).toBe(
      `https://drivereal.com/share/vehicle/${"a".repeat(64)}`,
    );
  });

  test("provisioning and portal sign-in no longer embed supabase verify or request origin", () => {
    const account = src("src/lib/driver-account.server.ts");
    expect(account).toContain("recoveryUrlFromGenerateLink");
    expect(account).not.toMatch(/inviteUrl = \(link\?\.properties\?\.action_link/);
    const signin = src("src/lib/portal-signin.functions.ts");
    expect(signin).toContain("publicAppOrigin");
    expect(signin).not.toMatch(/localhost\|lovable/);
    const confirm = src("src/routes/auth/confirm.tsx");
    expect(confirm).toContain("verifyOtp");
    expect(confirm).toContain("token_hash");
    const setPw = src("src/routes/set-password.tsx");
    expect(setPw).toContain("token_hash");
    expect(setPw).toContain("verifyOtp");
  });

  test("forgot-password flows send a drivereal.com confirm link instead of resetPasswordForEmail", () => {
    const login = src("src/routes/login.tsx");
    const admin = src("src/routes/admin.tsx");
    expect(login).toContain("requestPasswordReset");
    expect(admin).toContain("requestPasswordReset");
    expect(login).not.toContain("resetPasswordForEmail");
    expect(admin).not.toContain("resetPasswordForEmail");
    expect(login).not.toContain("window.location.origin");
    const reset = src("src/lib/password-reset.server.ts");
    expect(reset).toContain("generateLink");
    expect(reset).toContain("recoveryUrlFromGenerateLink");
    expect(reset).toContain("sendPasswordResetEmail");
  });

  test("sendEmail and sendSms refuse disallowed links and keep a consistent From", () => {
    const email = src("src/lib/email.server.ts");
    expect(email).toContain("findDisallowedOutboundUrls");
    expect(email).toContain("resolvedEmailFrom");
    expect(email).toContain("EMAIL_FROM_OVERRIDE");
    expect(email).toContain('text,');
    expect(email).toContain("reply_to: replyTo ?? EMAIL_REPLY_TO");
    expect(email).toContain('from: from ?? resolvedEmailFrom()');
    const sms = src("src/lib/sms.server.ts");
    expect(sms).toContain("findDisallowedOutboundUrls");
    expect(sms).toContain("outboundRefusalMessage");
  });
});

describe("plain-text alternative and reminder subjects", () => {
  test("htmlToText keeps every link visible", () => {
    const text = htmlToText(
      `<p>Hi</p><a href="https://drivereal.com/login">Sign In</a><p>Or paste https://drivereal.com/login</p>`,
    );
    expect(text).toContain("Sign In: https://drivereal.com/login");
  });

  test("default reminder subjects stay factual and mention late fees only through the placeholder", () => {
    expect(DEFAULT_TEMPLATES.stripe.due_today.subject).toBe("Your Weekly Rental Payment Is Due Today");
    expect(DEFAULT_TEMPLATES.stripe.overdue.subject).toBe("Your Weekly Payment Is Past Due");
    expect(DEFAULT_TEMPLATES.stripe.daily.subject).toBe("Your {{amount}} Weekly Invoice Is Still Open");
    expect(DEFAULT_TEMPLATES.manual.overdue.subject).toBe("Your Weekly Rent Is Past Due");
    expect(DEFAULT_TEMPLATES.manual.daily.subject).toBe("Your Outstanding Balance Is {{balance}}");
    const all = JSON.stringify(DEFAULT_TEMPLATES);
    expect(all).not.toMatch(/vehicle return/i);
    expect(all).not.toMatch(/5\s*PM/i);
    expect(all).toContain("{{late_fee_line}}");
  });
});
