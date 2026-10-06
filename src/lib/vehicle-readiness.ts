// Four separate ideas about a vehicle. Never merge them.
//
//  1. Status          — where the car is operationally (vehicles.status).
//                       Only a human changes it; becoming ready never flips it.
//  2. Rental Ready    — the MINIMUM to assign and establish a rental:
//                       year, make, model, valid VIN, weekly rate > 0.
//                       Enforced server-side by public.vehicle_rental_ready_missing
//                       (status trigger + activate_rental_tx). No photo needed.
//  3. Listing Ready   — Rental Ready + at least one explicitly published listing
//                       photo (public.vehicle_listing_ready_missing). Photos are
//                       never auto-published.
//  4. Fleet Profile   — non-blocking completeness for management/compliance.
//                       NEVER used as a rental or availability gate.
// This file mirrors the DB rules for display only.
import { checkVin } from "@/lib/vin";
import { presentSlots } from "@/lib/vehicle-doc-presence";

export const ONBOARDING_STATUS = "onboarding";

export type ReadyItem = { key: string; label: string; done: boolean };

type V = Record<string, any>;

/** $0 is not "unknown" — but free rentals are not supported, so it does not satisfy the gate. */
export function hasValidRate(rate: unknown): boolean {
  if (rate === null || rate === undefined || rate === "") return false;
  const n = Number(rate);
  return Number.isFinite(n) && n > 0;
}

export function rentalReadyItems(v: V): ReadyItem[] {
  const vin = String(v.vin ?? "").trim();
  return [
    { key: "identity", label: "Year, make and model", done: !!v.year && !!String(v.make ?? "").trim() && !!String(v.model ?? "").trim() },
    { key: "vin", label: "Valid VIN", done: !!vin && checkVin(vin).formatValid },
    { key: "weekly_rate", label: "Weekly rate", done: hasValidRate(v.weekly_rate) },
  ];
}

export function isRentalReady(v: V): boolean {
  return rentalReadyItems(v).every((i) => i.done);
}

export function listingReadyItems(v: V, publishedPhotoCount: number): ReadyItem[] {
  return [
    { key: "rental_ready", label: "Rental Ready", done: isRentalReady(v) },
    { key: "listing_photo", label: "Published listing photo", done: publishedPhotoCount > 0 },
  ];
}

export function profileItems(
  v: V,
  ctx: { docKinds: string[]; maintenanceCount: number; hasFinance?: boolean; photoCount?: number; inspectionCount?: number },
): ReadyItem[] {
  const slots = presentSlots(ctx.docKinds);
  return [
    { key: "mileage", label: "Current mileage", done: v.current_odometer != null },
    { key: "color", label: "Color", done: !!v.color },
    { key: "plate", label: "License plate", done: !!v.license_plate },
    { key: "registration", label: "Registration", done: slots.has("registration") || !!v.registration_expires_on },
    { key: "title", label: "Title", done: slots.has("title") || !!v.title_number },
    { key: "insurance", label: "Insurance evidence", done: slots.has("insurance_card") || !!v.insurance_carrier },
    { key: "gps", label: "GPS / tracker", done: !!v.gps_status && v.gps_status !== "not_installed" },
    { key: "maintenance", label: "Maintenance history", done: ctx.maintenanceCount > 0 },
    ...(ctx.inspectionCount === undefined ? [] : [{ key: "inspection", label: "Inspection history", done: ctx.inspectionCount > 0 }]),
    ...(ctx.photoCount === undefined ? [] : [{ key: "photos", label: "Photos", done: ctx.photoCount > 0 }]),
    ...(ctx.hasFinance === undefined ? [] : [{ key: "purchase", label: "Purchase information", done: !!ctx.hasFinance }]),
  ];
}

export function percent(items: ReadyItem[]) {
  return items.length ? Math.round((items.filter((i) => i.done).length / items.length) * 100) : 0;
}

const LABELS: Record<string, string> = { year: "year", make: "make", model: "model", vin: "a valid VIN", weekly_rate: "a weekly rate above $0", photo: "at least one photo" };

/** Turns the database's "vehicle_not_rental_ready:weekly_rate,vin" into a sentence. */
export function notReadyMessage(dbMessage: string): string | null {
  const m = /vehicle_not_rental_ready:([a-z_,]+)/.exec(dbMessage);
  if (!m) return null;
  const parts = m[1].split(",").filter(Boolean).map((k) => LABELS[k] ?? k);
  return `Not rental ready yet — add ${parts.join(" and ")} first.`;
}
