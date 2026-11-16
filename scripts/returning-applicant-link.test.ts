// Returning applicant on a lead form (Dolmar, t314u): the email they just typed
// matched an application, so a secure link went to that address. The panel
// must not ask for the email again, must show it masked, and Resend must reuse
// it. A phone-only match ("review") keeps the neutral email box.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const calls: unknown[] = [];
mock.module("@tanstack/react-start", () => ({
  useServerFn: () => async (arg: unknown) => {
    calls.push(arg);
    return { ok: true, retryAfterSeconds: 120 };
  },
  createServerFn: () => {
    const chain: any = { inputValidator: () => chain, handler: () => chain, middleware: () => chain };
    return chain;
  },
}));
mock.module("@/lib/applications.functions", () => ({ requestApplicationLink: {} }));

const { WelcomeBack } = await import("@/components/site/WelcomeBack");
const copy = await import("@/lib/secure-link-copy");

const render = (props: Record<string, unknown>) => {
  const html = renderToStaticMarkup(createElement(WelcomeBack, props as any));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  return { html, text };
};

const EMAIL = "dolmar.test@gmail.com";

describe("maskEmail", () => {
  test("keeps first letter and domain", () => {
    expect(copy.maskEmail(EMAIL)).toBe("d•••@gmail.com");
    expect(copy.maskEmail("  A@b.co ")).toBe("A•••@b.co");
  });
  test("never echoes a malformed value", () => {
    for (const bad of ["", null, undefined, "@gmail.com", "nobody@", "plain"]) {
      expect(copy.maskEmail(bad as any)).toBe("your email");
    }
  });
});

describe("isReturningPanel", () => {
  test("matched statuses with a real email", () => {
    for (const s of ["sent", "recent", "failed", "requested"]) expect(copy.isReturningPanel(EMAIL, s)).toBe(true);
  });
  test("phone-only match and missing email keep the neutral panel", () => {
    expect(copy.isReturningPanel(EMAIL, "review")).toBe(false);
    expect(copy.isReturningPanel("", "sent")).toBe(false);
    expect(copy.isReturningPanel(undefined, "sent")).toBe(false);
    expect(copy.isReturningPanel(EMAIL, undefined)).toBe(false);
  });
});

describe("returning applicant panel", () => {
  const { html, text } = render({ email: EMAIL, initial: { status: "sent", retryAfterSeconds: 64 }, onBack: () => {} });

  test("does not ask for the email again", () => {
    expect(html).not.toContain("<input");
    expect(html).not.toContain("you@example.com");
    expect(text).not.toContain("Check Your Email To Continue");
  });
  test("shows the masked address, never the full one", () => {
    expect(text).toContain("We sent a secure link to d•••@gmail.com to pick up where you left off.");
    expect(html).not.toContain(EMAIL);
    expect(html).not.toContain("dolmar.test");
  });
  test("clear returning copy and a way back", () => {
    expect(text).toContain("Welcome Back");
    expect(text).toContain("Looks like you've already started an application with us.");
    expect(text).toContain("Use A Different Email");
    expect(text).not.toContain("Back To The Form");
    expect(text).toContain("expires in 30 minutes");
    expect(text).toContain("Resend In 1:04");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Resend In 1:04/);
    expect(html).toContain('data-secure-link="returning"');
  });
  test("recent and failed say where, without asking", () => {
    const r = render({ email: EMAIL, initial: { status: "recent", retryAfterSeconds: 30 } });
    expect(r.text).toContain("We recently sent a link to d•••@gmail.com.");
    expect(r.html).not.toContain("<input");
    const f = render({ email: EMAIL, initial: { status: "failed", retryAfterSeconds: 30 } });
    expect(f.text).toContain("We couldn't send the email to d•••@gmail.com just now.");
    expect(f.html).not.toContain("<input");
  });
  test("no back link without onBack", () => {
    expect(render({ email: EMAIL, initial: { status: "sent", retryAfterSeconds: 0 } }).text).not.toContain("Use A Different Email");
  });
  test("Resend button is enabled once the countdown ends", () => {
    const r = render({ email: EMAIL, initial: { status: "sent", retryAfterSeconds: 0 } });
    expect(r.text).toContain("Resend Link");
    expect(r.html).not.toMatch(/<button[^>]*disabled=""[^>]*>Resend Link/);
  });
});

describe("unchanged neutral panels", () => {
  test("phone-only match keeps the email box and review copy", () => {
    const { html, text } = render({ email: EMAIL, initial: { status: "review", retryAfterSeconds: 0 }, onBack: () => {} });
    expect(html).toContain("<input");
    expect(text).toContain("a team member will review them");
    expect(text).not.toContain("Welcome Back");
    expect(text).not.toContain("d•••@gmail.com");
  });
  test("/thank-you missing and expired still ask for an email", () => {
    for (const p of [{ missing: true }, { expired: true }]) {
      const { html, text } = render(p);
      expect(html).toContain("<input");
      expect(text).not.toContain("Welcome Back");
    }
  });
});

describe("wiring", () => {
  test("Resend reuses the stored email", () => {
    const src = readFileSync("src/components/site/WelcomeBack.tsx", "utf8");
    expect(src).toContain("useState(email ?? \"\")");
    expect(src).toMatch(/requestLink\(\{ data: \{ email: value \} \}\)/);
  });
  test("both lead forms pass the typed email and a way back", () => {
    for (const f of ["src/routes/apply.tsx", "src/components/site/CityHeroLeadForm.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("<WelcomeBack email={returning.email} initial={returning} onBack={() => setReturning(null)} />");
    }
  });
});
