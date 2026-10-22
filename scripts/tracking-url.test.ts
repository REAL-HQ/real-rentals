import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { captureAttribution } from "../src/lib/attribution";
import {
  googleAdsBootstrap,
  isCredentialTrackingPath,
  sanitizeTrackingUrl,
  trackingLandingPage,
  trackingPagePath,
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
    ["claim", "claim-token"],
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

  it("treats credential paths as case-insensitive and percent-decoded", () => {
    expect(parsed(`${ORIGIN}/Thank-You/?t=resume-token`).href).toBe(`${ORIGIN}/thank-you`);
    expect(parsed(`${ORIGIN}/SIGN/Esign-Token?gclid=abc123`).href).toBe(`${ORIGIN}/sign/redacted?gclid=abc123`);
    expect(parsed(`${ORIGIN}/%73ign/Esign-Token?t=resume-token&gclid=abc123`).href).toBe(
      `${ORIGIN}/sign/redacted?gclid=abc123`,
    );
    expect(parsed(`${ORIGIN}/card/app-id?t=resume-token&gclid=abc123`).href).toBe(`${ORIGIN}/card/redacted?gclid=abc123`);
    expect(parsed(`${ORIGIN}/CARD/App-Id?gclid=abc123`).href).toBe(`${ORIGIN}/card/redacted?gclid=abc123`);
    expect(parsed(`${ORIGIN}/%63ard/app-id?t=resume-token&gclid=abc123`).href).toBe(`${ORIGIN}/card/redacted?gclid=abc123`);
    expect(parsed(`${ORIGIN}/%?t=resume-token`).href).toBe(`${ORIGIN}/%`);
  });

  it("drops a claim fragment without dropping ads params", () => {
    const url = parsed(`${ORIGIN}/apply?utm_source=google&gclid=abc123#claim=claim-token`);
    expect(url.hash).toBe("");
    expect(url.href).not.toContain("claim-token");
    expect(url.searchParams.get("utm_source")).toBe("google");
    expect(url.searchParams.get("gclid")).toBe("abc123");
    expect(url.pathname).toBe("/apply");
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
      "t=1&signin=2&token=3&code=4&access_token=5&refresh_token=6&token_hash=7&session_id=8&claim=9",
      "&utm_source=google&utm_medium=cpc&utm_campaign=brand&utm_term=uber&utm_content=hero&gclid=Cj0KCQjw",
      "#access_token=in-hash",
    ].join("");
    const url = parsed(raw);
    expect(url.pathname).toBe("/sign/redacted");
    expect(url.hash).toBe("");
    for (const key of ["t", "signin", "token", "code", "access_token", "refresh_token", "token_hash", "session_id", "claim"]) {
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
    expect(trackingLandingPage(`${ORIGIN}/CARD/app-id?gclid=abc123`)).toBe("/card/redacted?gclid=abc123");
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
    expect(isCredentialTrackingPath("/Thank-You")).toBe(true);
    expect(isCredentialTrackingPath("/SIGN/raw-token")).toBe(true);
    expect(isCredentialTrackingPath("/%73ign/raw-token")).toBe(true);
    expect(isCredentialTrackingPath("/card/app-id")).toBe(true);
    expect(isCredentialTrackingPath("/CARD/app-id/")).toBe(true);
    expect(isCredentialTrackingPath("/")).toBe(false);
    expect(isCredentialTrackingPath("/apply")).toBe(false);
    expect(isCredentialTrackingPath("/fleet")).toBe(false);
    expect(isCredentialTrackingPath("/signals")).toBe(false);
    expect(isCredentialTrackingPath("/cartoon")).toBe(false);
  });
});

