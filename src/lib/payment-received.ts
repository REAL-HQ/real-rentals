/**
 * Payment Received page (/reservation-fee?status=paid&session_id=cs_...).
 * Client-safe types and pure helpers. The server half is
 * payment-received.server.ts; the page is
 * src/components/reservation/PaymentReceivedPage.tsx.
 *
 * The Checkout Session id in the return URL is the only key. It works like a
 * bearer token, so the lookup returns ONLY what this page shows: the payment
 * (amount, time, card brand and last 4, Stripe receipt link), the car (year,
 * make, model, color), the weekly rate, start date and market, and the pickup
 * booking state. No name, email, phone, address or record ids.
 */
import type { PickupSlot } from "@/lib/pickup-schedule";

/** Stripe Checkout Session ids: cs_test_… / cs_live_…, letters and digits only. */
export const CHECKOUT_SESSION_ID_RE = /^cs_(test|live)_[A-Za-z0-9]{10,250}$/;

export function isCheckoutSessionId(raw: unknown): raw is string {
  return typeof raw === "string" && CHECKOUT_SESSION_ID_RE.test(raw);
}

/** Only an https Stripe receipt link is ever shown. */
export function safeReceiptUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    if (!/(^|\.)stripe\.com$/i.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export type PaymentReceivedReceipt = {
  amount: number;
  paidAt: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  receiptUrl: string | null;
};

export type PaymentReceivedRental = {
  vehicle: { year: number | null; make: string | null; model: string | null; color: string | null } | null;
  weeklyRate: number | null;
  startDate: string | null;
  market: string | null;
};

export type BookedPickup = { date: string; time: string; label: string; location: string | null };

/**
 *  reserved      a Reserved booking already exists (show the booked time)
 *  pick          open slots to choose from
 *  no_vehicle    no car assigned yet: we call to schedule
 *  no_slots      no open slot in the window: we call to schedule
 *  unavailable   the car or applicant can't be booked online right now: we call
 */
export type PickupBookingState =
  | { state: "reserved"; pickup: BookedPickup }
  | { state: "pick"; slots: PickupSlot[]; location: string | null }
  | { state: "no_vehicle" }
  | { state: "no_slots" }
  | { state: "unavailable" };

export type PaymentReceivedView =
  | { ok: true; receipt: PaymentReceivedReceipt; rental: PaymentReceivedRental; booking: PickupBookingState }
  | { ok: false; reason: "invalid" | "not_found" | "unpaid" | "not_reservation_fee" | "unavailable" };

export type BookPickupResult =
  | { ok: true; already: boolean; pickup: BookedPickup }
  | { ok: false; code: "invalid_session" | "slot_taken" | "no_vehicle" | "no_slots" | "unavailable" | "bad_slot" | "failed"; message: string; slots?: PickupSlot[] };

const BRANDS: Record<string, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover",
  diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay", link: "Link",
};
export function cardBrandLabel(brand: string | null | undefined): string {
  const b = String(brand ?? "").toLowerCase();
  return BRANDS[b] ?? (b ? b.charAt(0).toUpperCase() + b.slice(1) : "Card");
}

export function vehicleLabel(v: PaymentReceivedRental["vehicle"]): string | null {
  if (!v) return null;
  const name = [v.year, v.make, v.model].filter((x) => x !== null && x !== undefined && String(x).trim() !== "").join(" ").trim();
  if (!name) return null;
  return v.color ? `${name} (${titleWord(v.color)})` : name;
}

function titleWord(s: string): string {
  return s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** "Nov 17, 2026" in Eastern time. */
export function fmtPaidDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
}

/** YYYY-MM-DD calendar day → "Fri, Nov 20". */
export function fmtDay(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "09:30" → "9:30 AM". */
export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Slots grouped by day, earliest first, for the picker. */
export function slotsByDay(slots: PickupSlot[]): { date: string; label: string; slots: PickupSlot[] }[] {
  const out: { date: string; label: string; slots: PickupSlot[] }[] = [];
  for (const s of slots) {
    let g = out.find((x) => x.date === s.date);
    if (!g) { g = { date: s.date, label: fmtDay(s.date) ?? s.date, slots: [] }; out.push(g); }
    g.slots.push(s);
  }
  return out;
}

export const COMPANY_PHONE_E164 = "+18888338280";
export const COMPANY_PHONE_DISPLAY = "(888) 833-8280";
export const COMPANY_EMAIL = "team@drivereal.com";
