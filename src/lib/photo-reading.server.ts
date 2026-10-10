// Photo Reading — the I/O half. Loads the Owner's settings and reserves a
// slot against the daily limit.
//
// THE RESERVATION IS THE POINT OF THIS FILE.
//
// Counting rows and then inserting is not a limit; it is a suggestion. Two
// requests that both read "19 of 20 used" will both decide they may proceed,
// and the day ends at 21. So the counter lives in the settings row and moves
// by compare-and-swap: the UPDATE carries the version it read, and PostgREST
// filters on it, so exactly one of two simultaneous writers lands and the
// loser is told to try again with fresh numbers. No migration is needed for
// this; it is an ordinary conditional UPDATE on a row that already exists.
//
// It fails closed throughout. No settings row means Photo Reading is off, not
// unlimited, and a write that cannot be confirmed releases its slot.
import {
  PHOTO_READING_KEY, readPhotoReadingSettings, writePhotoReadingSettings,
  refusalReason, remainingOn, todayUtc, usedOn, withRelease, withReservation,
  type PhotoReadingSettings,
} from "@/lib/photo-reading";

/** How many times a loser of the compare-and-swap re-reads and tries again. */
const CAS_ATTEMPTS = 6;

async function loadRow(sb: any): Promise<PhotoReadingSettings | null> {
  const { data } = await sb.from("app_settings").select("value").eq("key", PHOTO_READING_KEY).maybeSingle();
  return data ? readPhotoReadingSettings(data.value) : null;
}

/** Current settings. An absent row reads as the defaults, which are Off. */
export async function loadPhotoReading(sb: any): Promise<PhotoReadingSettings> {
  return (await loadRow(sb)) ?? readPhotoReadingSettings(null);
}

/**
 * Write the configuration half (the switch and the limit), leaving the usage
 * counter alone. Owner-only — enforced by the caller AND by the RLS policy on
 * app_settings, which is admin-only for every command.
 */
export async function savePhotoReadingConfig(
  sb: any, actorId: string, patch: { enabled?: boolean; dailyLimit?: number; clearPause?: boolean },
): Promise<PhotoReadingSettings> {
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const current = await loadRow(sb);
    const base = current ?? readPhotoReadingSettings(null);
    const next: PhotoReadingSettings = {
      ...base,
      enabled: patch.enabled ?? base.enabled,
      dailyLimit: patch.dailyLimit ?? base.dailyLimit,
      pausedReason: patch.clearPause ? null : base.pausedReason,
      pausedAt: patch.clearPause ? null : base.pausedAt,
      updatedBy: actorId,
      updatedAt: new Date().toISOString(),
      version: base.version + 1,
    };
    const value = writePhotoReadingSettings(next);
    if (!current) {
      const { error } = await sb.from("app_settings").insert({ key: PHOTO_READING_KEY, value });
      if (!error) return next;
      continue; // lost the race to create it; re-read and patch instead
    }
    const { data } = await sb.from("app_settings").update({ value })
      .eq("key", PHOTO_READING_KEY).eq("value->>version", String(base.version)).select("key");
    if (data?.length) return next;
  }
  throw new Error("Could not save Photo Reading settings — too many simultaneous changes. Try again.");
}

/** Record a reason to stop spending. Used by the queue when the provider refuses. */
export async function pausePhotoReading(sb: any, reason: string): Promise<void> {
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const current = await loadRow(sb);
    if (!current || current.pausedReason) return;
    const next = { ...current, pausedReason: reason.slice(0, 200), pausedAt: new Date().toISOString(), version: current.version + 1 };
    const { data } = await sb.from("app_settings").update({ value: writePhotoReadingSettings(next) })
      .eq("key", PHOTO_READING_KEY).eq("value->>version", String(current.version)).select("key");
    if (data?.length) return;
  }
}

export type Reservation =
  | { ok: true; remaining: number; day: string }
  | { ok: false; error: string };

/**
 * Take one slot against today's limit, or explain why not.
 *
 * Call this immediately before queuing work and nowhere else — a reservation
 * that is taken and then not used has to be released, and the fewer places
 * that can happen, the better.
 */
export async function reservePhotoRead(sb: any, now: Date = new Date()): Promise<Reservation> {
  const day = todayUtc(now);
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const current = await loadRow(sb);
    // No row at all: Photo Reading has never been turned on. Fail closed.
    if (!current) return { ok: false, error: refusalReason(readPhotoReadingSettings(null), day) as string };
    const refused = refusalReason(current, day);
    if (refused) return { ok: false, error: refused };

    const next = withReservation(current, day);
    const { data } = await sb.from("app_settings").update({ value: writePhotoReadingSettings(next) })
      .eq("key", PHOTO_READING_KEY).eq("value->>version", String(current.version)).select("key");
    // Exactly one writer sees rows come back; the other re-reads and re-decides,
    // which is how the limit holds when two people press Read together.
    if (data?.length) return { ok: true, remaining: remainingOn(next, day), day };
  }
  return { ok: false, error: "Photo Reading is busy. Try again in a moment." };
}

/** Hand a reserved slot back, for work that was never queued. Best effort. */
export async function releasePhotoRead(sb: any, day: string): Promise<void> {
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const current = await loadRow(sb);
    if (!current || usedOn(current, day) <= 0) return;
    const next = withRelease(current, day);
    const { data } = await sb.from("app_settings").update({ value: writePhotoReadingSettings(next) })
      .eq("key", PHOTO_READING_KEY).eq("value->>version", String(current.version)).select("key");
    if (data?.length) return;
  }
}
