import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — REAL AUTOMOTIVE" }, { name: "robots", content: "noindex" }] }),
  component: Admin,
});

type Tab = "applications" | "vehicles" | "contact" | "investors";

function Admin() {
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("applications");
  const [apps, setApps] = useState<Tables<"applications">[]>([]);
  const [vehicles, setVehicles] = useState<Tables<"vehicles">[]>([]);
  const [contacts, setContacts] = useState<Tables<"contact_leads">[]>([]);
  const [investors, setInvestors] = useState<Tables<"investor_leads">[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setIsAdmin(false); return; }
    supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "admin").maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [session]);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("applications").select("*").order("created_at", { ascending: false }).then(({ data }) => setApps(data || []));
    supabase.from("vehicles").select("*").order("make").then(({ data }) => setVehicles(data || []));
    supabase.from("contact_leads").select("*").order("created_at", { ascending: false }).then(({ data }) => setContacts(data || []));
    supabase.from("investor_leads").select("*").order("created_at", { ascending: false }).then(({ data }) => setInvestors(data || []));
  }, [isAdmin, tab]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setErr(error.message);
  }
  async function signOut() { await supabase.auth.signOut(); }

  async function updateAppStatus(id: string, status: string) {
    await supabase.from("applications").update({ status }).eq("id", id);
    setApps((a) => a.map((x) => x.id === id ? { ...x, status } : x));
  }
  async function updateVehicleStatus(id: string, status: string) {
    await supabase.from("vehicles").update({ status }).eq("id", id);
    setVehicles((a) => a.map((x) => x.id === id ? { ...x, status } : x));
  }

  if (!session) {
    return (
      <SiteLayout>
        <div className="container-real max-w-md py-32">
          <h1 className="text-3xl font-semibold mb-6">Admin Sign In</h1>
          <form onSubmit={signIn} className="space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className="w-full bg-soft rounded-full px-5 py-3 text-sm" />
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" placeholder="Password" className="w-full bg-soft rounded-full px-5 py-3 text-sm" />
            {err && <div className="text-sm text-real-red">{err}</div>}
            <button className="w-full rounded-full bg-black text-white py-3 text-sm hover:bg-real-red transition">Sign In</button>
          </form>
        </div>
      </SiteLayout>
    );
  }

  if (!isAdmin) {
    return (
      <SiteLayout>
        <div className="container-real py-32 text-center max-w-lg">
          <h1 className="text-2xl font-semibold">No admin access</h1>
          <p className="mt-3 text-muted-foreground text-sm">Your account ID:<br/><code className="text-xs">{session.user.id}</code></p>
          <p className="mt-3 text-muted-foreground text-sm">Grant access from the Cloud SQL editor:<br/><code className="text-xs">INSERT INTO user_roles (user_id, role) VALUES ('{session.user.id}', 'admin');</code></p>
          <button onClick={signOut} className="mt-6 rounded-full border border-border px-6 py-2 text-sm">Sign out</button>
        </div>
      </SiteLayout>
    );
  }

  const tabs: Tab[] = ["applications", "vehicles", "contact", "investors"];

  return (
    <SiteLayout>
      <div className="container-real py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-semibold">Admin</h1>
          <button onClick={signOut} className="text-sm text-muted-foreground hover:text-foreground">Sign out</button>
        </div>
        <div className="flex gap-2 mb-8 flex-wrap">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-5 py-2 text-sm capitalize transition ${tab === t ? "bg-black text-white" : "bg-soft hover:bg-border"}`}>{t}</button>
          ))}
        </div>

        {tab === "applications" && (
          <div className="space-y-3">
            {apps.map((a) => (
              <div key={a.id} className="rounded-2xl bg-soft p-5 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
                <div>
                  <div className="font-medium">{a.full_name} <span className="text-muted-foreground text-sm">· {a.email} · {a.phone}</span></div>
                  <div className="text-xs text-muted-foreground mt-1">{new Date(a.created_at!).toLocaleString()} · Platforms: {a.platforms?.join(", ") || "—"} · Term: {a.rental_term}</div>
                </div>
                <select value={a.status} onChange={(e) => updateAppStatus(a.id, e.target.value)} className="bg-white border border-border rounded-full px-4 py-2 text-sm">
                  {["new", "reviewing", "approved", "declined", "active"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            ))}
            {apps.length === 0 && <div className="text-muted-foreground text-sm">No applications yet.</div>}
          </div>
        )}
        {tab === "vehicles" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {vehicles.map((v) => (
              <div key={v.id} className="rounded-2xl bg-soft p-5 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">{v.year} {v.make} {v.model}</div>
                  <div className="text-xs text-muted-foreground">${Number(v.weekly_rate)}/wk · {v.body_type}</div>
                </div>
                <select value={v.status} onChange={(e) => updateVehicleStatus(v.id, e.target.value)} className="bg-white border border-border rounded-full px-4 py-2 text-sm">
                  {["available", "rented", "maintenance"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        {tab === "contact" && (
          <div className="space-y-3">
            {contacts.map((c) => (
              <div key={c.id} className="rounded-2xl bg-soft p-5">
                <div className="font-medium">{c.name} <span className="text-muted-foreground text-sm">· {c.email}</span></div>
                <p className="text-sm mt-2 text-muted-foreground">{c.message}</p>
              </div>
            ))}
          </div>
        )}
        {tab === "investors" && (
          <div className="space-y-3">
            {investors.map((i) => (
              <div key={i.id} className="rounded-2xl bg-soft p-5">
                <div className="font-medium">{i.name} <span className="text-muted-foreground text-sm">· {i.email} · {i.capital_range}</span></div>
                <p className="text-sm mt-2 text-muted-foreground">{i.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </SiteLayout>
  );
}