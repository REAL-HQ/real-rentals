// Which agreements and payments belong to a booking (a rental).
//
// An agreement is prepared and signed BEFORE the rental row exists (the renter
// signs, pays the Reservation Fee, and only then is the car reserved), so its
// rental_id is null at birth. Reading "agreements WHERE rental_id = X" alone
// therefore reports "no agreement" for exactly the rentals that were papered
// first. A booking owns an agreement when it is linked to it, OR when it is
// not yet linked to any rental and belongs to the same person (application) —
// unless that person has another live rental the agreement fits better.
//
// Pure and browser-safe so the rule is tested without a database.

export type BookingRef = {
  id: string;
  applicationId: string | null;
  vehicleId: string | null;
};

export type SiblingRental = { id: string; vehicleId: string | null; status: string | null };

export type AgreementLinkRow = {
  rental_id: string | null;
  application_id: string | null;
  vehicle_id: string | null;
  voided_at?: string | null;
};

const DEAD = new Set(["cancelled", "canceled", "void", "voided"]);

/** Other rentals for the same person that are not cancelled. */
export function liveSiblings(siblings: SiblingRental[], bookingId: string): SiblingRental[] {
  return siblings.filter((s) => s.id !== bookingId && !DEAD.has(String(s.status ?? "").toLowerCase()));
}

export function agreementBelongsToBooking(
  a: AgreementLinkRow,
  booking: BookingRef,
  siblings: SiblingRental[] = [],
): boolean {
  if (a.rental_id) return a.rental_id === booking.id;
  if (!booking.applicationId || a.application_id !== booking.applicationId) return false;
  const others = liveSiblings(siblings, booking.id);
  if (others.length === 0) return true; // the only rental this person has
  // Several rentals: an unlinked agreement goes with the one whose car it names.
  if (!a.vehicle_id || !booking.vehicleId) return false;
  return a.vehicle_id === booking.vehicleId;
}

export function selectBookingAgreements<T extends AgreementLinkRow>(
  rows: T[],
  booking: BookingRef,
  siblings: SiblingRental[] = [],
): T[] {
  return rows.filter((a) => agreementBelongsToBooking(a, booking, siblings));
}

export type PaymentLinkRow = { rental_id: string | null; driver_id: string | null };

/**
 * payments.driver_id is an applications id (not the auth user id). A payment
 * with no rental yet — the Reservation Fee is paid before the reservation row
 * exists — belongs to the person's only live rental.
 */
export function paymentBelongsToBooking(
  p: PaymentLinkRow,
  booking: BookingRef,
  siblings: SiblingRental[] = [],
): boolean {
  if (p.rental_id) return p.rental_id === booking.id;
  if (!booking.applicationId || p.driver_id !== booking.applicationId) return false;
  return liveSiblings(siblings, booking.id).length === 0;
}
