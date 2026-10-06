import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { listMaintenanceDefaults, saveMaintenanceDefault, deleteMaintenanceDefault } from "@/lib/maintenance.functions";
import { inputCls, ModalButton } from "./modal";
import { EmptyState } from "./ui";

// Company maintenance intervals. Nothing ships pre-filled: the Owner decides
// the policy. Vehicles can override an interval from their Service tab.
export function MaintenanceDefaultsPanel() {
  const list = useServerFn(listMaintenanceDefaults);
  const save = useServerFn(saveMaintenanceDefault);
  const del = useServerFn(deleteMaintenanceDefault);
  const [rows, setRows] = useState<any[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [draft, setDraft] = useState({ item: "", miles: "", months: "" });
  const refresh = useCallback(() => list().then((r) => { setRows(r.defaults.filter((d: any) => d.is_active)); setCanEdit(r.canEdit); }), [list]);
  useEffect(() => { refresh(); }, [refresh]);

  const commit = async (id: string | null, item: string, miles: string, months: string) => {
    const r = await save({ data: { id, item, interval_miles: miles ? Number(miles) : null, interval_days: months ? Number(months) * 30 : null } }).catch((e) => ({ ok: false as const, error: e?.message ?? "Could not save." }));
    if (!r.ok) { toast.error((r as any).error); return false; }
    toast.success("Interval saved."); refresh(); return true;
  };

  if (!rows) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  return (
    <div className="space-y-4">
      {rows.length === 0 && <EmptyState title="No Intervals Yet" hint={canEdit ? "Add an interval such as Oil Change, set by miles, months or both." : "An Owner sets company maintenance intervals."} />}
      {rows.length > 0 && (
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[1fr_140px_140px_40px] gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:grid"><span>Service</span><span>Every (Miles)</span><span>Every (Months)</span><span /></div>
          {rows.map((r) => <Row key={r.id} r={r} canEdit={canEdit} onSave={commit} onDelete={async () => { await del({ data: { id: r.id } }); refresh(); }} />)}
        </div>
      )}
      {canEdit && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
          <input className={inputCls} placeholder="Service, e.g. Oil Change" value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} />
          <input className={inputCls} inputMode="numeric" placeholder="Miles" value={draft.miles} onChange={(e) => setDraft({ ...draft, miles: e.target.value.replace(/\D/g, "") })} />
          <input className={inputCls} inputMode="numeric" placeholder="Months" value={draft.months} onChange={(e) => setDraft({ ...draft, months: e.target.value.replace(/\D/g, "") })} />
          <ModalButton variant="primary" disabled={draft.item.trim().length < 2 || (!draft.miles && !draft.months)}
            onClick={async () => { if (await commit(null, draft.item.trim(), draft.miles, draft.months)) setDraft({ item: "", miles: "", months: "" }); }}>
            <Plus className="h-4 w-4" /> Add Interval
          </ModalButton>
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">Whichever comes first — miles or time — makes a service due. Changes are recorded in Activity.</p>
    </div>
  );
}

function Row({ r, canEdit, onSave, onDelete }: { r: any; canEdit: boolean; onSave: (id: string, item: string, miles: string, months: string) => Promise<boolean>; onDelete: () => void }) {
  const [miles, setMiles] = useState(r.interval_miles ? String(r.interval_miles) : "");
  const [months, setMonths] = useState(r.interval_days ? String(Math.round(r.interval_days / 30)) : "");
  const dirty = miles !== (r.interval_miles ? String(r.interval_miles) : "") || months !== (r.interval_days ? String(Math.round(r.interval_days / 30)) : "");
  return (
    <div className="grid grid-cols-1 items-center gap-2 px-4 py-2.5 sm:grid-cols-[1fr_140px_140px_40px] sm:gap-3">
      <div className="text-[14px] font-medium">{r.item}</div>
      <input disabled={!canEdit} className={inputCls} inputMode="numeric" value={miles} placeholder="—" onChange={(e) => setMiles(e.target.value.replace(/\D/g, ""))} onBlur={() => dirty && (miles || months) && onSave(r.id, r.item, miles, months)} />
      <input disabled={!canEdit} className={inputCls} inputMode="numeric" value={months} placeholder="—" onChange={(e) => setMonths(e.target.value.replace(/\D/g, ""))} onBlur={() => dirty && (miles || months) && onSave(r.id, r.item, miles, months)} />
      {canEdit ? <button aria-label="Remove Interval" className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted" onClick={onDelete}><Trash2 className="h-4 w-4" /></button> : <span />}
    </div>
  );
}
