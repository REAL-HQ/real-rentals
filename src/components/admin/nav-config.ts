// Back-office navigation model: one grouped business rail → destinations.
// Messages is a global overlay (top-right); Automations and Team live in Settings.
// Pure data + functions (no React state) so it can be tested per role.
// Visibility is convenience only — server functions and RLS stay authoritative.
import {
  Users,
  Car,
  Handshake,
  CalendarCheck,
  CreditCard,
  Wrench,
  LayoutDashboard,
  ClipboardCheck,
  ListChecks,
  Truck,
  Receipt,
  ArrowLeftRight,
  Bell,
  Banknote,
  TrendingUp,
  ShieldAlert,
  AlertTriangle,
  Wallet,
  Inbox,
  Upload,
  Landmark,
  PieChart,
  LayoutGrid,
  ScrollText,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { tierAllows, type StaffTier } from "@/lib/roles";
import { UNIFIED_FINANCE_ENDPOINT_ENABLED } from "@/lib/unified-finance-flag";
import { VEHICLE_PROFITABILITY_ENABLED } from "@/lib/vehicle-profitability-flag";
import { INCIDENT_BOARD_ENABLED } from "@/lib/incident-board";
import { FLEET_AVAILABILITY_ENABLED } from "@/lib/fleet-availability";
import { PARTNER_STATEMENT_ENABLED } from "@/lib/partner-statement-flag";
import { OWNER_PNL_ENABLED } from "@/lib/owner-pnl-flag";
import { OWNER_EXPENSE_ENTRY_ENABLED } from "@/lib/owner-expense-entry-flag";

export type TabDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  minTier: StaffTier;
  /** Contextual-nav group. Omitted = reachable but not listed (e.g. "shops" lives under Vendors). */
  group?: Group;
  description: string;
};

export const GROUP_ORDER = ["HOME", "PEOPLE", "RENTALS", "FLEET", "BUSINESS", "MANAGE"] as const;
export type Group = (typeof GROUP_ORDER)[number];

export const TABS: readonly TabDef[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, minTier: "coordinator", group: "HOME", description: "Pipeline, Fleet And Revenue At A Glance" },
  { id: "drivers", label: "Drivers", icon: Users, minTier: "coordinator", group: "PEOPLE", description: "Manage Applicants, Active Renters And Driver Lifecycle" },
  // Bookings sits above Payments under RENTALS: what is out on rent, and what
  // came back, before the money it generated. Coordinator-visible — the money
  // columns are withheld by the SERVER for that tier, not by this list.
  {
    id: "bookings",
    label: "Bookings",
    icon: CalendarCheck,
    minTier: "coordinator",
    group: "RENTALS",
    description: "Active And Completed Rentals, With Their Paperwork",
  },
  {
    id: "active_rentals",
    label: "Active Rentals",
    icon: ListChecks,
    minTier: "manager",
    group: "RENTALS",
    description: "Who Is Out, What Is Due, And What Is Still Open",
  },
  { id: "payments", label: "Payments", icon: CreditCard, minTier: "manager", group: "RENTALS", description: "Rent, Deposits, Balances And Renter Charges" },
  { id: "charges", label: "Charges", icon: Receipt, minTier: "manager", description: "Tolls And Violations, Matched To The Renter Who Had The Car" },
  { id: "stripe_match", label: "Stripe Match", icon: ArrowLeftRight, minTier: "manager", description: "Live Stripe Customers Next To The Driver They Belong To" },
  { id: "collections_watch", label: "Collections Watch", icon: Bell, minTier: "manager", description: "Past Due Subscriptions, Failed Charges And What Is Due This Week" },
  { id: "deposits_ledger", label: "Deposits & Refunds", icon: Banknote, minTier: "manager", description: "Stripe Refunds, Deposits Held And The Period Net" },
  { id: "weekly_cash_flow", label: "Weekly Cash Flow", icon: TrendingUp, minTier: "manager", description: "Twelve Weeks Of Collections, Refunds, Expenses And Cash Flow" },
  { id: "vehicles", label: "Vehicles", icon: Car, minTier: "coordinator", group: "FLEET", description: "Fleet Inventory & Vehicle Status" },
  { id: "fleet_inbox", label: "Fleet Inbox", icon: Inbox, minTier: "coordinator", group: "FLEET", description: "Drop Fleet Files — Sorted, Matched To Vehicles And Ready For Review" },
  { id: "maintenance", label: "Service", icon: Wrench, minTier: "manager", group: "FLEET", description: "Maintenance, Due Work And Inspections" },
  { id: "inspections", label: "Inspections", icon: ClipboardCheck, minTier: "coordinator", description: "Pre-Delivery And Return Checklists With Photo Proof" },
  { id: "incidents", label: "Incidents", icon: ShieldAlert, minTier: "manager", group: "FLEET", description: "Accidents, Damage And Insurance Claims" },
  { id: "driver_issues", label: "Driver Issues", icon: AlertTriangle, minTier: "manager", group: "FLEET", description: "Breakdowns And Other Reports From Renters" },
  { id: "expenses", label: "Expenses", icon: Wallet, minTier: "manager", group: "BUSINESS", description: "Every Cost Against Every Car, And What Each One Earns" },
  { id: "vendors", label: "Vendors", icon: Truck, minTier: "coordinator", description: "Every Vendor We Work With — Repair Shops, Towing, GPS, Insurance" },
  { id: "shops", label: "Repair Shops", icon: Truck, minTier: "manager", description: "Preferred Maintenance Providers By Market" },
  { id: "partners", label: "Partners", icon: Handshake, minTier: "manager", group: "BUSINESS", description: "Vehicle Owners, Lenders And Vendors" },
  // Settings is opened from the profile dropdown, not the rail — the tab stays reachable (deep links / LEGACY_TABS).
];

