/**
 * Pickup Not Booked: the lead is approved, a current agreement is signed, and
 * the Reservation Fee is paid, but no pickup is booked. A Pending Reservation
 * (fee paid, insurance card not issued, no pickup time) is not a booked
 * pickup, so Book Pickup still shows and createReservationCore reuses that
 * row. reserved, on_hold, and active hide it. Client-safe. No phone numbers.
 */

export type PickupNotBookedState = {
  show: boolean;
  openRental: boolean;
  vehicleId: string | null;
  startDate: string | null;
  agreementId: string | null;
  paymentId: string | null;
  feeNotesMatch: boolean;
};

export const PICKUP_NOT_BOOKED_TITLE = "Pickup Not Booked";
export const FEE_PAID_NO_PICKUP_TITLE = "Fee Paid, No Pickup Booked";
export const PICKUP_LINK_EMAIL_SUBJECT = "Choose Your Pickup Time";

const OPEN_RENTAL = new Set(["reserved", "on_hold", "active"]);

export function isOpenRentalStatus(status: string | null | undefined): boolean {
  return OPEN_RENTAL.has(String(status ?? "").toLowerCase());
}

/**
 * Profile state. `active` counts as approved because an application stage is
 * not itself a running rental; an open rental is what hides the state.
 */
export function isPickupNotBooked(input: {
  applicationStatus: string | null | undefined;
  deleted?: boolean;
  hasCurrentSignedAgreement: boolean;
  reservationFeePaid: boolean;
  openRental: boolean;
}): boolean {
  if (input.deleted) return false;
  const status = String(input.applicationStatus ?? "").toLowerCase();
  if (status !== "approved" && status !== "active") return false;
  if (!input.hasCurrentSignedAgreement || !input.reservationFeePaid) return false;
  return input.openRental !== true;
}

/** Payment Received page for a paid Reservation Fee Checkout session. */
export function pickupLinkPath(sessionId: string): string {
  return `/reservation-fee?status=paid&session_id=${encodeURIComponent(sessionId)}`;
}

export function pickupNotBookedNote(): string {
  return "Pickup Not Booked. The agreement is signed and the Reservation Fee is paid. Book a pickup or send the renter a link to choose a time.";
}

/** In-app staff notice. The lead id is the dedupe key. No phone number. */
export function feePaidNoPickupBody(name: string | null | undefined, applicationId: string): string {
  const who = String(name ?? "").trim() || "A lead";
  return `${who} paid the Reservation Fee and no pickup is booked. Lead ${applicationId}.`;
}

export function feePaidNoPickupEmail(input: { name: string | null | undefined; applicationId: string; adminUrl: string }): { subject: string; html: string } {
  const who = String(input.name ?? "").trim() || "A lead";
  const subject = `${FEE_PAID_NO_PICKUP_TITLE} — ${who}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
  <h1 style="font-size:18px;margin:0 0 8px">${escapeHtml(FEE_PAID_NO_PICKUP_TITLE)}</h1>
  <p style="font-size:14px;line-height:1.5;color:#333;margin:6px 0">${escapeHtml(who)} signed and the Reservation Fee is already paid, but no pickup is booked.</p>
  <p style="font-size:14px;line-height:1.5;color:#333;margin:6px 0">Open the driver profile to book a pickup or send a pickup link.</p>
  <p style="margin-top:16px"><a href="${escapeHtml(input.adminUrl)}" style="display:inline-block;background:#D03020;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open Driver Record</a></p>
</div>`;
  return { subject, html };
}

export function pickupLinkEmail(input: { firstName: string | null | undefined; url: string }): { subject: string; html: string } {
  const name = String(input.firstName ?? "").trim().split(/\s+/)[0] || "there";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
  <p>Hi ${escapeHtml(name)},</p>
  <p>Your agreement is signed and your Reservation Fee is paid. It is applied to your first week. Choose a pickup time.</p>
  <p><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#D03020;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Choose A Pickup Time</a></p>
  <p style="color:#666;font-size:13px;line-height:1.5">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(input.url)}</span></p>
  <p>— REAL RENTALS</p>
</div>`;
  return { subject: PICKUP_LINK_EMAIL_SUBJECT, html };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
