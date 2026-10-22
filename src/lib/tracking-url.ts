// Credential values that must never reach Google Ads or the stored first-touch
// landing page. gclid and utm_* stay: they are ads attribution, not secrets.
//
// The helpers below are plain functions. The head snippet is a separate static
// string because the Worker runtime refuses to compile code from strings.
// scripts/tracking-url.test.ts runs that string in node:vm and checks it
// against these functions.

const SENSITIVE_QUERY_KEYS = [
  "t",
  "signin",
  "token",
  "code",
  "access_token",
  "refresh_token",
  "token_hash",
  "session_id",
  "claim",
];

function normalizedPathname(pathname: string): string {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  const stripped = decoded.toLowerCase().replace(/\/+$/, "");
  return stripped || "/";
}

export function isCredentialTrackingPath(pathname: string): boolean {
  const path = normalizedPathname(pathname);
  return (
    path === "/login" ||
    path === "/invite" ||
    path === "/sign" ||
    path.startsWith("/sign/") ||
    path === "/card" ||
    path.startsWith("/card/")
  );
}

export function sanitizeTrackingUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.includes(key)) url.searchParams.delete(key);
  }
  let path = normalizedPathname(url.pathname);
  path = path.replace(/\/sign\/[^/]*/, "/sign/redacted").replace(/\/card\/[^/]*/, "/card/redacted");
  url.pathname = path;
  url.hash = "";
  return url.toString();
}

/** Path plus query, which is the shape stored as the first landing page. */
export function trackingLandingPage(href: string): string {
  const clean = new URL(sanitizeTrackingUrl(href));
  return clean.pathname + clean.search;
}

/** Path only, for events that record where a click happened. */
export function trackingPagePath(href: string): string {
  try {
    return new URL(sanitizeTrackingUrl(href)).pathname;
  } catch {
    return "/";
  }
}

/**
 * Inline head snippet. /login, /invite, /sign, and /card never load the tag.
 * /thank-you loads it, matching live, and every loaded route passes a
 * sanitized page_location and page_referrer into
 * gtag('config'), including a cross-origin referrer. History changes
 * re-apply page_location with gtag('set') so a tag already loaded on a
 * marketing page cannot send a later client-side credential URL.
 *
 * Kept as a string literal so the server and client emit the same HTML and
 * the Worker never compiles it.
 */
export const GOOGLE_ADS_BOOTSTRAP = `(function(){
    function normalizedPathname(pathname) {
      var decoded = pathname;
      try { decoded = decodeURIComponent(pathname); } catch (e) { decoded = pathname; }
      var stripped = decoded.toLowerCase().replace(/\\/+$/, "");
      return stripped || "/";
    }
    function isCredentialTrackingPath(pathname) {
      var path = normalizedPathname(pathname);
      return path === "/login" || path === "/invite" || path === "/sign" || path.indexOf("/sign/") === 0 || path === "/card" || path.indexOf("/card/") === 0;
    }
    function sanitizeTrackingUrl(raw) {
      var sensitive = ["t", "signin", "token", "code", "access_token", "refresh_token", "token_hash", "session_id", "claim"];
      var url;
      try { url = new URL(raw); } catch (e) { return raw; }
      var keys = [];
      url.searchParams.forEach(function(_value, key) { keys.push(key); });
      for (var i = 0; i < keys.length; i++) {
        if (sensitive.indexOf(keys[i]) !== -1) url.searchParams.delete(keys[i]);
      }
      var path = normalizedPathname(url.pathname).replace(/\\/sign\\/[^/]*/, "/sign/redacted").replace(/\\/card\\/[^/]*/, "/card/redacted");
      url.pathname = path;
      url.hash = "";
      return url.toString();
    }
    var id = "AW-18340435293";
    if (isCredentialTrackingPath(location.pathname)) return;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){window.dataLayer.push(arguments);};

    function applyPageLocation(href){
      window.gtag("set", { page_location: sanitizeTrackingUrl(href) });
    }

    function wrapHistory(name){
      var orig = history[name];
      if (!orig || orig.__rrSanitized) return;
      var wrapped = function(state, title, url){
        var next = location.href;
        if (url != null && url !== "") {
          try { next = new URL(String(url), location.href).href; } catch (e) {}
        }
        applyPageLocation(next);
        return orig.apply(this, arguments);
      };
      wrapped.__rrSanitized = true;
      history[name] = wrapped;
    }

    function installHistory(){
      wrapHistory("pushState");
      wrapHistory("replaceState");
    }

    installHistory();
    window.addEventListener("popstate", function(){ applyPageLocation(location.href); }, true);

    var referrer = document.referrer;
    var fields = { page_location: sanitizeTrackingUrl(location.href) };
    if (referrer) fields.page_referrer = sanitizeTrackingUrl(referrer);
    window.gtag("set", fields);
    window.gtag("js", new Date());
    window.gtag("config", id, fields);

    var script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
    script.addEventListener("load", installHistory);
    document.head.appendChild(script);
    window.addEventListener("load", function(){ setTimeout(installHistory, 0); });
  })();`;

export function googleAdsBootstrap(): string {
  return GOOGLE_ADS_BOOTSTRAP;
}
