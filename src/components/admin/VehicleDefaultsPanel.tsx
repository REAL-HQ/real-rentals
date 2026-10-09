import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { listVehicleDefaults, saveVehicleDefault, deleteVehicleDefault } from "@/lib/vehicle-defaults.functions";
import { BODY_TYPES } from "@/lib/vehicles.functions";
import { DEFAULT_FIELDS, DEFAULT_FIELD_LABELS, bodyTypeLabel, type VehicleDefault } from "@/lib/vehicle-defaults";

const money = (v: number | null) => (v == null ? "Not Set" : `$${v.toLocaleString()}`);
type Draft = { body_type: string; weekly_rate: string; monthly_rate: string; deposit: string };
const toDraft = (d: VehicleDefault): Draft => ({
  body_type: d.body_type,
  weekly_rate: d.weekly_rate == null ? "" : String(d.weekly_rate),
  monthly_rate: d.monthly_rate == null ? "" : String(d.monthly_rate),
  deposit: d.deposit == null ? "" : String(d.deposit),
});

export function VehicleDefaultsPanel() {
  const list = useServerFn(listVehicleDefaults);
  const save = useServerFn(saveVehicleDefault);
  const remove = useServerFn(deleteVehicleDefault);
  const [rows, setRows] = useState<VehicleDefault[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => list().then((r) => { setRows(r.defaults); setCanEdit(r.canEdit); }).catch(() => setRows([]));
  useEffect(() => { void load(); }, []);

  const unused = BODY_TYPES.filter((b) => !rows?.some((r) => r.body_type === b));

  async function submit() {
    if (!draft) return;
    const vals: Record<string, number | null> = {};
    for (const f of DEFAULT_FIELDS) {
      const raw = draft[f].trim();
      const n = raw === "" ? null : Number(raw);
      if (n != null && (!Number.isFinite(n) || n < 0)) return toast.error(`${DEFAULT_FIELD_LABELS[f]} must be a number`);
      vals[f] = n;
    }
    setBusy(true);
    try {
      await save({ data: { body_type: draft.body_type, ...(vals as any) } });
      toast.success(`${bodyTypeLabel(draft.body_type)} defaults saved`);
      setDraft(null); await load();
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Only an Owner can change Vehicle Pricing." : "Could not save.");
    } finally { setBusy(false); }
  }

  async function del(t: string) {
    if (!confirm(`Delete the ${bodyTypeLabel(t)} defaults? Existing vehicles keep their prices.`)) return;
    try { await remove({ data: { body_type: t } }); toast.success("Deleted"); await load(); }
    catch { toast.error("Could not delete."); }
  }

  if (!rows) return <div className="py-10 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      {!canEdit && <p className="text-[12px] text-muted-foreground">Only an Owner can change Vehicle Pricing. They apply automatically when you add a vehicle.</p>}
      {rows.length === 0 && !draft && (
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
          No Vehicle Pricing set yet. New vehicles start with Weekly Rate, Monthly Rate and Deposit Not Set.
        </div>
      )}
      {rows.map((r) => draft && !isNew && draft.body_type === r.body_type ? null : (
        <div key={r.body_type} className="rounded-xl border border-border bg-card px-5 py-4 flex items-center gap-4 flex-wrap">
          <div className="w-32 font-semibold text-[14px]">{bodyTypeLabel(r.body_type)}</div>
          <dl className="flex-1 grid grid-cols-3 gap-4 min-w-[260px]">
            {DEFAULT_FIELDS.map((f) => (
              <div key={f}>
                <dt className="text-[11px] text-muted-foreground">{DEFAULT_FIELD_LABELS[f]}</dt>
                <dd className={`text-[14px] ${r[f] == null ? "text-muted-foreground" : "font-medium"}`}>{money(r[f])}</dd>
              </div>
            ))}
          </dl>
          {canEdit && (
            <div className="flex gap-1">
              <button aria-label={`Edit ${bodyTypeLabel(r.body_type)} defaults`} onClick={() => { setIsNew(false); setDraft(toDraft(r)); }} className="h-9 px-3 rounded-lg text-[13px] inline-flex items-center gap-1.5 hover:bg-muted"><Pencil className="w-3.5 h-3.5" /> Edit</button>
              <button aria-label={`Delete ${bodyTypeLabel(r.body_type)} defaults`} onClick={() => del(r.body_type)} className="h-9 w-9 grid place-items-center rounded-lg hover:bg-muted text-muted-foreground"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
      ))}

      {draft && (
        <div className="rounded-xl border border-foreground/20 bg-card p-5 space-y-4">
          <div className="flex items-center gap-3">
            {isNew ? (
              <select aria-label="Vehicle Type" value={draft.body_type} onChange={(e) => setDraft({ ...draft, body_type: e.target.value })} className="h-10 px-3 rounded-lg border border-input bg-background text-[14px]">
                {unused.map((b) => <option key={b} value={b}>{bodyTypeLabel(b)}</option>)}
              </select>
            ) : <div className="font-semibold text-[15px]">{bodyTypeLabel(draft.body_type)}</div>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {DEFAULT_FIELDS.map((f) => (
              <label key={f} className="block">
                <span className="block text-[12px] font-medium mb-1">{DEFAULT_FIELD_LABELS[f]}</span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input aria-label={DEFAULT_FIELD_LABELS[f]} inputMode="decimal" placeholder="Not Set" value={draft[f]} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                    className="w-full h-10 pl-7 pr-3 rounded-lg border border-input bg-background text-[14px]" />
                </div>
              </label>
            ))}
          </div>
          <p className="text-[12px] text-muted-foreground">Leave a field blank for Not Set. $0 is saved as a real $0. Changes apply only to vehicles added from now on.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDraft(null)} className="h-9 px-4 rounded-lg text-[13px] hover:bg-muted">Cancel</button>
            <button onClick={submit} disabled={busy || !draft.body_type} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save Defaults
            </button>
          </div>
        </div>
      )}

      {canEdit && !draft && unused.length > 0 && (
        <button onClick={() => { setIsNew(true); setDraft({ body_type: unused[0], weekly_rate: "", monthly_rate: "", deposit: "" }); }}
          className="h-10 px-4 rounded-lg border border-border bg-card text-[13px] font-medium inline-flex items-center gap-1.5 hover:bg-muted">
          <Plus className="w-4 h-4" /> Add Vehicle Type
        </button>
      )}
    </div>
  );
}
