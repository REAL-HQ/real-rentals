// Three separate ideas about a vehicle. Never merge them.
//
//  1. Status          — where the car is operationally (vehicles.status).
//  2. Rental Ready    — the MINIMUM to price, identify and present a car:
//                       year, make, model, valid VIN, weekly rate, one photo.
//                       Enforced server-side by public.vehicle_rental_ready_missing
//                       (status trigger + activate_rental_tx). This file mirrors it
//                       for display only.
//  3. Fleet Profile   — non-blocking completeness for management/ROI/compliance.
//                       NEVER used as a rental or availability gate.
import { checkVin } from "@/lib/vin";

export const ONBOARDING_STATUS = "onboarding";

export type ReadyItem = { key: string; label: string; done: boolean };

type V = Record<string, any>;

export function rentalReadyItems(v: V, photoCount: number): ReadyItem[] {
  const vin = String(v.vin ?? "").trim();
  return [
    { key: "vin", label: "Valid VIN", done: !!vin && checkVin(vin).formatValid },
    { key: "identity", label: "Year, make and model", done: !!v.year && !!v.make && !!v.model },
    { key: "weekly_rate", label: "Weekly rate", done: v.weekly_rate !== null && v.weekly_rate !== undefined && v.weekly_rate !== "" },
    { key: "photo", label: "At least one photo", done: photoCount > 0 || (Array.isArray(v.photos) && v.photos.length > 0) },
  ];
}

export function profileItems(
  v: V,
  ctx: { docKinds: string[]; maintenanceCount: number; hasFinance?: boolean },
): ReadyItem[] {
  const kinds = new Set(ctx.docKinds);
  return [
    { key: "mileage", label: "Current mileage", done: v.current_odometer != null },
    { key: "color", label: "Color", done: !!v.color },
    { key: "plate", label: "License plate", done: !!v.license_plate },
    { key: "registration", label: "Registration", done: kinds.has("registration") || !!v.registration_expires_on },
    { key: "title", label: "Title", done: kinds.has("title") || !!v.title_number },
    { key: "insurance", label: "Insurance", done: kinds.has("insurance_card") || kinds.has("insurance_policy") || !!v.insurance_carrier },
    { key: "gps", label: "GPS / tracker", done: !!v.gps_status && v.gps_status !== "not_installed" },
    { key: "maintenance", label: "Maintenance history", done: ctx.maintenanceCount > 0 },
    ...(ctx.hasFinance === undefined ? [] : [{ key: "purchase", label: "Purchase information", done: !!ctx.hasFinance }]),
  ];
}

export function percent(items: ReadyItem[]) {
  return items.length ? Math.round((items.filter((i) => i.done).length / items.length) * 100) : 0;
}

const LABELS: Record<string, string> = { year: "year", make: "make", model: "model", vin: "a valid VIN", weekly_rate: "a weekly rate", photo: "at least one photo" };

/** Turns the database's "vehicle_not_rental_ready:weekly_rate,photo" into a sentence. */
export function notReadyMessage(dbMessage: string): string | null {
  const m = /vehicle_not_rental_ready:([a-z_,]+)/.exec(dbMessage);
  if (!m) return null;
  const parts = m[1].split(",").filter(Boolean).map((k) => LABELS[k] ?? k);
  return `Not rental ready yet — add ${parts.join(" and ")} first.`;
}
