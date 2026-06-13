import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { supabase } from "@/integrations/supabase/client";
import { ApplicationsPanel } from "@/components/admin/ApplicationsPanel";
import { VehiclesPanel } from "@/components/admin/VehiclesPanel";
import { LeadsPanel } from "@/components/admin/LeadsPanel";
import { FleetOwnersPanel } from "@/components/admin/FleetOwnersPanel";
import { Logo } from "@/components/site/Logo";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — REAL AUTOMOTIVE" }, { name: "robots", content: "noindex" }] }),
  component: Admin,
});

const TABS = [
  { id: "applications", label: "Applications" },
  { id: "vehicles", label: "Vehicles" },
  { id: "fleet_owners", label: "Fleet Owners" },
  { id: "investors", label: "Investors" },
  { id: "contact", label: "Contact" },
] as const;
type Tab = typeof TABS[number]["id"];

function Admin() {
  const [session, setSession] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>("applications");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setIsAdmin(false); return; }
    supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "admin").maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [session]);

  async function signOut() { await supabase.auth.signOut(); toast.success("Signed out"); }

  if (checking) return <SiteLayout><div className="container-real py-32 text-center text-muted-foreground">Loading…</div></SiteLayout>;
  if (!session) return <SignIn />;
  if (!isAdmin) return <NoAccess userId={session.user.id} onSignOut={signOut} />;

  return (
    <SiteLayout>
      <div className="container-real py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold">Admin</h1>
            <p className="text-xs text-muted-foreground mt-1">Signed in as {session.user.email}</p>
          </div>
          <button onClick={signOut} className="text-sm text-muted-foreground hover:text-foreground">Sign out</button>
        </div>
        <div className="flex gap-1 mb-8 flex-wrap border-b border-border">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.id ? "border-real-red text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "applications" && <ApplicationsPanel />}
        {tab === "vehicles" && <VehiclesPanel />}
        {tab === "fleet_owners" && <FleetOwnersPanel />}
        {tab === "investors" && <LeadsPanel table="investor_leads" label="Investor leads" />}
        {tab === "contact" && <LeadsPanel table="contact_leads" label="Contact messages" />}
      </div>
    </SiteLayout>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setLoading(true);
    const fn = mode === "signin"
      ? supabase.auth.signInWithPassword({ email, password: pw })
      : supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: `${window.location.origin}/admin` } });
    const { error } = await fn;
    setLoading(false);
    if (error) return setErr(error.message);
    if (mode === "signup") toast.success("Account created. Check your email if confirmation is required, then sign in.");
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left panel — brand */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-black text-white overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-real-red/30 via-black to-black pointer-events-none" />
        <div className="relative z-10">
          <Logo offset={false} />
        </div>
        <div className="relative z-10 max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-real-red" /> Admin Console
          </div>
          <h2 className="text-4xl font-semibold leading-tight">
            Drive the fleet.<br />Move the business.
          </h2>
          <p className="mt-4 text-sm text-white/70 max-w-sm">
            Manage applications, vehicles, partners, and leads — all in one place.
          </p>
        </div>
        <div className="relative z-10 grid grid-cols-3 gap-6 max-w-md">
          <Stat n="100%" l="Insured Fleet" />
          <Stat n="24/7" l="Driver Ready" />
          <Stat n="Same Day" l="Approvals" />
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex justify-center"><Logo offset={false} /></div>
          <h1 className="text-3xl font-semibold">{mode === "signin" ? "Welcome back" : "Create account"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Restricted to authorized team members.</p>
          <form onSubmit={submit} className="mt-8 space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="Email"
              className="w-full bg-soft rounded-lg px-5 py-3 text-sm" />
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" required minLength={6} placeholder="Password"
              className="w-full bg-soft rounded-lg px-5 py-3 text-sm" />
            {err && <div className="text-sm text-real-red">{err}</div>}
            <button disabled={loading} className="w-full rounded-lg bg-real-red text-white py-3 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
              {loading ? "…" : mode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>
          <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 text-xs text-muted-foreground hover:text-foreground">
            {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <div className="text-xl font-semibold">{n}</div>
      <div className="text-xs text-white/60 mt-1">{l}</div>
    </div>
  );
}

function NoAccess({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  return (
    <SiteLayout>
      <div className="container-real py-32 text-center max-w-lg">
        <h1 className="text-2xl font-semibold">No admin access</h1>
        <p className="mt-3 text-muted-foreground text-sm">Your account ID:<br/><code className="text-xs">{userId}</code></p>
        <p className="mt-3 text-muted-foreground text-sm">Ask an existing admin to grant access by running:<br/>
          <code className="text-xs">INSERT INTO user_roles (user_id, role) VALUES ('{userId}', 'admin');</code>
        </p>
        <button onClick={onSignOut} className="mt-6 rounded-lg border border-border px-6 py-2 text-sm">Sign out</button>
      </div>
    </SiteLayout>
  );
}