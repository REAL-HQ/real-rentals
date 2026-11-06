/**
 * My Car card for an active driver. The flag is a hard constant. The server
 * function throws before portalScope and before any table read unless this
 * is true.
 *
 * The driver's own client can read their rental and vehicles_public. Plate
 * is license_plate on vehicles, which that client cannot read and which the
 * public view does not expose. It stays off until that is a separate decision.
 */

import { fmtDate } from "@/lib/date-format";
import { roadsideHelpHref } from "@/lib/driver-roadside";

export const MY_CAR_CARD_ENABLED: boolean = false;

/** Column a future driver-readable source would need before a plate can show. */
export const MY_CAR_PLATE_COLUMN = "license_plate";

export function assertMyCarCardEnabled(): void {
  if (MY_CAR_CARD_ENABLED !== true) {
    throw new Error("My car card is not enabled.");
  }
}

export type MyCarRental = {
  status: string | null;
  start_date: string | null;
  weekly_rate: number | null;
};

export type MyCarVehicle = {
  year: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
  photos: string[] | null;
};

export type MyCarLink = {
  label: "Payments" | "Documents" | "Roadside Help";
  /** Portal tab. Null when the control is a route instead. */
  tab: "payments" | "documents" | null;
  /** Set only when DRIVER_ROADSIDE_ENABLED is true. */
  href: "/portal/roadside" | null;
};

/** Payments and Documents are live portal tabs. Roadside Help points at /portal/roadside only while that flag is on. */
export function myCarLinks(roadsideEnabled?: boolean): MyCarLink[] {
  return [
    { label: "Payments", tab: "payments", href: null },
    { label: "Documents", tab: "documents", href: null },
    { label: "Roadside Help", tab: null, href: roadsideHelpHref(roadsideEnabled) },
  ];
}

export const MY_CAR_LINKS: MyCarLink[] = myCarLinks();

export type MyCarCard = {
  year: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
  photo: string | null;
  startDate: string | null;
  weeklyRate: string | null;
  missing: string[];
  plate: null;
  plateColumn: typeof MY_CAR_PLATE_COLUMN;
  links: MyCarLink[];
};

function money(amount: number): string {
  return Number(amount).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function firstPhoto(photos: string[] | null | undefined): string | null {
  const photo = photos?.find((item) => typeof item === "string" && item.trim());
  return photo ? photo.trim() : null;
}

/** Active rental only. Anything else is not the driver's current car. */
export function buildMyCar(rental: MyCarRental, vehicle: MyCarVehicle | null): MyCarCard | null {
  if ((rental.status ?? "").trim().toLowerCase() !== "active") return null;

  const photo = vehicle ? firstPhoto(vehicle.photos) : null;
  const startDate = rental.start_date ? fmtDate(rental.start_date) || null : null;
  const weeklyRate =
    rental.weekly_rate == null || Number.isNaN(Number(rental.weekly_rate)) ? null : money(Number(rental.weekly_rate));

  const missing: string[] = [];
  if (!vehicle || vehicle.year == null) missing.push("Year");
  if (!vehicle?.make?.trim()) missing.push("Make");
  if (!vehicle?.model?.trim()) missing.push("Model");
  if (!vehicle?.color?.trim()) missing.push("Color");
  if (!photo) missing.push("Photo");
  if (!startDate) missing.push("Start Date");
  if (!weeklyRate) missing.push("Weekly Rate");

  return {
    year: vehicle?.year ?? null,
    make: vehicle?.make?.trim() || null,
    model: vehicle?.model?.trim() || null,
    color: vehicle?.color?.trim() || null,
    photo,
    startDate,
    weeklyRate,
    missing,
    plate: null,
    plateColumn: MY_CAR_PLATE_COLUMN,
    links: myCarLinks(),
  };
}
