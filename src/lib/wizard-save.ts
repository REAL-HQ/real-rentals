/*
 * Save reliability for the application wizard. Pure logic, no React, no
 * network: the wizard supplies the write function, and the unit tests drive
 * this with fake clocks.
 *
 * Three jobs:
 *
 *  - Classify which failures are worth retrying: PostgreSQL serialization
 *    conflicts (SQLSTATE 40001, which the M2 guards raise as a "busy, try
 *    again" signal and which can happen transiently today) and network
 *    failures. A validation error or an expired link is not retried — the
 *    same request would fail the same way.
 *  - Retry those with bounded exponential backoff and jitter. Every wizard
 *    write sets absolute values (updateApplicationStep never increments), so
 *    replaying one is idempotent.
 *  - Sequence writes. Autosave and the explicit step change (go()) share one
 *    queue, so an autosave already on the wire finishes before the step
 *    change is sent, and an autosave that has not started yet is dropped once
 *    the step changes. Without this a slow autosave carrying step:"rental"
 *    could land after step:"driving" and walk current_step backwards.
 */

import { APPLICATION_LOCKED_MESSAGE } from "@/lib/application-edit-status";

/**
 * The application has been decided (PR 1's edit lock). Terminal: no retry
 * can save it, and the wizard switches to its read-only screen.
 */
export function isApplicationLockedError(err: unknown): boolean {
  const message =
    err && typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : typeof err === "string"
        ? err
        : "";
  return message === APPLICATION_LOCKED_MESSAGE;
}

/** Marker the server puts in a 40001 error message so the browser can recognise it. */
export const SAVE_BUSY_CODE = "40001";

/** The applicant-facing text for a serialization conflict that outlived its retries. */
export const SAVE_BUSY_MESSAGE = `Another save was still finishing, so this one didn't go through. Please try again. (code ${SAVE_BUSY_CODE})`;

const NETWORK_PATTERNS = [
  /failed to fetch/i, // Chrome
  /networkerror/i, // Firefox
  /load failed/i, // Safari
  /network request failed/i,
  /network connection was lost/i,
  /the internet connection appears to be offline/i,
  /fetch failed/i, // Node / undici
  /econnreset|etimedout|econnrefused|socket hang up/i,
];

/** True for failures a retry can plausibly fix. */
export function isRetryableSaveError(err: unknown): boolean {
  if (err == null) return false;
  // Checked first and on its own: a locked application is never retried.
  if (isApplicationLockedError(err)) return false;
  const e = err as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
  if (e.code === SAVE_BUSY_CODE || e.code === "40P01") return true;
  const status = typeof e.status === "number" ? e.status : null;
  if (status === 502 || status === 503 || status === 504) return true;
  const message = typeof e.message === "string" ? e.message : typeof err === "string" ? err : "";
  if (new RegExp(`\\b${SAVE_BUSY_CODE}\\b`).test(message)) return true;
  if (/could not serialize access|deadlock detected/i.test(message)) return true;
  // A TypeError from fetch is how every browser reports "no response at all".
  if (e.name === "TypeError" && /fetch|network|load failed/i.test(message)) return true;
  return NETWORK_PATTERNS.some((p) => p.test(message));
}

export type RetryOptions = {
  /** Total attempts including the first. */
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Checked before each retry. Returning false stops retrying and rethrows the last error. */
  shouldContinue?: () => boolean;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
};

export const DEFAULT_SAVE_ATTEMPTS = 4;

/**
 * Delay before retry number `attempt` (1-based): exponential, capped, with
 * "equal jitter" — half fixed, half random — so many tabs retrying after the
 * same conflict spread out instead of colliding again.
 */
export function retryDelayMs(
  attempt: number,
  {
    baseMs = 400,
    maxMs = 6000,
    random = Math.random,
  }: Pick<RetryOptions, "baseMs" | "maxMs" | "random"> = {},
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const r = Math.min(1, Math.max(0, random()));
  return Math.round(ceiling / 2 + r * (ceiling / 2));
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Run `fn`, retrying retryable failures with backoff. Non-retryable failures throw at once. */
export async function withSaveRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_SAVE_ATTEMPTS);
  const sleep = opts.sleep ?? realSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryableSaveError(err) || attempt === attempts) throw err;
      if (opts.shouldContinue && !opts.shouldContinue()) throw err;
      const delay = retryDelayMs(attempt, opts);
      opts.onRetry?.(attempt, delay, err);
      await sleep(delay);
      if (opts.shouldContinue && !opts.shouldContinue()) throw err;
    }
  }
  throw lastError;
}

