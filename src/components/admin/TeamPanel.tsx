import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UserPlus, X, Users } from "lucide-react";

type Row = {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
};

const ROLES = ["admin", "partner", "driver", "team"] as const;

export function TeamPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("user_roles").select("*").order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    if (!confirm("Remove this role assignment?")) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    load();
  }

  const visible = filter === "all" ? rows : rows.filter((r) => r.role === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm">
            <option value="all">All Roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className="text-sm text-muted-foreground">{visible.length} assignment(s)</span>
        </div>
        <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 rounded-lg bg-real-red text-white px-4 py-2 text-sm font-medium">
          <UserPlus className="w-4 h-4" /> Grant Role
        </button>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : visible.length === 0 ? (
        <div className="rounded-xl border border-border p-10 text-center text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No role assignments.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-soft text-xs uppercase tracking-wider text-muted-foreground text-left">
              <tr><th className="px-4 py-2">User ID</th><th>Role</th><th>Granted</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><code className="text-xs">{r.user_id}</code></td>
                  <td><span className="text-xs rounded-full bg-soft px-2 py-0.5 capitalize">{r.role}</span></td>
                  <td className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => remove(r.id)} className="text-xs text-real-red hover:underline">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showForm && <GrantForm onClose={() => setShowForm(false)} onCreated={() => { setShowForm(false); load(); }} />}
    </div>
  );
}

function GrantForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<string>("driver");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return toast.error("User ID required");
    setSaving(true);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as any });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Granted");
    onCreated();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl p-6 max-w-md w-full space-y-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Grant Role</h3><button type="button" onClick={onClose}><X className="w-4 h-4" /></button></div>
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User UUID" className="w-full rounded border border-border px-3 py-2 text-sm font-mono" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded border border-border bg-white px-3 py-2 text-sm">
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">User must already have an account. Copy their UUID from the authenticated session.</p>
        <button disabled={saving} className="w-full rounded-lg bg-real-red text-white py-2 text-sm font-medium">{saving ? "Saving…" : "Grant"}</button>
      </form>
    </div>
  );
}