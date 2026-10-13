/**
 * Reading public.application_read_projection, and failing honestly when it
 * cannot be read.
 *
 * THE BUG THIS EXISTS FOR.
 *
 * Thirteen call sites read the projection view. Every one of them
 * destructured only `data` and ignored `error`:
 *
 *     const { data: apps } = await supabase
 *       .from("application_read_projection").select("id").eq("user_id", userId);
 *     const appIds = (apps ?? []).map(a => a.id);
 *
 * The view is created by migration 0030, which is NOT installed in
 * production. So `apps` comes back undefined, `appIds` is `[]`, the payments
 * query is skipped entirely, and the renter is shown an empty Payments tab —
 * presented as fact. Their application status reads null for the same reason,
 * and the pre-rental panel cannot tell an approved applicant from a rejected
 * one; its own comment warns that guessing "approved" there tells a rejected
 * person they are approved.
 *
 * None of that announces itself. A failed read and a renter with genuinely no
 * payments produce the identical screen.
 *
 * WHY THERE IS NO FALLBACK TO public.applications.
 *
 * The obvious repair — read the base table when the view is missing — was
 * checked against 0030 before being rejected, because it is NOT safe:
 *
 *   0030 revokes SELECT on public.applications from `authenticated` and
 *   re-grants ~40 allowlisted columns. getDriverProfile reads `city`,
 *   `address`, `state`, `zip` and `sms_consent`, and NONE of those five is
 *   in that allowlist. A column grant is not row-scoped, so the fallback
 *   would fail with permission denied even for a driver reading their own
 *   record.
 *
 *   Through the VIEW the same five are fine: 0030 returns `to_jsonb(a)`
 *   unmasked when `NOT private.is_staff() AND a.user_id = auth.uid()`, so a
 *   driver sees their whole row. The view is the supported path precisely
 *   because the base table is not.
 *
 * A fallback would therefore work for nine columns and fail for five, which
 * is the worst of both: half the portal silently degraded, half of it loudly
 * broken, and the 0030 boundary quietly routed around. So this module does
 * not widen access. It makes the failure visible and lets the caller stop.
 */

/** A projection read that could not be completed. Never an empty result. */
export class ApplicationReadUnavailable extends Error {
  readonly kind: ProjectionFailure;
  readonly where: string;
  constructor(kind: ProjectionFailure, where: string, detail?: string) {
    super(MESSAGES[kind](where) + (detail ? ` (${detail})` : ""));
    this.name = "ApplicationReadUnavailable";
    this.kind = kind;
    this.where = where;
  }
}

export type ProjectionFailure = "missing_view" | "denied" | "failed";

const MESSAGES: Record<ProjectionFailure, (where: string) => string> = {
  // The operator-facing cause is named, because this one is a deployment
  // ordering mistake and the person reading the log needs to know which.
  missing_view: (w) =>
    `Your account details are temporarily unavailable, so ${w} cannot be shown right now. ` +
    `The application projection (migration 0030) is not installed on this environment.`,
  denied: (w) =>
    `Your account details could not be read, so ${w} cannot be shown right now. ` +
    `The application projection refused this request.`,
  failed: (w) => `Your account details could not be read, so ${w} cannot be shown right now.`,
};

/** Shape of the error PostgREST hands back. */
type PgError = { code?: string | null; message?: string | null } | null | undefined;

/**
 * Which kind of failure this is, or null when the read succeeded.
 *
 * `42P01` is Postgres's undefined_table; PostgREST reports an unknown
 * relation as `PGRST205` and a missing column as `PGRST204`/`42703`. The
 * message is checked as well, because the code is not always populated and a
 * missing view must never be mistaken for a genuine empty result.
 */
export function classifyProjectionError(err: PgError): ProjectionFailure | null {
  if (!err) return null;
  const code = String(err.code ?? "");
  const msg = String(err.message ?? "");
  if (code === "42P01" || code === "PGRST205" || /does not exist|could not find the table|unknown relation/i.test(msg))
    return "missing_view";
  if (code === "42501" || /permission denied|not authorized|insufficient privilege/i.test(msg))
    return "denied";
  return "failed";
}

/**
 * Throw unless the read actually succeeded.
 *
 * `where` names what the renter was trying to see, so the message says which
 * part of their portal is unavailable rather than leaking a relation name.
 */
export function assertProjectionOk(err: PgError, where: string): void {
  const kind = classifyProjectionError(err);
  if (!kind) return;
  throw new ApplicationReadUnavailable(kind, where, err?.code ? String(err.code) : undefined);
}

/**
 * True when a thrown value is this failure — for callers that degrade a
 * single panel rather than the whole page.
 */
export function isApplicationReadUnavailable(e: unknown): e is ApplicationReadUnavailable {
  return e instanceof Error && e.name === "ApplicationReadUnavailable";
}
