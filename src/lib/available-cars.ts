// Available cars board — pure rules.
export const ASSIGNABLE_DRIVER_STATUSES = new Set(["approved", "active"]);
export const BOARD_VEHICLE_STATUSES = ["available", "onboarding", "reserved"] as const;

export type AssignCheck = { ok: true } | { ok: false; error: string };

export function canAssign(
  driver: { status: string | null; vehicle_id: string | null } | null,
  vehicle: { status: string | null; archived_at?: string | null; assignedTo?: string | null } | null,
  driverId: string,
): AssignCheck {
  if (!driver) return { ok: false, error: "Driver not found." };
  if (!ASSIGNABLE_DRIVER_STATUSES.has(String(driver.status))) return { ok: false, error: "Only approved drivers can be assigned a car." };
  if (!vehicle || vehicle.archived_at) return { ok: false, error: "Car not found." };
  if (String(vehicle.status).toLowerCase() !== "available") return { ok: false, error: "This car is not available." };
  if (vehicle.assignedTo && vehicle.assignedTo !== driverId) return { ok: false, error: "This car is already assigned to another driver." };
  if (driver.vehicle_id && driver.vehicle_id !== null) return { ok: false, error: "This driver already has a car. Unassign it first." };
  return { ok: true };
}
