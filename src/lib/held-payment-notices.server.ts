// Retry for renter payment notices (receipt / payment failed) that were HELD
// because the Back Office → Automations switches could not be read.
//
// The Stripe webhook claims a notice (payments.notified_status = outcome)
// before sending, so a Stripe retry can never double-send. When the send is
// held, the webhook parks the row as 'held:<outcome>' instead. This sweep,
// run by the 5-minute automations cron:
//   * does nothing while the switches are still unreadable;
//   * drops the notice (records it handled, sends nothing) when the Owner has
//     switched that automation off — no replay across an Off;
//   * drops it when the payment is no longer in that outcome (a failure that
//     was later paid, waived, voided or refunded never gets a failure email,
//     and a refunded charge never gets a late receipt);
//   * otherwise claims it atomically (held:X → X where status = X) and sends
//     once; if the send is held again it parks the row again.
// At most MAX_PER_RUN rows per run. Rows only ever become 'held:*' through
// the webhook, so nothing historical is swept up.
import { gateFor, loadAutomationControls } from "@/lib/automation-controls.server";

export const MAX_PER_RUN = 20;
const HELD = ["held:paid", "held:failed"] as const;

type Deps = {
  sendReceipt: (a: { to: string; firstName: string | null; amount: number; reason: string; brand?: string | null; last4?: string | null }) => Promise<{ ok: boolean; blocked?: "off" | "held" }>;
  sendFailed: (a: { to: string; firstName: string | null; amount: number; reason: string; brand?: string | null; last4?: string | null }) => Promise<{ ok: boolean; blocked?: "off" | "held" }>;
};

export type HeldNoticeReport = { checked: number; sent: number; dropped: number; stillHeld: number; skipped?: "settings_unreadable" };

export async function retryHeldPaymentNotices(admin: any, deps: Deps): Promise<HeldNoticeReport> {
  const report: HeldNoticeReport = { checked: 0, sent: 0, dropped: 0, stillHeld: 0 };
  const controls = await loadAutomationControls(admin);
  if (controls.status === "error") return { ...report, skipped: "settings_unreadable" };

  const { data: rows, error } = await admin.from("payments")
    .select("id,status,notified_status,amount,reason,rental_id")
    .in("notified_status", [...HELD])
    .order("updated_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) return report;

  for (const row of (rows ?? []) as any[]) {
    report.checked++;
    const heldTag = String(row.notified_status); // captured before any update
    const outcome = heldTag.slice(5) as "paid" | "failed";
    const key = outcome === "paid" ? "payment_receipt" : "payment_failed";
    const handled = async () => {
      await admin.from("payments").update({ notified_status: outcome }).eq("id", row.id).eq("notified_status", heldTag);
      report.dropped++;
    };
    if (row.status !== outcome || gateFor(controls, key) === "off") { await handled(); continue; }

    const claim = await admin.from("payments").update({ notified_status: outcome })
      .eq("id", row.id).eq("notified_status", heldTag).eq("status", outcome).select("id");
    if (!claim.data?.length) continue; // another run took it, or it changed

    const { data: rental } = await admin.from("rentals")
      .select("application_id, applications:application_id(email, full_name, card_brand, card_last4)")
      .eq("id", row.rental_id).maybeSingle();
    const app = rental?.applications;
    if (!app?.email) { report.dropped++; continue; }
    const args = { to: app.email as string, firstName: (app.full_name as string | null) ?? null, amount: Number(row.amount ?? 0), reason: String(row.reason ?? "rent"), brand: app.card_brand ?? null, last4: app.card_last4 ?? null };
    const res = outcome === "paid" ? await deps.sendReceipt(args) : await deps.sendFailed(args);
    if (res.blocked === "held") {
      await admin.from("payments").update({ notified_status: heldTag }).eq("id", row.id).eq("notified_status", outcome);
      report.stillHeld++;
    } else if (res.blocked === "off") {
      report.dropped++;
    } else {
      report.sent++;
    }
  }
  return report;
}
