import { CLOSED_RESUME_STATUSES, isClosedResumeStatus } from "@/lib/application-resume-flag";
import type { SendResult } from "@/lib/email.server";

/*
 * The hourly "you didn't finish your application" nudges: the 24h and 72h
 * reminders and the one-shot abandoned-quote email.
 *
 * Two rules keep these from going to the wrong person or going twice.
 *
 * 1. Only open drafts. Soft-deleted (deleted_at) and purged (purged_at) rows
 *    are never emailed, and neither is anything already decided — the closed
 *    list is CLOSED_RESUME_STATUSES (approved, active, suspended, declined,
 *    closed, duplicate, complete), the same list that refuses a resume token.
 *    The old filter named a status, 'rejected', that this app never writes,
 *    so declined, closed, duplicate and suspended applicants were nudged.
 *
 * 2. Claim before sending. The stamp column is set with a conditional update
 *    (WHERE stamp IS NULL, plus the same open-draft conditions, RETURNING id),
 *    and only a row this run actually claimed is emailed. Two overlapping
 *    runs cannot both claim a row, so they cannot both send. Sending first
 *    and stamping after — which this replaced — let a slow run and the next
 *    hourly run email the same applicant twice.
 *
 * Delivery is at most once. A claim is released (stamp set back to NULL, but
 * only if it still holds this run's value) when the send definitely did not
 * happen: the sender threw before reaching the provider, or the provider
 * refused outright. An uncertain outcome (timeout, 5xx, 409) keeps the claim,
 * because a second email is worse than a missed nudge.
 */

type Admin = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

/** PostgREST `in` list for the closed statuses. Values are fixed identifiers. */
export const CLOSED_STATUS_FILTER = `(${CLOSED_RESUME_STATUSES.join(",")})`;

/** Steps that mean "has applied" (see hasApplied). NULL current_step is still a draft. */
export const APPLIED_STEPS = [
  "submitted",
  "documents",
  "profile_complete",
  "confirmation",
  "complete",
  "done",
] as const;
const NOT_APPLIED_FILTER = `current_step.is.null,current_step.not.in.(${APPLIED_STEPS.join(",")})`;

export type StampColumn =
  "recovery_email_sent_24h" | "recovery_email_sent_72h" | "recovery_sent_at";

export type WizardRecoveryDeps = {
  sendWizardRecoveryEmail: (args: {
    to: string;
    firstName: string | null;
    applicationId: string;
    variant: "24h" | "72h";
  }) => Promise<SendResult | void>;
  sendAbandonedRecoveryEmail: (args: {
    to: string;
    firstName: string | null;
    applicationId: string;
    market: string | null;
    pickupDate: string | null;
  }) => Promise<SendResult | void>;
  now?: () => number;
  log?: (message: string, ...rest: unknown[]) => void;
};

export type WizardRecoveryReport = {
  ok: true;
  considered_24h: number;
  considered_72h: number;
  considered_abandoned: number;
  sent_24h: number;
  sent_72h: number;
  sent_abandoned: number;
  skipped_claimed: number;
  failed: number;
};

/**
 * Has this person actually applied?
 *
 * These emails say "you didn't finish". Sending one to somebody who submitted
 * Part 1 and simply has not uploaded their licence yet is both false and
 * insulting — Part 1 is the application, and an incomplete Part 2 is not an
 * abandoned anything. So `submitted`, `documents` and `profile_complete` all
 * count as applied and stop the nudges.
 *
 * The legacy steps stay in the list: applications from before the Part 1 /
 * Part 2 split finished on `confirmation`.
 */
export function hasApplied(step: unknown, status: unknown): boolean {
  const s = typeof step === "string" ? step.toLowerCase() : "";
  const st = typeof status === "string" ? status.toLowerCase() : "";
  if (st === "complete" || st === "completed" || st === "submitted") return true;
  if (["submitted", "documents", "profile_complete"].includes(s)) return true;
  if (s === "confirmation" || s === "complete" || s === "done") return true;
  return false;
}

