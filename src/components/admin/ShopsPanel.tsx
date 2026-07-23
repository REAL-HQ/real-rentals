import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Store, MapPin, Phone } from "lucide-react";
import { StatusPill } from "./ui";

type Shop = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  hours: string | null;
  services: string[];
  is_active: boolean;
  market_id: string | null;
};

export function ShopsPanel() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [markets, setMarkets] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    const [s, m] = await Promise.all([
      supabase.from("shops").select("*").order("name"),
      supabase.from("markets").select("id, name").order("name"),
    ]);
    if (s.error) toast.error(s.error.message);
    setShops((s.data as any) ?? []);
    setMarkets((m.data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(id: string, is_active: boolean) {
    const { error } = await supabase.from("shops").update({ is_active: !is_active }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this shop?")) return;
    const { error } = await supabase.from("shops").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{shops.length} shop(s)</span>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#CC0000] text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150">
          <Plus className="w-4 h-4" /> Add Shop
        </button>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : shops.length === 0 ? (
        <div className="rounded-xl border border-border p-10 text-center text-muted-foreground">
          <Store className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No shops yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {shops.map((s) => (
            <div key={s.id} className="rounded-2xl border border-[#EDEDF0] p-4 bg-white shadow-sm transition-colors duration-150 hover:border-[#D9D9DE]">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{markets.find((m) => m.id === s.market_id)?.name ?? "No market"}</div>
                </div>
                <StatusPill status={s.is_active ? "active" : "inactive"} />
              </div>
              {s.address && <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{s.address}</div>}
              {s.phone && <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{s.phone}</div>}
              {s.services?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.services.map((srv) => <span key={srv} className="text-[10px] rounded-full bg-soft px-2 py-0.5 text-muted-foreground">{srv}</span>)}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={() => toggleActive(s.id, s.is_active)} className="text-xs rounded border border-border px-2 py-1">{s.is_active ? "Deactivate" : "Activate"}</button>
                <button onClick={() => remove(s.id)} className="text-xs rounded border border-border px-2 py-1 text-real-red">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {showForm && <NewShopForm markets={markets} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function NewShopForm({ markets, onClose, onCreated }: { markets: { id: string; name: string }[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [marketId, setMarketId] = useState<string>(markets[0]?.id ?? "");
  const [services, setServices] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return toast.error("Name required");
    setSaving(true);
    const { error } = await supabase.from("shops").insert({
      name, address: address || null, phone: phone || null,
      market_id: marketId || null,
      services: services.split(",").map((s) => s.trim()).filter(Boolean),
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Created");
    onCreated();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl p-6 max-w-md w-full space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Add Shop</h3><button type="button" onClick={onClose}><X className="w-4 h-4" /></button></div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop name" className="w-full rounded border border-border px-3 py-2 text-sm" />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="w-full rounded border border-border px-3 py-2 text-sm" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-full rounded border border-border px-3 py-2 text-sm" />
        <select value={marketId} onChange={(e) => setMarketId(e.target.value)} className="w-full rounded border border-border bg-white px-3 py-2 text-sm">
          <option value="">No market</option>
          {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input value={services} onChange={(e) => setServices(e.target.value)} placeholder="Services (comma-separated)" className="w-full rounded border border-border px-3 py-2 text-sm" />
        <button disabled={saving} className="w-full rounded-lg bg-real-red text-white py-2 text-sm font-medium">{saving ? "Saving…" : "Create"}</button>
      </form>
    </div>
  );
}