// Waitlist aging is dark. This constant is the only switch, and it is false.
// There is no environment variable. Turning it on is a source change.
export const WAITLIST_AGING_ENABLED: boolean = false;

export const WAITLIST_AGING_CAP = 1000;
/** Eastern calendar days after notification. Day 7 with no application counts. */
export const NOTIFIED_WINDOW_DAYS = 7;

export type WaitlistAgingGroup = {
  city: string | null;
  waiting: number;
  /** Exact median. The screen rounds it; this value does not. */
  medianDays: number | null;
  oldestDays: number | null;
  notifiedNotApplied: number;
};

export type WaitlistAgingResult = {
  failed: boolean;
  truncated: boolean;
  cap: number;
  groups: WaitlistAgingGroup[];
};

export function assertWaitlistAgingEnabled(): void {
  if (WAITLIST_AGING_ENABLED !== true) {
    throw new Error("Waitlist aging is disabled.");
  }
}

/** Inlined true while the flag is false, so the read stays unreachable. */
export const AGING_REFUSED: boolean = !WAITLIST_AGING_ENABLED;

export function idleWaitlistAging(): WaitlistAgingResult {
  return { failed: false, truncated: false, cap: WAITLIST_AGING_CAP, groups: [] };
}

export function failedWaitlistAging(): WaitlistAgingResult {
  return { failed: true, truncated: false, cap: WAITLIST_AGING_CAP, groups: [] };
}
