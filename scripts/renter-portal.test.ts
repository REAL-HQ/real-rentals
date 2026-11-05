import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  COMPANY_INSURANCE_SLOT_ENABLED,
  clampSummary,
  insuranceOnFile,
  isFetchableHost,
  normalizeWebsite,
  parseVendorView,
  pickLogoFromHtml,
  recordsVisible,
  renterSections,
  renterStage,
  reorder,
  validateVendor,
  vendorInitials,
  VENDOR_CATEGORIES,
} from "../src/lib/renter-portal";

const T = "2026-11-04";

describe("stage", () => {
  test("statuses", () => {
    expect(renterStage("active", null, T)).toBe("active");
    expect(renterStage("pending", null, T)).toBe("assigned");
    expect(renterStage(null, null, T)).toBe("assigned");
    expect(renterStage("returned", "2026-01-01", T)).toBe("returned");
    expect(renterStage("Completed", null, T)).toBe("returned");
    expect(renterStage("pending", "2026-10-01", T)).toBe("returned");
    expect(renterStage("cancelled", null, T)).toBe("none");
  });
});

describe("visibility", () => {
  test("assigned sees only plate and VIN", () => {
    expect(renterSections("assigned", { recordsVisible: false })).toEqual(["plate", "vin"]);
  });
  test("active sees registration, insurance, photos, receipts; company slot off", () => {
    expect(COMPANY_INSURANCE_SLOT_ENABLED).toBe(false);
    expect(renterSections("active", { recordsVisible: true })).toEqual(["plate", "vin", "registration", "insurance", "photos", "receipts"]);
    expect(renterSections("active", { recordsVisible: true, companyInsurance: true })).toContain("companyInsurance");
  });
  test("returned within a year: photos and receipts only", () => {
    expect(renterSections("returned", { recordsVisible: true })).toEqual(["photos", "receipts"]);
    expect(renterSections("returned", { recordsVisible: false })).toEqual([]);
    expect(renterSections("none", { recordsVisible: true })).toEqual([]);
  });
  test("one-year window", () => {
    expect(recordsVisible("returned", "2025-11-04", T)).toBe(true);
    expect(recordsVisible("returned", "2025-11-03", T)).toBe(false);
    expect(recordsVisible("returned", "2026-08-01", T)).toBe(true);
    expect(recordsVisible("returned", null, T)).toBe(false);
    expect(recordsVisible("assigned", null, T)).toBe(false);
    expect(recordsVisible("active", null, T)).toBe(true);
  });
  test("clampSummary strips keys a stage may not have", () => {
    const leaky = { stage: "assigned", plate: "P", vin: "V", registration: {}, insurance: [], photos: [], receipts: [] };
    expect(Object.keys(clampSummary(leaky)).sort()).toEqual(["plate", "stage", "vin"]);
    const ret = clampSummary({ stage: "returned", plate: "P", vin: "V", photos: [], registration: {} });
    expect(ret.plate).toBeNull();
    expect(ret.vin).toBeNull();
    expect("registration" in ret).toBe(false);
    expect(clampSummary({ stage: "hacker", plate: "P" })).toEqual({ stage: "none" });
    expect(clampSummary(null)).toEqual({ stage: "none" });
  });
});

describe("insurance on file", () => {
  const v = { id: "1", label: "Old", expiresOn: null, reviewStatus: "verified", isCurrent: false, uploadedAt: "2026-01-01" };
  const n = { id: "2", label: "New", expiresOn: null, reviewStatus: "uploaded", isCurrent: true, uploadedAt: "2026-10-01" };
  test("old verified stays valid while new is under review", () => {
    expect(insuranceOnFile([n, v])).toEqual({ verified: v, pending: n });
  });
  test("after review the new one is verified", () => {
    const nv = { ...n, reviewStatus: "verified" };
    expect(insuranceOnFile([nv, v])).toEqual({ verified: nv, pending: null });
  });
  test("rejected upload is not pending", () => {
    expect(insuranceOnFile([{ ...n, reviewStatus: "rejected" }, v]).pending).toBeNull();
  });
});

