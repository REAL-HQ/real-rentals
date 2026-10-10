// Photo Reading — the Owner's switch and daily limit. Pure rules, no I/O, so
// the same decisions run on the server, in the UI and in the tests.
//
// Reading a photograph is the only thing in this system that spends money, so
// unlike Safe Autofill — whose cost is zero and whose risk is a wrong value —
// this has to hold under concurrency. Two Managers pressing Read at the same
// instant must not both get the last slot of the day. The counter therefore
// lives in the settings row itself and moves by compare-and-swap (see
// photo-reading.server.ts), not by counting rows after the fact.
//
// The row is in app_settings, whose RLS policy is
// private.has_role(auth.uid(), 'admin') for every command — Owner-only at the
// database, not merely in the UI. That is the boundary; requireOwner in the
// server function is the courtesy that produces a readable error first.

export const PHOTO_READING_KEY = "photo_reading";

export type PhotoReadingSettings = {
  enabled: boolean;
  dailyLimit: number;
  /** Set when a run failed in a way that must stop further spending. */
  pausedReason: string | null;
  pausedAt: string | null;
  /** The day `usedToday` belongs to (UTC, YYYY-MM-DD). */
  usageDate: string | null;
  usedToday: number;
  updatedBy: string | null;
  updatedAt: string | null;
  /** Compare-and-swap token. Every write increments it. */
  version: number;
};

/** Off, with a modest limit, until an Owner says otherwise. */
export const PHOTO_READING_DEFAULTS: PhotoReadingSettings = {
  enabled: false,
  dailyLimit: 20,
  pausedReason: null,
  pausedAt: null,
  usageDate: null,
  usedToday: 0,
  updatedBy: null,
  updatedAt: null,
  version: 0,
};

const int = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Tolerant parse: a malformed or absent row reads as "off", never as "on". */
export function readPhotoReadingSettings(value: unknown): PhotoReadingSettings {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    enabled: v.enabled === true,
    dailyLimit: int(v.daily_limit, PHOTO_READING_DEFAULTS.dailyLimit, 0, 1000),
    pausedReason: str(v.paused_reason),
    pausedAt: str(v.paused_at),
    usageDate: str(v.usage_date),
    usedToday: int(v.used_today, 0, 0, 1_000_000),
    updatedBy: str(v.updated_by),
    updatedAt: str(v.updated_at),
    version: int(v.version, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** The shape stored in app_settings.value. */
export function writePhotoReadingSettings(s: PhotoReadingSettings): Record<string, unknown> {
  return {
    enabled: s.enabled, daily_limit: s.dailyLimit,
    paused_reason: s.pausedReason, paused_at: s.pausedAt,
    usage_date: s.usageDate, used_today: s.usedToday,
    updated_by: s.updatedBy, updated_at: s.updatedAt,
    version: s.version,
  };
}

export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** Reads used today, treating yesterday's count as spent and gone. */
export function usedOn(s: PhotoReadingSettings, day: string): number {
  return s.usageDate === day ? s.usedToday : 0;
}

export function remainingOn(s: PhotoReadingSettings, day: string): number {
  return Math.max(0, s.dailyLimit - usedOn(s, day));
}

/**
 * Why a read cannot start, in words an operator can act on — or null if it can.
 * Checked server-side before anything is queued; the UI shows the same string.
 */
export function refusalReason(s: PhotoReadingSettings, day: string): string | null {
  if (!s.enabled) return "Photo Reading is switched off. An Owner can turn it on in Settings → Photo Reading.";
  if (s.pausedReason) return `Photo Reading is paused: ${s.pausedReason}`;
  if (s.dailyLimit <= 0) return "Photo Reading has a daily limit of zero. An Owner can raise it in Settings → Photo Reading.";
  if (remainingOn(s, day) <= 0) return `Today's limit of ${s.dailyLimit} photo${s.dailyLimit === 1 ? "" : "s"} has been reached. It resets at midnight UTC.`;
  return null;
}

/** The next value after one slot is taken. Pure, so the CAS loop stays honest. */
export function withReservation(s: PhotoReadingSettings, day: string): PhotoReadingSettings {
  return { ...s, usageDate: day, usedToday: usedOn(s, day) + 1, version: s.version + 1 };
}

/** The next value after a reserved slot is handed back unspent. */
export function withRelease(s: PhotoReadingSettings, day: string): PhotoReadingSettings {
  return { ...s, usageDate: day, usedToday: Math.max(0, usedOn(s, day) - 1), version: s.version + 1 };
}
