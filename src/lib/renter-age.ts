// Minimum renter age, one place for every rule and every line of public copy.
//
// Dolmar, Nov 21 2026 (2:37 PM ET, relayed by FLEET): the minimum is 23,
// matching Uber's minimum driver age in Florida, so every renter can drive for
// Uber right away. Was 21 (hard floor) with a 25 "young driver" staff look.
// Client-safe: imported by the public site, the admin UI and FLEET review.

export const MIN_RENTER_AGE = 23;

/** Readiness / screening disqualifier text, e.g. "Driver under 23". */
export const UNDER_MIN_AGE_LABEL = `Driver under ${MIN_RENTER_AGE}`;

/** The public FAQ entry (site FAQ page, home page FAQ, city pages). */
export const MIN_AGE_FAQ = {
  q: "How old do I have to be to rent?",
  a: `You must be at least ${MIN_RENTER_AGE} with a valid U.S. driver's license. That matches Uber's minimum driver age in Florida, so every renter can drive for Uber right away.`,
} as const;