/** Thrown (and swallowed by callers) when a queued autosave was overtaken by a step change. */
export class SaveSuperseded extends Error {
  constructor() {
    super("Superseded by a newer step change.");
    this.name = "SaveSuperseded";
  }
}

/**
 * One queue for every write the wizard makes.
 *
 * `epoch` moves forward on every step change. An autosave records the epoch it
 * was scheduled in; if the epoch has moved by the time its turn comes (or
 * before one of its retries), it is dropped. A step change waits for whatever
 * write is already on the wire, then goes — so it is always the last word.
 */
export function createSaveSequencer() {
  let tail: Promise<unknown> = Promise.resolve();
  let epoch = 0;
  let inFlight = 0;
  // Autosaves waiting out a backoff. A step change wakes them so they notice
  // they are stale at once, instead of holding the Next button for a backoff.
  const sleepers = new Set<() => void>();
  const wakeAll = () => {
    for (const wake of [...sleepers]) wake();
  };
  function interruptible(sleep: (ms: number) => Promise<void>) {
    return (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          sleepers.delete(done);
          resolve();
        };
        sleepers.add(done);
        sleep(ms).then(done, done);
      });
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    // On an idle queue the write starts now, synchronously, so "on the wire"
    // means exactly that; otherwise it waits for the previous write to settle.
    const run: Promise<T> =
      inFlight === 0
        ? new Promise<T>((resolve) => resolve(task()))
        : tail.then(
            () => task(),
            () => task(),
          );
    inFlight++;
    const settled = run.finally(() => {
      inFlight--;
    });
    tail = settled.catch(() => undefined);
    return settled;
  }

  return {
    /** Current epoch, for an autosave to remember. */
    get epoch() {
      return epoch;
    },
    /** Whether any write is queued or on the wire. */
    get busy() {
      return inFlight > 0;
    },
    /** Field-only autosave. Dropped if a step change happens before it runs. */
    autosave<T>(write: () => Promise<T>, retry: RetryOptions = {}): Promise<T> {
      const mine = epoch;
      const current = () => epoch === mine;
      return enqueue(async () => {
        if (!current()) throw new SaveSuperseded();
        return withSaveRetry(write, {
          ...retry,
          sleep: interruptible(retry.sleep ?? realSleep),
          shouldContinue: () => current() && (retry.shouldContinue?.() ?? true),
        });
      });
    },
    /**
     * A write that must not overlap the others but does not change the step
     * (Part 2 upload saves). Retried like the rest; never dropped.
     */
    serial<T>(write: () => Promise<T>, retry: RetryOptions = {}): Promise<T> {
      return enqueue(() => withSaveRetry(write, retry));
    },
    /** Step change. Bumps the epoch first, so no older autosave can run after it. */
    stepChange<T>(write: () => Promise<T>, retry: RetryOptions = {}): Promise<T> {
      epoch++;
      wakeAll();
      return enqueue(() => withSaveRetry(write, retry));
    },
  };
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Shown when a file reached storage but saving its path to the application
 * failed. The file is not "on file" until that save succeeds.
 */
export const UPLOAD_SAVE_FAILED_MESSAGE =
  "Your file uploaded, but we couldn't save it to your application yet. Tap Retry.";

/**
 * Write a value to the application, and only then mark it on file.
 *
 * `save` failing leaves the mark untouched and rethrows with the
 * applicant-facing message, so the caller's uploader shows it next to the
 * file with a Retry.
 */
export async function saveThenMark(
  save: () => Promise<unknown>,
  mark: () => void,
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    await save();
  } catch (err) {
    onError?.(err);
    throw new Error(UPLOAD_SAVE_FAILED_MESSAGE);
  }
  mark();
}

/**
 * Upload a file, then save its path. If the save fails, the stored path is
 * remembered against that File, so a retry with the same File re-sends the
 * save only — the photo is not checked, uploaded (and stored) a second time.
 */
export function createUploadThenSave<F extends object>(
  save: (path: string) => void | Promise<void>,
) {
  const stored = new WeakMap<F, string>();
  return async (
    file: F,
    upload: () => Promise<{ path: string }>,
    onProgress: (pct: number) => void = () => {},
  ): Promise<string> => {
    let path = stored.get(file);
    if (!path) {
      ({ path } = await upload());
      stored.set(file, path);
    }
    onProgress(90);
    await save(path);
    stored.delete(file);
    onProgress(100);
    return path;
  };
}
