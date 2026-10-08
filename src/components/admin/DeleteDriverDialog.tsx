import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDeletionSummary, deleteDriver, purgeDriver } from "@/lib/driver-deletion.functions";

type Summary = Extract<Awaited<ReturnType<typeof getDeletionSummary>>, { ok: true }>;

/** Owner-only. Mode "soft" = Delete Driver (recoverable); "purge" = Delete Permanently. */
export function DeleteDriverDialog({
  applicationId,
  mode,
  onClose,
  onDone,
}: {
  applicationId: string;
  mode: "soft" | "purge";
  onClose: () => void;
  onDone: () => void;
}) {
  const summaryFn = useServerFn(getDeletionSummary);
  const softFn = useServerFn(deleteDriver);
  const purgeFn = useServerFn(purgeDriver);
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    summaryFn({ data: { applicationId } })
      .then((r) => (r.ok ? setS(r) : setErr(r.error)))
      .catch(() => setErr("Could not load this record."));
  }, [applicationId, summaryFn]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const r = mode === "soft" ? await softFn({ data: { applicationId } }) : await purgeFn({ data: { applicationId } });
      if (!r.ok) return void toast.error(r.error);
      toast.success(mode === "soft" ? "Driver Deleted" : "Personal Data Deleted");
      const failed = mode === "purge" ? Number((r as any).files?.failed ?? 0) : 0;
      if (failed) toast.error(`${failed} file(s) could not be removed yet. Retry in Recently Deleted.`);
      onDone();
    } catch {
      toast.error("Could not complete. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const purgeBlocked = !!s && mode === "purge" && (s.legalHold || s.activeRentals > 0 || s.openCharges > 0);
  const softBlocked = !!s && mode === "soft" && s.activeRentals > 0;
  const canConfirm = !!s && !busy && !purgeBlocked && !softBlocked && (mode === "soft" || typed.trim() === (s.name ?? "").trim());

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "soft" ? "Delete Driver" : "Delete Permanently"}</DialogTitle>
          <DialogDescription>
            {mode === "soft" ? "Reversible. The Owner can restore this driver from Recently Deleted." : "Not reversible. Eligible personal information and identity files are erased."}
          </DialogDescription>
        </DialogHeader>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!s && !err && <p className="text-sm text-muted-foreground">Loading…</p>}
        {s && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Driver</dt><dd>{s.name}</dd>
              <dt className="text-muted-foreground">Status</dt><dd className="capitalize">{s.status}</dd>
              <dt className="text-muted-foreground">Waitlist History</dt><dd>{s.waitlistHistory ? "Yes" : "No"}</dd>
              <dt className="text-muted-foreground">Linked Duplicates</dt><dd>{s.duplicates}</dd>
              <dt className="text-muted-foreground">Documents</dt><dd>{s.documents}</dd>
              <dt className="text-muted-foreground">Agreements</dt><dd>{s.agreements}</dd>
              <dt className="text-muted-foreground">Active Rentals</dt><dd>{s.activeRentals}</dd>
              <dt className="text-muted-foreground">Open Charges</dt><dd>{s.openCharges}</dd>
              <dt className="text-muted-foreground">Legal Hold</dt><dd>{s.legalHold ? "On" : "Off"}</dd>
            </dl>
            <div>
              <p className="font-medium">Will Be Removed</p>
              <p className="text-muted-foreground">
                {mode === "soft"
                  ? "Hidden from Drivers, Waitlist, counts and searches. Resume links, upload links and automated messages stop. Active Waitlist hold closes."
                  : `Name, contact, address, license, card and insurance details; ${s.identityDocuments} identity file(s); personal notes in screening records; name and contact on linked Waitlist entries.`}
              </p>
            </div>
            <div>
              <p className="font-medium">Must Be Retained</p>
              <p className="text-muted-foreground">
                {mode === "soft"
                  ? "Everything is kept and can be restored."
                  : `Agreements, payments, rentals, tolls, incidents, inspections, ${s.retainedDocuments} other document(s), screening decisions, lead source and signup dates, audit history.`}
              </p>
            </div>
            {softBlocked && <p className="text-destructive">This driver has an active rental. End the rental first.</p>}
            {purgeBlocked && (
              <p className="text-destructive">
                {s.legalHold ? "Legal Hold is on." : s.activeRentals ? "This driver has an active rental." : "This driver has an open charge."} Permanent deletion is blocked.
              </p>
            )}
            {mode === "purge" && !purgeBlocked && (
              <label className="block">
                <span className="text-muted-foreground">Type the driver's name to confirm</span>
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={s.name ?? ""} />
              </label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!canConfirm} onClick={confirm}>
            {busy ? "Working…" : mode === "soft" ? "Delete Driver" : "Delete Permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
