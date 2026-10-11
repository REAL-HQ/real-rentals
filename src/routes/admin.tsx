import { createFileRoute, useSearch as useRouterSearch, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Nav } from "@/components/site/Nav";
import { supabase } from "@/integrations/supabase/client";
import { VehiclesPanel } from "@/components/admin/VehiclesPanel";
import { DriversPanel } from "@/components/admin/DriversPanel";
import { PartnersPanel } from "@/components/admin/PartnersPanel";
import { PaymentsPanel } from "@/components/admin/PaymentsPanel";
import { Logo } from "@/components/site/Logo";
import { toast } from "sonner";
import adminHero from "@/assets/admin-hero.jpg";
import {
  Eye,
  EyeOff,
  LogOut,
  History as HistoryIcon,
  Settings as SettingsGear,
  UserPlus,
  Search,
  Bell,
  Menu,
  Plus,
  MessageSquare,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  TABS,
  GROUP_ORDER,
  ADD_TABS,
  visibleTabs,
  visibleCreateActions,
  navOwner,
  railEntries,
  WORKSPACE_TABS,
  visibleWorkspaceTabs,
  LEGACY_TABS,
  type TabDef,
} from "@/components/admin/nav-config";
import { MaintenancePanel } from "@/components/admin/MaintenancePanel";
import { ShopsPanel } from "@/components/admin/ShopsPanel";
import { MessagesOverlay } from "@/components/admin/MessagesOverlay";
import { SettingsWorkspace } from "@/components/admin/SettingsWorkspace";
import { useServerFn } from "@tanstack/react-start";
import { listConversations } from "@/lib/messages.functions";
import { OverviewPanel } from "@/components/admin/OverviewPanel";
import { VendorsPanel } from "@/components/admin/VendorsPanel";
import { InspectionsPanel } from "@/components/admin/InspectionsPanel";
import { ChargesPanel } from "@/components/admin/ChargesPanel";
import { IncidentsPanel } from "@/components/admin/IncidentsPanel";
import { ExpensesPanel } from "@/components/admin/ExpensesPanel";
import { FleetInboxPanel } from "@/components/admin/FleetInboxPanel";
import { ExperienceSwitcher } from "@/components/ExperienceSwitcher";
import { availableExperiences, navTierFor, resolveExperience, storeExperience, type Experience } from "@/lib/experience";
import { tierAllows, tierFromRoles, TIER_LABELS, type StaffTier } from "@/lib/roles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmtDateTime } from "@/lib/date-format";

