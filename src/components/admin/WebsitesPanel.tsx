import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Globe } from "lucide-react";

type Site = {
  id: string;
  slug: string;
  title: string;
  market_id: string | null;
  is_published: boolean;
  status: string;
  show_on_homepage: boolean;
  sort_order: number;
  hero_image_url: string | null;
};

export function WebsitesPanel() {
  const [sites, setSites] = useState<Site[]>([]);
  const [markets, setMarkets] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [waitlistCounts, setWaitlistCounts] = useState<Record<string, number>>({});

  async function load() {
    setLoading(true);
    const [s, m, w] = await Promise.all([
      supabase.from("sites").select("*").order("title"),
      supabase.from("markets").select("id, name").order("name"),
      supabase.from("waitlist").select("market_id"),
    ]);
    if (s.error) toast.error(s.error.message);
    setSites((s.data as any) ?? []);
    setMarkets((m.data as any) ?? []);
    const counts: Record<string, number> = {};
    ((w.data as any[]) ?? []).forEach((row) => {
      if (row.market_id) counts[row.market_id] = (counts[row.market_id] ?? 0) + 1;
    });
    setWaitlistCounts(counts);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function togglePublish(id: string, is_published: boolean) {
    const { error } = await supabase.from("sites").update({ is_published: !is_published }).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  async function updateSite(id: string, patch: Partial<Site>) {
    const { error } = await supabase.from("sites").update(patch as any).eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{sites.length} site(s)</span>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-real-red text-white px-4 py-2 text-sm font-medium">
          <Plus className="w-4 h-4" /> New Site
        </button>
      </div>

      <div className="rounded-xl border border-border p-4 bg-soft">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Waitlist Demand (Coming Soon Cities)</div>
        <div className="flex flex-wrap gap-2">
          {sites
            .filter((s) => s.status === "coming_soon")
            .sort((a, b) => (waitlistCounts[b.market_id ?? ""] ?? 0) - (waitlistCounts[a.market_id ?? ""] ?? 0))
            .map((s) => (
              <span key={s.id} className="inline-flex items-center gap-2 rounded-full bg-white border border-border px-3 py-1 text-xs">
                <span className="font-medium">{markets.find((m) => m.id === s.market_id)?.name ?? s.title}</span>
                <span className="text-real-red font-semibold">{waitlistCounts[s.market_id ?? ""] ?? 0}</span>
              </span>
            ))}
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : sites.length === 0 ? (
        <div className="rounded-xl border border-border p-10 text-center text-muted-foreground">
          <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No market sites yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-soft text-xs uppercase tracking-wider text-muted-foreground text-left">
              <tr>
                <th className="px-4 py-2">Title</th>
                <th>Slug</th>
                <th>Market</th>
                <th>Status</th>
                <th>Homepage</th>
                <th>Order</th>
                <th>Hero Image</th>
                <th>Waitlist</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sites.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-medium">{s.title}</td>
                  <td><code className="text-xs">/{s.slug}</code></td>
                  <td className="text-muted-foreground">{markets.find((m) => m.id === s.market_id)?.name ?? "—"}</td>
                  <td>
                    <select
                      value={s.status}
                      onChange={(e) => updateSite(s.id, { status: e.target.value })}
                      className="text-xs rounded border border-border bg-white px-2 py-1"
                    >
                      <option value="live">Live</option>
                      <option value="coming_soon">Coming Soon</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={s.show_on_homepage}
                      onChange={(e) => updateSite(s.id, { show_on_homepage: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={s.sort_order}
                      onChange={(e) => updateSite(s.id, { sort_order: Number(e.target.value) })}
                      className="w-16 text-xs rounded border border-border px-2 py-1"
                    />
                  </td>
                  <td>
                    <input
                      type="url"
                      defaultValue={s.hero_image_url ?? ""}
                      onBlur={(e) => {
                        if (e.target.value !== (s.hero_image_url ?? "")) {
                          updateSite(s.id, { hero_image_url: e.target.value || null });
                        }
                      }}
                      placeholder="https://…"
                      className="w-44 text-xs rounded border border-border px-2 py-1"
                    />
                  </td>
                  <td className="text-center">
                    <span className="text-xs font-semibold text-real-red">{waitlistCounts[s.market_id ?? ""] ?? 0}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => togglePublish(s.id, s.is_published)} className="text-xs rounded border border-border px-2 py-1">
                      {s.is_published ? "Unpublish" : "Publish"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showForm && <NewSiteForm markets={markets} onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function NewSiteForm({ markets, onClose, onCreated }: { markets: { id: string; name: string }[]; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [marketId, setMarketId] = useState<string>(markets[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !slug) return toast.error("Title and slug required");
    setSaving(true);
    const { error } = await supabase.from("sites").insert({ title, slug, market_id: marketId || null } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Created");
    onCreated();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl p-6 max-w-md w-full space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">New Site</h3><button type="button" onClick={onClose}><X className="w-4 h-4" /></button></div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded border border-border px-3 py-2 text-sm" />
        <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="slug" className="w-full rounded border border-border px-3 py-2 text-sm" />
        <select value={marketId} onChange={(e) => setMarketId(e.target.value)} className="w-full rounded border border-border bg-white px-3 py-2 text-sm">
          <option value="">No market</option>
          {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button disabled={saving} className="w-full rounded-lg bg-real-red text-white py-2 text-sm font-medium">{saving ? "Saving…" : "Create"}</button>
      </form>
    </div>
  );
}