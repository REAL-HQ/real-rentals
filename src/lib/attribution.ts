// Ad attribution capture. Reads gclid + utm_* from the first URL a visitor
// lands on and persists them (plus landing_page + referrer) in sessionStorage
// so they survive navigation through the marketing site into /apply and the
// wizard. First-touch wins: once a field is recorded, later navigations
// don't overwrite it.

const KEY = "rr_attribution_v1";

export type Attribution = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  landing_page: string | null;
  referrer: string | null;
};

const EMPTY: Attribution = {
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_term: null,
  utm_content: null,
  gclid: null,
  landing_page: null,
  referrer: null,
};

function read(): Attribution {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<Attribution>) };
  } catch {
    return { ...EMPTY };
  }
}

function write(v: Attribution) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode / disabled storage — swallow */
  }
}

export function captureAttribution(): Attribution {
  if (typeof window === "undefined") return { ...EMPTY };
  const current = read();
  const params = new URLSearchParams(window.location.search);
  const keys: (keyof Attribution)[] = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
  ];
  let changed = false;
  for (const k of keys) {
    const v = params.get(k);
    if (v && !current[k]) {
      current[k] = v;
      changed = true;
    }
  }
  if (!current.landing_page) {
    current.landing_page = window.location.pathname + window.location.search;
    changed = true;
  }
  if (!current.referrer) {
    const ref = document.referrer;
    if (ref && !ref.startsWith(window.location.origin)) {
      current.referrer = ref;
      changed = true;
    }
  }
  if (changed) write(current);
  return current;
}

export function getAttribution(): Attribution {
  return captureAttribution();
}