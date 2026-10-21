import { describe, expect, it } from "vitest";
import {
  googleAdsBootstrap,
  isCredentialTrackingPath,
  sanitizeTrackingUrl,
  trackingLandingPage,
} from "../src/lib/tracking-url";

const ORIGIN = "https://rent.example";

function parsed(raw: string): URL {
  return new URL(sanitizeTrackingUrl(raw));
}

describe("sanitizeTrackingUrl", () => {
  it.each([
    ["t", "resume-token"],
    ["signin", "login-token"],
    ["token", "invite-token"],
    ["code", "oauth-code"],
    ["access_token", "access-token"],
    ["refresh_token", "refresh-token"],
    ["token_hash", "hashed-token"],
    ["session_id", "session-token"],
  ] as const)("drops %s and keeps utm params and gclid", (key, value) => {
    const url = parsed(
      `${ORIGIN}/apply?${key}=${encodeURIComponent(value)}&utm_source=google&utm_medium=cpc&gclid=abc123`,
    );
    expect(url.searchParams.has(key)).toBe(false);
    expect(url.search).not.toContain(value);
    expect(url.searchParams.get("utm_source")).toBe("google");
    expect(url.searchParams.get("utm_medium")).toBe("cpc");
    expect(url.searchParams.get("gclid")).toBe("abc123");
    expect(url.hash).toBe("");
  });

  it("redacts the path segment after /sign/", () => {
    const url = parsed(`${ORIGIN}/sign/30-day-esign-token?gclid=abc123&utm_source=google`);
    expect(url.pathname).toBe("/sign/redacted");
    expect(url.href).not.toContain("30-day-esign-token");
    expect(url.searchParams.get("gclid")).toBe("abc123");
    expect(url.searchParams.get("utm_source")).toBe("google");
  });

  it("clears the hash", () => {
    const url = parsed(`${ORIGIN}/login#access_token=secret&refresh_token=other`);
    expect(url.hash).toBe("");
    expect(url.href).not.toContain("secret");
    expect(url.pathname).toBe("/login");
    expect(url.search).toBe("");
  });

  it("strips every credential at once and keeps ads params", () => {
    const raw = [
      `${ORIGIN}/sign/path-token?`,
      "t=1&signin=2&token=3&code=4&access_token=5&refresh_token=6&token_hash=7&session_id=8",
      "&utm_source=google&utm_medium=cpc&utm_campaign=brand&utm_term=uber&utm_content=hero&gclid=Cj0KCQjw",
      "#access_token=in-hash",
    ].join("");
    const url = parsed(raw);
    expect(url.pathname).toBe("/sign/redacted");
    expect(url.hash).toBe("");
    for (const key of ["t", "signin", "token", "code", "access_token", "refresh_token", "token_hash", "session_id"]) {
      expect(url.searchParams.has(key)).toBe(false);
    }
    expect(url.searchParams.get("utm_source")).toBe("google");
    expect(url.searchParams.get("utm_medium")).toBe("cpc");
    expect(url.searchParams.get("utm_campaign")).toBe("brand");
    expect(url.searchParams.get("utm_term")).toBe("uber");
    expect(url.searchParams.get("utm_content")).toBe("hero");
    expect(url.searchParams.get("gclid")).toBe("Cj0KCQjw");
    expect(url.href).not.toContain("path-token");
    expect(url.href).not.toContain("in-hash");
  });

  it("keeps a normal UTM url, including every utm_* param and gclid", () => {
    const raw = `${ORIGIN}/fleet?utm_source=google&utm_medium=cpc&utm_campaign=brand&utm_term=uber%20cars&utm_content=hero&gclid=Cj0KCQjw`;
    const url = parsed(raw);
    expect(url.pathname).toBe("/fleet");
    expect(url.hash).toBe("");
    expect(url.searchParams.get("utm_source")).toBe("google");
    expect(url.searchParams.get("utm_medium")).toBe("cpc");
    expect(url.searchParams.get("utm_campaign")).toBe("brand");
    expect(url.searchParams.get("utm_term")).toBe("uber cars");
    expect(url.searchParams.get("utm_content")).toBe("hero");
    expect(url.searchParams.get("gclid")).toBe("Cj0KCQjw");
    expect([...url.searchParams.keys()].sort()).toEqual(
      ["gclid", "utm_campaign", "utm_content", "utm_medium", "utm_source", "utm_term"].sort(),
    );
  });
});

describe("trackingLandingPage", () => {
  it("stores path plus query with credentials removed and gclid kept", () => {
    expect(trackingLandingPage(`${ORIGIN}/thank-you?t=resume-token&utm_source=google&gclid=abc123`)).toBe(
      "/thank-you?utm_source=google&gclid=abc123",
    );
    expect(trackingLandingPage(`${ORIGIN}/sign/esign-token?gclid=abc123`)).toBe("/sign/redacted?gclid=abc123");
  });
});

