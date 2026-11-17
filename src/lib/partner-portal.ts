/**
 * Partner Portal v2 — client-safe rules (Dolmar, Nov 17 2026).
 *
 * A partner owns the car, not the operation. Everything a partner can see is
 * built by the whitelists in this file, so a column added to vehicles,
 * rentals, payments or vehicle_expenses never reaches the portal by accident:
 *
 *   - Vehicles: year/make/model/trim/color/VIN/plate, our listing status, and
 *     the first published listing photo. No GPS, keys, toll, insurance, or
 *     financing fields.
 *   - Rentals: only that the car is rented, and the start/end DATES. Never a
 *     renter name, contact, vetting result, agreement, or document.
 *   - Expenses: date, a category label and amount. Insurance premiums are shown
 *     as "Program Coverage" with no vendor, description, reference, notes or
 *     receipt, so a carrier or broker name can never appear.
 *   - Payouts: period, amounts, paid date and the receipt we attach.
 *
 * Sending, storage and SQL live in partner-portal.functions.ts,
 * partner-intake.functions.ts, partner-admin.functions.ts and
 * partner-notices.server.ts.
 */

/** Back Office -> Automations switch. Default OFF (catalogued with defaultOn: false). */
export const PARTNER_RENTAL_NOTICE_KEY = "partner_rental_notice";
/** Back Office -> Automations switch for the staff alert on a new /partners submission. Default OFF. */
export const PARTNER_SUBMISSION_ALERT_KEY = "partner_submission_alert";
/**
 * Stripe Connect (bank details for payouts) is a compile-time gate. Connect
 * has to be enabled on the Stripe account first (a Stripe settings change that
 * needs Dolmar). While false, the Bank & Payouts tab explains payouts are
 * being set up and no Stripe call is made.
 */
export const PARTNER_STRIPE_CONNECT_ENABLED = false;

export const PARTNER_DOCS_BUCKET = "partner-documents";
export const PARTNER_PHOTOS_BUCKET = "owner-vehicle-photos";

export const MAX_INTAKE_PHOTOS = 12;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_DOC_BYTES = 25 * 1024 * 1024;
export const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const DOC_MIME = [...PHOTO_MIME, "application/pdf"] as const;

export type IntakeFileKind = "photo" | "registration" | "id_document";

export type IntakeFileMeta = { kind: IntakeFileKind; name: string; type: string; size: number };

/** Returns a human error for a file the server would refuse, or null. */
export function intakeFileProblem(f: IntakeFileMeta): string | null {
  const type = (f.type || "").toLowerCase();
  if (f.kind === "photo") {
    if (!(PHOTO_MIME as readonly string[]).includes(type)) return `${f.name}: photos must be JPG, PNG, WEBP or HEIC.`;
    if (f.size > MAX_PHOTO_BYTES) return `${f.name}: photos must be 25 MB or smaller.`;
  } else {
    if (!(DOC_MIME as readonly string[]).includes(type)) return `${f.name}: upload a photo or PDF.`;
    if (f.size > MAX_DOC_BYTES) return `${f.name}: files must be 25 MB or smaller.`;
  }
  if (f.size <= 0) return `${f.name}: the file is empty.`;
  return null;
}

