import { badEmailReason, normEmail, undeliverableDomain, type BadEmailReason, type DeliveryHistoryRow } from "@/lib/email-suppression";

const HISTORY_STATES = ["bounced", "complained", "delivered"];

/** ilike pattern that matches the literal address only (escape % _ \\). */
function exactLike(e: string): string {
  return e.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * One address's suppression reason. Fails open (null) when the history cannot
 * be read: Resend still refuses known hard bounces, and a read error must not
 * silently stop every renter email.
 */
export async function badEmailForAddress(admin: any, raw: string): Promise<BadEmailReason | null> {
  const e = normEmail(raw);
  if (!e.includes("@")) return null;
  if (undeliverableDomain(e)) return "undeliverable";
  try {
    const { data, error } = await admin
      .from("email_deliveries")
      .select("recipient,state,created_at")
      .ilike("recipient", exactLike(e))
      .in("state", HISTORY_STATES)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return badEmailReason(e, (data ?? []) as DeliveryHistoryRow[]);
  } catch (err) {
    console.error("[email-suppression] could not read delivery history; sending", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Reasons for many addresses at once (lead cards). Missing = fine. Fails open to an empty map. */
export async function badEmailsFor(admin: any, emails: readonly (string | null | undefined)[]): Promise<Map<string, BadEmailReason>> {
  const out = new Map<string, BadEmailReason>();
  const list = [...new Set(emails.map(normEmail).filter((e) => e.includes("@")))];
  for (const e of list) if (undeliverableDomain(e)) out.set(e, "undeliverable");
  const lookup = list.filter((e) => !out.has(e));
  if (!lookup.length) return out;
  try {
    const raw = [...new Set(emails.filter((e): e is string => !!e && lookup.includes(normEmail(e))).map((e) => e.trim()))];
    const { data, error } = await admin
      .from("email_deliveries")
      .select("recipient,state,created_at")
      .in("recipient", [...new Set([...lookup, ...raw])])
      .in("state", HISTORY_STATES)
      .limit(2000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as DeliveryHistoryRow[];
    for (const e of lookup) {
      const reason = badEmailReason(e, rows);
      if (reason) out.set(e, reason);
    }
  } catch (err) {
    console.error("[email-suppression] could not read delivery history for lead cards", err instanceof Error ? err.message : err);
  }
  return out;
}
