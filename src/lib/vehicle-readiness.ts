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
    { key: "identity", label: "Year, Make and Model", done: !!v.year && !!String(v.make ?? "").trim() && !!String(v.model ?? "").trim() },
    { key: "vin", label: "Valid VIN", done: !!vin && checkVin(vin).formatValid },
    { key: "weekly_rate", label: "Weekly Rate", done: hasValidRate(v.weekly_rate) },
  ];
}

export function isRentalReady(v: V): boolean {
  return rentalReadyItems(v).every((i) => i.done);
}

export function listingReadyItems(v: V, publishedPhotoCount: number): ReadyItem[] {
  return [
    { key: "rental_ready", label: "Rental Ready", done: isRentalReady(v) },
    { key: "listing_photo", label: "Published Listing Photo", done: publishedPhotoCount > 0 },
  ];
}

export function profileItems(
  v: V,
  ctx: { docKinds: string[]; maintenanceCount: number; hasFinance?: boolean; photoCount?: number; inspectionCount?: number },
): ReadyItem[] {
  const slots = presentSlots(ctx.docKinds);
  return [
    { key: "mileage", label: "Current Mileage", done: v.current_odometer != null },
    { key: "color", label: "Color", done: !!v.color },
    { key: "plate", label: "License Plate", done: !!v.license_plate },
    { key: "registration", label: "Registration", done: slots.has("registration") || !!v.registration_expires_on },
    { key: "title", label: "Title", done: slots.has("title") || !!v.title_number },
    { key: "insurance", label: "Insurance Evidence", done: slots.has("insurance_card") || !!v.insurance_carrier },
    { key: "gps", label: "GPS / Tracker", done: !!v.gps_status && v.gps_status !== "not_installed" },
    { key: "maintenance", label: "Maintenance History", done: ctx.maintenanceCount > 0 },
    ...(ctx.inspectionCount === undefined ? [] : [{ key: "inspection", label: "Inspection History", done: ctx.inspectionCount > 0 }]),
    ...(ctx.photoCount === undefined ? [] : [{ key: "photos", label: "Photos", done: ctx.photoCount > 0 }]),
    ...(ctx.hasFinance === undefined ? [] : [{ key: "purchase", label: "Purchase Information", done: !!ctx.hasFinance }]),
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

// ============================================================ Vehicle Readiness checklist (Phase A)
// Display only. Shape is stable so a future server function (Phase B) can
// return the same ReadinessCheck[] and the UI needs no rebuild.
// Never changes vehicle status; never invents dates, coverage or results.

export type ReadinessFacts = {
  lastPreDeliveryPassedAt: string | null;
  schedules: Array<{ item: string; next_due_on: string | null; next_due_miles: number | null }>;
  openIssues: Array<{ title: string | null; severity: string | null }>;
  openIncidents: Array<{ type: string | null; severity: string | null; drivable: boolean | null }>;
  hasActiveRental: boolean;
};

export type CheckStatus = "ready" | "attention" | "not_ready" | "info";
export type FixTarget = { kind: "edit"; section: "identity" | "insurance" | "dmv" | "service" } | { kind: "tab"; tab: "photos" | "documents" | "service" | "insurance" | "dmv" };
export type ReadinessCheck = { key: string; label: string; status: CheckStatus; value: string; reason: string; fix?: FixTarget; fixLabel?: string };
export type OverallReadiness = "ready" | "attention" | "not_ready";

export const SOON_DAYS = 30;
export const INSPECTION_STALE_DAYS = 30;
const SAFETY_ISSUE = new Set(["critical", "high", "safety", "urgent"]);
const SAFETY_INCIDENT = new Set(["major", "total_loss"]);

function daysUntil(date: string, today: Date): number {
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400_000);
}
const mdY = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${m}-${d}-${y}`; };

function expiryCheck(key: string, label: string, date: string | null, hasDoc: boolean, today: Date, fix: FixTarget, missingStatus: CheckStatus): ReadinessCheck {
  if (!date) {
    return { key, label, status: missingStatus, value: hasDoc ? "Date Missing" : "Not Verified",
      reason: hasDoc ? "Document on file but no expiration date recorded." : "No document or expiration date on file.", fix, fixLabel: "Add Date" };
  }
  const days = daysUntil(date, today);
  if (days < 0) return { key, label, status: "not_ready", value: "Expired", reason: `Expired ${mdY(date)} (${-days} days ago).`, fix, fixLabel: "Update" };
  if (days <= SOON_DAYS) return { key, label, status: "attention", value: "Expiring Soon", reason: `Expires ${mdY(date)} (in ${days} days).`, fix, fixLabel: "Update" };
  return { key, label, status: "ready", value: "Current", reason: `Expires ${mdY(date)}.${hasDoc ? "" : " No document uploaded."}` };
}

export function vehicleReadinessChecks(v: V, f: ReadinessFacts, docKinds: string[], publishedPhotos: number, today = new Date()): ReadinessCheck[] {
  const slots = presentSlots(docKinds);
  const checks: ReadinessCheck[] = [];
  const idItems = rentalReadyItems(v);
  const idMissing = idItems.filter((i) => i.key !== "weekly_rate" && !i.done);
  checks.push(idMissing.length
    ? { key: "identity", label: "Identity and VIN", status: "not_ready", value: "Incomplete", reason: `Missing: ${idMissing.map((i) => i.label).join(", ")}.`, fix: { kind: "edit", section: "identity" }, fixLabel: "Complete" }
    : { key: "identity", label: "Identity and VIN", status: "ready", value: "Complete", reason: `VIN ending ${String(v.vin).slice(-4)}.` });
  checks.push(hasValidRate(v.weekly_rate)
    ? { key: "weekly_rate", label: "Weekly Rate", status: "ready", value: `$${Number(v.weekly_rate).toLocaleString()}`, reason: "Weekly rate set." }
    : { key: "weekly_rate", label: "Weekly Rate", status: "not_ready", value: "Not Set", reason: "A weekly rate above $0 is required to rent.", fix: { kind: "edit", section: "identity" }, fixLabel: "Set Rate" });
  checks.push(expiryCheck("registration", "Registration", v.registration_expires_on ?? null, slots.has("registration"), today, { kind: "edit", section: "dmv" }, "not_ready"));
  checks.push(expiryCheck("insurance", "Insurance", v.insurance_expires_on ?? null, slots.has("insurance_card"), today, { kind: "edit", section: "insurance" }, "not_ready"));
  if (!v.license_plate) {
    checks.push({ key: "plate", label: "License Plate", status: "attention", value: "Not Recorded", reason: "No plate number on file.", fix: { kind: "edit", section: "dmv" }, fixLabel: "Add Plate" });
  } else {
    const c = expiryCheck("plate", "License Plate", v.plate_expires_on ?? null, true, today, { kind: "edit", section: "dmv" }, "attention");
    if (!v.plate_expires_on) { c.value = "Date Missing"; c.reason = `Plate ${v.license_plate}; no expiration date recorded.`; }
    checks.push(c);
  }
  if (!f.lastPreDeliveryPassedAt) {
    checks.push({ key: "inspection", label: "Pre-Delivery Inspection", status: "not_ready", value: "None Passed", reason: "No passed pre-delivery inspection on file. One is required for each rental.", fix: { kind: "tab", tab: "service" }, fixLabel: "Open Service" });
  } else {
    const age = -daysUntil(f.lastPreDeliveryPassedAt, today);
    checks.push(age > INSPECTION_STALE_DAYS
      ? { key: "inspection", label: "Pre-Delivery Inspection", status: "attention", value: "Over 30 Days", reason: `Last passed ${mdY(f.lastPreDeliveryPassedAt)} (${age} days ago).`, fix: { kind: "tab", tab: "service" }, fixLabel: "Open Service" }
      : { key: "inspection", label: "Pre-Delivery Inspection", status: "ready", value: "Passed", reason: `Passed ${mdY(f.lastPreDeliveryPassedAt)}.` });
  }
  const odo = v.current_odometer != null ? Number(v.current_odometer) : null;
  const overdue = f.schedules.filter((s) => (s.next_due_on && daysUntil(s.next_due_on, today) < 0) || (odo != null && s.next_due_miles != null && odo >= s.next_due_miles));
  const soon = f.schedules.filter((s) => !overdue.includes(s) && ((s.next_due_on && daysUntil(s.next_due_on, today) <= SOON_DAYS) || (odo != null && s.next_due_miles != null && s.next_due_miles - odo <= 500)));
  checks.push(!f.schedules.length
    ? { key: "maintenance", label: "Maintenance", status: "info", value: "No Schedule", reason: "No service schedule set up yet.", fix: { kind: "tab", tab: "service" }, fixLabel: "Open Service" }
    : overdue.length
      ? { key: "maintenance", label: "Maintenance", status: "attention", value: "Overdue", reason: `Overdue: ${overdue.map((s) => s.item).join(", ")}.`, fix: { kind: "tab", tab: "service" }, fixLabel: "Open Service" }
      : soon.length
        ? { key: "maintenance", label: "Maintenance", status: "attention", value: "Due Soon", reason: `Due soon: ${soon.map((s) => s.item).join(", ")}.`, fix: { kind: "tab", tab: "service" }, fixLabel: "Open Service" }
        : { key: "maintenance", label: "Maintenance", status: "ready", value: "Up to Date", reason: "No service due." });
  const critical = f.openIssues.filter((i) => SAFETY_ISSUE.has(String(i.severity ?? "").toLowerCase())).length
    + f.openIncidents.filter((i) => SAFETY_INCIDENT.has(String(i.severity ?? "")) || i.drivable === false).length;
  const totalOpen = f.openIssues.length + f.openIncidents.length;
  checks.push(critical
    ? { key: "safety", label: "Safety Issues", status: "not_ready", value: `${critical} Critical`, reason: `${totalOpen} open issue(s) or incident(s), ${critical} safety-critical or not drivable.` }
    : totalOpen
      ? { key: "safety", label: "Safety Issues", status: "attention", value: `${totalOpen} Open`, reason: `${totalOpen} open minor issue(s) or incident(s).` }
      : { key: "safety", label: "Safety Issues", status: "ready", value: "None Open", reason: "No open issues or incidents." });
  return checks;
}

/** Listing photos never affect rental readiness — kept as a separate check. */
export function listingPhotoCheck(publishedPhotos: number, totalPhotos: number): ReadinessCheck {
  return publishedPhotos > 0
    ? { key: "listing_photo", label: "Listing Photos", status: "ready", value: `${publishedPhotos} Published`, reason: "Shown on the public listing." }
    : { key: "listing_photo", label: "Listing Photos", status: "info", value: "None Published", reason: totalPhotos ? `${totalPhotos} photo(s) uploaded, none published.` : "No photos uploaded.", fix: { kind: "tab", tab: "photos" }, fixLabel: totalPhotos ? "Publish" : "Add Photo" };
}

export function overallReadiness(checks: ReadinessCheck[]): OverallReadiness {
  if (checks.some((c) => c.status === "not_ready")) return "not_ready";
  if (checks.some((c) => c.status === "attention")) return "attention";
  return "ready";
}

export type Availability = "Available" | "Reserved" | "On Rent" | "Onboarding" | "Out of Service" | "Retired";
/** Availability comes from status and live rentals only — never from readiness. */
export function vehicleAvailability(status: string | null | undefined, hasActiveRental: boolean): Availability {
  if (hasActiveRental) return "On Rent";
  switch (String(status ?? "")) {
    case "available": return "Available";
    case "reserved": return "Reserved";
    case "rented": return "On Rent";
    case "onboarding": return "Onboarding";
    case "retired": case "sold": case "archived": return "Retired";
    default: return "Out of Service";
  }
}
