/**
 * The one list of states a plate or registration can be issued in.
 *
 * Plate state was a free-text box in three places, and it showed: "FL", "Fl",
 * "fla" and " FL " are four strings for one state, and neither the plate
 * lookups nor the case-insensitive unique index could agree about any of them.
 * Codes are stored upper-cased (UPPERCASE_FIELDS in vehicles.functions.ts);
 * this list is what a human may choose from, so nothing else can be typed.
 */
export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DC", name: "District of Columbia" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

export const US_STATE_CODES: readonly string[] = US_STATES.map((s) => s.code);

const CODES = new Set(US_STATE_CODES);

/** Is this a state a plate could have come from? Blank is not a state. */
export function isUsStateCode(v: unknown): boolean {
  return CODES.has(
    String(v ?? "")
      .trim()
      .toUpperCase(),
  );
}

/**
 * Options for a <select>. The blank stays first: an unknown plate state is a
 * real answer during onboarding, and inventing one would be worse than "—".
 */
export function usStateOptions(blankLabel = "—"): Array<{ value: string; label: string }> {
  return [
    { value: "", label: blankLabel },
    ...US_STATES.map((s) => ({ value: s.code, label: `${s.code} — ${s.name}` })),
  ];
}
