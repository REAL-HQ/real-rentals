import { createFileRoute, useSearch as useRouterSearch, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { supabase } from "@/integrations/supabase/client";
import { VehiclesPanel } from "@/components/admin/VehiclesPanel";
import { DriversPanel } from "@/components/admin/DriversPanel";
import { WaitlistPanel } from "@/components/admin/WaitlistPanel";
import { PartnersPanel } from "@/components/admin/PartnersPanel";
import { PaymentsPanel } from "@/components/admin/PaymentsPanel";
import { SettingsPanel } from "@/components/admin/SettingsPanel";
import { Logo } from "@/components/site/Logo";
import { toast } from "sonner";
import adminHero from "@/assets/admin-hero.jpg";
import {
  Eye,
  EyeOff,
  LogOut,
  Search,
  Bell,
  Menu,
  Plus,
  ChevronRight,
  Settings as SettingsIcon,
  UserCog,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TABS,
  GROUP_ORDER,
  ADD_TABS,
  visibleTabs,
  visibleApps,
  visibleCreateActions,
  appOf,
  navOwner,
  type TabDef,
} from "@/components/admin/nav-config";
import { MaintenancePanel } from "@/components/admin/MaintenancePanel";
import { ShopsPanel } from "@/components/admin/ShopsPanel";
import { MessagesPanel } from "@/components/admin/MessagesPanel";
import { WebsitesPanel } from "@/components/admin/WebsitesPanel";
import { TeamPanel } from "@/components/admin/TeamPanel";
import { OverviewPanel } from "@/components/admin/OverviewPanel";
import { AutomationsPanel } from "@/components/admin/AutomationsPanel";
import { VendorsPanel } from "@/components/admin/VendorsPanel";
import { InspectionsPanel } from "@/components/admin/InspectionsPanel";
import { ChargesPanel } from "@/components/admin/ChargesPanel";
import { IncidentsPanel } from "@/components/admin/IncidentsPanel";
import { ExpensesPanel } from "@/components/admin/ExpensesPanel";
import { ActivityPanel } from "@/components/admin/ActivityPanel";
import { tierAllows, tierFromRoles, TIER_LABELS, type StaffTier } from "@/lib/roles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Deep-link parameters the Overview cards and applicant rows send. */
type AdminSearch = {
  tab?: string;
  id?: string;
  filter?: string;
  add?: "1";
};

/**
 * Which tab each search parameter belongs to.
 *
 * `tab` is global — it names the destination. Everything else is the property
 * of one tab, and carrying it anywhere else is how `/admin?tab=vehicles&id=<an
 * applicant>` happens: a parameter that means nothing where it landed, quietly
 * holding a child view open or filtering a list nobody asked to filter.
 *
 * Read by `rootSearch` below, which is what every root navigation goes
 * through, and by the normalization effect that strips a stale parameter
 * arriving from a hand-edited or forwarded URL.
 */
const PARAM_OWNER: Record<Exclude<keyof AdminSearch, "tab">, readonly string[]> = {
  // A selected record. Only tabs that can show one.
  id: ["drivers", "vehicles"],
  // Payments is the only list that takes a filter from a link today.
  filter: ["payments"],
  // A creation flow opened from "+ Create".
  add: [...ADD_TABS],
};

/** The search for a tab's ROOT view: the tab, and nothing that belongs to a child. */
export function rootSearch(tab: string): AdminSearch {
  return { tab };
}

/** Drop any parameter that does not belong to `tab`. */
function ownedSearch(tab: string, search: AdminSearch): AdminSearch {
  const out: AdminSearch = { tab };
  for (const key of ["id", "filter", "add"] as const) {
    const value = search[key];
    if (value !== undefined && PARAM_OWNER[key].includes(tab)) {
      // TypeScript cannot see that the key and value agree; they do.
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export const Route = createFileRoute("/admin")({
  /**
   * Declare the deep-link parameters this page actually uses.
   *
   * Every other route that reads search params validates them; this one did
   * not, which left the Overview's links passing `search` through `as any`
   * casts into an untyped bag. Declaring the shape gives the router a schema
   * to round-trip, keeps unrelated junk out of the URL, and means a typo in a
   * Link is a type error rather than a control that quietly does nothing.
   *
   * Unknown values are dropped rather than rejected — a stale or hand-edited
   * URL should land on the dashboard, not an error page.
   */
  validateSearch: (raw: Record<string, unknown>): AdminSearch => {
    const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
    const out: AdminSearch = {};
    if (str(raw.tab)) out.tab = str(raw.tab);
    if (str(raw.id)) out.id = str(raw.id);
    if (str(raw.filter)) out.filter = str(raw.filter);
    // The router JSON-parses search values, so its own links round-trip as
    // the string "1" while a hand-typed or emailed ?add=1 arrives as the
    // number 1 — and silently did nothing.
    if (raw.add === "1" || raw.add === 1 || raw.add === true) out.add = "1";
    return out;
  },
  head: () => ({
    meta: [{ title: "Admin — REAL RENTALS" }, { name: "robots", content: "noindex" }],
  }),
  component: Admin,
});

type Tab = string;

function Admin() {
  const [session, setSession] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  // Read the tab from the router rather than from window.location once at
  // mount. The Overview cards and the "View All" links navigate to
  // /admin?tab=..., which changes the URL without remounting this component —
  // so a one-shot useState left the page sitting on Overview and made every
  // one of those links look broken.
  /*
   * The URL is the only source of truth for where you are.
   *
   * `tab` used to be React state, seeded from the URL and re-synced by an
   * effect that fired only when `urlTab` CHANGED VALUE — while the sidebar
   * set that state without touching the URL at all. Two owners of one fact,
   * and every reported symptom falls out of them disagreeing:
   *
   *  - Sidebar → Overview leaves the URL reading ?tab=drivers&id=A. Clicking
   *    a different applicant then navigates to ?tab=drivers&id=B: `urlTab` is
   *    "drivers" before and after, so it never changes, the effect never
   *    fires, and the click does nothing you can see. That is the "names are
   *    not clickable" report, and why it seemed intermittent — it worked from
   *    a clean /admin and stopped once the URL had drifted.
   *  - On a driver detail, "Drivers" called setTab("drivers") while the tab
   *    was already "drivers": a no-op that left `id` in the URL and the
   *    drawer open. Hence clicking it twice, and still not getting the list.
   *
   * Derived, not stored. Every navigation goes through the router, so back
   * and forward work, a URL can be pasted to a colleague, and nothing can
   * hold a view open that the address bar does not describe.
   */
  const search = useRouterSearch({ strict: false }) as AdminSearch;
  const navigate = useNavigate();
  const urlTab = typeof search?.tab === "string" ? search.tab : null;
  // `id` names the selected record on whichever tab owns it.
  const urlRecordId = typeof search?.id === "string" ? search.id : null;
  const urlFilter = typeof search?.filter === "string" ? search.filter : null;
  const urlAdd = search?.add === "1";
  const [globalSearch, setGlobalSearch] = useState("");
  const [notifs, setNotifs] = useState<
    Array<{
      id: string;
      full_name: string | null;
      email: string | null;
      phone: string | null;
      created_at: string | null;
      status: string | null;
    }>
  >([]);
  const [tier, setTier] = useState<StaffTier | null>(null);
  const navTabs = useMemo(() => visibleTabs(tier), [tier]);

  /*
   * Where we are, derived. An unknown tab renders the overview rather than a
   * blank screen; a tab this tier may not open does the same, once the role
   * lookup has returned. The server function behind each panel refuses an
   * unauthorized caller regardless — this is the presentation half of that
   * rule, not the enforcement, and it must never be the only lock.
   */
  const tab: Tab = useMemo(() => {
    if (!urlTab || !TABS.some((t) => t.id === urlTab)) return "overview";
    if (tier && !navTabs.some((t) => t.id === urlTab)) return "overview";
    return urlTab as Tab;
  }, [urlTab, tier, navTabs]);

  /*
   * Normalize the address bar to match what is on screen — replace, not
   * push, so tidying up never becomes a history entry the back button has to
   * climb through. Two jobs: a tab the URL named but we refused to render,
   * and a parameter belonging to some other tab (an applicant id sitting on
   * ?tab=vehicles, say) that would otherwise hold a child view open or
   * filter a list nobody asked to filter.
   */
  /**
   * Go to a tab's root, for the few controls that cannot be links — a select
   * handler, a search box reacting as you type. Same destination the sidebar
   * links produce, so there is one way to reach a root view and not two.
   */
  const goRoot = useCallback(
    (next: string, opts?: { replace?: boolean }) =>
      void navigate({ to: "/admin", search: rootSearch(next), replace: opts?.replace }),
    [navigate],
  );

  useEffect(() => {
    const owned = ownedSearch(tab, search);
    const same =
      owned.tab === search.tab &&
      owned.id === search.id &&
      owned.filter === search.filter &&
      owned.add === search.add;
    if (same) return;
    void navigate({ to: "/admin", search: owned, replace: true });
  }, [tab, search, navigate]);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [notifSeenAt, setNotifSeenAt] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("admin-notif-seen-at") || 0);
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("admin-sidebar-collapsed") === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined")
      window.localStorage.setItem("admin-sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      setTier(null);
      return;
    }
    // Read every grant this account holds and take the strongest. The old
    // check asked only for a literal 'admin' row, which is why granting
    // somebody 'team' let them in nowhere at all.
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .then(({ data }) => {
        const t = tierFromRoles(((data ?? []) as any[]).map((r) => String(r.role)));
        setTier(t);
        setIsAdmin(!!t);
      });
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
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("read", false);
      if (!cancelled) setUnreadMsgs(count ?? 0);
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isAdmin]);

  const unreadCount = notifs.filter(
    (n) => new Date(n.created_at ?? 0).getTime() > notifSeenAt,
  ).length;

  function markNotifsSeen() {
    const now = Date.now();
    setNotifSeenAt(now);
    if (typeof window !== "undefined")
      window.localStorage.setItem("admin-notif-seen-at", String(now));
  }

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out");
  }

  if (checking)
    return (
      <AdminShell>
        <div className="container-real py-32 text-center text-muted-foreground">Loading…</div>
      </AdminShell>
    );
  if (!session) return <SignIn />;
  if (!isAdmin) return <NoAccess userId={session.user.id} onSignOut={signOut} />;

  const current = navTabs.find((t) => t.id === tab) ?? navTabs[0] ?? TABS[0];
  const emailName = session?.user?.email ?? "";
  const rawName = (
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    emailName.split("@")[0] ||
    "Admin"
  ).toString();
  const firstName = rawName.split(/[.\s]/)[0] || "Admin";
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFB] text-[#111114]">
      <div className="flex flex-1 min-h-0">
        {/* Sidebar — dark shell, grouped */}
        <aside
          className={`hidden md:flex ${collapsed ? "w-[68px]" : "w-[248px]"} transition-[width] duration-200 flex-col bg-[#141416] sticky top-0 h-screen`}
        >
          <div className="relative px-4 pt-8 pb-6 flex items-start justify-center">
            {!collapsed && <Logo offset={false} />}
            <button
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={`p-1.5 rounded-md hover:bg-white/10 text-[#8E8E96] hover:text-white transition-colors duration-150 ${collapsed ? "" : "absolute right-2 top-4"}`}
            >
              {collapsed ? (
                <PanelLeftOpen className="w-[18px] h-[18px]" strokeWidth={1.75} />
              ) : (
                <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={1.75} />
              )}
            </button>
          </div>
          <nav className="flex-1 px-3 pt-4 pb-4 overflow-y-auto">
            {GROUP_ORDER.map((group) => {
              const items = navTabs.filter((t) => t.group === group);
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
                        <Link
                          key={t.id}
                          to="/admin"
                          /*
                           * A root destination. "Drivers" means the drivers
                           * LIST — so it carries the tab and nothing else,
                           * which is what drops the selected applicant and
                           * returns you to the listing on the first click
                           * rather than the second.
                           */
                          search={rootSearch(t.id)}
                          title={collapsed ? t.label : undefined}
                          className={`relative w-full flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-3"} py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 ${
                            active
                              ? "bg-[#1F1F23] text-white"
                              : "text-[#8E8E96] hover:bg-[#1A1A1E] hover:text-white"
                          }`}
                        >
                          {active && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r bg-[#D03020]" />
                          )}
                          <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                          {!collapsed && <span>{t.label}</span>}
                        </Link>
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
              {navTabs.map((t) => (
                <Link
                  key={t.id}
                  to="/admin"
                  search={rootSearch(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap font-medium transition-colors duration-150 ${tab === t.id ? "bg-[rgba(208,48,32,0.08)] text-[#D03020]" : "bg-[#F4F4F6] text-[#55555E]"}`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>
          <main className="flex-1 min-w-0 bg-[#FAFAFB]">
            <header className="px-8 py-4 flex items-center justify-between gap-4">
              {/* Left: search */}
              <div className="relative hidden sm:block w-[360px] max-w-full">
                <Search
                  className="w-[18px] h-[18px] text-[#9A9AA3] absolute left-3 top-1/2 -translate-y-1/2"
                  strokeWidth={1.75}
                />
                <input
                  type="search"
                  placeholder="Search Drivers, Vehicles, Partners…"
                  value={globalSearch}
                  onChange={(e) => {
                    const v = e.target.value;
                    setGlobalSearch(v);
                    // Typing jumps to the list being searched. `replace`, so
                    // a search does not leave one history entry per keystroke.
                    if (v && !["drivers", "vehicles", "partners"].includes(tab))
                      goRoot("drivers", { replace: true });
                  }}
                  className="w-full pl-10 pr-3 py-2 rounded-full bg-white border border-[#EDEDF0] focus:border-[#D03020]/40 focus:outline-none focus:ring-2 focus:ring-[#D03020]/20 text-[13px] text-[#111114] placeholder:text-[#9A9AA3] transition-all duration-150"
                />
              </div>
              {/* Right: notifications + profile */}
              <div className="flex items-center gap-2">
                {/* Messages */}
                <button
                  aria-label="Messages"
                  onClick={() => goRoot("messages")}
                  className="relative w-10 h-10 rounded-full border border-[#EDEDF0] bg-white grid place-items-center text-[#55555E] hover:text-[#111114] hover:border-[#D6D6DB] transition-colors duration-150"
                >
                  <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.75} />
                  {unreadMsgs > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D03020] text-white text-[10px] font-semibold grid place-items-center">
                      {unreadMsgs}
                    </span>
                  )}
                </button>
                <DropdownMenu
                  onOpenChange={(o) => {
                    if (o) markNotifsSeen();
                  }}
                >
                  <DropdownMenuTrigger
                    aria-label="Notifications"
                    className="relative w-10 h-10 rounded-full border border-[#EDEDF0] bg-white grid place-items-center text-[#55555E] hover:text-[#111114] hover:border-[#D6D6DB] transition-colors duration-150"
                  >
                    <Bell className="w-[18px] h-[18px]" strokeWidth={1.75} />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D03020] text-white text-[10px] font-semibold grid place-items-center">
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
                        <div className="px-3 py-8 text-center text-xs text-[#9A9AA3]">
                          No Recent Activity
                        </div>
                      )}
                      {notifs.map((n) => {
                        const created = n.created_at ? new Date(n.created_at) : null;
                        const isNew = created && created.getTime() > notifSeenAt;
                        return (
                          <button
                            key={n.id}
                            onClick={() => goRoot("drivers")}
                            className="w-full text-left px-3 py-2.5 hover:bg-[#F4F4F6] transition-colors duration-150 border-b border-[#F4F4F6] last:border-0"
                          >
                            <div className="flex items-center gap-2">
                              {isNew && <span className="w-1.5 h-1.5 rounded-full bg-[#D03020]" />}
                              <div className="text-[13px] font-medium text-[#111114] truncate flex-1">
                                New Lead: {n.full_name || n.email || "Unnamed"}
                              </div>
                            </div>
                            <div className="text-[11px] text-[#55555E] mt-0.5 truncate">
                              {n.email || n.phone || "—"} ·{" "}
                              {created
                                ? created.toLocaleString([], {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })
                                : ""}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="hidden md:block text-[13px] text-[#55555E] tabular-nums pl-1">
                  {new Date().toLocaleDateString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
                {/* Profile dropdown */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Account"
                    className="ml-1 w-9 h-9 rounded-full hover:bg-[#F4F4F6] transition-colors duration-150 grid place-items-center focus:outline-none focus:ring-2 focus:ring-[#D03020]/20"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#D03020]/15 text-[#D03020] grid place-items-center text-[11px] font-bold">
                      {initials}
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-[300px] p-0 rounded-2xl overflow-hidden"
                  >
                    <div className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 rounded-full bg-[#D03020]/15 text-[#D03020] grid place-items-center text-[15px] font-bold">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14px] font-semibold text-[#111114] capitalize truncate">
                            {displayName}
                          </div>
                          <div className="text-[12px] text-[#55555E] truncate">
                            {session?.user?.email}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => goRoot("settings")}
                        className="flex items-center gap-3 px-2 py-2.5 rounded-xl w-full text-left text-[13px] text-[#111114] hover:bg-[#F4F4F6] transition-colors duration-150"
                      >
                        <SettingsIcon
                          className="w-[18px] h-[18px] text-[#9A9AA3] shrink-0"
                          strokeWidth={1.75}
                        />
                        <span>Settings</span>
                      </button>
                      <button
                        onClick={() => goRoot("team")}
                        className="flex items-center gap-3 px-2 py-2.5 rounded-xl w-full text-left text-[13px] text-[#111114] hover:bg-[#F4F4F6] transition-colors duration-150"
                      >
                        <UserCog
                          className="w-[18px] h-[18px] text-[#9A9AA3] shrink-0"
                          strokeWidth={1.75}
                        />
                        <span>Team</span>
                      </button>
                      <div className="h-px bg-[#EDEDF0] my-3" />
                      <button
                        onClick={signOut}
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[#D03020] text-white text-[13px] font-semibold hover:bg-[#B00000] transition-colors duration-150"
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
              {tab !== "overview" && (
                <div className="mb-6">
                  <h1 className="text-[22px] font-semibold tracking-tight text-[#111114]">
                    {current.label}
                  </h1>
                  <p className="text-[13px] text-[#55555E] mt-1">{current.description}</p>
                </div>
              )}
              {tab === "overview" && <OverviewPanel />}
              {tab === "drivers" && (
                <DriversPanel
                  externalSearch={globalSearch}
                  initialOpenId={urlRecordId ?? undefined}
                  isOwner={tier === "owner"}
                />
              )}
              {tab === "waitlist" && <WaitlistPanel />}
              {tab === "vehicles" && (
                <VehiclesPanel
                    externalSearch={globalSearch}
                    autoOpenAdd={urlAdd}
                    openId={urlRecordId}
                  />
              )}
              {tab === "partners" && <PartnersPanel externalSearch={globalSearch} />}
              {tab === "payments" && <PaymentsPanel initialFilter={urlFilter ?? undefined} />}
              {tab === "maintenance" && <MaintenancePanel />}
              {tab === "shops" && <ShopsPanel />}
              {tab === "vendors" && <VendorsPanel />}
              {tab === "inspections" && <InspectionsPanel />}
              {tab === "automations" && <AutomationsPanel />}
              {tab === "charges" && <ChargesPanel />}
              {tab === "incidents" && <IncidentsPanel />}
              {tab === "messages" && <MessagesPanel />}
              {tab === "websites" && <WebsitesPanel />}
              {tab === "expenses" && <ExpensesPanel />}
              {tab === "activity" && <ActivityPanel />}
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

/**
 * Back-office sign-in. Sign-in only.
 *
 * This used to offer a public "Create Account" toggle, which let anyone mint
 * an auth account for any address. The account itself was inert — no trigger
 * grants a role, and NoAccess below is what an unroled account sees — but it
 * was still an uncontrolled way to occupy an email address, and it fed the
 * squat against driver provisioning: register with a pending applicant's
 * address, and approval would resolve their identity to your account.
 * provisionDriverAccount refuses that now; this removes the surface as well.
 *
 * Nothing legitimate depended on it. A new teammate gets an invitation and
 * creates their account at /invite, which is bound to the invited address.
 * A partner signs up at /partner, which is a deliberate step of that
 * onboarding handshake. A driver's account is made for them at approval.
 */
function SignIn() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    setLoading(false);
    if (error) return setErr(error.message);
  }

  // The app had no password recovery at all. Staff lose passwords like
  // everybody else, and without this the only fix was somebody with service
  // role access doing it by hand.
  async function sendReset() {
    if (!email.trim()) return setErr("Enter your email first.");
    setErr(null);
    setLoading(true);
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setLoading(false);
    // Same answer whether or not the address exists — this box must not
    // confirm who has a back-office account.
    setResetSent(true);
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
          <div className="lg:hidden mb-8 flex justify-center">
            <Logo offset={false} />
          </div>
          <h1 className="text-3xl font-semibold">Welcome Back</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Restricted To Authorized Team Members.
          </p>
          <form onSubmit={submit} className="mt-8 space-y-3">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              placeholder="Email"
              className="w-full bg-soft rounded-lg px-5 py-3 text-sm"
            />
            <div className="relative">
              <input
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                type={showPw ? "text" : "password"}
                required
                minLength={6}
                placeholder="Password"
                className="w-full bg-soft rounded-lg px-5 py-3 pr-12 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {err && <div className="text-sm text-real-red">{err}</div>}
            <button
              disabled={loading}
              className="w-full rounded-lg bg-real-red text-white py-3 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50"
            >
              {loading ? "…" : "Sign In"}
            </button>
          </form>
          {resetSent ? (
            <p className="mt-4 text-xs text-muted-foreground">
              If that address has an account, a reset link is on its way.
            </p>
          ) : (
            <button
              type="button"
              onClick={sendReset}
              disabled={loading}
              className="mt-4 text-xs text-real-red hover:underline font-medium disabled:opacity-50"
            >
              Forgot your password?
            </button>
          )}
          {/* No Create Account. Team access arrives by invitation. */}
          <p className="mt-4 text-xs text-muted-foreground">
            Team members join by invitation. Ask an owner to send you one.
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
        <p className="mt-3 text-muted-foreground text-sm">
          Your account ID:
          <br />
          <code className="text-xs">{userId}</code>
        </p>
        <p className="mt-3 text-muted-foreground text-sm">
          Ask an existing admin to grant access by running:
          <br />
          <code className="text-xs">
            INSERT INTO user_roles (user_id, role) VALUES ('{userId}', 'admin');
          </code>
        </p>
        <button
          onClick={onSignOut}
          className="mt-6 rounded-lg border border-border px-6 py-2 text-sm"
        >
          Sign Out
        </button>
      </div>
    </AdminShell>
  );
}