/** Row-level re-check of the query filters. The database filter is the gate; this is a backstop. */
export function isRecoveryCandidate(row: {
  status?: unknown;
  current_step?: unknown;
  deleted_at?: unknown;
  purged_at?: unknown;
  email?: unknown;
}): boolean {
  if (row.deleted_at || row.purged_at) return false;
  if (typeof row.email !== "string" || !row.email.trim()) return false;
  if (isClosedResumeStatus(row.status)) return false;
  return !hasApplied(row.current_step, row.status);
}

/** Atomically stamp one row if nobody has yet. True only when this call won the row. */
export async function claimRecoverySend(
  admin: Admin,
  id: string,
  column: StampColumn,
  stamp: string,
  extra: (q: any) => any = (q) => q,
): Promise<{ claimed: boolean; error: string | null }> {
  let q: any = (admin as any)
    .from("applications")
    .update({ [column]: stamp })
    .eq("id", id)
    .is(column, null)
    .is("deleted_at", null)
    .is("purged_at", null)
    .not("status", "in", CLOSED_STATUS_FILTER)
    // Re-checked at claim time: somebody who submitted between the read and
    // this write must not be told they didn't finish.
    .or(NOT_APPLIED_FILTER);
  q = extra(q);
  const { data, error } = await q.select("id");
  if (error) return { claimed: false, error: error.message ?? "update failed" };
  return { claimed: Array.isArray(data) && data.length > 0, error: null };
}

/** Undo this run's claim, and only this run's: the stamp must still be ours. */
async function releaseRecoveryClaim(admin: Admin, id: string, column: StampColumn, stamp: string) {
  const { error } = await (admin as any)
    .from("applications")
    .update({ [column]: null })
    .eq("id", id)
    .eq(column, stamp)
    .select("id");
  return !error;
}

/** Whether a send definitely did not reach the provider, so a later run may try again. */
function definitelyNotSent(result: SendResult | void | undefined, threw: boolean): boolean {
  if (threw) return true;
  if (!result) return false; // legacy void sender: assume it went
  return result.ok === false && result.uncertain !== true;
}

