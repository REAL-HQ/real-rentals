// Back-office navigation model: one grouped business rail → destinations.
// Messages is a global overlay (top-right); Automations and Team live in Settings.
// Pure data + functions (no React state) so it can be tested per role.
// Visibility is convenience only — server functions and RLS stay authoritative.
import {
  Users,
  Car,
  Handshake,
  CreditCard,
  Wrench,
  LayoutDashboard,
  ClipboardCheck,
  Truck,
  Receipt,
  ShieldAlert,
  Wallet,
  Inbox,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { tierAllows, type StaffTier } from "@/lib/roles";

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
  { id: "payments", label: "Payments", icon: CreditCard, minTier: "manager", group: "RENTALS", description: "Rent, Deposits, Balances And Renter Charges" },
  { id: "charges", label: "Charges", icon: Receipt, minTier: "manager", description: "Tolls And Violations, Matched To The Renter Who Had The Car" },
  { id: "vehicles", label: "Vehicles", icon: Car, minTier: "coordinator", group: "FLEET", description: "Fleet Inventory & Vehicle Status" },
  { id: "fleet_inbox", label: "Fleet Inbox", icon: Inbox, minTier: "coordinator", group: "FLEET", description: "Drop Fleet Files — Sorted, Matched To Vehicles And Ready For Review" },
  { id: "maintenance", label: "Service", icon: Wrench, minTier: "manager", group: "FLEET", description: "Maintenance, Due Work And Inspections" },
  { id: "inspections", label: "Inspections", icon: ClipboardCheck, minTier: "coordinator", description: "Pre-Delivery And Return Checklists With Photo Proof" },
  { id: "incidents", label: "Incidents", icon: ShieldAlert, minTier: "manager", group: "FLEET", description: "Accidents, Damage And Insurance Claims" },
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
  { id: "vehicle_defaults", label: "Vehicle Defaults", group: "FLEET", minTier: "manager" },
  { id: "maintenance", label: "Maintenance", group: "FLEET", minTier: "manager" },
  { id: "safe_autofill", label: "Safe Autofill", group: "FLEET", minTier: "owner" },
  { id: "photo_enhancement", label: "Photo Enhancement", group: "FLEET", minTier: "owner" },
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

export function visibleTabs(tier: StaffTier | null): TabDef[] {
  return TABS.filter((t) => tierAllows(tier, t.minTier));
}

/**
 * Consolidated workspaces: one rail entry, several tabs. Each tab keeps its
 * own id, minTier, panel and server checks — this only groups them.
 */
export const WORKSPACE_TABS: Record<string, readonly { id: string; label: string }[]> = {
  payments: [{ id: "payments", label: "Payments" }, { id: "charges", label: "Charges" }],
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
  return TABS.filter((t) => t.group)
    .map((t) => ({ ...t, href: visibleWorkspaceTabs(t.id, tier)[0]?.id ?? "" }))
    .filter((t) => t.href);
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
