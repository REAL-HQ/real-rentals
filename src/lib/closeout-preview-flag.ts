/**
 * Rental Closeout preview.
 *
 * false: a booking looks the same as today. No environment variable can
 * open this. Activation is changing this constant and rebuilding. The
 * preview only reads, and it does not end a rental or settle a deposit.
 */
export const CLOSEOUT_PREVIEW_ENABLED = false;

const ENDED = new Set(["ended", "completed", "closed", "returned", "finished"]);

/** Active rentals, plus the completed phase from the bookings list. */
export function showsCloseoutPreview(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "active" || ENDED.has(s);
}

export function isEndedRentalStatus(status: string | null | undefined): boolean {
  return ENDED.has(String(status ?? "").toLowerCase());
}
