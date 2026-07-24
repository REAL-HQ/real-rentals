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
import { Eye, EyeOff, Users, Car, Handshake, CreditCard, Settings as SettingsIcon, LogOut, Wrench, Store, MessageSquare, Globe, UserCog, PanelLeftClose, PanelLeftOpen, LayoutDashboard, Search, Bell } from "lucide-react";
import { MaintenancePanel } from "@/components/admin/MaintenancePanel";
import { ShopsPanel } from "@/components/admin/ShopsPanel";
import { MessagesPanel } from "@/components/admin/MessagesPanel";
import { WebsitesPanel } from "@/components/admin/WebsitesPanel";
import { TeamPanel } from "@/components/admin/TeamPanel";
import { OverviewPanel } from "@/components/admin/OverviewPanel";
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
  { id: "overview",    label: "Overview",    icon: LayoutDashboard, group: "OPERATIONS", description: "Pipeline, Fleet And Revenue At A Glance" },
  { id: "drivers",     label: "Drivers",     icon: Users,           group: "OPERATIONS", description: "Manage Applicants, Active Renters And Driver Lifecycle" },
  { id: "payments",    label: "Payments",    icon: CreditCard,      group: "OPERATIONS", description: "Rent, Deposits And Balances" },
  { id: "messages",    label: "Messages",    icon: MessageSquare,   group: "OPERATIONS", description: "Inbound Driver & Partner Conversations" },
  { id: "vehicles",    label: "Vehicles",    icon: Car,             group: "FLEET",      description: "Fleet Inventory & Vehicle Status" },
  { id: "maintenance", label: "Maintenance", icon: Wrench,          group: "FLEET",      description: "Vehicle Service Records, Schedules & Cost Splits" },
  { id: "shops",       label: "Shops",       icon: Store,           group: "FLEET",      description: "Preferred Maintenance Providers By Market" },
  { id: "partners",    label: "Partners",    icon: Handshake,       group: "GROWTH",     description: "Vehicle Owners, Capital Partners And Lenders" },
  { id: "websites",    label: "Websites",    icon: Globe,           group: "GROWTH",     description: "Market-Specific Marketing Sites" },
  { id: "team",        label: "Team",        icon: UserCog,         group: "SYSTEM",     description: "Internal Roles & Access Control" },
  { id: "settings",    label: "Settings",    icon: SettingsIcon,    group: "SYSTEM",     description: "Rental Terms, Payments, Admin Users And Preferences" },
] as const;
type Tab = typeof TABS[number]["id"];
const GROUP_ORDER = ["OPERATIONS", "FLEET", "GROWTH", "SYSTEM"] as const;

