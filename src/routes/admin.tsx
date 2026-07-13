import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { supabase } from "@/integrations/supabase/client";
import { VehiclesPanel } from "@/components/admin/VehiclesPanel";
import { DriversPanel } from "@/components/admin/DriversPanel";
import { PartnersPanel } from "@/components/admin/PartnersPanel";
import { PaymentsPanel } from "@/components/admin/PaymentsPanel";
import { SettingsPanel } from "@/components/admin/SettingsPanel";
import { Logo } from "@/components/site/Logo";
import { toast } from "sonner";
import adminHero from "@/assets/admin-hero.jpg";
import { Eye, EyeOff, Users, Car, Handshake, CreditCard, Settings as SettingsIcon, LogOut, User, Wrench, Store, MessageSquare, Globe, UserCog, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { MaintenancePanel } from "@/components/admin/MaintenancePanel";
import { ShopsPanel } from "@/components/admin/ShopsPanel";
import { MessagesPanel } from "@/components/admin/MessagesPanel";
import { WebsitesPanel } from "@/components/admin/WebsitesPanel";
import { TeamPanel } from "@/components/admin/TeamPanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — REAL RENTALS" }, { name: "robots", content: "noindex" }] }),
  component: Admin,
});

const TABS = [
  { id: "drivers", label: "Drivers", icon: Users, description: "Manage applicants, active renters and driver lifecycle" },
  { id: "vehicles", label: "Vehicles", icon: Car, description: "Fleet Inventory & Vehicle Status" },
  { id: "partners", label: "Partners", icon: Handshake, description: "Vehicle owners, capital partners and lenders" },
  { id: "payments", label: "Payments", icon: CreditCard, description: "Rent, deposits and balances" },
  { id: "maintenance", label: "Maintenance", icon: Wrench, description: "Vehicle Service Records, Schedules & Cost Splits" },
  { id: "shops", label: "Shops", icon: Store, description: "Preferred Maintenance Providers by Market" },
  { id: "websites", label: "Websites", icon: Globe, description: "Market-Specific Marketing Sites" },
  { id: "team", label: "Team", icon: UserCog, description: "Internal Roles & Access Control" },
  { id: "settings", label: "Settings", icon: SettingsIcon, description: "Rental terms, payments, admin users and preferences" },
] as const;
type Tab = typeof TABS[number]["id"] | "messages";

function Admin() {
  const [session, setSession] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const urlTab = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
  const initialTab: Tab = urlTab && (TABS.some((t) => t.id === urlTab) || urlTab === "messages") ? (urlTab as Tab) : "drivers";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("admin-sidebar-collapsed") === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("admin-sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

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

  if (checking) return <AdminShell><div className="container-real py-32 text-center text-muted-foreground">Loading…</div></AdminShell>;
  if (!session) return <SignIn />;
  if (!isAdmin) return <NoAccess userId={session.user.id} onSignOut={signOut} />;

  const current = TABS.find((t) => t.id === tab) ?? { id: "messages" as Tab, label: "Messages", description: "Inbound Driver & Partner Conversations" };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className={`hidden md:flex ${collapsed ? "w-16" : "w-60"} transition-[width] duration-200 flex-col bg-[#0b0b0d] text-white sticky top-0 h-screen`}>
          <div className="relative px-3 py-3 flex items-center justify-center">
            {!collapsed && <Logo offset={false} />}
            <button
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={`p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white ${collapsed ? "" : "absolute right-2 top-1/2 -translate-y-1/2"}`}
            >
              {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  title={collapsed ? t.label : undefined}
                  className={`w-full flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-3"} py-2.5 rounded-lg text-sm transition ${
                    active ? "bg-real-red text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {!collapsed && <span>{t.label}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <Nav />
          {/* Mobile tab pills */}
          <div className="md:hidden bg-[#0b0b0d] text-white">
            <div className="flex overflow-x-auto px-2 py-2 gap-1">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${tab === t.id ? "bg-real-red" : "bg-white/5 text-white/70"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <main className="flex-1 min-w-0 bg-white">
            <header className="bg-white border-b border-border px-8 py-6">
              <h1 className="text-2xl font-semibold">{current.label}</h1>
              <p className="text-sm text-muted-foreground mt-1">{current.description}</p>
            </header>
            <div className="p-8">
            {tab === "drivers" && <DriversPanel />}
            {tab === "vehicles" && <VehiclesPanel />}
            {tab === "partners" && <PartnersPanel />}
            {tab === "payments" && <PaymentsPanel />}
            {tab === "maintenance" && <MaintenancePanel />}
            {tab === "shops" && <ShopsPanel />}
            {tab === "messages" && <MessagesPanel />}
            {tab === "websites" && <WebsitesPanel />}
            {tab === "team" && <TeamPanel />}
            {tab === "settings" && <SettingsPanel />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1">{children}</main>
    </div>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

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
      {/* Left panel — image */}
      <div className="relative hidden lg:block overflow-hidden bg-black">
        <img src={adminHero} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40 pointer-events-none" />
        <div className="relative z-10 p-12">
          <Logo offset={false} />
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex justify-center"><Logo offset={false} /></div>
          <h1 className="text-3xl font-semibold">{mode === "signin" ? "Welcome Back" : "Create Account"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Restricted To Authorized Team Members.</p>
          <form onSubmit={submit} className="mt-8 space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="Email"
              className="w-full bg-soft rounded-lg px-5 py-3 text-sm" />
            <div className="relative">
              <input value={pw} onChange={(e) => setPw(e.target.value)} type={showPw ? "text" : "password"} required minLength={6} placeholder="Password"
                className="w-full bg-soft rounded-lg px-5 py-3 pr-12 text-sm" />
              <button type="button" onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {err && <div className="text-sm text-real-red">{err}</div>}
            <button disabled={loading} className="w-full rounded-lg bg-real-red text-white py-3 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
              {loading ? "…" : mode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            {mode === "signin" ? "Need An Account? " : "Already Have An Account? "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="text-real-red hover:underline font-medium"
            >
              {mode === "signin" ? "Create Account" : "Sign In"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function NoAccess({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  return (
    <AdminShell>
      <div className="container-real py-32 text-center max-w-lg">
        <h1 className="text-2xl font-semibold">No Admin Access</h1>
        <p className="mt-3 text-muted-foreground text-sm">Your account ID:<br/><code className="text-xs">{userId}</code></p>
        <p className="mt-3 text-muted-foreground text-sm">Ask an existing admin to grant access by running:<br/>
          <code className="text-xs">INSERT INTO user_roles (user_id, role) VALUES ('{userId}', 'admin');</code>
        </p>
        <button onClick={onSignOut} className="mt-6 rounded-lg border border-border px-6 py-2 text-sm">Sign Out</button>
      </div>
    </AdminShell>
  );
}