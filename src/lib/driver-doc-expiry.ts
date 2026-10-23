/**
 * License and insurance expiry for the signed-in driver.
 *
 * The dates are the columns the application already stores:
 * applications.license_expiration and applications.insurance_expires_on.
 * A driver can read their own application (user_id = auth.uid()). This module
 * does not read or write anything itself.
 *
 * The flag the portal checks is duplicated in src/routes/portal.tsx so the
 * card module stays unloaded while both copies are false.
 */

import { fmtDate } from "@/lib/date-format";

export const DRIVER_DOC_EXPIRY_CARD_ENABLED: boolean = false;

export const DOC_EXPIRY_TIME_ZONE = "America/New_York";

/** Days still counting as "expiring," including the expiry date itself. */
export const DOC_EXPIRY_WINDOW_DAYS = 30;

export function assertDriverDocExpiryEnabled(): void {
  if (DRIVER_DOC_EXPIRY_CARD_ENABLED !== true) {
    throw new Error("Driver document expiry card is not enabled.");
  }
}

export type ExpiryState = "ok" | "expiring" | "expired" | "missing";

export const EXPIRY_STATE_LABEL: Record<ExpiryState, string> = {
  ok: "OK",
  expiring: "Expiring In 30 Days Or Less",
  expired: "Expired",
  missing: "No Date On File",
};

export type ExpiryRow = {
  user_id: string;
  license_expiration: string | null;
  insurance_expires_on: string | null;
};

export type DocExpiryItem = {
  key: "license" | "insurance";
  label: string;
  column: "license_expiration" | "insurance_expires_on";
  date: string | null;
  displayDate: string | null;
  state: ExpiryState;
  stateLabel: string;
};

export type DocExpiryCard = {
  items: DocExpiryItem[];
};

/** Calendar date in Eastern Time, YYYY-MM-DD. */
export function easternDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DOC_EXPIRY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Add calendar days to a YYYY-MM-DD date. The arithmetic stays on the calendar. */
export function addCalendarDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function expiryState(value: string | null | undefined, today: string): ExpiryState {
  if (!value || !DATE_ONLY.test(value)) return "missing";
  if (value < today) return "expired";
  if (value <= addCalendarDays(today, DOC_EXPIRY_WINDOW_DAYS)) return "expiring";
  return "ok";
}

const FIELDS = [
  { key: "license", label: "License", column: "license_expiration" },
  { key: "insurance", label: "Insurance", column: "insurance_expires_on" },
] as const;

/**
 * Keep only rows for this driver. The query already filters by user_id;
 * this drops anything that does not match before a date is shown.
 */
export function buildDocExpiry(rows: readonly ExpiryRow[], userId: string, now: Date): DocExpiryCard {
  const today = easternDate(now);
  const row = rows.find((candidate) => candidate.user_id === userId) ?? null;
  return {
    items: FIELDS.map((field) => {
      const date = row?.[field.column] ?? null;
      const state = expiryState(date, today);
      return {
        key: field.key,
        label: field.label,
        column: field.column,
        date: state === "missing" ? null : date,
        displayDate: state === "missing" ? null : fmtDate(date),
        state,
        stateLabel: EXPIRY_STATE_LABEL[state],
      };
    }),
  };
}
