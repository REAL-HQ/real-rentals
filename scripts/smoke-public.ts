/**
 * No-login public smoke. A headless browser navigates and reads.
 * The script does not submit a form and does not send its own POST.
 * The page's own resume exchange may POST; that request is not initiated here.
 *
 *   BASE_URL=https://drivereal.com bun scripts/smoke-public.ts
 *
 * Chrome must already be installed. Set CHROME_PATH if it is not on the default path.
 * A line marked [after RC4] passes only once that release is published.
 * /apply?t=x fails on RC2 because that handoff ships in RC3.
 */
import { existsSync } from "node:fs";
import { chromium, type Page, type Request, type Response } from "playwright-core";

const TOKEN = "x";
const RECOVERY = "Get A New Secure Link";
const MISSING_LINK = "Get A Secure Link To Your Application";
const EXPIRED_SENTENCE = "This link has expired";
const SETTLE_MS = 15_000;

const baseArg = process.env.BASE_URL ?? process.argv[2];
if (!baseArg) {
  console.error("BASE_URL is required. Example: BASE_URL=https://drivereal.com bun scripts/smoke-public.ts");
  process.exit(1);
}

let base: URL;
try {
  base = new URL(baseArg);
} catch {
  console.error("BASE_URL is not a URL.");
  process.exit(1);
}
if (base.protocol !== "http:" && base.protocol !== "https:") {
  console.error("BASE_URL must be http or https.");
  process.exit(1);
}

const chromePath = [process.env.CHROME_PATH, "/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(
  (path) => path && existsSync(path),
);
if (!chromePath) {
  console.error("Chrome was not found. Set CHROME_PATH to a Chrome or Chromium binary.");
  process.exit(1);
}

const failures: string[] = [];
let passes = 0;

function record(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (ok) passes += 1;
  else failures.push(label);
}

function pathnameOf(href: string): { pathname: string; token: string | null } {
  const url = new URL(href, base);
  return { pathname: url.pathname.replace(/\/$/, "") || "/", token: url.searchParams.get("t") };
}

function carriesToken(href: string): boolean {
  const where = pathnameOf(href);
  return where.pathname === "/thank-you" && where.token === TOKEN;
}

/** Record the URL before and after client history changes, including the first paint. */
const RECORD_URLS = `(() => {
  const record = () => {
    const list = window.__smokeUrls || [];
    const href = location.pathname + location.search;
    if (list[list.length - 1] !== href) list.push(href);
    window.__smokeUrls = list;
  };
  for (const name of ["pushState", "replaceState"]) {
    const orig = history[name].bind(history);
    history[name] = function () {
      record();
      const result = orig.apply(history, arguments);
      record();
      return result;
    };
  }
  record();
})();`;

function redirectChain(response: Response | null): string[] {
  const chain: string[] = [];
  let request: Request | null = response?.request() ?? null;
  while (request) {
    chain.push(request.url());
    request = request.redirectedFrom();
  }
  return chain.reverse();
}

async function visit(browser: Awaited<ReturnType<typeof chromium.launch>>, path: string) {
  const page = await browser.newPage();
  await page.addInitScript(RECORD_URLS);
  const response = await page.goto(new URL(path, base).href, { waitUntil: "domcontentloaded", timeout: 20_000 });
  return { page, response };
}

async function observedUrls(page: Page, response: Response | null): Promise<string[]> {
  const fromPage = await page.evaluate(() => (window as Window & { __smokeUrls?: string[] }).__smokeUrls ?? []);
  return [...redirectChain(response), ...fromPage.map((href) => new URL(href, page.url()).href), page.url()];
}

/** Wait until the visible page matches and holds still, so the client route has settled. */
async function settle(page: Page, ready: (text: string, url: string, title: string) => boolean): Promise<{ text: string; url: string; title: string }> {
  const started = Date.now();
  let last = "";
  let steady = 0;
  let text = "";
  let url = page.url();
  let title = "";
  while (Date.now() - started < SETTLE_MS) {
    text = await page.locator("body").innerText().catch(() => "");
    url = page.url();
    title = await page.title();
    const snapshot = `${url}\n${title}\n${text}`;
    if (ready(text, url, title) && snapshot === last) steady += 1;
    else steady = 0;
    last = snapshot;
    if (steady >= 2) return { text, url, title };
    await page.waitForTimeout(200);
  }
  return { text, url, title };
}

