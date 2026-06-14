import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Partner, FleetOwner, InvestorLead } from "./types";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PARTNER_TYPES = ["vehicle_owner","capital_partner","private_lender","jv_partner","other"] as const;
const PARTNER_STATUSES = ["prospect","active","paused","closed"] as const;

export function PartnersPanel() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [legacyOwners, setLegacyOwners] = useState<FleetOwner[]>([]);
  const [legacyInvestors, setLegacyInvestors] = useState<InvestorLead[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    refresh();
    supabase.from("fleet_owner_submissions").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setLegacyOwners(data || []));
    supabase.from("investor_leads").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setLegacyInvestors(data || []));
  }, []);

  function refresh() {
    supabase.from("partners").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setPartners(data || []));
  }

  async function update(id: string, patch: Partial<Partner>) {
    const { error } = await supabase.from("partners").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setPartners(p => p.map(x => x.id === id ? { ...x, ...patch } : x));
  }
  async function remove(id: string) {
    if (!confirm("Delete partner?")) return;
    const { error } = await supabase.from("partners").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setPartners(p => p.filter(x => x.id !== id));
  }
  async function add(p: Partial<Partner>) {
    const { data, error } = await supabase.from("partners").insert(p as any).select().single();
    if (error) return toast.error(error.message);
    setPartners(cur => [data as Partner, ...cur]);
    setShowAdd(false);
    toast.success("Partner added");
  }
  async function convertOwner(o: FleetOwner) {
    await add({ name: o.full_name, email: o.email, phone: o.phone, partner_type: "vehicle_owner", status: "prospect", vehicles_contributed: 1, notes: `Converted from fleet owner submission. Vehicle: ${o.year} ${o.make} ${o.model}` });
  }
  async function convertInvestor(l: InvestorLead) {
    await add({ name: l.name, email: l.email, phone: l.phone || undefined, partner_type: "capital_partner", status: "prospect", notes: [l.capital_range && `Range: ${l.capital_range}`, l.message].filter(Boolean).join(" — ") || null });
  }

  const filtered = filter === "all" ? partners : partners.filter(p => p.partner_type === filter);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-2 text-xs">
          {(["all", ...PARTNER_TYPES] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-md capitalize ${filter === s ? "bg-black text-white" : "bg-white border border-border"}`}>
              {s.replace(/_/g, " ")} {s !== "all" && `(${partners.filter(p => p.partner_type === s).length})`}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdd(true)} className="ml-auto rounded-md bg-real-red text-white px-3 py-1.5 text-sm">+ Add Partner</button>
      </div>

      <div className="space-y-2">
        {filtered.map(p => (
          <div key={p.id} className="rounded-xl bg-soft p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[240px]">
                <div className="font-medium">{p.name} <span className="text-xs text-muted-foreground">· {p.partner_type.replace(/_/g, " ")}</span></div>
                <div className="text-xs text-muted-foreground">{p.email || "—"} · {p.phone || "—"}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Capital: ${Number(p.capital_committed || 0).toLocaleString()} · Vehicles: {p.vehicles_contributed || 0} · Monthly: ${Number(p.monthly_payment || 0).toLocaleString()}
                </div>
              </div>
              <Select value={p.status} onValueChange={(status) => update(p.id, { status })}>
                <SelectTrigger className="h-8 w-28 bg-white text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent>{PARTNER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={p.partner_type} onValueChange={(partner_type) => update(p.id, { partner_type })}>
                <SelectTrigger className="h-8 w-36 bg-white text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent>{PARTNER_TYPES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
              <button onClick={() => remove(p.id)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-real-red hover:text-white hover:border-real-red">Delete</button>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <NumInput label="Capital ($)" value={p.capital_committed as any} onSave={(v) => update(p.id, { capital_committed: v })} />
              <NumInput label="Vehicles" value={p.vehicles_contributed as any} onSave={(v) => update(p.id, { vehicles_contributed: v })} />
              <NumInput label="Monthly ($)" value={p.monthly_payment as any} onSave={(v) => update(p.id, { monthly_payment: v })} />
            </div>
            <textarea defaultValue={p.notes || ""} onBlur={(e) => update(p.id, { notes: e.target.value })}
              placeholder="Notes" rows={2}
              className="mt-2 w-full bg-white border border-border rounded-md px-3 py-2 text-sm" />
          </div>
        ))}
        {filtered.length === 0 && <div className="text-sm text-muted-foreground">No partners.</div>}
      </div>

      <div className="mt-10">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Legacy submissions</h3>
        <div className="space-y-2">
          {legacyOwners.map(o => (
            <div key={o.id} className="rounded-lg bg-white border border-border p-3 flex flex-wrap items-center gap-3 text-sm">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{o.full_name} <span className="text-xs text-muted-foreground">· Fleet owner</span></div>
                <div className="text-xs text-muted-foreground">{o.email} · {o.year} {o.make} {o.model}</div>
              </div>
              <button onClick={() => convertOwner(o)} className="rounded-md bg-black text-white px-3 py-1.5 text-xs">Convert to Partner</button>
            </div>
          ))}
          {legacyInvestors.map(l => (
            <div key={l.id} className="rounded-lg bg-white border border-border p-3 flex flex-wrap items-center gap-3 text-sm">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{l.name} <span className="text-xs text-muted-foreground">· Investor</span></div>
                <div className="text-xs text-muted-foreground">{l.email} · {l.capital_range || "—"}</div>
              </div>
              <button onClick={() => convertInvestor(l)} className="rounded-md bg-black text-white px-3 py-1.5 text-xs">Convert to Partner</button>
            </div>
          ))}
          {legacyOwners.length === 0 && legacyInvestors.length === 0 && (
            <div className="text-xs text-muted-foreground">No legacy submissions.</div>
          )}
        </div>
      </div>

      {showAdd && <AddPartner onClose={() => setShowAdd(false)} onSave={add} />}
    </div>
  );
}

function NumInput({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number) => void }) {
  return (
    <div className="bg-white border border-border rounded-md px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <input type="number" defaultValue={value ?? 0} onBlur={(e) => onSave(Number(e.target.value) || 0)}
        className="w-full text-sm outline-none" />
    </div>
  );
}

function AddPartner({ onClose, onSave }: { onClose: () => void; onSave: (p: Partial<Partner>) => void }) {
  const [form, setForm] = useState<Partial<Partner>>({ name: "", email: "", phone: "", partner_type: "vehicle_owner", status: "prospect" });
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4">Add partner</h2>
        <div className="space-y-3 text-sm">
          <input placeholder="Name" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-soft rounded-md px-3 py-2" />
          <input placeholder="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full bg-soft rounded-md px-3 py-2" />
          <input placeholder="Phone" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full bg-soft rounded-md px-3 py-2" />
          <Select value={form.partner_type} onValueChange={(v) => setForm({ ...form, partner_type: v })}>
            <SelectTrigger className="bg-white text-foreground"><SelectValue /></SelectTrigger>
            <SelectContent>{PARTNER_TYPES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button onClick={() => form.name && onSave(form)} className="rounded-md bg-real-red text-white px-4 py-2 text-sm">Add</button>
        </div>
      </div>
    </div>
  );
}