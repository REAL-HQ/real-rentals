import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Send } from "lucide-react";
import {
  approveApplication,
  getApprovalEligibility,
  inviteDriverPortal,
} from "@/lib/applications.functions";

const btn =
  "inline-flex items-center gap-1.5 rounded-md border border-[#DEDEE3] bg-white text-[#28282E] px-2.5 sm:px-3 py-1.5 text-[12px] font-semibold hover:bg-[#F4F4F6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Approve (manual intake) and Invite. Rendered only for Manager/Owner; the
 * server re-checks role and identity evidence on every call.
 *  - Approve: no portal login, no email/SMS, no agreement.
 *  - Invite: approved drivers only; portal access only, never an agreement,
 *    rental, subscription or charge.
 */
export function DriverApprovalActions({
  driverId,
  status,
  hasLogin,
  hasEmail,
  onApproved,
}: {
  driverId: string;
  status: string | null;
  hasLogin: boolean;
  hasEmail: boolean;
  onApproved: () => void;
}) {
  const approve = useServerFn(approveApplication);
  const eligibility = useServerFn(getApprovalEligibility);
  const invite = useServerFn(inviteDriverPortal);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"approve" | "invite" | null>(null);
  const [invited, setInvited] = useState(false);

  const canApproveStatus = status === "new" || status === "reviewing";
  const canInvite = status === "approved" && !hasLogin && !invited;

  useEffect(() => {
    if (!canApproveStatus) return;
    let off = false;
    setMissing(null);
    eligibility({ data: { id: driverId } })
      .then((r) => { if (!off) setMissing(r.blockers.map((b) => b.message)); })
      .catch(() => { if (!off) setMissing(["Could not check eligibility."]); });
    return () => { off = true; };
  }, [driverId, canApproveStatus, eligibility]);

  async function doApprove() {
    if (!confirm("Approve this driver?\n\nNo portal login, email, text or agreement will be sent.")) return;
    setBusy("approve");
    try {
      const r = await approve({ data: { id: driverId, mode: "manual_intake" } });
      if (!r.ok) throw new Error(r.error ?? "Could not approve");
      toast.success("Approved. No login, message or agreement sent.");
      onApproved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve");
    } finally {
      setBusy(null);
    }
  }

  async function doInvite() {
    if (!confirm("Invite this driver to the portal?\n\nThey will get a set-password email. No agreement, rental or charge.")) return;
    setBusy("invite");
    try {
      const r = await invite({ data: { id: driverId } });
      if (!r.ok) throw new Error(r.error ?? "Could not invite");
      toast.success(r.portalAccount === "created" ? "Portal invite emailed." : "They already have a portal login.");
      setInvited(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not invite");
    } finally {
      setBusy(null);
    }
  }

  if (canApproveStatus) {
    const blocked = missing === null || missing.length > 0;
    const title = missing === null ? "Checking…" : missing.length ? `Needs: ${missing.join(" ")}` : "Approve without portal login or agreement";
    return (
      <button type="button" className={btn} onClick={doApprove} disabled={blocked || busy !== null} title={title} aria-label="Approve">
        {busy === "approve" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
      </button>
    );
  }
  if (canInvite) {
    return (
      <button type="button" className={btn} onClick={doInvite} disabled={!hasEmail || busy !== null} title={hasEmail ? "Send portal invite" : "No email on file"} aria-label="Invite">
        {busy === "invite" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Invite
      </button>
    );
  }
  return null;
}
