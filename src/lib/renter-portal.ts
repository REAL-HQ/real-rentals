/**
 * Renter portal (PR D). Pure rules shared by the server functions, the
 * portal card and the admin vendor list. Visibility itself is enforced in
 * Postgres (public.renter_portal_summary / renter_portal_file, migration
 * 20261104210000_renter_portal.sql); this module only mirrors it for the UI
 * and the tests.
 */

/** Portal card on/off. Shipping on; going live still needs a Publish. */
export const RENTER_PORTAL_ENABLED: boolean = true;

/**
 * Company-provided insurance card slot. OFF: renters supply their own
 * insurance for now. Nothing reads company insurance while this is false.
 */
export const COMPANY_INSURANCE_SLOT_ENABLED: boolean = false;

/** Photos and receipts stay visible to the renter this long after return. */
export const RENTER_RECORDS_RETENTION_DAYS = 365;

export type RenterStage = "none" | "assigned" | "active" | "returned";

const RETURNED = new Set(["returned", "completed", "ended", "closed"]);
const CANCELLED = new Set(["cancelled", "canceled"]);

/** Same rule as private.renter_portal_stage. `today` is a YYYY-MM-DD New York day. */
export function renterStage(status: string | null | undefined, endDate: string | null | undefined, today: string): RenterStage {
  const s = (status ?? "").trim().toLowerCase();
  if (CANCELLED.has(s)) return "none";
  if (RETURNED.has(s)) return "returned";
  if (s === "active") return "active";
  if (endDate && endDate < today) return "returned";
  return "assigned";
}

/** Returned renters keep photos/receipts through returnedOn + 1 year (inclusive). */
export function recordsVisible(stage: RenterStage, returnedOn: string | null, today: string): boolean {
  if (stage === "active") return true;
  if (stage !== "returned" || !returnedOn) return false;
  // SQL uses date + interval '1 year'; 365/366 days. Match calendar year.
  const [y, m, d] = returnedOn.split("-").map(Number);
  const limit = new Date(Date.UTC(y + 1, m - 1, d, 12)).toISOString().slice(0, 10);
  return today <= limit;
}

export type RenterSection = "plate" | "vin" | "registration" | "insurance" | "photos" | "receipts" | "companyInsurance";

/** Which sections the portal renders for a stage. */
export function renterSections(stage: RenterStage, opts: { recordsVisible: boolean; companyInsurance?: boolean }): RenterSection[] {
  if (stage === "assigned") return ["plate", "vin"];
  if (stage === "active") {
    const out: RenterSection[] = ["plate", "vin", "registration", "insurance", "photos", "receipts"];
    if ((opts.companyInsurance ?? COMPANY_INSURANCE_SLOT_ENABLED) === true) out.push("companyInsurance");
    return out;
  }
  if (stage === "returned" && opts.recordsVisible) return ["photos", "receipts"];
  return [];
}

export type InsuranceDoc = {
  id: string;
  label: string;
  expiresOn: string | null;
  reviewStatus: "uploaded" | "verified" | "rejected" | string;
  isCurrent: boolean;
  uploadedAt: string | null;
};

/**
 * Old verified document stays valid until the team reviews the new upload.
 * Shown: the newest verified file as "on file", plus the newest current
 * upload as "under review" when it is newer and not yet verified.
 */
export function insuranceOnFile(docs: InsuranceDoc[]): { verified: InsuranceDoc | null; pending: InsuranceDoc | null } {
  const byNewest = [...docs].sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
  const verified = byNewest.find((d) => d.reviewStatus === "verified") ?? null;
  const pending =
    byNewest.find(
      (d) => d.isCurrent && d.reviewStatus === "uploaded" && (!verified || (d.uploadedAt ?? "") > (verified.uploadedAt ?? "")),
    ) ?? null;
  return { verified, pending };
}

export type RenterPortalSummary = {
  stage: RenterStage;
  rentalId?: string;
  plate?: string | null;
  plateState?: string | null;
  vin?: string | null;
  returnedOn?: string | null;
  registration?: {
    state: string | null;
    number: string | null;
    expiresOn: string | null;
    files: { id: string; label: string; expiresOn: string | null }[];
  };
  insurance?: InsuranceDoc[];
  photos?: {
    id: string;
    phase: string | null;
    angle: string | null;
    mediaType: string | null;
    capturedByRole: string | null;
    takenAt: string;
    takenAtSource?: string | null;
  }[];
  receipts?: { id: string; type: string | null; amount: number; paidDate: string | null; method: string | null }[];
};

const ALLOWED_KEYS: Record<RenterStage, string[]> = {
  none: ["stage"],
  assigned: ["stage", "rentalId", "plate", "plateState", "vin", "returnedOn"],
  active: ["stage", "rentalId", "plate", "plateState", "vin", "returnedOn", "registration", "insurance", "photos", "receipts"],
  returned: ["stage", "rentalId", "plate", "plateState", "vin", "returnedOn", "photos", "receipts"],
};

