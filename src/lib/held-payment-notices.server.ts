// Retry for payment notices HELD because the Back Office → Automations
// switches could not be read: receipt, payment failed, card expiring, and the
// team failure alert — for one-off charges, multi-row charges and weekly
// subscription invoices.
//
// The webhook keeps its notice claim (payments.notified_status) exactly as
// before, so a Stripe replay still claims nothing and repeats no side effect.
// A held send is instead written to public.held_notices (staged migration
// proposed/held-notices-v1): references only, one row per (kind, Stripe id).
// This sweep, run by the 5-minute automations cron:
//   * does nothing while the switches are unreadable or the table is missing;
//   * drops a notice the Owner has switched off (no replay across an Off),
//     one older than 7 days, or one whose payment rows moved on (a receipt for
//     a refunded charge, a failure notice once paid / waived / void / refunded,
//     a card notice once the card is no longer expiring);
//   * claims it (held → sending) before sending, so overlapping runs can't
//     both send; a row stuck in "sending" is never resent (its outcome is
//     unknown), it is marked failed for staff;
//   * rebuilds the email from current records (no stored body or address).
import { gateFor, loadAutomationControls } from "@/lib/automation-controls.server";
import { isAutomationOn } from "@/lib/automation-catalog";

export const MAX_PER_RUN = 20;
export const STALE_DAYS = 7;
const SENDING_STUCK_MS = 15 * 60 * 1000;

export type HeldKind = "payment_receipt" | "payment_failed" | "card_expiring" | "payment_team_alert";
export type HeldNoticeInput = {
  kind: HeldKind;
  sourceRef: string;
  rentalId: string | null;
  paymentIds: string[];
  outcome: "paid" | "failed";
  amount: number;
  reason: string;
};

type SendRes = { ok: boolean; blocked?: "off" | "held" } | void | undefined;

/** Record a held notice. Never throws; false when the table is missing or the write failed. */
export async function holdNotice(admin: any, n: HeldNoticeInput): Promise<boolean> {
  try {
    const { error } = await admin.from("held_notices").upsert({
      kind: n.kind, source_ref: n.sourceRef, rental_id: n.rentalId, payment_ids: n.paymentIds,
      outcome: n.outcome, amount: n.amount, reason: n.reason, status: "held",
    }, { onConflict: "kind,source_ref", ignoreDuplicates: true });
    if (error) { console.error("[held-notices] could not record", n.kind, error.message ?? error); return false; }
    return true;
  } catch (err) {
    console.error("[held-notices] could not record", n.kind, err);
    return false;
  }
}

/** Call after any notice send: records it for retry only when it was held. */
export async function holdIfHeld(admin: any, res: SendRes, n: HeldNoticeInput): Promise<void> {
  if (res && (res as any).blocked === "held") await holdNotice(admin, n);
}

const GONE = ["void", "waived", "refunded"];

export type Deps = {
  sendReceipt: (a: any) => Promise<SendRes>;
  sendFailed: (a: any) => Promise<SendRes>;
  sendCardExpiring: (a: any) => Promise<SendRes>;
  sendTeamAlert: (a: any) => Promise<SendRes>;
  now?: () => number;
};

export type HeldNoticeReport = { checked: number; sent: number; dropped: number; stillHeld: number; failed: number; skipped?: "settings_unreadable" | "queue_unavailable" | "retry_off" };

function cardExpiresSoon(m: number | null, y: number | null, now: Date): boolean {
  if (!m || !y) return false;
  const soon = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  return new Date(y, m, 1) <= soon;
}