describe("googleAdsBootstrap", () => {
  function run(href: string, referrer = "") {
    const location = new URL(href);
    const scripts: { src: string; async: boolean }[] = [];
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
      addEventListener(_type: string, _fn: () => void) {},
    };
    vm.runInContext(
      googleAdsBootstrap(),
      vm.createContext({
        window,
        document,
        location,
        history,
        URL,
        Date,
        String,
        decodeURIComponent,
        setTimeout() {},
      }),
    );
    const queued = () => window.dataLayer.map((args) => Array.from(args as ArrayLike<unknown>));
    return { queued, scripts, history };
  }

  it("does not load or configure the tag on credential routes", () => {
    for (const href of [
      `${ORIGIN}/thank-you?t=resume-token`,
      `${ORIGIN}/login?signin=login-token`,
      `${ORIGIN}/invite?token=invite-token`,
      `${ORIGIN}/sign/esign-token`,
      `${ORIGIN}/Thank-You?t=resume-token`,
      `${ORIGIN}/SIGN/esign-token`,
      `${ORIGIN}/%73ign/esign-token`,
      `${ORIGIN}/card/app-id?t=resume-token`,
      `${ORIGIN}/CARD/app-id`,
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

  it("sets page_referrer to the sanitized value for every referrer", () => {
    const href = `${ORIGIN}/?utm_source=google&gclid=abc123`;
    const same = run(href, `${ORIGIN}/thank-you?t=resume-token&utm_source=email`);
    const sameConfig = same.queued().find((call) => call[0] === "config");
    expect(sameConfig?.[2]).toEqual({
      page_location: sanitizeTrackingUrl(href),
      page_referrer: sanitizeTrackingUrl(`${ORIGIN}/thank-you?t=resume-token&utm_source=email`),
    });

    const crossReferrer = "https://ads.example/CARD/app-id?claim=claim-token&utm_source=google&gclid=abc123";
    const cross = run(href, crossReferrer);
    const crossConfig = cross.queued().find((call) => call[0] === "config");
    expect(crossConfig?.[2]).toEqual({
      page_location: sanitizeTrackingUrl(href),
      page_referrer: sanitizeTrackingUrl(crossReferrer),
    });
    expect(sanitizeTrackingUrl(crossReferrer)).toBe("https://ads.example/card/redacted?utm_source=google&gclid=abc123");
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

  it("matches the module sanitizer, including decoded and mixed-case paths", () => {
    const samples = [
      `${ORIGIN}/fleet?utm_source=google&gclid=abc123&t=resume-token`,
      `${ORIGIN}/Fleet?t=resume-token&gclid=abc123`,
      `${ORIGIN}/apply?t=resume-token&claim=claim-token&utm_source=google&gclid=abc123`,
      `${ORIGIN}/apply?utm_source=google&gclid=abc123#claim=claim-token`,
    ];
    for (const href of samples) {
      const { queued, scripts } = run(href);
      expect(isCredentialTrackingPath(new URL(href).pathname), href).toBe(false);
      expect(scripts, href).toHaveLength(1);
      const config = queued().find((call) => call[0] === "config");
      expect((config?.[2] as { page_location: string }).page_location).toBe(sanitizeTrackingUrl(href));
    }

    const { history, queued } = run(`${ORIGIN}/?gclid=abc123`);
    const before = queued().length;
    history.pushState({}, "", "/SIGN/esign-token?t=resume-token&gclid=abc123");
    history.pushState({}, "", "/%73ign/esign-token?t=resume-token");
    history.pushState({}, "", "/Thank-You?t=resume-token&utm_source=google");
    history.pushState({}, "", "/CARD/app-id?t=resume-token&gclid=abc123");
    history.pushState({}, "", "/%63ard/app-id?claim=claim-token");
    const sets = queued().slice(before).filter((call) => call[0] === "set");
    expect(sets.map((call) => (call[1] as { page_location: string }).page_location)).toEqual([
      sanitizeTrackingUrl(`${ORIGIN}/SIGN/esign-token?t=resume-token&gclid=abc123`),
      sanitizeTrackingUrl(`${ORIGIN}/%73ign/esign-token?t=resume-token`),
      sanitizeTrackingUrl(`${ORIGIN}/Thank-You?t=resume-token&utm_source=google`),
      sanitizeTrackingUrl(`${ORIGIN}/CARD/app-id?t=resume-token&gclid=abc123`),
      sanitizeTrackingUrl(`${ORIGIN}/%63ard/app-id?claim=claim-token`),
    ]);
  });
});

describe("stored referrer and click path", () => {
  it("sanitizes a cross-origin referrer and the click-to-call path", () => {
    const href = `${ORIGIN}/?utm_source=google&gclid=abc123`;
    const referrer = "https://ads.example/SIGN/secret-token?t=resume-token&utm_source=newsletter";
    const storage = new Map<string, string>();
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    Object.assign(globalThis, {
      window: {
        location: new URL(href),
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        },
      },
      document: { referrer },
    });
    try {
      const saved = captureAttribution();
      expect(saved.referrer).toBe(sanitizeTrackingUrl(referrer));
      expect(saved.referrer).not.toContain("secret-token");
      expect(saved.referrer).not.toContain("resume-token");
      expect(saved.gclid).toBe("abc123");
      expect(trackingPagePath(`${ORIGIN}/SIGN/esign-token?t=resume-token`)).toBe("/sign/redacted");
      expect(trackingPagePath(`${ORIGIN}/%73ign/esign-token`)).toBe("/sign/redacted");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});

describe("worker safety", () => {
  it("does not compile strings in the module that runs on the worker", () => {
    const source = readFileSync(new URL("../src/lib/tracking-url.ts", import.meta.url), "utf8");
    expect(source.includes("new Function")).toBe(false);
    expect(source.includes("eval(")).toBe(false);
  });
});
