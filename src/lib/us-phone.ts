/**
 * US phone helpers for the apply / lead forms.
 *
 * The input shows a typable US format, like (813) 555-0123. The value we
 * submit and store is E.164 (+1XXXXXXXXXX) when the input is a valid US
 * number — the same value toE164 and businessPhoneE164 already produce —
 * so Quo inbound matching (ilike on the last 10 digits), duplicate
 * detection, and missing-items outreach keep working. A pretty display
 * string such as "(813) 555-0123" is not stored, because those lookups
 * look for a contiguous digit run.
 */

export function usPhoneDigits(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** 10-digit national number, or null if the input isn't a US number. */
export function usNationalNumber(raw: string | null | undefined): string | null {
  const digits = usPhoneDigits(raw);
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

/** E.164 for a US number, or null. Same rules as toE164 / businessPhoneE164 for US input. */
export function usPhoneE164(raw: string | null | undefined): string | null {
  const national = usNationalNumber(raw);
  return national ? `+1${national}` : null;
}

/**
 * Value written to applications.phone (and waitlist.phone).
 * Valid US numbers become E.164; anything else is trimmed as-typed so the
 * existing 7-character minimum still submits.
 */
export function applicantPhoneForSubmit(raw: string): string {
  return usPhoneE164(raw) ?? raw.trim();
}

/**
 * Format a US number for a typable input.
 * Handles a leading 1 or +1, pasting, backspacing, and autofill.
 *
 * Closing punctuation is added only after the next digit, so backspacing
 * through a hyphen or parenthesis actually removes a digit.
 */
export function formatUsPhoneInput(raw: string): string {
  let digits = usPhoneDigits(raw);

  // A lone "1" is the country code started, not an area code (those cannot
  // begin with 1). Keep it visible until the next digit arrives.
  if (digits === "1") return "1";

  // Area codes cannot start with 0 or 1, so a leading 1 followed by another
  // digit is the US country code, even before all 11 digits are present.
  if (digits.startsWith("1") && digits.length >= 2) {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);

  if (!digits) return "";

  const area = digits.slice(0, 3);
  const mid = digits.slice(3, 6);
  const line = digits.slice(6, 10);

  if (digits.length <= 3) return `(${area}`;
  if (digits.length <= 6) return `(${area}) ${mid}`;
  return `(${area}) ${mid}-${line}`;
}

/**
 * Common typings of the same US number, for exact-match phone lookups.
 * Built only from the 10 national digits — never from raw applicant text —
 * so the values can be passed to PostgREST `.in()` without interpolation.
 */
export function applicantPhoneLookupValues(raw: string): string[] {
  const national = usNationalNumber(raw);
  if (!national) {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  const a = national.slice(0, 3);
  const b = national.slice(3, 6);
  const c = national.slice(6, 10);
  return [
    ...new Set([
      `+1${national}`,
      `1${national}`,
      national,
      `(${a}) ${b}-${c}`,
      `${a}-${b}-${c}`,
      `${a}.${b}.${c}`,
      `${a} ${b} ${c}`,
      `+1 (${a}) ${b}-${c}`,
      `1 (${a}) ${b}-${c}`,
      `1-${a}-${b}-${c}`,
      `+1-${a}-${b}-${c}`,
    ]),
  ];
}

/**
 * Format any phone field as the user types (the shared PhoneInput).
 *
 * US numbers, the only kind the business takes, are formatted exactly like
 * formatUsPhoneInput. Two kinds of input are left as typed instead of being
 * mangled into a US shape: an international number (starts with "+" and a
 * country code other than 1), and a number with an extension or other
 * letters ("813-555-0123 ext 4"), which some vendor and insurance phones need.
 */
export function formatPhoneInput(raw: string): string {
  const s = String(raw ?? "");
  const trimmed = s.trimStart();
  if (trimmed.startsWith("+") && !/^\+\s*\(?\s*1/.test(trimmed) && /\d/.test(trimmed)) return s;
  if (/[a-z]/i.test(s)) return s;
  return formatUsPhoneInput(s);
}

/** Show a stored phone (E.164 or as-typed) the way the input formats it. */
export function formatPhoneForDisplay(stored: string | null | undefined): string {
  const s = String(stored ?? "");
  const national = usNationalNumber(s);
  if (national && !/[a-z]/i.test(s)) return formatUsPhoneInput(national);
  return s;
}

/**
 * Where the caret belongs after reformatting, so typing or deleting in the
 * middle of a number does not throw the caret to the end.
 *
 * Counts the digits left of the caret in what the user typed, drops a
 * country-code 1 the formatter removed, and puts the caret right after the
 * same number of digits in the formatted value.
 */
export function caretAfterFormat(typed: string, caret: number, formatted: string): number {
  const typedDigits = usPhoneDigits(typed);
  let before = usPhoneDigits(typed.slice(0, Math.max(0, caret))).length;
  const formattedDigits = usPhoneDigits(formatted);
  if (
    typedDigits.length > formattedDigits.length &&
    typedDigits.startsWith("1") &&
    !formattedDigits.startsWith("1")
  ) {
    before = Math.max(0, before - 1);
  }
  before = Math.min(before, formattedDigits.length);
  if (before === 0) {
    const first = formatted.search(/\d/);
    return first < 0 ? formatted.length : first;
  }
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]) && ++seen === before) return i + 1;
  }
  return formatted.length;
}
