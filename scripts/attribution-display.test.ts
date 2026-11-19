import { expect, test } from "bun:test";
import { buildAttributionRows, hasTrackingDetails, landingPageName, referrerDomain } from "../src/lib/attribution-display";

const d = {
  gclid: "Cj0KCQiAabcdefghijklmnopqrstuvwxyz",
  utm_source: null, utm_medium: null, utm_campaign: null,
  landing_page: "/tampa?gad_source=1&gad_campaignid=24049501434&gbraid=0AAAAB",
  referrer: "https://www.google.com/",
};
test("landing page and referrer are readable", () => {
  expect(landingPageName(d.landing_page)).toBe("Tampa Page");
  expect(landingPageName("/")).toBe("Home Page");
  expect(referrerDomain(d.referrer)).toBe("google.com");
});
test("rows use friendly labels, hide empties, truncate click id", () => {
  const rows = buildAttributionRows(d);
  const labels = rows.map((r) => r.label);
  expect(labels).toEqual(["Source", "Landing Page", "Ad Tracking", "Referred From", "Ad Click ID"]);
  expect(rows.find((r) => r.label === "Ad Tracking")!.value).toBe("Google Ads Click");
  expect(rows.find((r) => r.label === "Ad Click ID")!.value.length).toBeLessThan(15);
  expect(rows.find((r) => r.label === "Ad Click ID")!.raw).toBe(d.gclid);
  expect(JSON.stringify(rows.map((r) => r.value))).not.toContain("utm_");
});
test("empty attribution shows no tracking", () => {
  expect(hasTrackingDetails({})).toBe(false);
  expect(buildAttributionRows({})[0].value).toBe("Organic / Direct");
});
test("utm values get Title Case", () => {
  const r = buildAttributionRows({ utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "spring-drive" });
  expect(r.map((x) => x.value)).toEqual(["Facebook", "Paid Social", "Spring Drive"]);
});
