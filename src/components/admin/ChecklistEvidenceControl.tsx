import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, inputCls, ModalBody, ModalButton, ModalFooter, ModalHeader, ModalShell } from "./modal";
import { EVIDENCE_FIELD_LABELS, EVIDENCE_UPDATE_UNAVAILABLE, type AttestationInput, type EvidenceProjection } from "@/lib/checklist-evidence";

export function ChecklistEvidenceControl({ applicationId, item, save, onSaved }: {
  applicationId: string; item: EvidenceProjection;
  /** No save callback in the real profile until durable persistence is authorized. */
  save?: (input: AttestationInput) => Promise<void>; onSaved?: () => void;
}) {
  const [choice, setChoice] = useState<"collected" | "not_collected" | null>(null);
  const tone = item.tone === "yellow" ? "text-warning-foreground" : item.tone === "red" ? "text-destructive" : "text-success";
  const label = EVIDENCE_FIELD_LABELS[item.field];
  return <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-[11px]" aria-label={`${label} Evidence`}>
    <span className={tone}>{label}: {item.label}</span>
    <label className="flex min-h-7 items-center gap-1.5"><Checkbox checked={item.collected} disabled={item.complete || item.uploaded} aria-label={`${label} Collected`} onCheckedChange={() => setChoice(item.collected ? "not_collected" : "collected")} />Collected</label>
    <Button variant="ghost" size="sm" className="h-7 px-1.5 text-[11px]" disabled={item.complete} onClick={() => setChoice("not_collected")}>Not Collected</Button>
    {choice ? <EvidenceChoiceDialog applicationId={applicationId} item={item} choice={choice} save={save} onClose={() => setChoice(null)} onSaved={onSaved} /> : null}
  </div>;
}

function EvidenceChoiceDialog({ applicationId, item, choice, save, onClose, onSaved }: {
  applicationId: string; item: EvidenceProjection; choice: "collected" | "not_collected";
  save?: (input: AttestationInput) => Promise<void>; onClose: () => void; onSaved?: () => void;
}) {
  const [source, setSource] = useState<"email" | "paper" | "other">("email");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = useRef<HTMLDivElement>(null);
  const close = () => { if (!busy) onClose(); };
  useEffect(() => {
    const previous = document.activeElement;
    scope.current?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const controls = Array.from(scope.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? []).filter((e) => e.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  async function submit() {
    if (!save || busy || note.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      const base = { applicationId, field: item.field, expectedRevision: item.revision, idempotencyKey: crypto.randomUUID(), note: note.trim() };
      await save(choice === "collected" ? { ...base, state: choice, source } : { ...base, state: choice, source: null });
      onSaved?.(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Could Not Save Evidence"); }
    finally { setBusy(false); }
  }
  return createPortal(<div ref={scope} onKeyDown={onKey}>
    <ModalShell label={`${choice === "collected" ? "Collected" : "Not Collected"}: ${EVIDENCE_FIELD_LABELS[item.field]}`} size="sm" z="z-[80]" onClose={close} closeOnBackdrop={!busy}>
      <ModalHeader title={choice === "collected" ? "Collected Elsewhere" : "Not Collected"} subtitle={EVIDENCE_FIELD_LABELS[item.field]} onClose={busy ? undefined : close} />
      <ModalBody className="space-y-4">
        {choice === "collected" ? <Field label="Received Via" required><Select value={source} disabled={busy} onValueChange={(v) => { if (v === "email" || v === "paper" || v === "other") setSource(v); }}><SelectTrigger aria-label="Received Via"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="paper">Paper</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></Field> : null}
        <Field label="Evidence Note" required><textarea aria-label="Evidence Note" className={`${inputCls} h-auto py-2`} rows={3} maxLength={1000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} /></Field>
        {!save ? <p role="status" className="text-xs text-warning-foreground">{EVIDENCE_UPDATE_UNAVAILABLE}</p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </ModalBody>
      <ModalFooter><ModalButton disabled={busy} onClick={close}>Cancel</ModalButton><ModalButton variant="primary" disabled={!save || busy || note.trim().length < 3} onClick={() => void submit()}>{busy ? "Saving…" : "Save Evidence"}</ModalButton></ModalFooter>
    </ModalShell>
  </div>, document.body);
}