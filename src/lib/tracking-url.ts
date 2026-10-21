// Credential values that must never reach Google Ads or the stored first-touch
// landing page. gclid and utm_* stay: they are ads attribution, not secrets.
//
// The function bodies live once, as source text. The head snippet pastes that
// text, and the helpers below compile the same text, so server HTML and the
// client cannot drift apart the way function.toString() does after minification.

const sanitizeTrackingUrlSource = String.raw`function sanitizeTrackingUrl(raw) {
  const sensitive = ["t", "signin", "token", "code", "access_token", "refresh_token", "token_hash", "session_id"];
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    return raw;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (sensitive.includes(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/sign\/[^/]*/, "/sign/redacted");
  url.hash = "";
  return url.toString();
}`;

const isCredentialTrackingPathSource = String.raw`function isCredentialTrackingPath(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/thank-you" || path === "/login" || path === "/invite" || path === "/sign" || path.startsWith("/sign/");
}`;

function compile<T>(source: string): T {
  return new Function(`"use strict"; return (${source});`)() as T;
}

export const sanitizeTrackingUrl: (raw: string) => string = compile(sanitizeTrackingUrlSource);

export const isCredentialTrackingPath: (pathname: string) => boolean = compile(isCredentialTrackingPathSource);

/** Path plus query, which is the shape stored as the first landing page. */
export function trackingLandingPage(href: string): string {
  const clean = new URL(sanitizeTrackingUrl(href));
  return clean.pathname + clean.search;
}

const GOOGLE_ADS_ID = "AW-18340435293";

/**
 * Inline head snippet. Credential routes never load or configure the tag.
 * Every other route passes a sanitized page_location, and a same-origin
 * page_referrer when there is one, into gtag('config'). History changes
 * re-apply page_location with gtag('set') so a tag already loaded on a
 * marketing page cannot send a later client-side credential URL.
 */
export function googleAdsBootstrap(): string {
  return `(function(){
    ${sanitizeTrackingUrlSource}
    ${isCredentialTrackingPathSource}
    var id = ${JSON.stringify(GOOGLE_ADS_ID)};
    if (isCredentialTrackingPath(location.pathname)) return;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){window.dataLayer.push(arguments);};

    function applyPageLocation(href){
      window.gtag('set', { page_location: sanitizeTrackingUrl(href) });
    }

    function wrapHistory(name){
      var orig = history[name];
      if (!orig || orig.__rrSanitized) return;
      var wrapped = function(state, title, url){
        var next = location.href;
        if (url != null && url !== '') {
          try { next = new URL(String(url), location.href).href; } catch (e) {}
        }
        applyPageLocation(next);
        return orig.apply(this, arguments);
      };
      wrapped.__rrSanitized = true;
      history[name] = wrapped;
    }

    function installHistory(){
      wrapHistory('pushState');
      wrapHistory('replaceState');
    }

    installHistory();
    window.addEventListener('popstate', function(){ applyPageLocation(location.href); }, true);

    var referrer = document.referrer;
    var fields = { page_location: sanitizeTrackingUrl(location.href) };
    if (referrer) {
      try {
        if (new URL(referrer).origin === location.origin) fields.page_referrer = sanitizeTrackingUrl(referrer);
      } catch (e) {}
    }
    window.gtag('js', new Date());
    window.gtag('config', id, fields);

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    script.addEventListener('load', installHistory);
    document.head.appendChild(script);
    window.addEventListener('load', function(){ setTimeout(installHistory, 0); });
  })();`;
}
