import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LIVE_RENTAL_RELEASE, APPROVAL_RELEASE_HOLD, createRequestGate } from "@/lib/live-rental-release";
import { AlertTriangle, Check, Loader2, Send } from "lucide-react";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton } from "./modal";
import {
  approveApplication,
  getApprovalEligibility,
  inviteDriverPortal,
} from "@/lib/applications.functions";

const btn =
  "inline-flex items-center gap-1.5 rounded-md border border-[#DEDEE3] bg-white text-[#28282E] px-2.5 sm:px-3 py-1.5 text-[12px] font-semibold hover:bg-[#F4F4F6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * The one Approve action (modal: Approve Only / Approve & Invite) and the
 * separate Invite action. Rendered only for Manager/Owner; the server
 * re-checks role and identity/license evidence on every call. Never sends an
 * agreement, creates a rental, subscription or charge.
 */
export function DriverApprovalActions({
  driverId,
  status,
  hasLogin,
  hasEmail,
  open,
  onOpenChange,
  showApproveButton = true,
  onApproved,
}: {
  driverId: string;
  status: string | null;
  hasLogin: boolean;
  hasEmail: boolean;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  showApproveButton?: boolean;
  onApproved: () => void;
}) {
  const approve = useServerFn(approveApplication);
  const eligibility = useServerFn(getApprovalEligibility);
  const invite = useServerFn(inviteDriverPortal);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"only" | "invite" | "reinvite" | null>(null);
  const [invited, setInvited] = useState(false);

  const requests = useRef(createRequestGate());

  const canApproveStatus = status === "new" || status === "reviewing";
  const canInvite = status === "approved" && !hasLogin && !invited;

  useEffect(() => {
    if (!canApproveStatus) return;
    const request = requests.current.begin();
    setMissing(null);
    eligibility({ data: { id: driverId } })
      .then((r) => { if (requests.current.isCurrent(request)) setMissing(r.blockers.map((b) => b.message)); })
      .catch(() => { if (requests.current.isCurrent(request)) setMissing(["Could not check eligibility."]); });
    return () => { requests.current.invalidate(); };
  }, [driverId, canApproveStatus, open, eligibility]);

  async function doApprove(mode: "approve_only" | "approve_invite") {
    if (!LIVE_RENTAL_RELEASE.approveOnly || (mode === "approve_invite" && !LIVE_RENTAL_RELEASE.invitations)) return;
    const request = requests.current.begin();
    setBusy(mode === "approve_only" ? "only" : "invite");
    try {
      const r = await approve({ data: { id: driverId, mode } });
      if (!requests.current.isCurrent(request)) return;
      if (!r.ok) {
        if (r.blockers?.length) setMissing(r.blockers.map((b) => b.message));
        throw new Error(r.error ?? "Could not approve");
      }
      const portal =
        r.portalAccount === "created" ? " Portal invite emailed."
        : r.portalAccount === "existing" ? " They already have a portal login."
        : r.portalAccount === "conflict" ? " Portal login NOT linked — resolve the identity first."
        : r.portalAccount === "failed" ? " Portal login could not be created — use Invite later."
        : r.portalAccount === "no email" ? " No email on file, so no invite."
        : " No login, message or agreement sent.";
      toast.success(`Approved.${portal}`);
      if (r.portalAccount === "created" || r.portalAccount === "existing") setInvited(true);
      onOpenChange(false);
      onApproved();
    } catch (e) {
      if (requests.current.isCurrent(request)) toast.error(e instanceof Error ? e.message : "Could not approve");
    } finally {
      if (requests.current.isCurrent(request)) setBusy(null);
    }
  }

  async function doInvite() {
    if (!LIVE_RENTAL_RELEASE.invitations) return;
    const request = requests.current.begin();
    if (!confirm("Invite this driver to the portal?\n\nThey will get a set-password email. No agreement, rental or charge.")) return;
    setBusy("reinvite");
    try {
      const r = await invite({ data: { id: driverId } });
      if (!requests.current.isCurrent(request)) return;
      if (!r.ok) throw new Error(r.error ?? "Could not invite");
      toast.success(r.portalAccount === "created" ? "Portal invite emailed." : "They already have a portal login.");
      setInvited(true);
    } catch (e) {
      if (requests.current.isCurrent(request)) toast.error(e instanceof Error ? e.message : "Could not invite");
    } finally {
      if (requests.current.isCurrent(request)) setBusy(null);
    }
  }

  const blocked = missing === null || missing.length > 0 || !LIVE_RENTAL_RELEASE.approveOnly;

  return (
    <>
      {canApproveStatus && showApproveButton ? (
        <button type="button" className={btn} onClick={() => onOpenChange(true)} aria-label="Approve">
          <Check className="w-3.5 h-3.5" /> Approve
        </button>
      ) : null}
      {canInvite && LIVE_RENTAL_RELEASE.invitations ? (
        <button type="button" className={btn} onClick={doInvite} disabled={!hasEmail || busy !== null} title={hasEmail ? "Send portal invite" : "No email on file"} aria-label="Invite">
          {busy === "reinvite" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Invite
        </button>
      ) : null}

      {open && canApproveStatus ? (
        <ModalShell onClose={() => onOpenChange(false)} size="sm" label="Approve">
          <ModalHeader title="Approve" subtitle="No agreement, rental or charge is created." onClose={() => onOpenChange(false)} />
          <ModalBody>
            {missing === null ? (
              <div className="flex items-center gap-2 text-[12.5px] text-[#55555E]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking requirements…</div>
            ) : missing.length ? (
              <div className="rounded-lg border border-[#F6CFCA] bg-[#FDECEA] px-3 py-2">
                <div className="text-[12px] font-semibold text-[#B3261E] mb-1">Missing</div>
                <ul className="space-y-1">
                  {missing.map((m) => (
                    <li key={m} className="flex gap-2 text-[12px] text-[#B3261E]"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{m}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded-lg border border-[#CFE8D9] bg-[#EEF8F2] px-3 py-2 text-[12px] text-[#1E5B3A] flex gap-2">
                <Check className="w-3.5 h-3.5 mt-0.5" /> License and identity requirements met.
              </div>
            )}
            {!LIVE_RENTAL_RELEASE.approveOnly ? <p className="text-xs text-warning-foreground">{APPROVAL_RELEASE_HOLD}</p> : null}
            <div className="mt-3 space-y-1.5 text-[12px] text-[#55555E]">
              <div><span className="font-semibold text-[#28282E]">Approve Only</span> — no login, email, text or agreement.</div>

            </div>
          </ModalBody>
          <ModalFooter>
            <ModalButton variant="ghost" onClick={() => onOpenChange(false)}>Cancel</ModalButton>
            <ModalButton variant="ghost" onClick={() => doApprove("approve_only")} disabled={blocked || busy !== null}>
              {busy === "only" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Approve Only
            </ModalButton>
            {LIVE_RENTAL_RELEASE.invitations ? <ModalButton variant="primary" onClick={() => doApprove("approve_invite")} disabled={blocked || !hasEmail || busy !== null}>
              {busy === "invite" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Approve &amp; Invite
            </ModalButton> : null}
          </ModalFooter>
        </ModalShell>
      ) : null}
    </>
  );
}