async function main() {
  console.log(`BASE_URL ${base.origin}`);
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    try {
      const { page, response } = await visit(browser, "/");
      const settled = await settle(
        page,
        (_text, url, title) => pathnameOf(url).pathname === "/" && title.includes("Car Rentals For Uber, Lyft"),
      );
      const where = pathnameOf(settled.url);
      const ok = (response?.status() ?? 0) < 400 && where.pathname === "/" && settled.title.includes("Car Rentals For Uber, Lyft");
      record(ok, "/ loads", ok ? undefined : `${response?.status() ?? "no response"} ${settled.url} title ${JSON.stringify(settled.title)}`);
      await page.close();
    } catch (error) {
      record(false, "/ loads", error instanceof Error ? error.message : "navigation failed");
    }

    try {
      const { page, response } = await visit(browser, "/apply");
      const settled = await settle(
        page,
        (text, url) => text.includes("Tell Us How To Reach You") && pathnameOf(url).pathname === "/apply" && pathnameOf(url).token === null,
      );
      const where = pathnameOf(settled.url);
      const ok = (response?.status() ?? 0) < 400 && where.pathname === "/apply" && where.token === null && settled.text.includes("Tell Us How To Reach You");
      record(ok, "/apply loads", ok ? undefined : `${settled.url}`);
      await page.close();
    } catch (error) {
      record(false, "/apply loads", error instanceof Error ? error.message : "navigation failed");
    }

    try {
      const { page, response } = await visit(browser, `/apply?t=${TOKEN}`);
      const settled = await settle(
        page,
        (text, url) =>
          text.includes(RECOVERY) || (pathnameOf(url).pathname === "/apply" && text.includes("Tell Us How To Reach You")),
      );
      const urls = await observedUrls(page, response);
      const landed = urls.some(carriesToken);
      record(
        landed,
        `/apply?t=${TOKEN} lands on /thank-you?t=${TOKEN}`,
        landed ? undefined : `settled at ${settled.url}`,
      );
      const recovered = landed && pathnameOf(settled.url).pathname === "/thank-you" && settled.text.includes(RECOVERY);
      record(
        recovered,
        `recovery state says ${RECOVERY}`,
        recovered ? undefined : landed ? `settled text did not include the recovery heading (${settled.url})` : `did not reach /thank-you?t=${TOKEN}`,
      );
      await page.close();
    } catch (error) {
      record(false, `/apply?t=${TOKEN} lands on /thank-you?t=${TOKEN}`, error instanceof Error ? error.message : "navigation failed");
      record(false, `recovery state says ${RECOVERY}`, "navigation failed");
    }

    try {
      const { page, response } = await visit(browser, "/thank-you");
      const settled = await settle(
        page,
        (text) => text.includes(MISSING_LINK) || text.includes("Tell Us How To Reach You"),
      );
      const where = pathnameOf(settled.url);
      const shown =
        (response?.status() ?? 0) < 400 &&
        where.pathname === "/thank-you" &&
        where.token === null &&
        settled.text.includes(MISSING_LINK) &&
        !settled.text.includes(EXPIRED_SENTENCE);
      record(
        shown,
        `[after RC4] /thank-you shows ${MISSING_LINK}`,
        shown ? undefined : `${settled.url}`,
      );
      await page.close();
    } catch (error) {
      record(false, `[after RC4] /thank-you shows ${MISSING_LINK}`, error instanceof Error ? error.message : "navigation failed");
    }

    try {
      const { page, response } = await visit(browser, "/login");
      const settled = await settle(
        page,
        (text, url, title) => text.includes("Sign In") && pathnameOf(url).pathname === "/login" && title.includes("Sign In — REAL RENTALS"),
      );
      const where = pathnameOf(settled.url);
      const ok =
        (response?.status() ?? 0) < 400 &&
        where.pathname === "/login" &&
        settled.title.includes("Sign In — REAL RENTALS") &&
        settled.text.includes("Sign In");
      record(ok, "/login loads", ok ? undefined : `${settled.url} title ${JSON.stringify(settled.title)}`);
      await page.close();
    } catch (error) {
      record(false, "/login loads", error instanceof Error ? error.message : "navigation failed");
    }
  } finally {
    await browser.close();
  }

  console.log("");
  console.log(`${passes} PASS, ${failures.length} FAIL`);
  if (failures.length) {
    console.log("Lines marked [after RC4] pass only after that release is published.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
