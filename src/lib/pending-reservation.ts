/**
 * Pending Reservation: the soft hold that starts when the Reservation Fee is
 * paid, before a pickup is booked and before the insurance card is issued.
 *
 * rentals.status and vehicles.status are both `pending_reservation`. That is
 * not the staff On Hold state (`on_hold`), which pauses a reservation that
 * already exists.
 *
 * Pickup Not Booked (PR 517, cursor/pickup-not-booked-93f3) treats
 * reserved, on_hold, and active as "a pickup is booked" and hides Book Pickup.
 * A pending hold is not one of those, so Book Pickup still shows. Booking the
 * pickup reuses this row (createReservationCore) instead of inserting another.
 * The button should hide only once a pickup time is stored, or once the row
 * is promoted to reserved. PR 517 does not read this status yet; see
 * pendingHoldHidesBookPickup.
 *
 * The insurance-card event that promotes the hold to reserved is a current,
 * non-rejected driver document in category `insurance` that is not the
 * application-wizard copy labeled "Insurance (from application)". That is the
 * Insurance Card slot: staff upload, the portal upload, FLEET
 * driver-document category insurance, and the emailed Insurance ID Card
 * auto-file (fileRenterInsuranceCard, audit document.insurance_card_auto_filed).
 * An insurance quote (category insurance_quote, or
 * application.insurance_quote_applied) is not this event.
 */
import { readReservationDetails } from "@/lib/reservations";

export const PENDING_RESERVATION_STATUS = "pending_reservation" as const;
export const PENDING_RESERVATION_LABEL = "Pending Reservation";
export const WAITING_ON_INSURANCE_CARD = "Waiting On Insurance Card";

/** Application-wizard copy. It is not the policy card issued after the fee. */
export const APPLICATION_INSURANCE_LABEL = "Insurance (from application)";

/** Statuses that already mean the car is held for someone. */
export const HELD_RENTAL_STATUSES = ["reserved", "on_hold", "active", PENDING_RESERVATION_STATUS] as const;

/**
 * Statuses PR 517 counts as a booked pickup (hides Book Pickup).
 * pending_reservation is intentionally absent.
 */
export const PICKUP_BOOKED_RENTAL_STATUSES = ["reserved", "on_hold", "active"] as const;

export function isPendingReservationStatus(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toLowerCase() === PENDING_RESERVATION_STATUS;
}

/** A current Insurance Card that is not the file from the application wizard. */
export function isIssuedRenterInsuranceCard(doc: {
  category?: string | null;
  label?: string | null;
  is_current?: boolean | null;
  review_status?: string | null;
}): boolean {
  if (String(doc.category ?? "") !== "insurance") return false;
  if (doc.is_current === false) return false;
  if (String(doc.review_status ?? "") === "rejected") return false;
  if (String(doc.label ?? "") === APPLICATION_INSURANCE_LABEL) return false;
  return true;
}

/**
 * True when Book Pickup should stay hidden.
 * A pending hold with no pickup time is false: Book Pickup still shows.
 * A pending hold that already has a pickup time is true.
 * reserved, on_hold, and active stay true (PR 517's open rental).
 */
export function pendingHoldHidesBookPickup(
  status: string | null | undefined,
  reservationNote: string | null | undefined,
): boolean {
  const key = String(status ?? "").trim().toLowerCase();
  if ((PICKUP_BOOKED_RENTAL_STATUSES as readonly string[]).includes(key)) return true;
  if (key !== PENDING_RESERVATION_STATUS) return false;
  return readReservationDetails(reservationNote).pickupTime != null;
}

/** Note stored when the fee is paid and no pickup has been chosen. */
export function pendingHoldNote(): string {
  return JSON.stringify({
    reservation_details: 1,
    pending_reservation: true,
    pickup_time: null,
    pickup_location: null,
    note: null,
  });
}
