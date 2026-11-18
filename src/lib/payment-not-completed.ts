/**
 * Payment Not Completed page (/reservation-fee?status=canceled&session_id=cs_…).
 * Client-safe types and pure helpers. The server half is
 * payment-not-completed.server.ts; the page is
 * src/components/reservation/PaymentNotCompletedPage.tsx.
 *
 * The Checkout Session id in the cancel return URL is the only key. It works
 * like a bearer token, so the lookup returns ONLY what this page shows: the
 * signed car (name and published photos), the city, how many cars are
 * available there, how many pickup slots are open this week, and when the
 * checkout link expires. No name, email, phone, address or record ids.
 */
import { resolvePhotoUrl } from "@/lib/photoUrl";
import { PICKUP_TIMEZONE, zoneDate } from "@/lib/pickup-schedule";
import {
  COMPANY_EMAIL,
  COMPANY_PHONE_DISPLAY,
  COMPANY_PHONE_E164,
  vehicleLabel,
  type PaymentReceivedRental,
} from "@/lib/payment-received";
import { RESERVATION_FEE_DEFAULT_AMOUNT } from "@/lib/reservation-fee";

export { COMPANY_EMAIL, COMPANY_PHONE_DISPLAY, COMPANY_PHONE_E164, vehicleLabel };
export { RESERVATION_FEE_DEFAULT_AMOUNT };

export const PICKUP_ADDRESS = "3500 E Hillsborough Ave, Tampa, FL 33610";

export type PaymentNotCompletedVehicle = {
  label: string;
  photos: string[];
  bodyType: string | null;
};

/**
 *  alreadyPaid     the $50 is already paid; the page redirects to Payment Received
 *  ok + alreadyPaid false
 *                  show the conversion page; live counts may still be hidden
 *  ok: false       the session could not be used; the page still renders with
 *                  policy copy and no invented numbers
 */
export type PaymentNotCompletedView =
  | {
      ok: true;
      alreadyPaid: false;
      processing: boolean;
      amount: number;
      vehicle: PaymentNotCompletedVehicle | null;
      city: string | null;
      availableCars: number | null;
      openSlotsThisWeek: number | null;
      linkExpiresAt: string | null;
      checkoutUrl: string | null;
    }
  | { ok: true; alreadyPaid: true; sessionId: string | null }
  | { ok: false; reason: "invalid" | "not_found" | "not_reservation_fee" | "unavailable" };

export type RestartCheckoutResult =
  | { ok: true; alreadyPaid: false; url: string }
  | { ok: true; alreadyPaid: true; sessionId: string | null }
  | { ok: false; message: string };

/** Policy fallback when the session cannot be resolved. Never invents inventory. */
export const EMPTY_PNC_VIEW: Extract<PaymentNotCompletedView, { ok: true; alreadyPaid: false }> = {
  ok: true,
  alreadyPaid: false,
  processing: false,
  amount: RESERVATION_FEE_DEFAULT_AMOUNT,
  vehicle: null,
  city: null,
  availableCars: null,
  openSlotsThisWeek: null,
  linkExpiresAt: null,
  checkoutUrl: null,
};

export function displayView(view: PaymentNotCompletedView | null | undefined): Extract<PaymentNotCompletedView, { ok: true; alreadyPaid: false }> {
  if (view && view.ok && view.alreadyPaid === false) return view;
  return EMPTY_PNC_VIEW;
}

/** Published listing photo URLs only (https, absolute, or the public photo route). */
export function publicPhotoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  const out: string[] = [];
  for (const item of photos) {
    if (typeof item !== "string" || !item.trim()) continue;
    const url = resolvePhotoUrl(item.trim());
    if (url && (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("/"))) out.push(url);
  }
  return out;
}

export function reserveLabel(amount: number): string {
  const n = Number.isFinite(amount) ? amount : RESERVATION_FEE_DEFAULT_AMOUNT;
  return Number.isInteger(n) ? `Reserve My Car For $${n}` : `Reserve My Car For $${n.toFixed(2)}`;
}

export function availableCarsLine(count: number, city: string): string {
  if (count === 0) return `No Cars Available In ${city}`;
  if (count === 1) return `Only 1 Car Available In ${city}`;
  return `Only ${count} Cars Available In ${city}`;
}

export function openSlotsThisWeekLine(count: number): string {
  if (count === 0) return "No Open Pickup Slots This Week";
  if (count === 1) return "1 Open Pickup Slot This Week";
  return `${count} Open Pickup Slots This Week`;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday–Friday of the Eastern week that contains `now`. */
export function currentWeekMonFri(now: Date, timeZone = PICKUP_TIMEZONE): { monday: string; friday: string } {
  const { date, weekday } = zoneDate(now, timeZone);
  const sinceMon = weekday === 0 ? 6 : weekday - 1;
  const monday = addDays(date, -sinceMon);
  return { monday, friday: addDays(monday, 4) };
}

export function countOpenSlotsThisWeek(slots: ReadonlyArray<{ date: string }>, now: Date, timeZone = PICKUP_TIMEZONE): number {
  const { monday, friday } = currentWeekMonFri(now, timeZone);
  return slots.filter((s) => s.date >= monday && s.date <= friday).length;
}

/**
 * Real time remaining when `expiresAt` is a usable timestamp; otherwise the
 * standing 23-hour policy line.
 */
export function linkExpiryLabel(expiresAt: string | null | undefined, now: Date = new Date()): string {
  const POLICY = "Your Link Is Good For 23 Hours";
  if (!expiresAt) return POLICY;
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return POLICY;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 22) return POLICY;
  const hourPart = hours >= 1 ? `${hours} Hour${hours === 1 ? "" : "s"}` : "";
  const minutePart = minutes >= 1 ? `${minutes} Minute${minutes === 1 ? "" : "s"}` : "";
  const span = [hourPart, minutePart].filter(Boolean).join(" ");
  if (!span) return "Your Link Expires Shortly";
  return `Your Link Is Good For ${span}`;
}

/** Sticky Reserve bar: show only after the hero CTA is off-screen and before the bottom CTA comes into view. */
export function stickyReserveVisible(heroCtaInView: boolean, finalCtaInView: boolean): boolean {
  return !heroCtaInView && !finalCtaInView;
}

export function paidReturnPath(sessionId: string | null): string {
  return sessionId ? `/reservation-fee?status=paid&session_id=${encodeURIComponent(sessionId)}` : "/reservation-fee?status=paid";
}

export function fromRentalVehicle(
  vehicle: PaymentReceivedRental["vehicle"],
  photos: string[],
  bodyType: string | null,
): PaymentNotCompletedVehicle | null {
  const label = vehicleLabel(vehicle);
  if (!label) return null;
  return { label, photos, bodyType };
}