/** Defence in depth on the server: drop any key the stage does not allow. */
export function clampSummary(raw: unknown): RenterPortalSummary {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const stage = (["assigned", "active", "returned"] as const).includes(obj.stage as never) ? (obj.stage as RenterStage) : "none";
  const out: Record<string, unknown> = {};
  for (const k of ALLOWED_KEYS[stage]) if (k in obj) out[k] = obj[k];
  out.stage = stage;
  if (stage === "returned") {
    out.plate = null;
    out.plateState = null;
    out.vin = null;
  }
  return out as RenterPortalSummary;
}

export function last6(vin: string | null | undefined): string | null {
  const v = (vin ?? "").trim();
  return v ? v.slice(-6) : null;
}

// ---------------------------------------------------------------- vendors

export const VENDOR_CATEGORIES = [
  { value: "roadside", label: "Roadside Assistance" },
  { value: "locksmith", label: "Locksmith (Lockouts)" },
  { value: "towing", label: "Towing" },
  { value: "mechanic", label: "Mechanic" },
  { value: "tire_shop", label: "Tire Shop" },
  { value: "car_wash", label: "Car Wash" },
  { value: "oil_change", label: "Oil Change" },
  { value: "body_shop", label: "Body Shop" },
  { value: "glass", label: "Auto Glass" },
  { value: "other", label: "Other" },
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number]["value"];

export function vendorCategoryLabel(c: string): string {
  return VENDOR_CATEGORIES.find((x) => x.value === c)?.label ?? "Other";
}

export type RenterVendor = {
  id: string;
  category: VendorCategory;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  notes: string | null;
  logo_url: string | null;
  sort_order: number;
  is_active: boolean;
};

export type VendorInput = Omit<RenterVendor, "id" | "sort_order" | "is_active"> & {
  id?: string;
  sort_order?: number;
  is_active?: boolean;
};

const clean = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) throw new Error(`Too long (max ${max})`);
  return s;
};

export function normalizeWebsite(v: unknown): string | null {
  const s = clean(v, 300);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error("Website is not a valid address");
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new Error("Website is not a valid address");
  return u.toString();
}

export function validateVendor(input: unknown): VendorInput {
  const o = (input ?? {}) as Record<string, unknown>;
  const category = String(o.category ?? "") as VendorCategory;
  if (!VENDOR_CATEGORIES.some((c) => c.value === category)) throw new Error("Pick a category");
  const name = clean(o.name, 120);
  if (!name) throw new Error("Name is required");
  const phone = clean(o.phone, 40);
  if (phone && !/^[0-9+().\-\s x]+$/i.test(phone)) throw new Error("Phone has invalid characters");
  const logo = clean(o.logo_url, 500);
  if (logo && !/^https:\/\//i.test(logo)) throw new Error("Logo must be an https link");
  const id = o.id == null || o.id === "" ? undefined : String(o.id);
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid vendor");
  return {
    id,
    category,
    name,
    phone,
    website: normalizeWebsite(o.website),
    address: clean(o.address, 300),
    notes: clean(o.notes, 1000),
    logo_url: logo,
    sort_order: o.sort_order == null ? undefined : Math.max(0, Math.trunc(Number(o.sort_order) || 0)),
    is_active: o.is_active == null ? undefined : Boolean(o.is_active),
  };
}

/** Move one vendor up/down; returns ids in their new order. */
export function reorder(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function vendorInitials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

export type VendorView = "grid" | "list";
export const VENDOR_VIEW_STORAGE_KEY = "rr.renterVendorView";
export function parseVendorView(v: unknown): VendorView | null {
  return v === "grid" || v === "list" ? v : null;
}

// ---------------------------------------------------------------- logos

/** Hostnames we refuse to fetch from (SSRF guard). */
export function isFetchableHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  return true;
}

/**
 * Best logo candidate from a business homepage's HTML: og:image, then
 * apple-touch-icon, then rel=icon, then /favicon.ico. Only https results.
 */
export function pickLogoFromHtml(html: string, pageUrl: string): string | null {
  const base = new URL(pageUrl);
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1] ?? null;
  const tags = html.match(/<(meta|link)\b[^>]*>/gi) ?? [];
  const find = (pred: (t: string) => boolean, key: string) => {
    for (const t of tags) if (pred(t)) {
      const v = attr(t, key);
      if (v) return v;
    }
    return null;
  };
  const candidates = [
    find((t) => /property\s*=\s*["']og:image["']/i.test(t), "content"),
    find((t) => /rel\s*=\s*["'][^"']*apple-touch-icon[^"']*["']/i.test(t), "href"),
    find((t) => /rel\s*=\s*["'](?:shortcut )?icon["']/i.test(t), "href"),
    "/favicon.ico",
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const u = new URL(c.replace(/&amp;/g, "&"), base);
      if (u.protocol === "http:" && u.hostname === base.hostname) u.protocol = "https:";
      if (u.protocol === "https:" && isFetchableHost(u.hostname)) return u.toString();
    } catch {
      /* next */
    }
  }
  return null;
}
