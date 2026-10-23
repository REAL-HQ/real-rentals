/**
 * Read-only "My Rental" card for a signed-in driver.
 *
 * The flag stays off until someone turns the constant on. The server function
 * checks it before role lookup or any query. Nothing here writes.
 *
 * Plate is not part of this card. `vehicles.license_plate` exists, but drivers
 * have no SELECT on `public.vehicles`, and `vehicles_public` (the projection
 * authenticated users may read) does not include it. Reading the plate would
 * mean using the service role to pass that boundary.
 */

export const PORTAL_MY_RENTAL_ENABLED: boolean = false;

export type PortalMyRentalResult = {
  active: boolean;
  year: number | null;
  make: string | null;
  model: string | null;
  startDate: string | null;
  nextPaymentDue: string | null;
  weeklyAmount: number | null;
};

export const EMPTY_PORTAL_MY_RENTAL: PortalMyRentalResult = {
  active: false,
  year: null,
  make: null,
  model: null,
  startDate: null,
  nextPaymentDue: null,
  weeklyAmount: null,
};

export function assertPortalMyRentalEnabled(): void {
  if (PORTAL_MY_RENTAL_ENABLED !== true) {
    throw new Error("Portal My Rental is not enabled.");
  }
}

export type MyRentalRow = {
  start_date: string | null;
  next_payment_due: string | null;
  weekly_rate: number | string | null;
};

export type MyRentalVehicleRow = {
  year: number | null;
  make: string | null;
  model: string | null;
};

function money(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/** No active rental → nothing to show. An active rental keeps only the fields above. */
export function portalMyRental(
  rental: MyRentalRow | null,
  vehicle: MyRentalVehicleRow | null,
): PortalMyRentalResult {
  if (!rental) return { ...EMPTY_PORTAL_MY_RENTAL };
  return {
    active: true,
    year: vehicle?.year ?? null,
    make: vehicle?.make ?? null,
    model: vehicle?.model ?? null,
    startDate: rental.start_date ?? null,
    nextPaymentDue: rental.next_payment_due ?? null,
    weeklyAmount: money(rental.weekly_rate),
  };
}
