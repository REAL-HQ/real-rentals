import * as emailServer from "@/lib/email.server";
import { doubleCollectionMessage, easternCollectionDay, isDoubleCollectionReason } from "@/lib/double-collection";

function failureReasonStillSet(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type PaidRow = {
  id: string;
  status?: string;
  failure_reason?: string | null;
  rental_id?: string | null;
  stripe_invoice_id?: string | null;
};

/**
 * First writer wins: failure_reason must still be the prior non-blank reason.
 * A replay, or the other of invoice.paid and payment_intent.succeeded, matches
 * nothing and does not alert again. The driver receipt stays on notified_status.
 */
export async function recordPossibleDoubleCollection(
  admin: any,
  rows: PaidRow[],
  collection: { amountCents: number; unixSeconds: number; rentalId?: string | null; invoiceId?: string | null },
): Promise<void> {
  const day = easternCollectionDay(collection.unixSeconds);
  if (!day || !Number.isFinite(collection.amountCents)) return;
  const message = doubleCollectionMessage(collection.amountCents, day);
  const winners: PaidRow[] = [];
  for (const row of rows) {
    if (row.status && row.status !== "paid") continue;
    if (!failureReasonStillSet(row.failure_reason) || isDoubleCollectionReason(row.failure_reason)) continue;
    const updated = await admin
      .from("payments")
      .update({ failure_reason: message })
      .eq("id", row.id)
      .eq("status", "paid")
      .eq("failure_reason", row.failure_reason)
      .select("id");
    if (updated.error && updated.error.code !== "23505") throw new Error(updated.error.message);
    if (updated.data?.length) winners.push(row);
  }
  if (!winners.length) return;
  const detail = [
    message,
    ...winners.flatMap((row) => [
      `Rental: ${row.rental_id || collection.rentalId || "unknown"}`,
      `Invoice: ${row.stripe_invoice_id || collection.invoiceId || "unknown"}`,
    ]),
  ].join("\n");
  try {
    await admin.from("notifications").insert({
      title: "Possible Double Collection",
      body: detail,
      kind: "payment",
      read: false,
    });
  } catch (err) {
    console.error("[double-collection] notification failed", err);
  }
  try {
    const prefs = await emailServer.getLeadAlertPrefs();
    if (!prefs.recipients.length) {
      console.error("[double-collection] staff alert has no recipient");
      return;
    }
    await emailServer.sendEmail({
      to: prefs.recipients,
      subject: "Possible Double Collection",
      html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111"><p style="font-size:15px;line-height:1.5">${escapeHtml(detail).replace(/\n/g, "<br>")}</p></div>`,
      track: { workflow: "lead_alert" },
    });
  } catch (err) {
    console.error("[double-collection] staff alert failed", err);
  }
}
