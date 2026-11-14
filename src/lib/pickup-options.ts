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

/** Proposed outbound intent only. Not a send gate, account creator or retry policy. */
export function pickupWelcomeIntent(facts: {
  approvalAction: "approve_only" | "approve_and_invite";
  accountConflict: boolean; accountAccessReady: boolean; pickupConfirmed: boolean;
}): { login: "planned" | "not_requested" | "blocked"; pickup: "planned" | "awaiting_confirmation" | "blocked" } {
  if (facts.accountConflict || !facts.accountAccessReady) return { login: "blocked", pickup: "blocked" };
  return {
    login: facts.approvalAction === "approve_and_invite" && facts.pickupConfirmed ? "planned" : "not_requested",
    pickup: facts.pickupConfirmed ? "planned" : "awaiting_confirmation",
  };
}