describe("vendors", () => {
  test("required categories exist", () => {
    const c = VENDOR_CATEGORIES.map((x) => x.value);
    for (const k of ["roadside", "mechanic", "car_wash", "locksmith", "towing", "tire_shop"]) expect(c).toContain(k as never);
  });
  test("validate", () => {
    const ok = validateVendor({ category: "locksmith", name: " Pop-A-Lock ", phone: "(404) 555-0100", website: "popalock.com" });
    expect(ok.name).toBe("Pop-A-Lock");
    expect(ok.website).toBe("https://popalock.com/");
    expect(() => validateVendor({ category: "spa", name: "x" })).toThrow();
    expect(() => validateVendor({ category: "mechanic", name: "" })).toThrow();
    expect(() => validateVendor({ category: "mechanic", name: "x", logo_url: "http://a.com/x.png" })).toThrow();
    expect(() => validateVendor({ category: "mechanic", name: "x", phone: "<script>" })).toThrow();
    expect(() => normalizeWebsite("javascript:alert(1)")).toThrow();
  });
  test("reorder", () => {
    expect(reorder(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(reorder(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
  test("initials and view", () => {
    expect(vendorInitials("Joe's Auto Body")).toBe("JS");
    expect(vendorInitials("AAA")).toBe("AA");
    expect(parseVendorView("list")).toBe("list");
    expect(parseVendorView("tiles")).toBeNull();
  });
});

describe("logo", () => {
  test("og:image first, then icons, then favicon", () => {
    expect(pickLogoFromHtml('<meta property="og:image" content="/og.png"><link rel="icon" href="/i.png">', "https://x.com/")).toBe("https://x.com/og.png");
    expect(pickLogoFromHtml('<link rel="apple-touch-icon" href="/a.png">', "https://x.com/")).toBe("https://x.com/a.png");
    expect(pickLogoFromHtml('<link rel="shortcut icon" href="i.ico">', "https://x.com/p/")).toBe("https://x.com/p/i.ico");
    expect(pickLogoFromHtml("<html></html>", "https://x.com/")).toBe("https://x.com/favicon.ico");
  });
  test("ssrf guard", () => {
    expect(isFetchableHost("localhost")).toBe(false);
    expect(isFetchableHost("169.254.169.254")).toBe(false);
    expect(isFetchableHost("db.internal")).toBe(false);
    expect(isFetchableHost("aaa.com")).toBe(true);
    expect(pickLogoFromHtml('<meta property="og:image" content="https://127.0.0.1/x.png">', "https://x.com/")).toBe("https://x.com/favicon.ico");
  });
});

describe("migration invariants", () => {
  const sql = readFileSync("supabase/migrations/20261104210000_renter_portal.sql", "utf8").replace(/--.*$/gm, "");
  test("additive only, no cron/net, no policy drops", () => {
    expect(sql).not.toMatch(/cron\.|net\.http|DROP POLICY|ALTER POLICY|DROP TABLE|cron_tokens/i);
    expect(sql).not.toMatch(/partner/i);
  });
  test("definer functions pin search_path and revoke anon", () => {
    const defs = sql.match(/SECURITY DEFINER[^$]*?\$\$/g) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(4);
    for (const d of defs) expect(d).toMatch(/search_path = ''/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.renter_portal_summary\(\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.renter_portal_file\(text, uuid\) FROM PUBLIC, anon/);
  });
  test("registration is the only vehicle document exposed", () => {
    expect(sql).not.toMatch(/category\s*=\s*'(title|purchase|finance)/);
    expect(sql).not.toMatch(/vehicle_media|vehicle-originals/);
  });
  test("RLS on new tables", () => {
    expect(sql).toMatch(/renter_vendors ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/renter_portal_prefs ENABLE ROW LEVEL SECURITY/);
  });
});

describe("server functions", () => {
  const src = readFileSync("src/lib/renter-portal.functions.ts", "utf8");
  test("renter reads use caller client and clamp", () => {
    expect(src).toMatch(/rpc\("renter_portal_summary"\)/);
    expect(src).toMatch(/clampSummary\(data\)/);
  });
  test("signing happens only after renter_portal_file authorizes", () => {
    const i = src.indexOf('rpc("renter_portal_file"');
    const j = src.indexOf("createSignedUrl");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });
  test("every admin fn requires staff", () => {
    const admins = src.split("export const admin").slice(1);
    expect(admins.length).toBe(5);
    for (const a of admins) expect(a).toMatch(/await staff\(context\.userId\)/);
  });
  test("no toll or ticket disputes", () => {
    expect(src + readFileSync("src/components/portal/RenterPortalCard.tsx", "utf8")).not.toMatch(/dispute/i);
  });
});
