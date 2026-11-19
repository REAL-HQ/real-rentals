/**
 * The one red for every badge, pill and chip in the app. It is the pastel
 * "Unqualified" badge from the Contact Status column (Tailwind rose-100 / rose-800).
 * Import from here instead of writing bg-red-*, bg-rose-* or rgba(208,48,32,...)
 * on a badge. Solid brand-red buttons and inline error text are not badges and keep #D03020.
 */
export const DANGER_BADGE = "bg-rose-100 text-rose-800";
/** Same colour with a hairline border, for badges that sit on a bordered chip style. */
export const DANGER_BADGE_BORDERED = "border-rose-200 bg-rose-100 text-rose-800";
/** Inline-style form of DANGER_BADGE for components that colour through style props. */
export const DANGER_BADGE_STYLE = { backgroundColor: "#ffe4e6", color: "#9f1239" } as const;
