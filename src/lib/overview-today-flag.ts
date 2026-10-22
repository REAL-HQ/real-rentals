/**
 * Overview Today is dark. This is a constant, not an environment variable.
 * Leaving it false keeps the live dashboard on its current reads.
 *
 * The booking math imports the payments reader. This file does not, so the
 * Overview page can read the flag without loading that module.
 */
import { leadToday } from "@/lib/lead-priorities";

export const OVERVIEW_TODAY_ENABLED: boolean = false;

export function overviewToday(now = new Date()): string {
  return leadToday(now);
}

export function disabledOverviewToday(today = overviewToday()): { enabled: false; today: string } {
  return { enabled: false, today };
}

/** A missing or negative amount stays unknown. Zero is a real recorded amount. */
export function recordedAmount(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
