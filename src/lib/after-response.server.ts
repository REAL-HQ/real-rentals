/**
 * Keep a side effect (an alert email) alive after the handler returns.
 *
 * A bare `void promise` is cut off when the response is sent: the request
 * ends and the pending Resend call dies with it (Nov 16–22 2026: 15 lead
 * alerts stuck at "sending", 6 never sent). This mirrors the driver-issue
 * notices (driver-issues.functions.ts): use the runtime's waitUntil when it
 * has one, otherwise wait for the work, but never longer than maxWaitMs so a
 * slow provider cannot hold the applicant's form.
 *
 * Never throws. A timeout does not abort the work; if the request is then cut
 * off, the lead-alert sweep (lead-alert-sweep.server.ts) picks the row up.
 */
export type WaitUntil = (promise: Promise<unknown>) => void;
export type KeepAliveOutcome = "background" | "done" | "timeout";

export async function requestWaitUntil(context?: unknown): Promise<WaitUntil | undefined> {
  const fromContext = (context as { waitUntil?: WaitUntil } | undefined)?.waitUntil;
  if (typeof fromContext === "function") return fromContext;
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest() as { waitUntil?: WaitUntil } | undefined;
    return typeof request?.waitUntil === "function" ? request.waitUntil.bind(request) : undefined;
  } catch {
    return undefined;
  }
}

export async function keepAlive(
  work: Promise<unknown>,
  opts: { maxWaitMs: number; context?: unknown; waitUntil?: WaitUntil | null },
): Promise<KeepAliveOutcome> {
  const guarded = work.catch((err) => {
    console.error("[keep-alive] background work failed", err);
  });
  try {
    const waitUntil = opts.waitUntil === undefined ? await requestWaitUntil(opts.context) : opts.waitUntil ?? undefined;
    if (waitUntil) {
      waitUntil(guarded);
      return "background";
    }
  } catch (err) {
    console.error("[keep-alive] waitUntil unavailable; waiting inline", err);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<KeepAliveOutcome>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, opts.maxWaitMs));
  });
  try {
    return await Promise.race([guarded.then(() => "done" as const), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
