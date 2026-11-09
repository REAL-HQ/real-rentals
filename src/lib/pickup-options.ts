/** Confirmed business choices for the disabled pickup preparation; no I/O or authorization. */
export const PICKUP_COORDINATION = {
  appointmentOwner: "team",
  approvalEmail: "login_first",
  customLocationAllowed: true,
  defaultLocation: null,
} as const;

export const PICKUP_LOCATIONS = [
  { id: "hillsborough", address: "3500 E. Hillsborough Ave., Tampa, FL 33610" },
  { id: "county_line", address: "6411 E County Line Rd., Tampa, FL 33647" },
] as const;

export const PICKUP_PAYMENT_METHODS = [
  { id: "stripe", label: "Stripe" },
  { id: "zelle_bank", label: "Zelle / Bank Transfer" },
  { id: "cash_app_venmo", label: "Cash App / Venmo" },
  { id: "cash", label: "Cash" },
  { id: "other", label: "Other" },
] as const;

/** Selecting a suggestion does not confirm an appointment or restrict editing. */
export function pickupLocationSuggestion(id: string): string | null {
  return PICKUP_LOCATIONS.find((location) => location.id === id)?.address ?? null;
}