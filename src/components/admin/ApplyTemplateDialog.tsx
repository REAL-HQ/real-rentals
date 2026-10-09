import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { previewApplyTemplate, applyVehicleTemplate } from "@/lib/vehicle-defaults.functions";
import { DEFAULT_FIELD_LABELS, bodyTypeLabel, type ApplyRow, type DefaultField } from "@/lib/vehicle-defaults";

const money = (n: number | null) => (n == null ? "Not Set" : `$${n.toLocaleString()}`);

export function ApplyTemplateDialog({ vehicleId, open, onOpenChange, onApplied }: { vehicleId: string; open: boolean; onOpenChange: (o: boolean) => void; onApplied: () => void }) {
  const previewFn = useServerFn(previewApplyTemplate);
  const applyFn = useServerFn(applyVehicleTemplate);
  const [data, setData] = useState<{ bodyType: string | null; hasTemplate: boolean; plan: ApplyRow[] } | null>(null);
  const [chosen, setChosen] = useState<DefaultField[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setData(null);
    previewFn({ data: { vehicleId } }).then((r) => {
      setData(r);
      // Pre-tick blanks only; replacing an existing rate is always an explicit opt-in.
      setChosen(r.plan.filter((p) => p.change === "fill").map((p) => p.field));
    }).catch((e) => toast.error(e?.message ?? "Could not load the template."));
  }, [open, vehicleId, previewFn]);

  async function apply() {
    if (!data) return;
    setBusy(true);
    try {
      const r = await applyFn({ data: { vehicleId, fields: chosen, expected: data.plan.map(({ field, current, proposed }) => ({ field, current, proposed })) } });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Template Applied");
      onApplied();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Only an Owner or Manager can apply templates." : e?.message ?? "Could not apply.");
    } finally { setBusy(false); }
  }

  const actionable = data?.plan.filter((p) => p.change === "fill" || p.change === "replace") ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Apply Pricing Template</DialogTitle></DialogHeader>
        {!data ? <p className="text-[13px] text-muted-foreground">Loading…</p>
          : !data.bodyType ? <p className="text-[13px]">This vehicle has no body type. Set the body type first; the system will not guess.</p>
          : !data.hasTemplate ? <p className="text-[13px]">No Vehicle Pricing is set for {bodyTypeLabel(data.bodyType)}. Add it in Settings → Rentals → Vehicle Pricing.</p>
          : (
            <div className="space-y-3">
              <p className="text-[12px] text-muted-foreground">Template: <span className="font-medium text-foreground">{bodyTypeLabel(data.bodyType)}</span>. Only ticked rows change. Rentals and agreements already sent or signed are not affected.</p>
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[11px] text-muted-foreground"><th className="w-6" /><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
                <tbody>
                  {data.plan.map((r) => {
                    const can = r.change === "fill" || r.change === "replace";
                    return (
                      <tr key={r.field} className="border-t">
                        <td className="py-2"><input type="checkbox" aria-label={`Apply ${DEFAULT_FIELD_LABELS[r.field]}`} disabled={!can} checked={chosen.includes(r.field)}
                          onChange={(e) => setChosen((c) => e.target.checked ? [...c, r.field] : c.filter((f) => f !== r.field))} /></td>
                        <td>{DEFAULT_FIELD_LABELS[r.field]}</td>
                        <td>{money(r.current)}</td>
                        <td>{r.change === "no_template_value" ? "—" : money(r.proposed)}{r.change === "replace" && <span className="ml-1 text-[11px] text-destructive">Replaces</span>}{r.change === "same" && <span className="ml-1 text-[11px] text-muted-foreground">Same</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {actionable.length === 0 && <p className="text-[12px] text-muted-foreground">This vehicle already matches the template.</p>}
            </div>
          )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !chosen.length || !data?.hasTemplate} onClick={apply}>{busy ? "Applying…" : "Confirm & Apply"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
