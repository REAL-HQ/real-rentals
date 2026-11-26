// Returning applicant on a lead form (Dolmar, t314u): the email they just typed
// matched an application, so a secure link went to that address. The panel
// must not ask for the email again, must show it masked, and Resend must reuse
// it. A phone-only match ("review") keeps an empty email box and a masked hint
// of the address on file. The email they just typed is not put back in the box.
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
  test("closed/declined match says a NEW application starts from the link", () => {
    const r = render({ email: EMAIL, fresh: true, initial: { status: "sent", retryAfterSeconds: 64 }, onBack: () => {} });
    expect(r.text).toContain("Looks like you've applied with us before.");
    expect(r.text).toContain("we sent a secure link to d•••@gmail.com. Open it to start your new application.");
    expect(r.html).not.toContain("<input");
    expect(r.text).not.toContain("pick up where you left off");
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

describe("phone match, different email", () => {
  const HINT = "m•••••y@gmail.com";
  const WRONG = "jayson.new@gmail.com";

  test("does not pre-fill the email they just typed", () => {
    const { html } = render({ email: WRONG, maskedEmailOnFile: HINT, initial: { status: "review", retryAfterSeconds: 0 }, onBack: () => {} });
    expect(html).toContain("<input");
    expect(html).toContain('value=""');
    expect(html).not.toContain(WRONG);
    expect(html).not.toContain("jayson.new");
    expect(html).not.toContain("mystery@gmail.com");
  });

  test("shows the masked hint and the plain wording", () => {
    const { html, text } = render({ email: WRONG, maskedEmailOnFile: HINT, initial: { status: "review", retryAfterSeconds: 0 }, onBack: () => {} });
    expect(html).toContain('data-secure-link="email-on-file"');
    expect(text).toContain("Use The Email You Applied With");
    expect(text).toContain(`The secure link only goes to the email you used when you first applied: ${HINT}.`);
    expect(text).toContain("Enter that email below.");
    expect(text).toContain("If you no longer use it, our team will reach out to help.");
    expect(text).toContain("Send Secure Link");
    expect(text).not.toContain("Welcome Back");
    expect(text).not.toContain("a team member will review them");
  });

  test("a full address passed as the hint is not shown", () => {
    const { html, text } = render({ maskedEmailOnFile: "mystery@gmail.com", initial: { status: "review", retryAfterSeconds: 0 } });
    expect(html).toContain('value=""');
    expect(html).not.toContain("mystery@gmail.com");
    expect(text).toContain("If you applied with a different email, enter that one below.");
    expect(text).not.toContain("mystery");
  });

  test("without a hint, the box is still empty and the fallback wording is plain", () => {
    const { html, text } = render({ email: WRONG, initial: { status: "review", retryAfterSeconds: 0 } });
    expect(html).toContain('value=""');
    expect(html).not.toContain(WRONG);
    expect(text).toContain("The secure link only goes to the email you used when you first applied.");
    expect(text).toContain("If you applied with a different email, enter that one below.");
  });
});

describe("unchanged neutral panels", () => {
  test("an email passed outside a phone match is still the box value", () => {
    const { html, text } = render({ email: EMAIL });
    expect(html).toContain(`value="${EMAIL}"`);
    expect(text).toContain("Check Your Email To Continue");
    expect(text).not.toContain("Use The Email You Applied With");
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
  test("Resend reuses the typed value, and a phone match starts from an empty box", () => {
    const src = readFileSync("src/components/site/WelcomeBack.tsx", "utf8");
    expect(src).toContain('initial?.status === "review" ? "" : (email ?? "")');
    expect(src).toMatch(/requestLink\(\{ data: \{ email: value \} \}\)/);
  });
  test("both lead forms leave the box empty on review and pass only the masked hint", () => {
    for (const f of ["src/routes/apply.tsx", "src/components/site/CityHeroLeadForm.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain('email: review ? "" : form.email');
      expect(src).toContain('email={returning.status === "review" ? undefined : returning.email}');
      expect(src).toContain("maskedEmailOnFile={returning.maskedEmailOnFile}");
      expect(src).toContain("onBack={() => setReturning(null)}");
    }
  });
});
