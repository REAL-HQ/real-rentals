/**
 * No-login public smoke. Every request is GET, with no body and no cookie.
 * It never submits a form and never calls a server function.
 *
 *   BASE_URL=https://drivereal.com bun scripts/smoke-public.ts
 *
 * A line marked [after RC4] passes only once that release is published.
 * /apply?t=x fails on RC2 because that handoff ships in RC3.
 */
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";

const TOKEN = "x";
const RECOVERY = "Get A New Secure Link";
const MISSING_LINK = "Get A Secure Link To Your Application";
const MAX_BYTES = 3_000_000;
const MAX_HOPS = 5;
const MAX_SCRIPTS = 80;

type Page = {
  status: number;
  finalUrl: string;
  body: string;
  contentType: string;
};

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
base.hash = "";
base.search = "";
base.pathname = base.pathname.replace(/\/$/, "") || "/";

const failures: string[] = [];
let passes = 0;

function record(ok: boolean, label: string, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (ok) passes += 1;
  else failures.push(label);
}

function header(res: IncomingMessage, name: string): string {
  const value = res.headers[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** One GET. No body is written. */
function getOnce(target: URL): Promise<{ status: number; location: string; contentType: string; body: string }> {
  const options: RequestOptions = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    path: `${target.pathname}${target.search}`,
    method: "GET",
    headers: {
      accept: "text/html,application/javascript,*/*",
      "user-agent": "real-rentals-smoke-public",
    },
  };
  if (options.method !== "GET") throw new Error("smoke-public refuses any method other than GET");

  return new Promise((resolve, reject) => {
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(options, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        res.resume();
        reject(error);
      };
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          fail(new Error(`response larger than ${MAX_BYTES} bytes`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status: res.statusCode ?? 0,
          location: header(res, "location"),
          contentType: header(res, "content-type"),
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", fail);
    });
    req.setTimeout(20_000, () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Follow same-origin redirects with GET only. */
async function getPage(pathname: string): Promise<Page> {
  let current = new URL(pathname, base);
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    if (current.origin !== base.origin) {
      throw new Error(`redirect left ${base.origin} for ${current.origin}`);
    }
    const response = await getOnce(current);
    const redirected = response.status >= 300 && response.status < 400 && response.location;
    if (!redirected) {
      return {
        status: response.status,
        finalUrl: current.href,
        body: response.body,
        contentType: response.contentType,
      };
    }
    if (hop === MAX_HOPS) throw new Error(`too many redirects from ${pathname}`);
    current = new URL(response.location, current);
  }
  throw new Error(`too many redirects from ${pathname}`);
}

function titleOf(html: string): string {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return (match?.[1] ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function leafRoute(html: string): string {
  const at = html.lastIndexOf("matches:");
  if (at < 0) return "";
  const ids = [...html.slice(at, at + 2500).matchAll(/i:"([^"]*)"/g)].map((match) =>
    match[1].replaceAll("\u0000", ""),
  );
  return ids.at(-1) ?? "";
}

function sameOriginAsset(from: string, raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, from);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  if (!url.pathname.startsWith("/assets/") || !url.pathname.endsWith(".js")) return null;
  url.search = "";
  url.hash = "";
  return url.href;
}

function assetsInHtml(pageUrl: string, html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+\.js)"/g)) {
    const asset = sameOriginAsset(pageUrl, match[1]);
    if (asset) found.push(asset);
  }
  return found;
}

function assetsInScript(scriptUrl: string, source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/["']([^"']+\.js)["']/g)) {
    const asset = sameOriginAsset(scriptUrl, match[1]);
    if (asset) found.push(asset);
  }
  return found;
}

/** GET the page's same-origin scripts, plus one hop of imports. No other URLs. */
async function scriptText(page: Page): Promise<string> {
  const queue = assetsInHtml(page.finalUrl, page.body);
  const seen = new Set<string>();
  let text = page.body;
  let hops = 0;
  while (queue.length && seen.size < MAX_SCRIPTS && hops < 2) {
    const batch = queue.splice(0, queue.length);
    hops += 1;
    const next: string[] = [];
    for (const asset of batch) {
      if (seen.has(asset) || seen.size >= MAX_SCRIPTS) continue;
      seen.add(asset);
      const url = new URL(asset);
      const response = await getOnce(url);
      if (response.status !== 200) continue;
      text += `\n${response.body}`;
      if (hops < 2) next.push(...assetsInScript(asset, response.body));
    }
    queue.push(...next);
  }
  return text;
}

