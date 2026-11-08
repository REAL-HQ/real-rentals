import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PhoneCall } from "lucide-react";
import { recordCompletedPhoneCall } from "@/lib/quick-call.functions";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, Field, inputCls } from "./modal";
import { Checkbox } from "@/components/ui/checkbox";
import type { DriverScreening } from "./types";

function localNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function RecordCallDialog({ applicationId, name, onClose, onSaved, onInterview }: {
  applicationId: string;
  name: string;
  onClose: () => void;
  onSaved: (screening: DriverScreening) => void;
  onInterview: () => void;
}) {
  const save = useServerFn(recordCompletedPhoneCall);
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [note, setNote] = useState("");
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) onClose(); };
  const date = new Date(occurredAt);
  const valid = completed && note.trim().length >= 3 && Number.isFinite(date.getTime()) && date.getTime() <= Date.now();

  async function submit() {
    if (busy || !valid) return;
    setBusy(true);
    try {
      const result = await save({ data: { applicationId, occurredAt: date.toISOString(), note: note.trim(), completed: true } });
      onSaved(result.screening);
      if (result.auditWarning) toast.warning(result.auditWarning);
      else toast.success(result.alreadyComplete ? "Call Already Complete" : "Call Completion Saved");
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could Not Save Call Completion"); }
    finally { setBusy(false); }
  }

  return <ModalShell label="Call Complete" size="sm" onClose={close} closeOnBackdrop={!busy}>
    <ModalHeader title={<span className="flex items-center gap-2"><PhoneCall className="h-4 w-4 text-brand" />Call Complete</span>} subtitle={name} onClose={busy ? undefined : close} />
    <ModalBody className="space-y-4">
      <Field label="Call Completed At" required><input type="datetime-local" className={inputCls} aria-label="Call Completed At" value={occurredAt} max={localNow()} disabled={busy} onChange={(e) => setOccurredAt(e.target.value)} /></Field>
      <Field label="Call Notes" required><textarea className={`${inputCls} h-auto py-2`} aria-label="Call Notes" rows={3} maxLength={1000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} /></Field>
      <label className="flex items-start gap-2 text-sm"><Checkbox checked={completed} disabled={busy} onCheckedChange={(value) => setCompleted(value === true)} /><span>I Completed This Driver’s Qualification Call</span></label>
    </ModalBody>
    <ModalFooter left={<ModalButton variant="ghost" disabled={busy} onClick={onInterview}>Interview Script</ModalButton>}>
      <ModalButton disabled={busy} onClick={close}>Cancel</ModalButton>
      <ModalButton variant="primary" disabled={busy || !valid} onClick={() => void submit()}>{busy ? "Saving…" : "Save Completion"}</ModalButton>
    </ModalFooter>
  </ModalShell>;
}