export async function runWizardRecovery(
  admin: Admin,
  deps: WizardRecoveryDeps,
): Promise<WizardRecoveryReport> {
  const log = deps.log ?? ((m: string, ...r: unknown[]) => console.error(m, ...r));
  const now = (deps.now ?? Date.now)();
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600 * 1000).toISOString();
  const h24 = iso(24);
  const h26 = iso(26); // window: leads created 24–26h ago (avoid backfilling ancient rows)
  const h72 = iso(72);
  const h96 = iso(96);
  const h3 = iso(3);
  const h48 = iso(48);

  const cols =
    "id, full_name, email, current_step, status, created_at, deleted_at, purged_at, recovery_email_sent_24h, recovery_email_sent_72h";
  const db = admin as any;

  // 24h nudge: created between 26h and 24h ago, not sent yet, open draft.
  const { data: batch24, error: err24 } = await db
    .from("applications")
    .select(cols)
    .lt("created_at", h24)
    .gte("created_at", h26)
    .is("recovery_email_sent_24h", null)
    .is("deleted_at", null)
    .is("purged_at", null)
    .not("email", "is", null)
    .not("status", "in", CLOSED_STATUS_FILTER);
  if (err24) log("[wizard-recovery] 24h query failed", err24.message);

  // 72h nudge: created between 96h and 72h ago, 24h nudge already sent, 72h not yet, open draft.
  const { data: batch72, error: err72 } = await db
    .from("applications")
    .select(cols)
    .lt("created_at", h72)
    .gte("created_at", h96)
    .not("recovery_email_sent_24h", "is", null)
    .is("recovery_email_sent_72h", null)
    .is("deleted_at", null)
    .is("purged_at", null)
    .not("email", "is", null)
    .not("status", "in", CLOSED_STATUS_FILTER);
  if (err72) log("[wizard-recovery] 72h query failed", err72.message);

  // Abandoned recovery: status='partial' created between 3h and 48h ago, single send.
  const { data: batchAbandoned, error: errAb } = await db
    .from("applications")
    .select(
      "id, full_name, email, city, state, pickup_date, market_id, current_step, status, deleted_at, purged_at",
    )
    .eq("status", "partial")
    .lt("created_at", h3)
    .gte("created_at", h48)
    .is("recovery_sent_at", null)
    .is("deleted_at", null)
    .is("purged_at", null)
    .not("email", "is", null);
  if (errAb) log("[wizard-recovery] abandoned query failed", errAb.message);

  const report: WizardRecoveryReport = {
    ok: true,
    considered_24h: batch24?.length ?? 0,
    considered_72h: batch72?.length ?? 0,
    considered_abandoned: batchAbandoned?.length ?? 0,
    sent_24h: 0,
    sent_72h: 0,
    sent_abandoned: 0,
    skipped_claimed: 0,
    failed: 0,
  };

  /** Claim, send, and release only on a send that definitely did not happen. */
  async function claimAndSend(
    row: any,
    column: StampColumn,
    label: string,
    send: () => Promise<SendResult | void>,
    extra?: (q: any) => any,
  ): Promise<boolean> {
    if (!isRecoveryCandidate(row)) return false;
    const stamp = new Date().toISOString();
    const claim = await claimRecoverySend(admin, row.id, column, stamp, extra);
    if (claim.error) {
      log(`[wizard-recovery] ${label} claim failed`, row.id, claim.error);
      report.failed++;
      return false;
    }
    if (!claim.claimed) {
      // Another run already claimed it, or it stopped being an open draft.
      report.skipped_claimed++;
      return false;
    }
    let result: SendResult | void | undefined;
    let threw = false;
    try {
      result = await send();
    } catch (err) {
      threw = true;
      log(`[wizard-recovery] ${label} send failed`, row.id, err);
    }
    if (!threw && (!result || result.ok)) return true;
    report.failed++;
    if (!threw) log(`[wizard-recovery] ${label} provider did not accept`, row.id, result?.error);
    if (definitelyNotSent(result, threw)) {
      const released = await releaseRecoveryClaim(admin, row.id, column, stamp);
      if (!released) log(`[wizard-recovery] ${label} claim release failed`, row.id);
    }
    return false;
  }

  for (const row of batchAbandoned ?? []) {
    const sent = await claimAndSend(
      row,
      "recovery_sent_at",
      "abandoned",
      async () => {
        let marketName: string | null = null;
        if (row.market_id) {
          const { data: m } = await db
            .from("markets")
            .select("name")
            .eq("id", row.market_id as string)
            .maybeSingle();
          marketName = m?.name ?? null;
        }
        return deps.sendAbandonedRecoveryEmail({
          to: row.email as string,
          firstName: row.full_name as string | null,
          applicationId: row.id as string,
          market: marketName ?? (row.city as string | null),
          pickupDate: row.pickup_date as string | null,
        });
      },
      (q) => q.eq("status", "partial"),
    );
    if (sent) report.sent_abandoned++;
  }

  for (const row of batch24 ?? []) {
    const sent = await claimAndSend(row, "recovery_email_sent_24h", "24h", () =>
      deps.sendWizardRecoveryEmail({
        to: row.email as string,
        firstName: row.full_name as string | null,
        applicationId: row.id as string,
        variant: "24h",
      }),
    );
    if (sent) report.sent_24h++;
  }

  for (const row of batch72 ?? []) {
    const sent = await claimAndSend(
      row,
      "recovery_email_sent_72h",
      "72h",
      () =>
        deps.sendWizardRecoveryEmail({
          to: row.email as string,
          firstName: row.full_name as string | null,
          applicationId: row.id as string,
          variant: "72h",
        }),
      (q) => q.not("recovery_email_sent_24h", "is", null),
    );
    if (sent) report.sent_72h++;
  }

  return report;
}