export async function retryHeldNotices(admin: any, deps: Deps): Promise<HeldNoticeReport> {
  const report: HeldNoticeReport = { checked: 0, sent: 0, dropped: 0, stillHeld: 0, failed: 0 };
  const now = deps.now ? deps.now() : Date.now();
  const controls = await loadAutomationControls(admin);
  if (controls.status === "error") return { ...report, skipped: "settings_unreadable" };
  // Retry is OFF until an Owner turns on "Held Retry"; deploying this never sends anything by itself.
  if (!isAutomationOn(controls.value, "held_retry")) return { ...report, skipped: "retry_off" };

  // Anything left "sending" by a crashed run may have been sent: never resend it.
  const stuckBefore = new Date(now - SENDING_STUCK_MS).toISOString();
  await admin.from("held_notices").update({ status: "failed", last_note: "Outcome unknown after an interrupted send; not resent." })
    .eq("status", "sending").lt("updated_at", stuckBefore).then(() => {}, () => {});

  const { data: rows, error } = await admin.from("held_notices")
    .select("id,kind,source_ref,rental_id,payment_ids,outcome,amount,reason,status,attempts,created_at,updated_at")
    .eq("status", "held").order("created_at", { ascending: true }).limit(MAX_PER_RUN);
  if (error) return { ...report, skipped: "queue_unavailable" };

  for (const n of (rows ?? []) as any[]) {
    report.checked++;
    const finish = async (status: "dropped" | "sent" | "failed" | "held", note: string | null, from = "sending") => {
      await admin.from("held_notices").update({ status, last_note: note, updated_at: new Date(now).toISOString() }).eq("id", n.id).eq("status", from);
    };
    const drop = async (note: string) => { await finish("dropped", note, "held"); report.dropped++; };

    if (now - Date.parse(n.created_at) > STALE_DAYS * 86400000) { await drop("Older than 7 days."); continue; }
    if (gateFor(controls, n.kind) === "off") { await drop("Switched off in Automations."); continue; }

    const ids: string[] = n.payment_ids ?? [];
    const { data: pays } = ids.length
      ? await admin.from("payments").select("id,status").in("id", ids)
      : { data: [] as any[] };
    const statuses = ((pays ?? []) as any[]).map((p) => p.status as string);
    if (!statuses.length) { await drop("Payment rows not found."); continue; }
    if (n.outcome === "paid" && !statuses.every((s) => s === "paid")) { await drop("Charge is no longer paid."); continue; }
    if (n.outcome === "failed" && statuses.every((s) => s === "paid" || GONE.includes(s))) { await drop("Charge was paid or closed since."); continue; }

    const { data: rental } = await admin.from("rentals")
      .select("application_id, vehicles:vehicle_id(license_plate), applications:application_id(email, full_name, card_brand, card_last4, card_exp_month, card_exp_year)")
      .eq("id", n.rental_id).maybeSingle();
    const app = rental?.applications;
    if (n.kind !== "payment_team_alert" && !app?.email) { await drop("Renter email not on file."); continue; }
    if (n.kind === "card_expiring" && !cardExpiresSoon(app?.card_exp_month ?? null, app?.card_exp_year ?? null, new Date(now))) { await drop("Card no longer expiring."); continue; }

    const claim = await admin.from("held_notices").update({ status: "sending", attempts: (n.attempts ?? 0) + 1, updated_at: new Date(now).toISOString() })
      .eq("id", n.id).eq("status", "held").select("id");
    if (!claim.data?.length) continue;

    const base = { to: app?.email, firstName: app?.full_name ?? null, amount: Number(n.amount ?? 0), reason: String(n.reason ?? "rent"), brand: app?.card_brand ?? null, last4: app?.card_last4 ?? null };
    let res: SendRes;
    try {
      res = n.kind === "payment_receipt" ? await deps.sendReceipt(base)
        : n.kind === "payment_failed" ? await deps.sendFailed(base)
        : n.kind === "card_expiring" ? await deps.sendCardExpiring({ ...base, expMonth: app.card_exp_month, expYear: app.card_exp_year })
        : await deps.sendTeamAlert({ event: "failed", driverName: app?.full_name ?? null, amount: base.amount, reason: base.reason, applicationId: rental?.application_id ?? null, plate: rental?.vehicles?.license_plate ?? null, rentalId: n.rental_id });
    } catch {
      await finish("failed", "Send threw; outcome unknown, not resent."); report.failed++; continue;
    }
    const r = (res ?? { ok: true }) as { ok: boolean; blocked?: string };
    if (r.blocked === "held") { await finish("held", "Still held."); report.stillHeld++; }
    else if (r.blocked === "off") { await finish("dropped", "Switched off in Automations."); report.dropped++; }
    else if (r.ok) { await finish("sent", null); report.sent++; }
    else { await finish("failed", "Email provider refused; not resent."); report.failed++; }
  }
  return report;
}