export function safeExt(name: string, type: string): string {
  const fromName = (name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  if (fromName && fromName !== name.toLowerCase()) return fromName;
  if (type === "application/pdf") return "pdf";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic" || type === "image/heif") return "heic";
  return "jpg";
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Storage path for an intake file. Photos keep the existing bucket layout. */
export function intakePath(submissionId: string, kind: IntakeFileKind, fileId: string, ext: string): { bucket: string; path: string } {
  if (kind === "photo") return { bucket: PARTNER_PHOTOS_BUCKET, path: `${submissionId}/${fileId}.${ext}` };
  return { bucket: PARTNER_DOCS_BUCKET, path: `intake/${submissionId}/${kind}-${fileId}.${ext}` };
}

/** True only for a path this submission's signed upload could have produced. */
export function isIntakePathFor(submissionId: string, kind: IntakeFileKind, path: string): boolean {
  if (!new RegExp(`^${UUID}$`).test(submissionId)) return false;
  const esc = submissionId.replace(/-/g, "\\-");
  const re = kind === "photo"
    ? new RegExp(`^${esc}/${UUID}\\.[a-z0-9]{1,5}$`)
    : new RegExp(`^intake/${esc}/${kind}-${UUID}\\.[a-z0-9]{1,5}$`);
  return re.test(path);
}

export function payoutReceiptPath(partnerId: string, payoutId: string, fileId: string, ext: string): string {
  return `${partnerId}/payouts/${payoutId}-${fileId}.${ext}`;
}

export function isPayoutReceiptPathFor(partnerId: string, path: string): boolean {
  const esc = partnerId.replace(/-/g, "\\-");
  return new RegExp(`^${esc}/payouts/${UUID}-${UUID}\\.[a-z0-9]{1,5}$`).test(path);
}

// ------------------------------------------------------------ portal views

export type PartnerVehicleStatus = "rented" | "listed" | "preparing" | "in_service" | "inactive";

export const PARTNER_STATUS_LABELS: Record<PartnerVehicleStatus, string> = {
  rented: "Rented",
  listed: "Listed — Awaiting Renter",
  preparing: "Getting Ready To List",
  in_service: "In Service",
  inactive: "Not In Program",
};

export function partnerVehicleStatus(status: string | null | undefined, hasActiveRental: boolean): PartnerVehicleStatus {
  if (hasActiveRental) return "rented";
  const s = String(status ?? "").toLowerCase();
  if (s === "rented") return "rented";
  if (s === "available" || s === "reserved") return "listed";
  if (s === "maintenance") return "in_service";
  if (s === "archived" || s === "sold" || s === "retired") return "inactive";
  return "preparing";
}

export type PartnerRentalPeriod = { start: string | null; end: string | null; active: boolean };

export type PartnerPortalVehicle = {
  id: string;
  label: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  color: string | null;
  vin: string | null;
  plate: string | null;
  status: PartnerVehicleStatus;
  statusLabel: string;
  weeklyRate: number | null;
  photoPath: string | null;
  rentals: PartnerRentalPeriod[];
};

/** Only these vehicle columns are read for a partner. Exported for the source-scan test. */
export const PARTNER_VEHICLE_COLUMNS = "id,year,make,model,trim,color,vin,license_plate,status,weekly_rate,photos" as const;
/** Only these rental columns are read for a partner: dates and state, never the renter. */
export const PARTNER_RENTAL_COLUMNS = "id,vehicle_id,start_date,end_date,status" as const;

export function vehicleLabel(v: { year?: number | null; make?: string | null; model?: string | null; trim?: string | null }): string {
  return [v.year, v.make, v.model, v.trim].filter((x) => x !== null && x !== undefined && String(x).trim() !== "").join(" ") || "Vehicle";
}

export function toPartnerVehicle(
  v: Record<string, unknown>,
  rentals: Array<Record<string, unknown>>,
): PartnerPortalVehicle {
  const periods: PartnerRentalPeriod[] = rentals
    .filter((r) => r.vehicle_id === v.id)
    .map((r) => ({
      start: typeof r.start_date === "string" ? r.start_date.slice(0, 10) : null,
      end: typeof r.end_date === "string" ? r.end_date.slice(0, 10) : null,
      active: String(r.status ?? "").toLowerCase() === "active",
    }))
    .sort((a, b) => String(b.start ?? "").localeCompare(String(a.start ?? "")));
  const status = partnerVehicleStatus(v.status as string, periods.some((p) => p.active));
  const photos = Array.isArray(v.photos) ? (v.photos as unknown[]).filter((p): p is string => typeof p === "string") : [];
  return {
    id: String(v.id),
    label: vehicleLabel(v as any),
    year: (v.year as number) ?? null,
    make: (v.make as string) ?? null,
    model: (v.model as string) ?? null,
    trim: (v.trim as string) ?? null,
    color: (v.color as string) ?? null,
    vin: (v.vin as string) ?? null,
    plate: (v.license_plate as string) ?? null,
    status,
    statusLabel: PARTNER_STATUS_LABELS[status],
    weeklyRate: v.weekly_rate === null || v.weekly_rate === undefined ? null : Number(v.weekly_rate),
    photoPath: photos[0] ?? null,
    rentals: periods.slice(0, 24),
  };
}

export type PartnerExpenseView = { id: string; vehicleId: string; date: string; category: string; label: string; amount: number };

const EXPENSE_LABELS: Record<string, string> = {
  registration: "Registration",
  insurance: "Program Coverage",
  maintenance: "Maintenance",
  repair: "Repair",
  tires: "Tires",
  fuel: "Fuel",
  cleaning: "Cleaning",
  towing: "Towing",
  parking: "Parking / Storage",
  tolls: "Tolls",
  gps: "GPS Tracking",
  other: "Other",
};

/** Categories that are the company's own costs and never charged against a partner. */
export const NON_PARTNER_EXPENSE_CATEGORIES = new Set(["finance", "purchase"]);

/**
 * A partner sees date, category label and amount. Vendor, description,
 * reference, notes, payment method and receipt are dropped for every row, so
 * an insurance carrier or broker name cannot leak through free text.
 */
export function toPartnerExpense(e: Record<string, unknown>): PartnerExpenseView | null {
  const category = String(e.category ?? "other").toLowerCase();
  if (NON_PARTNER_EXPENSE_CATEGORIES.has(category)) return null;
  const amount = Number(e.amount ?? 0);
  if (!Number.isFinite(amount)) return null;
  return {
    id: String(e.id),
    vehicleId: String(e.vehicle_id ?? ""),
    date: String(e.incurred_on ?? "").slice(0, 10),
    category,
    label: EXPENSE_LABELS[category] ?? "Other",
    amount: round2(amount),
  };
}

export const PARTNER_EXPENSE_COLUMNS = "id,vehicle_id,category,amount,incurred_on" as const;
export const PARTNER_PAYMENT_COLUMNS = "vehicle_id,net_collected,type,paid_date,status" as const;

export type PartnerMonth = {
  month: string; // YYYY-MM (Eastern)
  grossRent: number;
  partnerShare: number;
  expenses: number;
  partnerExpenseShare: number;
  net: number;
};

/**
 * Month-by-month earnings. Revenue is rent net_collected on paid/refunded
 * rows (refunds are already netted by apply_payment_refund). Expenses are
 * split by the same percentage as revenue unless the agreement says otherwise
 * (staff can override per payout); this view is an estimate and the payout
 * receipt is the record.
 */
export function partnerMonths(
  payments: Array<{ net_collected?: unknown; paid_date?: unknown; type?: unknown; status?: unknown }>,
  expenses: PartnerExpenseView[],
  splitPct: number,
  months = 6,
  now = new Date(),
): PartnerMonth[] {
  const pct = Number.isFinite(splitPct) && splitPct > 0 && splitPct < 100 ? splitPct / 100 : 0.5;
  const keys: string[] = [];
  const nowEt = etYearMonth(now);
  let [y, m] = nowEt.split("-").map(Number);
  for (let i = 0; i < months; i++) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  const gross = new Map<string, number>();
  for (const p of payments) {
    if (String(p.type ?? "") !== "rent") continue;
    if (!["paid", "refunded"].includes(String(p.status ?? ""))) continue;
    const k = String(p.paid_date ?? "").slice(0, 7);
    gross.set(k, (gross.get(k) ?? 0) + Number(p.net_collected ?? 0));
  }
  const exp = new Map<string, number>();
  for (const e of expenses) {
    const k = e.date.slice(0, 7);
    exp.set(k, (exp.get(k) ?? 0) + e.amount);
  }
  return keys.map((k) => {
    const g = round2(gross.get(k) ?? 0);
    const share = round2(g * pct);
    const ex = round2(exp.get(k) ?? 0);
    const exShare = round2(ex * pct);
    return { month: k, grossRent: g, partnerShare: share, expenses: ex, partnerExpenseShare: exShare, net: round2(share - exShare) };
  });
}

export function etYearMonth(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------ notices

/** 8 AM to 9 PM America/New_York, the bot texting window. */
export function withinPartnerTextingHours(now: Date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 8 && hour < 21;
}

export function formatEtDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "today";
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "today";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(d);
}

export type PartnerRentalNoticeInput = { firstName: string; vehicleLabel: string; startDate: string | null; portalUrl: string };

/**
 * "Your car is rented." Deliberately says nothing about who rented it, the
 * agreement, or insurance. Kept short so the text is a single SMS segment-ish.
 */
export function partnerRentalNotice(i: PartnerRentalNoticeInput): { subject: string; html: string; sms: string } {
  const name = escapeHtml(i.firstName || "there");
  const car = escapeHtml(i.vehicleLabel);
  const when = formatEtDate(i.startDate);
  const subject = `Your ${i.vehicleLabel} is rented`;
  const html = `<p>Hi ${name},</p><p>Good news: your <strong>${car}</strong> went out on rent ${escapeHtml(when === "today" ? "today" : `on ${when}`)}.</p><p>You can see its status, earnings and payouts any time in your partner portal:<br/><a href="${i.portalUrl}">${i.portalUrl}</a></p><p>— Real Rentals</p>`;
  const sms = `Real Rentals: your ${i.vehicleLabel} went out on rent ${when === "today" ? "today" : `on ${when}`}. Status & earnings: ${i.portalUrl} Reply STOP to opt out.`;
  return { subject, html, sms };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const PARTNER_PORTAL_URL = "https://drivereal.com/partner";

/** Which portal sections a partner may open. Payments and bank unlock on activation. */
export function partnerSections(status: string | null | undefined): { vehicles: true; addVehicle: true; profile: true; earnings: boolean; payouts: boolean; bank: boolean } {
  const active = String(status ?? "").toLowerCase() === "active";
  return { vehicles: true, addVehicle: true, profile: true, earnings: active, payouts: active, bank: active };
}

export type SubmissionStatusView = "under_review" | "approved" | "declined";
export function submissionStatusView(status: string | null | undefined): SubmissionStatusView {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved" || s === "enrolled") return "approved";
  if (s === "declined" || s === "rejected") return "declined";
  return "under_review";
}