function pathOf(href: string): { pathname: string; token: string | null } {
  const url = new URL(href);
  return { pathname: url.pathname.replace(/\/$/, "") || "/", token: url.searchParams.get("t") };
}

async function main() {
  console.log(`BASE_URL ${base.origin}`);

  try {
    const home = await getPage("/");
    const homePath = pathOf(home.finalUrl).pathname;
    const homeTitle = titleOf(home.body);
    const homeOk =
      home.status === 200 &&
      home.contentType.includes("text/html") &&
      homePath === "/" &&
      homeTitle.includes("Car Rentals For Uber, Lyft");
    record(homeOk, "/ loads", homeOk ? undefined : `${home.status} ${home.finalUrl} title ${JSON.stringify(homeTitle)}`);
  } catch (error) {
    record(false, "/ loads", error instanceof Error ? error.message : "request failed");
  }

  try {
    const apply = await getPage("/apply");
    const where = pathOf(apply.finalUrl);
    const applyTitle = titleOf(apply.body);
    const applyOk =
      apply.status === 200 &&
      where.pathname === "/apply" &&
      where.token === null &&
      applyTitle.includes("Apply — REAL RENTALS") &&
      leafRoute(apply.body).includes("apply");
    record(applyOk, "/apply loads", applyOk ? undefined : `${apply.status} ${apply.finalUrl} route ${JSON.stringify(leafRoute(apply.body))}`);
  } catch (error) {
    record(false, "/apply loads", error instanceof Error ? error.message : "request failed");
  }

  let handoff: Page | null = null;
  try {
    handoff = await getPage(`/apply?t=${TOKEN}`);
    const where = pathOf(handoff.finalUrl);
    const landed = handoff.status === 200 && where.pathname === "/thank-you" && where.token === TOKEN;
    record(
      landed,
      `/apply?t=${TOKEN} lands on /thank-you?t=${TOKEN}`,
      landed ? undefined : `${handoff.status} ${handoff.finalUrl} route ${JSON.stringify(leafRoute(handoff.body))}`,
    );
  } catch (error) {
    record(false, `/apply?t=${TOKEN} lands on /thank-you?t=${TOKEN}`, error instanceof Error ? error.message : "request failed");
  }

  try {
    const where = handoff ? pathOf(handoff.finalUrl) : null;
    const landed = !!handoff && handoff.status === 200 && where?.pathname === "/thank-you" && where.token === TOKEN;
    if (!landed || !handoff) {
      record(false, `recovery state says ${RECOVERY}`, `did not reach /thank-you?t=${TOKEN}, so the heading was not checked`);
    } else {
      const source = await scriptText(handoff);
      const recovered = leafRoute(handoff.body).includes("thank-you") && source.includes(RECOVERY);
      record(recovered, `recovery state says ${RECOVERY}`, recovered ? undefined : "thank-you document did not include the recovery heading");
    }
  } catch (error) {
    record(false, `recovery state says ${RECOVERY}`, error instanceof Error ? error.message : "request failed");
  }

  try {
    const thanks = await getPage("/thank-you");
    const where = pathOf(thanks.finalUrl);
    const loaded = thanks.status === 200 && where.pathname === "/thank-you" && where.token === null;
    const source = loaded ? await scriptText(thanks) : "";
    const shown = loaded && source.includes(MISSING_LINK);
    record(
      shown,
      `[after RC4] /thank-you shows ${MISSING_LINK}`,
      shown ? undefined : loaded ? "heading not in the document or its scripts" : `${thanks.status} ${thanks.finalUrl}`,
    );
  } catch (error) {
    record(false, `[after RC4] /thank-you shows ${MISSING_LINK}`, error instanceof Error ? error.message : "request failed");
  }

  try {
    const login = await getPage("/login");
    const where = pathOf(login.finalUrl);
    const loginTitle = titleOf(login.body);
    const loginOk = login.status === 200 && where.pathname === "/login" && loginTitle.includes("Sign In — REAL RENTALS");
    record(loginOk, "/login loads", loginOk ? undefined : `${login.status} ${login.finalUrl} title ${JSON.stringify(loginTitle)}`);
  } catch (error) {
    record(false, "/login loads", error instanceof Error ? error.message : "request failed");
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
