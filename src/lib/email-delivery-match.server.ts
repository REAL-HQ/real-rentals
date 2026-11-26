/**
 * Resend webhook helper: fold an "unmatched" event into the pending row whose
 * request was cut off before it attached the Resend id. The matching rule
 * lives in SQL (email_delivery_claim_pending, migration 20261122200000) so it
 * runs under the same advisory lock as the attach. Before that migration is
 * applied the RPC does not exist and this is a no-op.
 */
/** Never throws: a webhook that recorded its event must still answer 2xx. */
export async function claimPendingDelivery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the typed client has no entry for this RPC until types are regenerated
  admin: { rpc: (...a: any[]) => any },
  args: { resendId: string; recipient: string; subject: string | null; sentAt: string | null },
): Promise<string> {
  try {
    const sentAt = args.sentAt && !Number.isNaN(Date.parse(args.sentAt)) ? new Date(args.sentAt).toISOString() : null;
    const { data, error } = await admin.rpc("email_delivery_claim_pending", {
      _resend_id: args.resendId,
      _recipient: args.recipient,
      _subject: args.subject ? String(args.subject).slice(0, 300) : null,
      _sent_at: sentAt,
    });
    if (error) return "unmatched";
    return data === "attached" ? "attached" : "unmatched";
  } catch {
    return "unmatched";
  }
}

