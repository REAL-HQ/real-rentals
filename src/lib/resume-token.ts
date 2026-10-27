import { useEffect, useState } from "react";

/**
 * Keep the resume token out of the address bar.
 *
 * The token is a bearer credential. Arriving in the query string it is in the
 * one place a URL gets copied from, screenshotted, read by any third-party
 * script on the page, written into analytics page-view URLs and recorded in
 * browser history — and on a shared or family device, history is somebody
 * else's. So the first thing the page does is take a copy and rewrite the URL
 * without it.
 *
 * WHAT THIS DOES AND DOES NOT BUY, honestly:
 *
 *  - It does not make the token secret. The email carrying it is still the
 *    weakest link, and nothing here changes that.
 *  - Referrer leakage was already covered: browsers default to
 *    strict-origin-when-cross-origin, which strips the path and query from
 *    cross-origin referrers. This closes the same-origin case and the
 *    third-party-script case, which the default does not.
 *  - History, copy-paste and screenshots are genuinely improved: after the
 *    first paint the visible URL is /thank-you with no credential in it.
 *  - sessionStorage is per-tab and cleared when the tab closes, which is the
 *    right lifetime for "I am working on my application right now". It is
 *    readable by script on this origin — but so was the URL, so this is not a
 *    regression, and the artifact:// origin is ours alone.
 *
 * Deliberately not a session cookie or a server-side session table: that is a
 * second authentication system to hold correct, for a link that already
 * expires in fourteen days and can be revoked.
 *
 * NOT named .client.ts, despite being browser-only in effect: that suffix is
 * reserved for modules the server must never reach, and the routes that use
 * this hook are server-rendered. Every window access here is guarded, so the
 * module is safe to evaluate during SSR — it simply returns undefined until
 * the effect runs.
 */
const KEY = "rr.resume-token";
/** Card-on-file links stay out of the resume stash, so opening one cannot resume /thank-you. */
export const CARD_TOKEN_KEY = "rr.card-on-file-token";

function read(key = KEY): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(token: string, key = KEY) {
  try {
    window.sessionStorage.setItem(key, token);
  } catch {
    // Private mode, blocked storage. The token stays in the URL, which still
    // works — this is a hardening measure, not a dependency.
  }
}

/**
 * Where /apply sends a link that already carries a resume token.
 *
 * This runs in the route's beforeLoad, before useResumeToken can strip `t`.
 * Stripping on /apply makes the router re-read the search with `t` gone. The
 * effect then runs again with no URL token and allowStashed false, and clears
 * the token, so the contact form appears instead of /thank-you. A page with
 * no token stays here and starts a new application. The tab stash is not read.
 */
export function resumeTargetFromApply(search: {
  t?: string;
}): { to: "/thank-you"; search: { t: string }; replace: true } | null {
  const t = typeof search.t === "string" ? search.t.trim() : "";
  if (!t) return null;
  return { to: "/thank-you", search: { t }, replace: true };
}

/** Replace this tab's token (after a single-use recovery link is exchanged). */
export function storeResumeToken(token: string) {
  write(token);
}

export function clearResumeToken() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Resolve the token from the URL or this tab's stash, and strip it from the
 * address bar. Returns undefined while resolving on the very first render.
 */
export function useResumeToken(
  fromUrl: string | undefined,
  opts: { allowStashed?: boolean; storageKey?: string } = {},
): string | null | undefined {
  const allowStashed = opts.allowStashed !== false;
  const storageKey = opts.storageKey ?? KEY;
  // Always undefined on the first render, server and client alike.
  //
  // Seeding this from `fromUrl` on the client only looks like a harmless
  // optimisation and is not: the server rendered nothing for this subtree and
  // the client rendered the wizard, so React threw a hydration mismatch and
  // regenerated the tree — which in practice meant the applicant watched their
  // own application fail to open. One frame of nothing is the correct price.
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (fromUrl) {
      write(fromUrl, storageKey);
      setToken(fromUrl);
      // replaceState, not pushState: Back should leave the flow, not walk
      // through a URL that still carries the credential.
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has("t")) {
          url.searchParams.delete("t");
          window.history.replaceState(
            window.history.state,
            "",
            url.pathname + (url.search || "") + url.hash,
          );
        }
      } catch {
        /* the token simply stays visible */
      }
      return;
    }
    // On a page whose job is to START an application, a token left in this
    // tab by whoever used the device last must not silently reopen their
    // wizard — their name, city, address and insurer with it. Only pages that
    // exist to resume read the stash.
    setToken(allowStashed ? read(storageKey) : null);
  }, [fromUrl, allowStashed, storageKey]);

  return token;
}
