// Turns raw ad-attribution values into readable labels for the admin UI.

export type AttributionInput = {
  gclid?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  landing_page?: string | null;
  referrer?: string | null;
};

export type AttributionRow = { label: string; value: string; raw?: string };

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

export function titleCaseWords(s: string): string {
  return s
    .replace(/[_+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function parseUrl(v: string): URL | null {
  try {
    return new URL(v, "https://placeholder.local");
  } catch {
    return null;
  }
}

export function referrerDomain(v: string | null | undefined): string | null {
  const t = clean(v);
  if (!t) return null;
  try {
    return new URL(t).hostname.replace(/^www\./, "") || t;
  } catch {
    return t;
  }
}

export function landingPageName(v: string | null | undefined): string | null {
  const t = clean(v);
  if (!t) return null;
  const u = parseUrl(t);
  if (!u) return t;
  const path = u.pathname.replace(/\/+$/, "");
  if (!path) return "Home Page";
  const parts = path.split("/").filter(Boolean).map((p) => titleCaseWords(decodeURIComponent(p)));
  return `${parts.join(" / ")} Page`;
}

const AD_PARAMS = ["gclid", "gad_source", "gad_campaignid", "gbraid", "wbraid"];

export function trackingSummary(v: string | null | undefined, gclid?: string | null): string | null {
  const t = clean(v);
  const u = t ? parseUrl(t) : null;
  const hasGoogle = !!clean(gclid) || (u ? AD_PARAMS.some((p) => u.searchParams.has(p)) : false);
  if (hasGoogle) return "Google Ads Click";
  const src = u?.searchParams.get("utm_source");
  if (src) return `${titleCaseWords(src)} Campaign Link`;
  return null;
}

export function buildAttributionRows(d: AttributionInput): AttributionRow[] {
  const rows: AttributionRow[] = [];
  const source = clean(d.utm_source);
  const medium = clean(d.utm_medium);
  const campaign = clean(d.utm_campaign);
  rows.push({
    label: "Source",
    value: clean(d.gclid) ? "Google Ads" : source ? titleCaseWords(source) : "Organic / Direct",
  });
  if (source && clean(d.gclid)) rows.push({ label: "UTM Source", value: titleCaseWords(source), raw: source });
  if (medium) rows.push({ label: "Medium", value: titleCaseWords(medium), raw: medium });
  if (campaign) rows.push({ label: "Campaign", value: titleCaseWords(campaign), raw: campaign });
  const lp = clean(d.landing_page);
  if (lp) rows.push({ label: "Landing Page", value: landingPageName(lp) ?? lp, raw: lp });
  const trk = trackingSummary(d.landing_page, d.gclid);
  if (trk) rows.push({ label: "Ad Tracking", value: trk });
  const ref = clean(d.referrer);
  if (ref) rows.push({ label: "Referred From", value: referrerDomain(ref) ?? ref, raw: ref });
  const gclid = clean(d.gclid);
  if (gclid) rows.push({ label: "Ad Click ID", value: gclid.length > 14 ? `${gclid.slice(0, 12)}…` : gclid, raw: gclid });
  return rows;
}

export function hasTrackingDetails(d: AttributionInput): boolean {
  return buildAttributionRows(d).some((r) => r.label !== "Source" || r.value !== "Organic / Direct");
}

export function rawAttributionLines(d: AttributionInput): { label: string; raw: string }[] {
  const out: { label: string; raw: string }[] = [];
  const add = (label: string, v: string | null | undefined) => {
    const t = clean(v);
    if (t) out.push({ label, raw: t });
  };
  add("utm_source", d.utm_source);
  add("utm_medium", d.utm_medium);
  add("utm_campaign", d.utm_campaign);
  add("landing_page", d.landing_page);
  add("referrer", d.referrer);
  add("gclid", d.gclid);
  return out;
}
