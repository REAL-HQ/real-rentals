/**
 * What an applicant sees when Step 1 (name, email, phone) cannot be saved.
 *
 * Before this, the raw error went into a 4-second toast at the bottom of the
 * screen. On a phone that toast sits behind the on-screen keyboard or on top
 * of the Continue button, and the text was whatever the server threw: a
 * Postgres message such as `column reference "phone" is ambiguous` (the
 * Nov 16-17 outage), a Zod JSON blob, or the browser's "Failed to fetch" /
 * Safari's "Load failed". A prospect on Nov 17 reported tapping Continue and
 * "it doesn't go anywhere" with no error. The form now keeps a plain message
 * next to the button until the next try, and the toast carries the same text.
 */
export const APPLY_HELP_PHONE_DISPLAY = "888-833-8280";

const NETWORK_PATTERNS = [
  /failed to fetch/i, // Chrome, Android
  /load failed/i, // iOS Safari
  /networkerror/i, // Firefox
  /network request failed/i,
  /the internet connection appears to be offline/i,
  /timed? ?out/i,
];

export type ApplySubmitErrorKind = "network" | "server";

export function applySubmitErrorKind(error: unknown): ApplySubmitErrorKind {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (NETWORK_PATTERNS.some((re) => re.test(message))) return "network";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
  return "server";
}

/** Plain-language text for the inline alert and the toast. Never the raw server text. */
export function applySubmitErrorMessage(error: unknown): string {
  if (applySubmitErrorKind(error) === "network") {
    return `We couldn't reach our server. Check your connection and tap Continue again. Still stuck? Call us at ${APPLY_HELP_PHONE_DISPLAY}.`;
  }
  return `We couldn't save your information. Please tap Continue again. If it keeps happening, call us at ${APPLY_HELP_PHONE_DISPLAY} and we'll help you finish.`;
}

/**
 * Close the on-screen keyboard before submitting, so the result (an error or
 * the next page) is not hidden behind it on iOS Safari and Android Chrome.
 */
export function dismissKeyboard(): void {
  if (typeof document === "undefined") return;
  const el = document.activeElement as HTMLElement | null;
  if (el && typeof el.blur === "function" && el !== document.body) el.blur();
}