/** Old destinations that now live elsewhere; bookmarks resolve through this. */
export const LEGACY_TABS: Record<string, { tab: string; section?: string; filter?: string; messages?: true }> = {
  automations: { tab: "settings", section: "automations" },
  team: { tab: "settings", section: "team" },
  messages: { tab: "overview", messages: true },
  websites: { tab: "settings", section: "website" },
  activity: { tab: "settings", section: "activity" },
  waitlist: { tab: "drivers", filter: "waitlist" },
};

/** Settings workspace menu. Only sections with real settings/functionality. */
export type SettingsSectionDef = { id: string; label: string; group: string; minTier: StaffTier };
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  { id: "company", label: "Company", group: "GENERAL", minTier: "owner" },
  { id: "website", label: "Website", group: "GENERAL", minTier: "manager" },
  { id: "maintenance", label: "Maintenance", group: "FLEET", minTier: "manager" },
  { id: "safe_autofill", label: "Safe Autofill", group: "FLEET", minTier: "owner" },
  { id: "photo_enhancement", label: "Photo Enhancement", group: "FLEET", minTier: "owner" },
  { id: "photo_reading", label: "Photo Reading", group: "FLEET", minTier: "owner" },
  { id: "vehicle_defaults", label: "Vehicle Pricing", group: "RENTALS", minTier: "manager" },
  { id: "rental_terms", label: "Rental Terms", group: "RENTALS", minTier: "owner" },
  { id: "deposits", label: "Deposits", group: "RENTALS", minTier: "owner" },
  { id: "applications", label: "Applications", group: "RENTALS", minTier: "owner" },
  { id: "esign", label: "Agreements & eSign", group: "RENTALS", minTier: "owner" },
  { id: "agreement_templates", label: "Agreement Templates", group: "RENTALS", minTier: "owner" },
  { id: "payments", label: "Payment Settings", group: "PAYMENTS", minTier: "owner" },
  { id: "partners", label: "Partner Terms", group: "BUSINESS", minTier: "owner" },
  { id: "notifications", label: "Notifications & Email", group: "COMMUNICATIONS", minTier: "owner" },
  { id: "automations", label: "Automations", group: "AUTOMATION", minTier: "manager" },
  { id: "team", label: "Team", group: "TEAM", minTier: "owner" },
  { id: "activity", label: "Activity", group: "TEAM", minTier: "manager" },
];
export function visibleSettingsSections(tier: StaffTier | null): SettingsSectionDef[] {
  return SETTINGS_SECTIONS.filter((s) => tierAllows(tier, s.minTier));
}

/** Shown only while Fleet Availability is compiled on. Kept out of TABS so a dark build cannot list it. */
const FLEET_AVAILABILITY_TAB: TabDef = {
  id: "fleet_availability",
  label: "Fleet Availability",
  icon: LayoutGrid,
  minTier: "coordinator",
  group: "FLEET",
  description: "Which Cars Are Available, Rented, In Shop, Or Not Rentable",
};

function spliceAfter<T extends { id: string }>(entries: T[], afterId: string, item: T): T[] {
  const next = [...entries];
  const at = next.findIndex((entry) => entry.id === afterId);
  next.splice(at === -1 ? next.length : at + 1, 0, item);
  return next;
}

/** Shown only while Unified Finance is compiled on. Kept out of TABS so a dark build cannot list it. */
const FINANCE_TAB: TabDef = {
  id: "finance",
  label: "Unified Finance",
  icon: Landmark,
  minTier: "manager",
  group: "BUSINESS",
  description: "Combined Finance Coverage And Per-Vehicle Profitability",
};

