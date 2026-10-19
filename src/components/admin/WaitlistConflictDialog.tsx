import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import {
  getWaitlistConflict,
  resolveWaitlistConflict,
  type ConflictSide,
} from "@/lib/waitlist.functions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MicroLabel } from "./ui";
import { fmtDate } from "@/lib/date-format";

// Review Conflict: side-by-side comparison of a waitlist entry and the one
// existing driver with the same email but a different phone. Linking is an
// explicit, affirmed, audited choice; nothing here merges or creates records.

type Choice = "existing" | "waitlist";

export function WaitlistConflictDialog({
  entryId,
  onClose,
  onResolved,
}: {
  entryId: string | null;
  onClose: () => void;
  onResolved: (applicationId: string) => void;
}) {
  const load = useServerFn(getWaitlistConflict);
  const resolve = useServerFn(resolveWaitlistConflict);
  const [data, setData] = useState<{ waitlist: ConflictSide; application: ConflictSide } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [reason, setReason] = useState("");
  const [affirmed, setAffirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkedId, setLinkedId] = useState<string | null>(null);

  useEffect(() => {
    setData(null); setLoadError(null); setChoice(null); setReason(""); setAffirmed(false); setLinkedId(null);
    if (!entryId) return;
    load({ data: { entryId } })
      .then((r) => (r.ok ? setData({ waitlist: r.waitlist, application: r.application }) : setLoadError(r.error)))
      .catch((e) => setLoadError(e?.message ?? "Could not load the records."));
  }, [entryId, load]);

  const reasonOk = choice !== "waitlist" || reason.trim().length >= 5;
  const canConfirm = !!data && !!choice && affirmed && reasonOk && !busy;

  async function confirm() {
    if (!data || !choice || !entryId) return;
    setBusy(true);
    try {
      const r = await resolve({
        data: {
          entryId,
          applicationId: data.application.id,
          phoneChoice: choice,
          reason: reason.trim(),
          affirmed: true,
          expectedWaitlistPhone: data.waitlist.phone,
          expectedApplicationPhone: data.application.phone,
        },
      });
      if (!r.ok) throw new Error(r.error);
      toast.success(r.already ? "These records were already linked." : `Linked ${data.application.name} to the existing driver profile.`);
      setLinkedId(r.applicationId);
      onResolved(r.applicationId);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not link these records.");
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, w: React.ReactNode, a: React.ReactNode, highlight = false) => (
    <tr className="border-b border-[#EDEDF0] last:border-0">
      <td className="py-2 pr-3 align-top"><MicroLabel>{label}</MicroLabel></td>
      <td className={`py-2 pr-3 text-[13px] ${highlight ? "font-semibold text-[#D03020]" : "text-[#111114]"}`}>{w}</td>
      <td className={`py-2 text-[13px] ${highlight ? "font-semibold text-[#D03020]" : "text-[#111114]"}`}>{a}</td>
    </tr>
  );

  return (
    <Dialog open={!!entryId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#D03020]" strokeWidth={1.75} />
            Review Conflict
          </DialogTitle>
          <DialogDescription>
            The email matches an existing driver but the phone number is different. Nothing changes until you choose an option below.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="py-4 text-[13px] text-[#D03020]">{loadError}</p>
        ) : !data ? (
          <p className="py-6 text-center text-[13px] text-[#9A9AA3]">Loading…</p>
        ) : linkedId ? (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-[#111114]">The waitlist entry is now linked. The original waitlist record and history are kept.</p>
            <Link
              to="/admin"
              search={{ tab: "drivers", id: linkedId } as any}
              onClick={onClose}
              className="inline-flex rounded-lg bg-[#D03020] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
            >
              Open Driver Profile
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#EDEDF0] text-left">
                  <th className="w-36 pb-2" />
                  <th className="pb-2"><MicroLabel>Waitlist Entry</MicroLabel></th>
                  <th className="pb-2"><MicroLabel>Existing Driver</MicroLabel></th>
                </tr>
              </thead>
              <tbody>
                {row("Name", data.waitlist.name, data.application.name)}
                {row("Email", data.waitlist.emailMasked, data.application.emailMasked)}
                {row("Phone", data.waitlist.phone ?? "—", data.application.phone ?? "—", true)}
                {row("Status", cap(data.waitlist.status), cap(data.application.status))}
                {row("Signed Up", fmtDate(data.waitlist.signedUpAt), fmtDate(data.application.signedUpAt))}
                {row("Source", data.waitlist.source ?? "—", data.application.source ?? "—")}
                {row("Documents", "—", data.application.documentCount ?? "—")}
                {row("Rentals", "—", data.application.rentalCount ?? "—")}
              </tbody>
            </table>

            <div className="space-y-2">
              <MicroLabel>Resolution</MicroLabel>
              {(
                [
                  ["existing", "Link — Keep Existing Phone", `Keeps ${data.application.phone ?? "the current phone"} on the driver profile.`],
                  ["waitlist", "Link — Use Waitlist Phone", `Changes the driver's phone to ${data.waitlist.phone ?? "—"}. A reason is required.`],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 ${choice === value ? "border-[#D03020]" : "border-[#EDEDF0]"}`}>
                  <input type="radio" name="phone-choice" className="mt-1" checked={choice === value} onChange={() => setChoice(value)} disabled={value === "waitlist" && !data.waitlist.phone} />
                  <span>
                    <span className="block text-[13px] font-medium text-[#111114]">{label}</span>
                    <span className="block text-[11px] text-[#9A9AA3]">{hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {choice === "waitlist" && (
              <div>
                <MicroLabel>Reason For Changing The Phone</MicroLabel>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="e.g. Driver confirmed new number by phone call on Oct 19, 2026"
                  className="mt-1 w-full rounded-lg border border-[#EDEDF0] px-3 py-2 text-sm outline-none focus:border-[#C7C7CC]"
                />
              </div>
            )}

            <label className="flex items-start gap-2 text-[13px] text-[#55555E]">
              <input type="checkbox" className="mt-0.5" checked={affirmed} onChange={(e) => setAffirmed(e.target.checked)} />
              I verified that both records belong to the same person.
            </label>
          </div>
        )}

        {!linkedId && (
          <DialogFooter>
            <button type="button" onClick={onClose} className="rounded-lg border border-[#EDEDF0] px-4 py-2 text-xs font-medium text-[#55555E] hover:bg-[#FAFAFB]">
              Cancel
            </button>
            {data && (
              <button type="button" onClick={confirm} disabled={!canConfirm} className="rounded-lg bg-[#D03020] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {busy ? "Linking…" : "Confirm Link"}
              </button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}
