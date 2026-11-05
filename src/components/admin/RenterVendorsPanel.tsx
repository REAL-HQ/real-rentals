import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Trash2, Plus, Wand2 } from "lucide-react";
import {
  adminDeleteRenterVendor,
  adminFindVendorLogo,
  adminListRenterVendors,
  adminReorderRenterVendors,
  adminSaveRenterVendor,
} from "@/lib/renter-portal.functions";
import { VENDOR_CATEGORIES, reorder, vendorCategoryLabel, type RenterVendor } from "@/lib/renter-portal";
import { VendorLogo } from "@/components/portal/RenterVendors";

type Draft = Partial<RenterVendor>;
const EMPTY: Draft = { category: "roadside", name: "", is_active: true };

/** Team-editable list renters see under Recommended Vendors. */
export function RenterVendorsPanel() {
  const qc = useQueryClient();
  const list = useServerFn(adminListRenterVendors);
  const save = useServerFn(adminSaveRenterVendor);
  const del = useServerFn(adminDeleteRenterVendor);
  const order = useServerFn(adminReorderRenterVendors);
  const findLogo = useServerFn(adminFindVendorLogo);
  const { data = [], isLoading } = useQuery({ queryKey: ["admin-renter-vendors"], queryFn: () => list() });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-renter-vendors"] });

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof RenterVendor, v: unknown) => setDraft((d) => ({ ...(d ?? {}), [k]: v }));

  return (
    <div className="rounded-2xl border border-border bg-white p-5 mt-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Renter Recommended Vendors</h3>
          <p className="text-xs text-muted-foreground">Shown in the renter portal. Only active rows are visible to renters.</p>
        </div>
        <button type="button" className="inline-flex items-center gap-1 text-sm text-real-red" onClick={() => setDraft({ ...EMPTY })}>
          <Plus className="w-4 h-4" /> Add vendor
        </button>
      </div>

      {draft ? (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm border border-border rounded-xl p-4">
          <label className="flex flex-col gap-1">Category
            <select className="border rounded px-2 py-1" value={draft.category} onChange={(e) => set("category", e.target.value)}>
              {VENDOR_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          {(["name", "phone", "website", "address", "logo_url"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 capitalize">{k.replace("_url", "").replace("_", " ")}
              <input className="border rounded px-2 py-1" value={(draft[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} />
            </label>
          ))}
          <label className="flex flex-col gap-1 sm:col-span-2">Notes
            <textarea className="border rounded px-2 py-1" rows={2} value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.is_active !== false} onChange={(e) => set("is_active", e.target.checked)} /> Visible to renters</label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <VendorLogo vendor={{ name: draft.name || "?", logo_url: draft.logo_url ?? null }} />
            <button type="button" disabled={busy || !draft.website} className="inline-flex items-center gap-1 text-xs text-real-red disabled:opacity-50"
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await findLogo({ data: { website: draft.website } });
                  if (r.logoUrl) set("logo_url", r.logoUrl);
                  else toast.message("No logo found; initials will be shown.");
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>
              <Wand2 className="w-3.5 h-3.5" /> Get logo from website
            </button>
            <div className="ml-auto flex gap-2">
              <button type="button" className="px-3 py-1 border rounded" onClick={() => setDraft(null)}>Cancel</button>
              <button type="button" disabled={busy} className="px-3 py-1 rounded bg-foreground text-background"
                onClick={() => run(async () => { await save({ data: draft }); setDraft(null); }, "Saved")}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {isLoading ? <p className="mt-4 text-sm text-muted-foreground">Loading…</p> : data.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No vendors yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {data.map((v, i) => (
            <li key={v.id} className="py-2 flex items-center gap-3 text-sm">
              <VendorLogo vendor={v} size={32} />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{v.name}{v.is_active ? "" : " (hidden)"}</div>
                <div className="text-xs text-muted-foreground">{vendorCategoryLabel(v.category)}{v.phone ? ` · ${v.phone}` : ""}</div>
              </div>
              <button type="button" aria-label="Move up" disabled={busy || i === 0}
                onClick={() => run(() => order({ data: { ids: reorder(data.map((x) => x.id), v.id, -1) } }))}><ArrowUp className="w-4 h-4" /></button>
              <button type="button" aria-label="Move down" disabled={busy || i === data.length - 1}
                onClick={() => run(() => order({ data: { ids: reorder(data.map((x) => x.id), v.id, 1) } }))}><ArrowDown className="w-4 h-4" /></button>
              <button type="button" aria-label="Edit" onClick={() => setDraft({ ...v })}><Pencil className="w-4 h-4" /></button>
              <button type="button" aria-label="Remove" disabled={busy}
                onClick={() => { if (window.confirm(`Remove ${v.name}?`)) void run(() => del({ data: { id: v.id } }), "Removed"); }}>
                <Trash2 className="w-4 h-4 text-real-red" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