/** Shown only while Vehicle Profitability is compiled on. Kept out of TABS so a dark build cannot list it. */
const VEHICLE_PROFIT_TAB: TabDef = {
  id: "vehicle_profit",
  label: "Vehicle Profit",
  icon: PieChart,
  minTier: "manager",
  group: "BUSINESS",
  description: "Revenue, Expenses, Utilization And Partner Share By Vehicle",
};

/** Shown only while the Incident Board flag is on. Kept out of TABS so a dark build cannot list it. */
const INCIDENT_BOARD_TAB: TabDef = {
  id: "incident_board",
  label: "Incident Board",
  icon: ShieldAlert,
  minTier: "coordinator",
  group: "FLEET",
  description: "Open Accidents, Damage And Breakdowns",
};

/** Shown only while Partner Statement is compiled on. Kept out of TABS so a dark build cannot list it. */
const PARTNER_STATEMENT_TAB: TabDef = {
  id: "partner_statement",
  label: "Partner Statement",
  icon: ScrollText,
  minTier: "owner",
  group: "BUSINESS",
  description: "Per-Partner Revenue, Expenses And Share For A Period",
};

/** Shown only while Monthly Owner P&L is compiled on. Kept out of TABS so a dark build cannot list it. */
const OWNER_PNL_TAB: TabDef = {
  id: "owner_pnl",
  label: "Monthly Owner P&L",
  icon: Scale,
  minTier: "owner",
  group: "BUSINESS",
  description: "One Month Of Revenue, Refunds, Expenses And Net",
};

/** Shown only while Owner Expense Entry is compiled on. Kept out of TABS so a dark build cannot list it. */
const EXPENSE_ENTRY_TAB: TabDef = {
  id: "expense_entry",
  label: "Expense Entry",
  icon: Banknote,
  minTier: "owner",
  group: "BUSINESS",
  description: "Add One Vehicle Expense",
};

function withPartnerStatement<T extends TabDef>(tabs: T[], tier: StaffTier | null, href?: string): T[] {
  if (!PARTNER_STATEMENT_ENABLED || !tierAllows(tier, "owner")) return tabs;
  const next = [...tabs];
  const at = next.findIndex((t) => t.id === "partners");
  const entry = href ? { ...PARTNER_STATEMENT_TAB, href } : PARTNER_STATEMENT_TAB;
  next.splice(at + 1, 0, entry as T);
  return next;
}

function withOwnerPnl<T extends TabDef>(tabs: T[], tier: StaffTier | null, href?: string): T[] {
  if (!OWNER_PNL_ENABLED || !tierAllows(tier, "owner")) return tabs;
  const next = [...tabs];
  const at = next.findIndex((t) => t.id === "partners");
  const entry = href ? { ...OWNER_PNL_TAB, href } : OWNER_PNL_TAB;
  next.splice(at + 1, 0, entry as T);
  return next;
}

function withExpenseEntry<T extends TabDef>(tabs: T[], tier: StaffTier | null, href?: string): T[] {
  if (!OWNER_EXPENSE_ENTRY_ENABLED || !tierAllows(tier, "owner")) return tabs;
  const next = [...tabs];
  const at = next.findIndex((t) => t.id === "expenses");
  const entry = href ? { ...EXPENSE_ENTRY_TAB, href } : EXPENSE_ENTRY_TAB;
  next.splice(at + 1, 0, entry as T);
  return next;
}

export function visibleTabs(tier: StaffTier | null): TabDef[] {
  let next = TABS.filter((t) => tierAllows(tier, t.minTier));
  if (FLEET_AVAILABILITY_ENABLED && tierAllows(tier, "coordinator")) {
    next = spliceAfter(next, "vehicles", FLEET_AVAILABILITY_TAB);
  }
  if (INCIDENT_BOARD_ENABLED && tierAllows(tier, "coordinator")) {
    const at = next.findIndex((t) => t.id === "incidents");
    const insertAt = at >= 0 ? at : next.findIndex((t) => t.id === "maintenance");
    next.splice(insertAt >= 0 ? insertAt : next.length, 0, INCIDENT_BOARD_TAB);
  }
  const extra: TabDef[] = [];
  const financeHidden = !UNIFIED_FINANCE_ENDPOINT_ENABLED || !tierAllows(tier, "manager");
  if (!financeHidden) extra.push(FINANCE_TAB);
  if (VEHICLE_PROFITABILITY_ENABLED && tierAllows(tier, "manager")) extra.push(VEHICLE_PROFIT_TAB);
  if (!extra.length) return withExpenseEntry(withOwnerPnl(withPartnerStatement(next, tier), tier), tier);
  const at = next.findIndex((t) => t.id === "expenses");
  next.splice(at + 1, 0, ...extra);
  return withExpenseEntry(withOwnerPnl(withPartnerStatement(next, tier), tier), tier);
}

