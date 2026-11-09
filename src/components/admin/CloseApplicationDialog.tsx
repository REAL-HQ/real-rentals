import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CLOSURE_REASONS, type ClosureReason } from "@/lib/application-status";

export function CloseApplicationDialog({
  busy = false,
  onCancel,
  onConfirm,
}: {
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: ClosureReason, notes: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const chosen = CLOSURE_REASONS.find((item) => item.key === reason) ?? null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close Application</DialogTitle>
        </DialogHeader>
        <label className="block text-sm text-[#111114]">
          Closure Reason
          <select
            aria-label="Closure Reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="">Select a Reason</option>
            {CLOSURE_REASONS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm text-[#111114]">
          Notes
          <textarea
            aria-label="Closure Notes"
            value={notes}
            maxLength={2000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional"
            className="mt-1 min-h-20 w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <DialogFooter className="mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border bg-white px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!chosen || busy}
            onClick={() => {
              if (!chosen) return;
              const trimmed = notes.trim();
              onConfirm(chosen.key, trimmed ? trimmed : null);
            }}
            className="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Close Application
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