describe("isCredentialTrackingPath", () => {
  it("matches the routes that carry reusable credentials", () => {
    expect(isCredentialTrackingPath("/thank-you")).toBe(true);
    expect(isCredentialTrackingPath("/thank-you/")).toBe(true);
    expect(isCredentialTrackingPath("/login")).toBe(true);
    expect(isCredentialTrackingPath("/invite")).toBe(true);
    expect(isCredentialTrackingPath("/sign")).toBe(true);
    expect(isCredentialTrackingPath("/sign/raw-token")).toBe(true);
    expect(isCredentialTrackingPath("/")).toBe(false);
    expect(isCredentialTrackingPath("/apply")).toBe(false);
    expect(isCredentialTrackingPath("/fleet")).toBe(false);
    expect(isCredentialTrackingPath("/signals")).toBe(false);
  });
});

describe("googleAdsBootstrap", () => {
  function run(href: string, referrer = "") {
    const location = new URL(href);
    const scripts: { src: string; async: boolean }[] = [];
    const listeners: Record<string, Array<() => void>> = {};
    const history = {
      pushState(_state: unknown, _title: string, _url?: string) {},
      replaceState(_state: unknown, _title: string, _url?: string) {},
    };
    const document = {
      referrer,
      head: { appendChild(el: { src: string; async: boolean }) { scripts.push(el); } },
      createElement() {
        return { async: false, src: "", addEventListener() {} };
      },
    };
    const window = {
      dataLayer: [] as ArrayLike<unknown>[],
      gtag: undefined as unknown,
      addEventListener(type: string, fn: () => void) {
        (listeners[type] ||= []).push(fn);
      },
    };
    const runner = new Function(
      "window",
      "document",
      "location",
      "history",
      "setTimeout",
      googleAdsBootstrap(),
    );
    runner(window, document, location, history, () => {});
    const queued = () => window.dataLayer.map((args) => Array.from(args));
    return { queued, scripts, history, listeners };
  }

  it("does not load or configure the tag on credential routes", () => {
    for (const href of [
      `${ORIGIN}/thank-you?t=resume-token`,
      `${ORIGIN}/login?signin=login-token`,
      `${ORIGIN}/invite?token=invite-token`,
      `${ORIGIN}/sign/esign-token`,
    ]) {
      const { queued, scripts } = run(href);
      expect(queued(), href).toEqual([]);
      expect(scripts, href).toEqual([]);
    }
  });

  it("configures the tag with a sanitized page_location and keeps gclid", () => {
    const href = `${ORIGIN}/fleet?utm_source=google&utm_medium=cpc&gclid=abc123&t=resume-token`;
    const { queued, scripts } = run(href);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.async).toBe(true);
    expect(scripts[0]?.src).toBe("https://www.googletagmanager.com/gtag/js?id=AW-18340435293");
    const config = queued().find((call) => call[0] === "config");
    expect(config?.[1]).toBe("AW-18340435293");
    expect(config?.[2]).toEqual({ page_location: sanitizeTrackingUrl(href) });
    const page = new URL((config?.[2] as { page_location: string }).page_location);
    expect(page.searchParams.get("gclid")).toBe("abc123");
    expect(page.searchParams.has("t")).toBe(false);
  });

  it("sanitizes a same-origin referrer and omits a cross-origin one", () => {
    const href = `${ORIGIN}/?utm_source=google&gclid=abc123`;
    const same = run(href, `${ORIGIN}/thank-you?t=resume-token&utm_source=email`);
    const sameConfig = same.queued().find((call) => call[0] === "config");
    expect(sameConfig?.[2]).toEqual({
      page_location: sanitizeTrackingUrl(href),
      page_referrer: sanitizeTrackingUrl(`${ORIGIN}/thank-you?t=resume-token&utm_source=email`),
    });

    const cross = run(href, "https://ads.example/landing?utm_source=google");
    const crossConfig = cross.queued().find((call) => call[0] === "config");
    expect(crossConfig?.[2]).toEqual({ page_location: sanitizeTrackingUrl(href) });
  });

  it("re-applies a sanitized page_location before a client-side navigation", () => {
    const { queued, history } = run(`${ORIGIN}/?gclid=abc123`);
    const before = queued().length;
    history.pushState({}, "", "/thank-you?t=resume-token&utm_source=google");
    const setCall = queued().slice(before).find((call) => call[0] === "set");
    expect(setCall?.[1]).toEqual({
      page_location: sanitizeTrackingUrl(`${ORIGIN}/thank-you?t=resume-token&utm_source=google`),
    });
    history.replaceState({}, "", "/sign/esign-token#access_token=secret");
    const replaceCall = queued().slice(before).filter((call) => call[0] === "set").at(-1);
    expect(replaceCall?.[1]).toEqual({
      page_location: sanitizeTrackingUrl(`${ORIGIN}/sign/esign-token#access_token=secret`),
    });
  });
});