/** Deep-link parameters the Overview cards and applicant rows send. */
type AdminSearch = {
  tab?: string;
  id?: string;
  filter?: string;
  add?: "1";
  /** Settings workspace section. */
  section?: string;
  /** Messages overlay: "inbox" = open, or an application id = open on that conversation. Global, survives tab. */
  msg?: string;
  /** Vehicles list state (List 1): search, filters, sort, page, view. */
  q?: string;
  vstatus?: string;
  body?: string;
  partner?: string;
  sort?: string;
  page?: string;
  view?: string;
  /** Fleet-wide readiness filter: listing_ready | rental_ready | not_ready. */
  ready?: string;
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
const PARAM_OWNER: Record<Exclude<keyof AdminSearch, "tab" | "msg">, readonly string[]> = {
  // A selected record. Only tabs that can show one.
  //
  // "inspections" is here because the Vehicle Readiness card sends the
  // operator there to inspect a SPECIFIC car. Without it the normaliser
  // stripped the id back out of the URL a moment after the navigation, the
  // panel fell back to whichever vehicle sorted first, and a pre-delivery
  // inspection could be filed against the wrong one.
  id: ["drivers", "vehicles", "inspections"],
  // Payments is the only list that takes a filter from a link today.
  filter: ["payments", "drivers"],
  // A creation flow opened from "+ Create".
  add: [...ADD_TABS],
  section: ["settings"],
  q: ["vehicles"],
  vstatus: ["vehicles"],
  body: ["vehicles"],
  partner: ["vehicles"],
  sort: ["vehicles"],
  page: ["vehicles"],
  view: ["vehicles"],
  ready: ["vehicles"],
};

/** The search for a tab's ROOT view: the tab, and nothing that belongs to a child. */
export function rootSearch(tab: string): AdminSearch {
  return { tab };
}

/** Drop any parameter that does not belong to `tab`. */
function ownedSearch(tab: string, search: AdminSearch): AdminSearch {
  const out: AdminSearch = { tab };
  if (search.msg) out.msg = search.msg;
  for (const key of ["id", "filter", "add", "section", "q", "vstatus", "body", "partner", "sort", "page", "view", "ready"] as const) {
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
    if (str(raw.section)) out.section = str(raw.section);
    if (typeof raw.q === "number") out.q = String(raw.q);
    for (const k of ["q", "vstatus", "body", "partner", "sort", "view", "ready"] as const) if (str(raw[k])) out[k] = str(raw[k]);
    if (raw.page !== undefined && Number(raw.page) > 1) out.page = String(Math.floor(Number(raw.page)));
    if (raw.msg === 1 || raw.msg === true) out.msg = "inbox";
    else if (str(raw.msg)) out.msg = str(raw.msg);
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
  const stickyRef = useRef<HTMLDivElement | null>(null);
  // Shared sticky layout: publish chrome + filter-row heights as CSS vars
  // (see "Back-office sticky layout standard" in styles.css). Re-measures
  // on resize and whenever a page swaps its toolbar.
  useEffect(() => {
    const el = stickyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const main = document.querySelector("[data-admin-main]");
    const set = () => {
      const desktop = window.matchMedia("(min-width: 768px)").matches;
      const header = el.querySelector("header");
      root.style.setProperty("--admin-sticky-h", `${desktop ? el.offsetHeight : header?.offsetHeight ?? 0}px`);
      const bar = main?.querySelector<HTMLElement>(".admin-sticky-bar");
      root.style.setProperty("--admin-bar-h", `${desktop && bar ? bar.offsetHeight : 0}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    let observedBar: Element | null = null;
    const mo = new MutationObserver(() => {
      const bar = main?.querySelector(".admin-sticky-bar") ?? null;
      if (bar !== observedBar) {
        if (observedBar) ro.unobserve(observedBar);
        if (bar) ro.observe(bar);
        observedBar = bar;
        set();
      }
    });
    if (main) mo.observe(main, { childList: true, subtree: true });
    window.addEventListener("resize", set);
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener("resize", set); };
  });
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
    // Settings is off the rail (profile dropdown) but must stay reachable; its sections filter by tier.
    if (urlTab === "settings") return "settings";
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
    // Old bookmarks (?tab=messages / automations / team) land on their new home.
    const legacy = urlTab ? LEGACY_TABS[urlTab] : undefined;
    if (legacy) {
      const next: AdminSearch = { tab: legacy.tab };
      if (legacy.section) next.section = legacy.section;
      if (legacy.filter) next.filter = legacy.filter;
      if (legacy.messages || search.msg) next.msg = search.msg ?? "inbox";
      void navigate({ to: "/admin", search: next, replace: true });
      return;
    }
    const owned = ownedSearch(tab, search);
    const same =
      owned.tab === search.tab &&
      owned.id === search.id &&
      owned.filter === search.filter &&
      owned.add === search.add &&
      owned.section === search.section &&
      owned.msg === search.msg;
    if (same) return;
    void navigate({ to: "/admin", search: owned, replace: true });
  }, [tab, search, navigate, urlTab]);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const listConvs = useServerFn(listConversations);
  const msgOpen = !!search.msg;
  const msgApp = search.msg && search.msg !== "inbox" ? search.msg : null;
  const setMsg = useCallback(
    (value: string | null) =>
      void navigate({ to: "/admin", search: (prev: AdminSearch) => ({ ...prev, msg: value ?? undefined }), replace: true }),
    [navigate],
  );
  // Contextual "Message" actions anywhere in the back office open the overlay
  // on that person without leaving the current page.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ applicationId?: string }>).detail?.applicationId;
      setMsg(id || "inbox");
    };
    window.addEventListener("open-messages", onOpen);
    return () => window.removeEventListener("open-messages", onOpen);
  }, [setMsg]);
  const [notifSeenAt, setNotifSeenAt] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return Number(window.localStorage.getItem("admin-notif-seen-at") || 0);
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [experience, setExperience] = useState<Experience | null>(null);
  useEffect(() => {
    if (!tier) return;
    const r = resolveExperience(tier, false);
    // Landing on /admin means a staff view; a stored "driver" falls back to the default staff view.
    const staffView = r === "driver" ? availableExperiences(tier, false)[0] : r;
    if (staffView && staffView !== r) storeExperience(staffView); // e.g. browser Back from Driver Preview
    setExperience(staffView);
  }, [tier]);
  function chooseExperience(e: Experience) {
    storeExperience(e);
    if (e === "driver") { window.location.assign("/portal?preview=1"); return; }
    setExperience(e);
  }



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
        .is("deleted_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(15);
      if (!cancelled) setNotifs(data || []);
      try {
        const r = await listConvs();
        if (!cancelled) setUnreadMsgs(r.unread);
      } catch {
        /* unread badge is a convenience */
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isAdmin, listConvs]);

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

  // Display-only tier: Owner in Admin view sees the Manager layout. Servers/RLS still use the real role.
  const navTier = navTierFor(tier, experience === "driver" ? null : experience);
  const createActions = visibleCreateActions(navTier);
  const ownerTab = navOwner(tab);
  const appTabs = railEntries(navTier);
  const expOptions = availableExperiences(tier, false);
  const switcher = experience && experience !== "driver"
    ? <ExperienceSwitcher value={experience} options={expOptions} onChange={chooseExperience} />
    : null;
  const workspace = TABS.find((t) => t.id === ownerTab) ?? current;
  const workspaceTabs = ownerTab in WORKSPACE_TABS ? visibleWorkspaceTabs(ownerTab, navTier) : [];
  const recordParent = urlRecordId && (tab === "drivers" || tab === "vehicles") ? current : null;

  const navLink = (t: TabDef & { href?: string }, onClick?: () => void) => {
    const Icon = t.icon;
    const active = ownerTab === t.id;
    return (
      <Link
        key={t.id}
        to="/admin"
        // A root destination: the tab and nothing else, so "Drivers" always
        // lands on the list and drops any selected record.
        search={rootSearch(t.href ?? t.id)}
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={`relative w-full flex items-center gap-3 px-3 py-2 md:py-1.5 min-h-[40px] md:min-h-0 rounded-lg text-[13px] font-medium transition-colors duration-150 ${
          active ? "bg-[#1F1F23] text-white" : "text-[#8E8E96] hover:bg-[#1A1A1E] hover:text-white"
        }`}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r bg-[#D03020]" />}
        <Icon className="w-[17px] h-[17px] shrink-0" strokeWidth={1.75} />
        <span>{t.label}</span>
      </Link>
    );
  };

  const groupedNav = (onClick?: () => void) =>
    GROUP_ORDER.map((group) => {
      const items = appTabs.filter((t) => t.group === group);
      if (!items.length) return null;
      return (
        <div key={group} className="mb-4 last:mb-0">
          <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#55555E]">{group}</div>
          <div className="space-y-0.5">{items.map((t) => navLink(t, onClick))}</div>
        </div>
      );
    });

  return (
    <>
      <div className="min-h-screen flex bg-[#FAFAFB] text-[#111114]">
        {/* Single business navigation rail */}
        <aside aria-label="Main navigation" className="hidden md:flex w-[220px] shrink-0 flex-col bg-[#141416] sticky top-0 h-screen">
          <div className="flex justify-center pt-6 pb-4">
            <Logo offset={false} />
          </div>
          {switcher}
          <nav className="flex-1 px-2.5 pb-4 overflow-y-auto">{groupedNav()}</nav>
        </aside>

        {/* Mobile navigation drawer */}
        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent side="left" className="w-[280px] p-0 bg-[#141416] border-r-0 text-white">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex justify-center pt-6 pb-3"><Logo offset={false} /></div>
            {switcher}
            <nav className="px-2.5 pb-6 overflow-y-auto max-h-[calc(100vh-170px)]">
              {(() => {
                // Drawer always lists Operations destinations.
                const ops = appTabs;
                return GROUP_ORDER.map((group) => {
                  const items = ops.filter((t) => t.group === group);
                  if (!items.length) return null;
                  return (
                    <div key={group} className="mb-4">
                      <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#55555E]">{group}</div>
                      <div className="space-y-0.5">{items.map((t) => navLink(t, () => setMobileNav(false)))}</div>
                    </div>
                  );
                });
              })()}
            </nav>
          </SheetContent>
        </Sheet>

        {/* Workspace */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Locked while scrolling: top bar, page title, section tabs. Its
              height is published as --admin-sticky-h so panel filter rows
              can lock directly underneath. */}
          <div ref={stickyRef} className="max-md:contents md:sticky md:top-0 z-20 bg-[#FAFAFB]">
          <header className="sticky top-0 z-20 md:static bg-[#FAFAFB] px-3 md:px-8 py-3 flex items-center justify-between gap-3 border-b border-[#EDEDF0] md:border-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                aria-label="Open navigation"
                onClick={() => setMobileNav(true)}
                className="md:hidden w-11 h-11 -ml-1 grid place-items-center rounded-lg text-[#111114] hover:bg-[#F4F4F6]"
              >
                <Menu className="w-5 h-5" strokeWidth={1.75} />
              </button>
              <div className="relative hidden sm:block w-[340px] max-w-full">
                <Search className="w-[17px] h-[17px] text-[#9A9AA3] absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
                <input
                  type="search"
                  aria-label="Search drivers, vehicles and partners"
                  placeholder="Search Drivers, Vehicles, Partners…"
                  value={globalSearch}
                  onChange={(e) => {
                    const v = e.target.value;
                    setGlobalSearch(v);
                    if (v && !["drivers", "vehicles", "partners"].includes(tab)) goRoot("drivers", { replace: true });
                  }}
                  className="w-full pl-10 pr-3 py-2 rounded-full bg-white border border-[#EDEDF0] focus:border-[#D03020]/40 focus:outline-none focus:ring-2 focus:ring-[#D03020]/20 text-[13px] text-[#111114] placeholder:text-[#9A9AA3]"
                />
              </div>
              <div className="md:hidden text-[15px] font-semibold truncate">{current.label}</div>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2">
              {createActions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Add"
                    className="h-10 md:h-9 px-3 rounded-full bg-[#D03020] text-white text-[13px] font-semibold flex items-center gap-1.5 hover:bg-[#B5281A] transition-colors focus:outline-none focus:ring-2 focus:ring-[#D03020]/30"
                  >
                    <Plus className="w-4 h-4" strokeWidth={2.25} />
                    <span className="hidden sm:inline">Add</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44 min-w-[11rem]">
                    {createActions.map((a) => {
                      const Icon = a.icon;
                      return (
                        <DropdownMenuItem
                          key={a.id}
                          onSelect={() =>
                            void navigate({ to: "/admin", search: a.add ? { tab: a.tab, add: "1" } : rootSearch(a.tab) })
                          }
                          className="gap-2.5 py-2"
                        >
                          <Icon className="w-4 h-4 text-[#55555E]" strokeWidth={1.75} />
                          {a.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <button
                aria-label={`Messages${unreadMsgs > 0 ? ` (${unreadMsgs} unread)` : ""}`}
                onClick={() => setMsg("inbox")}
                className="relative w-10 h-10 rounded-full border border-[#EDEDF0] bg-white grid place-items-center text-[#55555E] hover:text-[#111114] hover:border-[#D6D6DB] transition-colors duration-150"
              >
                <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.75} />
                {unreadMsgs > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#111114] text-white text-[10px] font-semibold grid place-items-center">{unreadMsgs}</span>
                )}
              </button>
              <DropdownMenu onOpenChange={(o) => { if (o) markNotifsSeen(); }}>
                <DropdownMenuTrigger
                  aria-label="Notifications"
                  className="relative w-10 h-10 rounded-full border border-[#EDEDF0] bg-white grid place-items-center text-[#55555E] hover:text-[#111114] hover:border-[#D6D6DB] transition-colors duration-150"
                >
                  <Bell className="w-[18px] h-[18px]" strokeWidth={1.75} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D03020] text-white text-[10px] font-semibold grid place-items-center">{unreadCount}</span>
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 p-0">
                  <div className="px-3 py-2 border-b border-[#EDEDF0] flex items-center justify-between">
                    <div className="text-sm font-semibold text-[#111114]">Notifications</div>
                    <div className="text-[11px] text-[#9A9AA3]">Last 7 Days</div>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifs.length === 0 && <div className="px-3 py-8 text-center text-xs text-[#9A9AA3]">No Recent Activity</div>}
                    {notifs.map((n) => {
                      const created = n.created_at ? new Date(n.created_at) : null;
                      const isNew = created && created.getTime() > notifSeenAt;
                      return (
                        <DropdownMenuItem
                          key={n.id}
                          onSelect={() => void navigate({ to: "/admin", search: { tab: "drivers", id: n.id } })}
                          className="block px-3 py-2.5 rounded-none border-b border-[#F4F4F6] last:border-0"
                        >
                          <div className="flex items-center gap-2">
                            {isNew && <span className="w-1.5 h-1.5 rounded-full bg-[#D03020]" />}
                            <div className="text-[13px] font-medium text-[#111114] truncate flex-1">New Lead: {n.full_name || n.email || "Unnamed"}</div>
                          </div>
                          <div className="text-[11px] text-[#55555E] mt-0.5 truncate">
                            {n.email || n.phone || "—"} ·{" "}
                            {created ? fmtDateTime(created) : ""}
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Account"
                  className="w-10 h-10 rounded-full hover:bg-[#F4F4F6] grid place-items-center focus:outline-none focus:ring-2 focus:ring-[#D03020]/20"
                >
                  <div className="w-8 h-8 rounded-full bg-[#D03020]/15 text-[#D03020] grid place-items-center text-[11px] font-bold">{initials}</div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[300px] p-3 rounded-2xl bg-white text-[#111114] border border-[#D6D6DB] shadow-xl">
                  <div className="flex items-center gap-3 px-1 pt-1 pb-3">
                    <div className="w-12 h-12 rounded-full bg-[#D03020]/15 text-[#D03020] grid place-items-center text-[15px] font-bold shrink-0">{initials}</div>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-[#111114] truncate">{displayName}</div>
                      <div className="text-[13px] text-[#55555E] truncate">{session?.user?.email}</div>
                      {tier && (
                        <div className="mt-1 inline-flex text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F4F4F6] text-[#55555E]">
                          {TIER_LABELS[tier]}
                        </div>
                      )}
                    </div>
                  </div>
                  {tierAllows(tier, "owner") && (
                    <DropdownMenuItem
                      onSelect={() => void navigate({ to: "/admin", search: { tab: "settings", section: "team" } })}
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg border border-[#D6D6DB] bg-white text-[14px] font-semibold text-[#111114] cursor-pointer focus:bg-[#F4F4F6]"
                    >
                      <UserPlus className="w-4 h-4" strokeWidth={1.75} />
                      Invite Members
                    </DropdownMenuItem>
                  )}
                  <div className="h-px bg-[#EDEDF0] my-3" />
                  {tierAllows(tier, "manager") && (
                    <>
                      <DropdownMenuItem
                        onSelect={() => void navigate({ to: "/admin", search: { tab: "settings", section: "activity" } })}
                        className="gap-3 px-2 py-2.5 text-[14px] text-[#111114] cursor-pointer"
                      >
                        <HistoryIcon className="w-4 h-4 text-[#55555E]" strokeWidth={1.75} />
                        Activity
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => void navigate({ to: "/admin", search: rootSearch("settings") })}
                        className="gap-3 px-2 py-2.5 text-[14px] text-[#111114] cursor-pointer"
                      >
                        <SettingsGear className="w-4 h-4 text-[#55555E]" strokeWidth={1.75} />
                        Settings
                      </DropdownMenuItem>
                      <div className="h-px bg-[#EDEDF0] my-3" />
                    </>
                  )}
                  <button
                    onClick={signOut}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[#D03020] text-white text-[14px] font-semibold hover:bg-[#B5281A] transition-colors duration-150"
                  >
                    <LogOut className="w-4 h-4" strokeWidth={2} />
                    Log Out
                  </button>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <div className="px-4 md:px-8 pt-3 md:pt-4">
            {/* Driver and vehicle records carry their own "Drivers ←" / "Vehicles /" breadcrumb. */}
            {tab !== "overview" && !recordParent && (
              <div className="mb-3">
                <h1 className="text-[22px] font-semibold tracking-tight text-[#111114]">{workspace.label}</h1>
                <p className="text-[13px] text-[#55555E] mt-1">{workspace.description}</p>
              </div>
            )}
            {workspaceTabs.length > 1 && !recordParent && (
              <div className="-mx-4 px-4 md:mx-0 md:px-0 mb-3 overflow-x-auto">
                <div role="tablist" aria-label={`${workspace.label} sections`} className="inline-flex rounded-lg bg-[#F0F0F2] p-0.5 w-max">
                  {workspaceTabs.map((v) => (
                    <Link
                      key={v.id}
                      to="/admin"
                      search={rootSearch(v.id)}
                      role="tab"
                      aria-selected={tab === v.id}
                      className={`px-3 py-1.5 rounded-md text-[13px] font-medium whitespace-nowrap ${tab === v.id ? "bg-white text-[#111114] shadow-sm" : "text-[#55555E] hover:text-[#111114]"}`}
                    >
                      {v.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>

          <main data-admin-main className="flex-1 min-w-0 px-4 pb-4 md:px-8 md:pb-8 pt-2">
            {tab === "overview" && <OverviewPanel />}
            {tab === "drivers" && (
              <DriversPanel externalSearch={globalSearch} initialOpenId={urlRecordId ?? undefined} isOwner={tier === "owner"} canManageWaitlist={tierAllows(tier, "manager")} urlFilter={urlFilter ?? undefined} />
            )}
            {tab === "vehicles" && <VehiclesPanel externalSearch={globalSearch} autoOpenAdd={urlAdd} openId={urlRecordId} listState={{ q: search?.q, status: search?.vstatus, body: search?.body, partner: search?.partner, sort: search?.sort, page: search?.page, view: search?.view, ready: search?.ready }} />}
            {tab === "fleet_inbox" && <FleetInboxPanel isManager={tierAllows(tier, "manager")} />}
            {tab === "partners" && <PartnersPanel externalSearch={globalSearch} />}
            {tab === "payments" && <PaymentsPanel initialFilter={urlFilter ?? undefined} autoOpenAdd={urlAdd} />}
            {tab === "maintenance" && <MaintenancePanel autoOpenAdd={urlAdd} />}
            {tab === "shops" && <ShopsPanel />}
            {tab === "vendors" && <VendorsPanel />}
            {tab === "inspections" && <InspectionsPanel />}
            {tab === "charges" && <ChargesPanel />}
            {tab === "incidents" && <IncidentsPanel />}
            {tab === "expenses" && <ExpensesPanel autoOpenAdd={urlAdd} />}
            {tab === "settings" && <SettingsWorkspace tier={tier} section={search.section ?? null} />}
          </main>
        </div>
      </div>
      <MessagesOverlay
        open={msgOpen}
        applicationId={msgApp}
        onSelect={(id) => setMsg(id ?? "inbox")}
        onClose={() => setMsg(null)}
        onUnreadChange={setUnreadMsgs}
      />
    </>
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
              Forgot Your Password?
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

function NoAccess({ onSignOut }: { userId?: string; onSignOut: () => void }) {
  return (
    <AdminShell>
      <div className="container-real py-32 text-center max-w-lg">
        <h1 className="text-2xl font-semibold">Access Restricted</h1>
        <p className="mt-3 text-muted-foreground text-sm">
          This account doesn't have permission to access the management area.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a href="/portal" className="rounded-lg bg-real-red px-6 py-2 text-sm font-medium text-primary-foreground">Go To Driver Portal</a>
          <button onClick={onSignOut} className="rounded-lg border border-border px-6 py-2 text-sm">Sign Out</button>
        </div>
      </div>
    </AdminShell>
  );
}
