/**
 * Canonical public origin for every outbound email and SMS link.
 *
 * Recipient links always use https://drivereal.com. Local, private, and
 * Preview hosts are never written into a message, even when PUBLIC_SITE_URL
 * or the incoming request points at one.
 */

export const PRODUCTION_ORIGIN = "https://drivereal.com";
export const PRODUCTION_HOST = "drivereal.com";

export type OutboundUrlIssue = {
  url: string;
  reason: "local_or_private" | "shortener" | "supabase_auth_verify";
};

const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "cutt.ly",
  "rebrand.ly",
  "tiny.cc",
  "shorturl.at",
  "rb.gy",
  "goo.gl",
  "lnkd.in",
  "trib.al",
  "tiny.one",
  "b.link",
]);

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** True for loopback, private, link-local, and typical local TLD hosts. */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (!h) return true;
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  if (
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan") ||
    h.endsWith(".home")
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const p = ipv4.slice(1).map(Number);
    if (p.some((n) => n > 255)) return false;
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    return false;
  }
  if (h.includes(":")) {
    if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  }
  return false;
}

export function isUrlShortenerHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (SHORTENER_HOSTS.has(h)) return true;
  for (const root of SHORTENER_HOSTS) {
    if (h.endsWith(`.${root}`)) return true;
  }
  return false;
}

export function inspectOutboundUrl(raw: string): OutboundUrlIssue | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isPrivateOrLocalHost(url.hostname)) return { url: raw, reason: "local_or_private" };
  if (isUrlShortenerHost(url.hostname)) return { url: raw, reason: "shortener" };
  const host = normalizeHost(url.hostname);
  if ((host === "supabase.co" || host.endsWith(".supabase.co")) && url.pathname.includes("/auth/v1/verify")) {
    return { url: raw, reason: "supabase_auth_verify" };
  }
  return null;
}

/** Pull http(s) URLs from HTML hrefs and from visible text. */
export function extractHttpUrls(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) found.push(m[1]);
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"'`\]]+/gi)) {
    found.push(m[0].replace(/[),.;]+$/g, ""));
  }
  return found;
}

export function findDisallowedOutboundUrls(...parts: Array<string | null | undefined>): OutboundUrlIssue[] {
  const seen = new Set<string>();
  const issues: OutboundUrlIssue[] = [];
  for (const part of parts) {
    if (!part) continue;
    for (const raw of extractHttpUrls(part)) {
      const issue = inspectOutboundUrl(raw);
      if (!issue || seen.has(issue.url)) continue;
      seen.add(issue.url);
      issues.push(issue);
    }
  }
  return issues;
}

export function outboundRefusalMessage(issue: OutboundUrlIssue): string {
  if (issue.reason === "shortener") {
    return "Refused to send: message contains a URL shortener.";
  }
  if (issue.reason === "supabase_auth_verify") {
    return "Refused to send: auth links must use drivereal.com, not supabase.co.";
  }
  return "Refused to send: a link points at a local or private host.";
}

/** Always https://drivereal.com. Candidate values are ignored when they are not the public site. */
export function publicAppOrigin(_candidate?: string | null): string {
  return PRODUCTION_ORIGIN;
}

export function publicAppUrl(pathAndQuery = "/"): string {
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  return `${PRODUCTION_ORIGIN}${path}`;
}

export type AuthOtpType = "recovery" | "invite" | "magiclink" | "signup" | "email_change" | "email";

const AUTH_NEXT_PATHS = new Set(["/invite", "/partner", "/set-password", "/portal", "/login", "/admin"]);

/**
 * A relative post-confirm path the app is allowed to send someone to.
 * Rejects open redirects, protocols, and any path outside the auth allow-list.
 */
export function safeAuthNextPath(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[a-z][a-z0-9+.-]*:/i.test(value)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value, PRODUCTION_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PRODUCTION_ORIGIN) return null;
  if (!AUTH_NEXT_PATHS.has(url.pathname)) return null;
  return `${url.pathname}${url.search}`;
}

/**
 * A drivereal.com confirm link from a generateLink hashed_token.
 * Never use action_link — that is the raw supabase.co /auth/v1/verify URL.
 */
export function authConfirmUrl(tokenHash: string, type: AuthOtpType = "recovery", next?: string | null): string {
  const hash = String(tokenHash || "").trim();
  if (!hash) throw new Error("Missing auth token.");
  const params = new URLSearchParams({ token_hash: hash, type });
  const safe = safeAuthNextPath(next);
  if (safe) params.set("next", safe);
  return publicAppUrl(`/auth/confirm?${params.toString()}`);
}

export function authUrlFromGenerateLink(
  link: {
    properties?: { hashed_token?: string | null; action_link?: string | null } | null;
  } | null | undefined,
  type: AuthOtpType = "recovery",
  next?: string | null,
): string | null {
  const hash = String(link?.properties?.hashed_token ?? "").trim();
  if (!hash) return null;
  return authConfirmUrl(hash, type, next);
}

export function recoveryUrlFromGenerateLink(link: {
  properties?: { hashed_token?: string | null; action_link?: string | null } | null;
} | null | undefined): string | null {
  return authUrlFromGenerateLink(link, "recovery");
}
