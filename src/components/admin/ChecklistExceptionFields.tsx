import { Checkbox } from "@/components/ui/checkbox";
import { EVIDENCE_FIELD_LABELS, EVIDENCE_UPDATE_UNAVAILABLE, type EvidenceField, type EvidenceProjection } from "@/lib/checklist-evidence";
import { inputCls } from "./modal";

/** Capture only; never remove existing hard blockers or enable the real submit action. */
export function ChecklistExceptionFields({ items, selected, reason, onSelected, onReason }: {
  items: readonly EvidenceProjection[]; selected: readonly EvidenceField[]; reason: string;
  onSelected: (fields: EvidenceField[]) => void; onReason: (reason: string) => void;
}) {
  const outstanding = items.filter((i) => !i.complete && i.status !== "uploaded");
  if (!outstanding.length) return null;
  return <section className="space-y-3 border-t border-border pt-3" aria-label="Checklist Exceptions">
    <h4 className="text-sm font-semibold text-foreground">Checklist Exceptions</h4>
    <div className="space-y-2">{outstanding.map((i) => <label key={i.field} className="flex min-h-8 items-center gap-2 text-xs">
      <Checkbox aria-label={`Override ${EVIDENCE_FIELD_LABELS[i.field]}`} checked={selected.includes(i.field)} onCheckedChange={(checked) => onSelected(checked ? [...selected.filter((f) => f !== i.field), i.field] : selected.filter((f) => f !== i.field))} />
      <span>{EVIDENCE_FIELD_LABELS[i.field]} · <span className={i.tone === "red" ? "text-destructive" : "text-warning-foreground"}>{i.label}</span></span>
    </label>)}</div>
    <label className="block space-y-1 text-xs font-medium">Exception Reason<textarea aria-label="Checklist Exception Reason" rows={2} maxLength={500} className={`${inputCls} h-auto py-2`} value={reason} onChange={(e) => onReason(e.target.value)} /></label>
    <p role="status" className="text-xs text-warning-foreground">{EVIDENCE_UPDATE_UNAVAILABLE}</p>
  </section>;
}