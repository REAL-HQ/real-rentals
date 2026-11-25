/**
 * The weekly amount billing charges, read from a sent or signed agreement.
 *
 * New prepares store it on merge_data._billing (rent + Additional Driver fees
 * + Damage Waiver per week). Older agreements are not rewritten: the amount
 * already printed (Amount Due Each Payment, or the weekly rate) is used as
 * stored, so a $450 agreement stays $450.
 *
 * Autopay charges rentals.weekly_rate once. Driver fees inside this amount
 * are not also a Stripe subscription item.
 */
import { moneyNumber, storedWeeklyAmount, weeklyRateFromAgreementOrVehicle } from "@/lib/agreement-prep";

const OPEN = ["signed", "sent", "viewed"] as const;

function pickCurrent(rows: { status?: string; voided_at?: string | null; signed_at?: string | null; sent_at?: string | null; created_at?: string | null; merge_data?: Record<string, unknown> | null }[]): { merge_data?: Record<string, unknown> | null } | null {
  const open = rows.filter((r) => !r.voided_at && (r.status === "signed" || r.status === "sent" || r.status === "viewed"));
  const signed = open.filter((r) => r.status === "signed");
  const pool = signed.length ? signed : open;
  pool.sort((a, b) => String(b.signed_at ?? b.sent_at ?? b.created_at ?? "").localeCompare(String(a.signed_at ?? a.sent_at ?? a.created_at ?? "")));
  return pool[0] ?? null;
}

/** Latest signed agreement, otherwise the latest sent one. Null when neither exists. */
export async function currentAgreementMerge(admin: any, applicationId: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!applicationId || !admin?.from) return null;
  try {
    let q = admin.from("agreements").select("id,status,signed_at,sent_at,voided_at,merge_data,created_at");
    if (!q || typeof q.eq !== "function") return null;
    q = q.eq("application_id", applicationId);
    if (typeof q.in === "function") q = q.in("status", [...OPEN]);
    if (typeof q.is === "function") q = q.is("voided_at", null);
    if (typeof q.order === "function") q = q.order("created_at", { ascending: false });
    if (typeof q.limit === "function") q = q.limit(10);
    const res = await q;
    const row = pickCurrent((res?.data ?? []) as any[]);
    const merge = row?.merge_data;
    return merge && typeof merge === "object" ? (merge as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function currentAgreementWeeklyAmount(admin: any, applicationId: string | null | undefined): Promise<number | null> {
  return storedWeeklyAmount(await currentAgreementMerge(admin, applicationId));
}

/**
 * Weekly rate for a new rental row or an activation suggestion.
 * The agreement amount wins. The vehicle rate is used only when no sent or
 * signed agreement has an amount.
 */
export async function weeklyRateForApplication(admin: any, applicationId: string | null | undefined, vehicleWeekly: unknown): Promise<number | null> {
  const agreed = await currentAgreementWeeklyAmount(admin, applicationId);
  return weeklyRateFromAgreementOrVehicle(agreed, moneyNumber(vehicleWeekly));
}

/**
 * A new send writes the agreement's weekly amount where billing reads it.
 * Does not update the agreement row, and does not touch an amendment or an
 * active rental. Sent agreements that are only re-delivered are not sent
 * through here.
 */
export async function recordAgreementWeeklyRate(admin: any, applicationId: string, merge: Record<string, unknown> | null | undefined, opts: { amendment: boolean }): Promise<void> {
  if (opts.amendment) return;
  const weekly = storedWeeklyAmount(merge ?? null);
  if (!(weekly != null && weekly > 0)) return;
  try {
    await admin.from("applications").update({ weekly_rent: weekly }).eq("id", applicationId);
  } catch (err) {
    console.error("[agreement] weekly rate was not saved on the application", err);
  }
  try {
    let q = admin.from("rentals").update({ weekly_rate: weekly }).eq("application_id", applicationId);
    if (typeof q.in === "function") q = q.in("status", ["pending_reservation", "reserved", "on_hold"]);
    await q;
  } catch (err) {
    console.error("[agreement] weekly rate was not saved on the open rental", err);
  }
}