/**
 * Consolidated workspaces: one rail entry, several tabs. Each tab keeps its
 * own id, minTier, panel and server checks — this only groups them.
 */
export const WORKSPACE_TABS: Record<string, readonly { id: string; label: string }[]> = {
  payments: [{ id: "payments", label: "Payments" }, { id: "charges", label: "Charges" }, { id: "stripe_match", label: "Stripe Match" }, { id: "collections_watch", label: "Collections Watch" }, { id: "deposits_ledger", label: "Deposits & Refunds" }, { id: "weekly_cash_flow", label: "Weekly Cash Flow" }],
  maintenance: [{ id: "maintenance", label: "Maintenance" }, { id: "inspections", label: "Inspections" }],
  partners: [{ id: "partners", label: "Partners" }, { id: "vendors", label: "Vendors" }, { id: "shops", label: "Repair Shops" }],
};

/** Which rail entry is highlighted for a tab (Charges → Payments, Inspections → Service, Vendors → Partners). */
export function navOwner(tab: string): string {
  for (const [parent, kids] of Object.entries(WORKSPACE_TABS)) if (kids.some((k) => k.id === tab)) return parent;
  return tab;
}

/** Workspace tabs this tier may open (never broadens: each tab keeps its minTier). */
export function visibleWorkspaceTabs(parent: string, tier: StaffTier | null) {
  const kids = WORKSPACE_TABS[parent] ?? [{ id: parent, label: "" }];
  return kids.filter((k) => {
    const def = TABS.find((t) => t.id === k.id);
    return !!def && tierAllows(tier, def.minTier);
  });
}

/** Rail entries: a workspace shows if any of its tabs is allowed; it links to the first allowed tab. */
export function railEntries(tier: StaffTier | null): (TabDef & { href: string })[] {
  let entries = TABS.filter((t) => t.group)
    .map((t) => ({ ...t, href: visibleWorkspaceTabs(t.id, tier)[0]?.id ?? "" }))
    .filter((t) => t.href);
  if (FLEET_AVAILABILITY_ENABLED && tierAllows(tier, "coordinator")) {
    entries = spliceAfter(entries, "vehicles", { ...FLEET_AVAILABILITY_TAB, href: "fleet_availability" });
  }
  if (INCIDENT_BOARD_ENABLED && tierAllows(tier, "coordinator")) {
    const at = entries.findIndex((t) => t.id === "incidents");
    const insertAt = at >= 0 ? at : entries.findIndex((t) => t.id === "maintenance");
    entries.splice(insertAt >= 0 ? insertAt : entries.length, 0, { ...INCIDENT_BOARD_TAB, href: "incident_board" });
  }
  const extra: (TabDef & { href: string })[] = [];
  const financeHidden = !UNIFIED_FINANCE_ENDPOINT_ENABLED || !tierAllows(tier, "manager");
  if (!financeHidden) extra.push({ ...FINANCE_TAB, href: "finance" });
  if (VEHICLE_PROFITABILITY_ENABLED && tierAllows(tier, "manager")) extra.push({ ...VEHICLE_PROFIT_TAB, href: "vehicle_profit" });
  if (!extra.length) {
    return withExpenseEntry(withOwnerPnl(withPartnerStatement(entries, tier, "partner_statement"), tier, "owner_pnl"), tier, "expense_entry");
  }
  const at = entries.findIndex((t) => t.id === "expenses");
  entries.splice(at + 1, 0, ...extra);
  return withExpenseEntry(withOwnerPnl(withPartnerStatement(entries, tier, "partner_statement"), tier, "owner_pnl"), tier, "expense_entry");
}

/** Global "+ Create" — each entry is an existing flow reached by deep link. */
export type CreateAction = { id: string; label: string; icon: LucideIcon; tab: string; add: boolean; minTier: StaffTier };
export const CREATE_ACTIONS: readonly CreateAction[] = [
  { id: "vehicle", label: "Vehicle", icon: Car, tab: "vehicles", add: true, minTier: "coordinator" },
  { id: "fleet_files", label: "Files", icon: Upload, tab: "fleet_inbox", add: false, minTier: "coordinator" },
  { id: "service", label: "Service", icon: Wrench, tab: "maintenance", add: true, minTier: "manager" },
  { id: "payment", label: "Payment", icon: CreditCard, tab: "payments", add: true, minTier: "manager" },
  { id: "expense", label: "Expense", icon: Wallet, tab: "expenses", add: true, minTier: "manager" },
];

export function visibleCreateActions(tier: StaffTier | null): CreateAction[] {
  return CREATE_ACTIONS.filter((a) => tierAllows(tier, a.minTier));
}

/** Tabs that accept `add=1` to open their creation flow. */
export const ADD_TABS = ["vehicles", "payments", "expenses"] as const;
