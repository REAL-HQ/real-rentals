import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listDeletedDrivers, restoreDriver, setLegalHold, retryFileCleanup } from "@/lib/driver-deletion.functions";
import { DeleteDriverDialog } from "./DeleteDriverDialog";

type Data = Awaited<ReturnType<typeof listDeletedDrivers>>;

/** Owner-only list of soft-deleted drivers: Restore, Legal Hold, Delete Permanently, file cleanup retry. */
export function RecentlyDeletedDialog({ onClose, onRestored }: { onClose: () => void; onRestored: () => void }) {
  const listFn = useServerFn(listDeletedDrivers);
  const restoreFn = useServerFn(restoreDriver);
  const holdFn = useServerFn(setLegalHold);
  const retryFn = useServerFn(retryFileCleanup);
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [purging, setPurging] = useState<string | null>(null);

  const load = useCallback(() => {
    listFn().then(setD).catch(() => toast.error("Could not load deleted drivers."));
  }, [listFn]);
  useEffect(load, [load]);

  async function act(id: string, f: () => Promise<{ ok: boolean; error?: string }>, msg: string) {
    if (busy) return;
    setBusy(id);
    try {
      const r = await f();
      if (!r.ok) toast.error(r.error ?? "Could not complete.");
      else toast.success(msg);
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Recently Deleted</DialogTitle>
          <DialogDescription>Deleted drivers stay recoverable until deleted permanently.</DialogDescription>
        </DialogHeader>
        {d && (d.pendingFiles > 0 || d.failedFiles > 0) && (
          <div className="flex items-center justify-between rounded-md border p-2 text-sm">
            <span>File Cleanup: {d.pendingFiles} pending / {d.failedFiles} failed</span>
            <Button size="sm" variant="outline" disabled={busy === "files"} onClick={() => act("files", async () => { await retryFn(); return { ok: true }; }, "Cleanup Retried")}>
              Retry
            </Button>
          </div>
        )}
        {!d && <p className="text-sm text-muted-foreground">Loading…</p>}
        {d && d.drivers.length === 0 && <p className="text-sm text-muted-foreground">No deleted drivers.</p>}
        <ul className="divide-y max-h-[60vh] overflow-y-auto">
          {d?.drivers.map((r) => (
            <li key={r.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
              <div className="flex-1 min-w-[160px]">
                <p className="font-medium">{r.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.purged_at ? "Permanently Deleted" : `Deleted ${new Date(r.deleted_at).toLocaleDateString()}`}
                  {r.legal_hold ? " · Legal Hold" : ""}
                </p>
              </div>
              {!r.purged_at && (
                <>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(r.id, async () => { const x = await restoreFn({ data: { applicationId: r.id } }); if (x.ok) onRestored(); return x; }, "Driver Restored")}>
                    Restore
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(r.id, () => holdFn({ data: { applicationId: r.id, on: !r.legal_hold } }), r.legal_hold ? "Legal Hold Off" : "Legal Hold On")}>
                    {r.legal_hold ? "Clear Hold" : "Legal Hold"}
                  </Button>
                  <Button size="sm" variant="destructive" disabled={!!busy || r.legal_hold} onClick={() => setPurging(r.id)}>
                    Delete Permanently
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {purging && (
          <DeleteDriverDialog applicationId={purging} mode="purge" onClose={() => setPurging(null)} onDone={() => { setPurging(null); load(); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}