function Admin() {
  const [session, setSession] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const urlTab = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
  const initialTab: Tab = urlTab && TABS.some((t) => t.id === urlTab) ? (urlTab as Tab) : "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [globalSearch, setGlobalSearch] = useState("");
  const [notifs, setNotifs] = useState<Array<{ id: string; full_name: string | null; email: string | null; phone: string | null; created_at: string | null; status: string | null }>>([]);
  const [notifSeenAt, setNotifSeenAt] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("admin-notif-seen-at") || 0);
  });
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

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    async function load() {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("applications")
        .select("id, full_name, email, phone, created_at, status")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(15);
      if (!cancelled) setNotifs(data || []);
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isAdmin]);

  const unreadCount = notifs.filter((n) => new Date(n.created_at ?? 0).getTime() > notifSeenAt).length;

  function markNotifsSeen() {
    const now = Date.now();
    setNotifSeenAt(now);
    if (typeof window !== "undefined") window.localStorage.setItem("admin-notif-seen-at", String(now));
  }

  async function signOut() { await supabase.auth.signOut(); toast.success("Signed out"); }

  if (checking) return <AdminShell><div className="container-real py-32 text-center text-muted-foreground">Loading…</div></AdminShell>;
  if (!session) return <SignIn />;
  if (!isAdmin) return <NoAccess userId={session.user.id} onSignOut={signOut} />;

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const emailName = session?.user?.email ?? "";
  const rawName = (session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || emailName.split("@")[0] || "Admin").toString();
  const firstName = rawName.split(/[.\s]/)[0] || "Admin";
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFB] text-[#111114]">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar — dark shell, grouped, user block at bottom */}
          <div className="relative px-4 pt-8 pb-6 flex items-start justify-center">
            {!collapsed && <Logo offset={false} />}
            <button
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={`p-1.5 rounded-md hover:bg-white/10 text-[#8E8E96] hover:text-white transition-colors duration-150 ${collapsed ? "" : "absolute right-2 top-4"}`}
            >
              {collapsed ? <PanelLeftOpen className="w-[18px] h-[18px]" strokeWidth={1.75} /> : <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={1.75} />}
            </button>
          </div>
          <nav className="flex-1 px-3 pt-4 pb-4 overflow-y-auto">
            {GROUP_ORDER.map((group) => {
              const items = TABS.filter((t) => t.group === group);
              return (
                <div key={group} className="mb-5 last:mb-0">
                  {!collapsed && (
                    <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#55555E]">
                      {group}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {items.map((t) => {
                      const Icon = t.icon;
                      const active = tab === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setTab(t.id)}
                          title={collapsed ? t.label : undefined}
                          className={`relative w-full flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-3"} py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 ${
                            active
                              ? "bg-[#1F1F23] text-white"
                              : "text-[#8E8E96] hover:bg-[#1A1A1E] hover:text-white"
                          }`}
                        >
                          {active && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-[#CC0000]" />
                          )}
                          <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                          {!collapsed && <span>{t.label}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Main column */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Mobile tab pills */}
          <div className="md:hidden bg-white border-b border-[#EDEDF0]">
            <div className="flex items-center h-14 px-3">
              <Logo offset={false} />
            </div>
            <div className="flex overflow-x-auto px-2 py-2 gap-1 border-t border-[#EDEDF0]">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap font-medium transition-colors duration-150 ${tab === t.id ? "bg-[rgba(204,0,0,0.08)] text-[#CC0000]" : "bg-[#F4F4F6] text-[#55555E]"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <main className="flex-1 min-w-0 bg-[#FAFAFB]">
            <header className="px-8 py-4 flex items-center justify-between gap-4">
              {/* Left: search */}
              <div className="relative hidden sm:block w-[360px] max-w-full">
                <Search className="w-[18px] h-[18px] text-[#9A9AA3] absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
                <input
                  type="search"
                  placeholder="Search Drivers, Vehicles, Partners…"
                  value={globalSearch}
                  onChange={(e) => {
                    const v = e.target.value;
                    setGlobalSearch(v);
                    if (v && !["drivers", "vehicles", "partners"].includes(tab)) setTab("drivers");
                  }}
                  className="w-full pl-10 pr-3 py-2 rounded-full bg-white border border-[#EDEDF0] focus:border-[#CC0000]/40 focus:outline-none focus:ring-2 focus:ring-[#CC0000]/20 text-[13px] text-[#111114] placeholder:text-[#9A9AA3] transition-all duration-150"
                />
              </div>
              {/* Right: notifications + profile */}
              <div className="flex items-center gap-2">
                <DropdownMenu onOpenChange={(o) => { if (o) markNotifsSeen(); }}>
                  <DropdownMenuTrigger
                    aria-label="Notifications"
                    className="relative w-10 h-10 rounded-full border border-[#EDEDF0] bg-white grid place-items-center text-[#55555E] hover:text-[#111114] hover:border-[#D6D6DB] transition-colors duration-150"
                  >
                    <Bell className="w-[18px] h-[18px]" strokeWidth={1.75} />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#CC0000] text-white text-[10px] font-semibold grid place-items-center">
                        {unreadCount}
                      </span>
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80 p-0">
                    <div className="px-3 py-2 border-b border-[#EDEDF0] flex items-center justify-between">
                      <div className="text-sm font-semibold text-[#111114]">Notifications</div>
                      <div className="text-[11px] text-[#9A9AA3]">Last 7 Days</div>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifs.length === 0 && (
                        <div className="px-3 py-8 text-center text-xs text-[#9A9AA3]">No Recent Activity</div>
                      )}
                      {notifs.map((n) => {
                        const created = n.created_at ? new Date(n.created_at) : null;
                        const isNew = created && created.getTime() > notifSeenAt;
                        return (
                          <button
                            key={n.id}
                            onClick={() => setTab("drivers")}
                            className="w-full text-left px-3 py-2.5 hover:bg-[#F4F4F6] transition-colors duration-150 border-b border-[#F4F4F6] last:border-0"
                          >
                            <div className="flex items-center gap-2">
                              {isNew && <span className="w-1.5 h-1.5 rounded-full bg-[#CC0000]" />}
                              <div className="text-[13px] font-medium text-[#111114] truncate flex-1">
                                New Lead: {n.full_name || n.email || "Unnamed"}
                              </div>
                            </div>
                            <div className="text-[11px] text-[#55555E] mt-0.5 truncate">
                              {n.email || n.phone || "—"} · {created ? created.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="hidden md:block text-[13px] text-[#55555E] tabular-nums pl-1">
                  {new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                </div>
                {/* Profile dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Account"
                    className="ml-1 w-9 h-9 rounded-full hover:bg-[#F4F4F6] transition-colors duration-150 grid place-items-center focus:outline-none focus:ring-2 focus:ring-[#CC0000]/20"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#CC0000]/15 text-[#CC0000] grid place-items-center text-[11px] font-bold">
                      {initials}
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[300px] p-0 rounded-2xl overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 rounded-full bg-[#CC0000]/15 text-[#CC0000] grid place-items-center text-[15px] font-bold">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14px] font-semibold text-[#111114] capitalize truncate">{displayName}</div>
                          <div className="text-[12px] text-[#55555E] truncate">{session?.user?.email}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => setTab("settings")}
                        className="flex items-center gap-3 px-2 py-2.5 rounded-xl w-full text-left text-[13px] text-[#111114] hover:bg-[#F4F4F6] transition-colors duration-150"
                      >
                        <SettingsIcon className="w-[18px] h-[18px] text-[#9A9AA3] shrink-0" strokeWidth={1.75} />
                        <span>Settings</span>
                      </button>
                      <button
                        onClick={() => setTab("team")}
                        className="flex items-center gap-3 px-2 py-2.5 rounded-xl w-full text-left text-[13px] text-[#111114] hover:bg-[#F4F4F6] transition-colors duration-150"
                      >
                        <UserCog className="w-[18px] h-[18px] text-[#9A9AA3] shrink-0" strokeWidth={1.75} />
                        <span>Team</span>
                      </button>
                      <div className="h-px bg-[#EDEDF0] my-3" />
                      <button
                        onClick={signOut}
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[#CC0000] text-white text-[13px] font-semibold hover:bg-[#B00000] transition-colors duration-150"
                      >
                        <LogOut className="w-4 h-4" strokeWidth={2} />
                        Log Out
                      </button>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>
            <div className="p-6 md:p-8">
            <div className="mb-6">
              <h1 className="text-[22px] font-semibold tracking-tight text-[#111114]">{current.label}</h1>
              <p className="text-[13px] text-[#55555E] mt-1">{current.description}</p>
            </div>
            {tab === "overview" && <OverviewPanel />}
            {tab === "drivers" && <DriversPanel externalSearch={globalSearch} />}
            {tab === "vehicles" && <VehiclesPanel externalSearch={globalSearch} />}
            {tab === "partners" && <PartnersPanel externalSearch={globalSearch} />}
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