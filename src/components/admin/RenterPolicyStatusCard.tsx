import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Shield } from "lucide-react";
import { getRenterPolicyStatus, setRenterPolicyDeclined } from "@/lib/reservation-fee-refund.functions";
import { reservationFeeRefundedDetail } from "@/lib/reservation-fee-refund";
import { DANGER_BADGE_BORDERED } from "@/lib/badge-tone";

/**
 * Marks the Renter Policy (the policy we arrange) as declined. Separate from
 * Insurance Verification (the renter's own card). Manager/Owner only. When
 * the Automations switch is On, a paid Reservation Fee is refunded automatically.
 */
export function RenterPolicyStatusCard({
  applicationId,
  canDecide,
}: {
  applicationId: string;
  canDecide: boolean;
}) {
  const load = useServerFn(getRenterPolicyStatus);
  const decline = useServerFn(setRenterPolicyDeclined);
  const [status, setStatus] = useState<"pending" | "issued" | "declined" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void load({ data: { applicationId } })
      .then((r) => { if (!cancelled) setStatus(r.status); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, [applicationId, load]);

  const onDecline = async () => {
    const note = window.prompt("Why was the Renter Policy declined? Saved in the audit log. Never name the insurance company.")?.trim();
    if (note == null) return;
    if (!window.confirm("Mark the Renter Policy as declined? If Auto-Refund Reservation On Insurance Decline is On, a paid Reservation Fee will be refunded in full.")) return;
    setBusy(true);
    try {
      const res = await decline({ data: { applicationId, note: note || null } });
      setStatus("declined");
      const refund = res.refund;
      if (refund.status === "refunded" || refund.status === "already") {
        toast.success(`Renter Policy declined. ${reservationFeeRefundedDetail(refund.reason)}.`);
      } else if (refund.status === "skipped" && refund.code === "switched_off") {
        toast.success("Renter Policy declined. The Reservation Fee was not refunded automatically (the switch is Off). Refund it from Payments if it should be.");
      } else if (refund.status === "skipped" && refund.code === "no_paid_fee") {
        toast.success("Renter Policy declined. No paid Reservation Fee to refund.");
      } else if (refund.status === "blocked") {
        toast.error(`Renter Policy declined, but the Reservation Fee could not be refunded: ${refund.error}`);
      } else {
        toast.success("Renter Policy declined.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record that the Renter Policy was declined.");
    } finally {
      setBusy(false);
    }
  };

  const label = status === "declined" ? "Declined" : status === "issued" ? "Issued" : status === "pending" ? "Pending" : "Not Recorded";

  return (
    <div className="rounded-xl border border-border bg-white" data-testid="renter-policy-status">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-semibold">Renter Policy</div>
        <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status === "declined" ? DANGER_BADGE_BORDERED : "border-[#EDEDF0] bg-[#FAFAFB] text-[#55555E]"}`}>
          {label}
        </span>
      </div>
      <div className="space-y-2 p-4">
        <p className="text-[12px] text-[#55555E]">
          The auto insurance policy we arrange after the agreement is signed. This is not the renter's own insurance card, and marking it declined does not verify or un-verify anyone. If it is declined and Auto-Refund Reservation On Insurance Decline is On, a paid Reservation Fee is refunded in full.
        </p>
        {canDecide && status !== "declined" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDecline()}
            className="text-xs font-medium text-[#D03020] hover:underline disabled:opacity-50"
          >
            {busy ? "Saving…" : "Mark Renter Policy Declined"}
          </button>
        ) : null}
        {!canDecide ? <p className="text-[11px] text-muted-foreground">Only A Manager Or Owner Can Mark This Declined.</p> : null}
      </div>
    </div>
  );
}
