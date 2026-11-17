/**
 * Texts that failed only because the Quo account was out of prepaid credits
 * (Quo: "Not Enough Credits"), sent again once credit is back (Dolmar, t352u).
 *
 * Runs from the 5-minute automations cron. Narrow on purpose:
 *   - only applicant follow-up and missing-items texts (kinds below), never
 *     payment notices (those have their own held-notice retry);
 *   - only failures from the last 24 hours, at least 15 minutes old;
 *   - only inside 9 AM-8 PM ET (the stricter of the follow-up and
 *     missing-items sending windows; never outside 8 AM-9 PM);
 *   - never to an applicant who has since been approved, declined, closed or
 *     marked duplicate, or who opted out (sendSms re-checks STOP and consent);
 *   - never when the same text already reached that number later;
 *   - each failed row is retried once. The old row is marked
 *     "[retried] ..." so no later run picks it up again; a retry that fails for
 *     credits again is a new row and gets at most two more tries (3 in 24h).
 * The text is the exact body that failed. No new link is minted.
 */
export const CREDIT_ERROR_RE = /not enough credits/i;
export const CREDIT_RETRY_KINDS = ["missing_items", "automation"] as const;
const STOP_STATUSES = ["approved", "active", "declined", "rejected", "closed", "duplicate"];
const MAX_TRIES_PER_TEXT = 3;

export type CreditRetrySummary = { ok: boolean; held?: string; considered: number; retried: number; sent: number; skipped: Record<string, number> };

function easternHour(at: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(at));
}

type Deps = {
  now?: () => Date;
  sendSms?: (a: { to: string; body: string; kind: string; applicationId: string | null; rentalId?: string | null; workflowId?: string | null; fromId?: string | null }) => Promise<{ ok: boolean; skipped?: boolean; reason?: string; error?: string }>;
};

export async function retryCreditFailedSms(admin: any, opts: { limit?: number } = {}, deps: Deps = {}): Promise<CreditRetrySummary> {
  const now = (deps.now ?? (() => new Date()))();
  const out: CreditRetrySummary = { ok: true, considered: 0, retried: 0, sent: 0, skipped: {} };
  const skip = (why: string) => (out.skipped[why] = (out.skipped[why] ?? 0) + 1);
  const h = easternHour(now);
  if (h < 9 || h >= 20) return { ...out, held: "outside_sending_hours" };

  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const settle = new Date(now.getTime() - 15 * 60_000).toISOString();
  const { data: rows, error } = await admin
    .from("outbound_messages")
    .select("id,to_address,from_address,body,kind,application_id,rental_id,workflow_id,error,created_at")
    .eq("channel", "sms")
    .eq("status", "failed")
    .in("kind", [...CREDIT_RETRY_KINDS])
    .ilike("error", "%not enough credits%")
    .gte("created_at", since)
    .lte("created_at", settle)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return { ...out, ok: false, held: "messages_unreadable" };
  const list = ((rows ?? []) as any[]).filter((r) => CREDIT_ERROR_RE.test(String(r.error ?? "")) && !String(r.error).startsWith("[retried]"));
  out.considered = list.length;
  if (!list.length) return out;

  const send = deps.sendSms ?? (async (a) => (await import("@/lib/sms.server")).sendSms(a as any));
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  for (const r of list) {
    if (out.retried >= limit) break;
    // Claim: mark the failed row first, so an overlapping run cannot send it too.
    const claim = await admin
      .from("outbound_messages")
      .update({ error: `[retried] ${String(r.error).slice(0, 180)}` })
      .eq("id", r.id)
      .eq("status", "failed")
      .not("error", "like", "[retried]%")
      .select("id");
    if (claim.error || !Array.isArray(claim.data) || !claim.data.length) { skip("claimed_elsewhere"); continue; }

    const [{ data: later }, { data: tries }, appRes] = await Promise.all([
      admin.from("outbound_messages").select("id").eq("channel", "sms").eq("to_address", r.to_address).eq("body", r.body).in("status", ["sent", "queued"]).gt("created_at", r.created_at).limit(1),
      admin.from("outbound_messages").select("id").eq("channel", "sms").eq("to_address", r.to_address).eq("body", r.body).eq("status", "failed").ilike("error", "%not enough credits%").gte("created_at", since),
      r.application_id ? admin.from("applications").select("status,deleted_at").eq("id", r.application_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (Array.isArray(later) && later.length) { skip("already_delivered"); continue; }
    if (Array.isArray(tries) && tries.length >= MAX_TRIES_PER_TEXT) { skip("max_tries"); continue; }
    const app = (appRes as any)?.data;
    if (r.application_id && (!app || app.deleted_at || STOP_STATUSES.includes(String(app.status)))) { skip(`status_${app?.status ?? "missing"}`); continue; }

    // Same line it was meant to go from (sendSms only accepts allowlisted numbers).
    const fromId = r.from_address ? String(r.from_address) : null;
    out.retried++;
    const res = await send({ to: r.to_address, body: r.body, kind: r.kind, applicationId: r.application_id ?? null, rentalId: r.rental_id ?? null, workflowId: r.workflow_id ?? null, fromId });
    if (res.ok) {
      out.sent++;
      if (r.kind === "missing_items" && r.application_id) {
        // The outreach row for this send recorded "sms: Not Enough Credits"; it reached them now.
        const { data: logs } = await admin
          .from("applicant_outreach_log")
          .select("id,channels,error,created_at")
          .eq("application_id", r.application_id)
          .ilike("error", "%not enough credits%")
          .order("created_at", { ascending: false })
          .limit(1);
        const l = (logs ?? [])[0];
        if (l) {
          const channels = Array.from(new Set([...(l.channels ?? []), "sms"]));
          await admin.from("applicant_outreach_log").update({ channels, error: null }).eq("id", l.id);
        }
      }
    } else skip(("reason" in res && res.reason) || "send_failed");
  }
  return out;
}
