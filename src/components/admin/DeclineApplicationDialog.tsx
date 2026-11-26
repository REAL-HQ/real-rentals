import { useState } from "react";
import { ModalBody, ModalButton, ModalFooter, ModalHeader, ModalShell } from "./modal";

const MIN = 5;

/**
 * Confirms a staff decline and collects the reason that is appended to
 * Internal Notes. Does not send the applicant an email or a text; that notice
 * belongs to the FLEET decline API.
 */
export function DeclineApplicationDialog({
  name,
  busy = false,
  onCancel,
  onConfirm,
}: {
  name: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.replace(/\s+/g, " ").trim();
  const ready = trimmed.length >= MIN && trimmed.length <= 1000;
  return (
    <ModalShell onClose={() => { if (!busy) onCancel(); }} size="sm" label="Decline Application">
      <ModalHeader title="Decline Application" subtitle={name} onClose={() => { if (!busy) onCancel(); }} />
      <ModalBody className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This sets the application to Declined. It does not send an email or a text.
        </p>
        <label className="block text-sm text-foreground">
          Reason
          <textarea
            aria-label="Decline Reason"
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why this application is being declined"
            className="mt-1 min-h-24 w-full rounded-md border border-border bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <p className="text-[11px] text-muted-foreground">
          Required. Saved on the profile Notes for staff.
        </p>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onCancel} disabled={busy}>Cancel</ModalButton>
        <ModalButton variant="primary" disabled={!ready || busy} onClick={() => { if (ready) onConfirm(trimmed); }}>
          {busy ? "Declining…" : "Decline Application"}
        </ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}
