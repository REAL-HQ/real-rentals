// Back-office navigation model: one grouped business rail → destinations.
// Messages is a global overlay (top-right); Automations and Team live in Settings.
// Pure data + functions (no React state) so it can be tested per role.
// Visibility is convenience only — server functions and RLS stay authoritative.
import {
  Users,
  Car,
  Handshake,
  CreditCard,
  Settings as SettingsIcon,
  Wrench,
  Globe,
  LayoutDashboard,
  Hourglass,
  ClipboardCheck,
  Truck,
  Receipt,
  History,
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
  { id: "waitlist", label: "Waitlist", icon: Hourglass, minTier: "coordinator", group: "PEOPLE", description: "Drivers Waiting When No Cars Are Available" },
  { id: "payments", label: "Payments", icon: CreditCard, minTier: "manager", group: "RENTALS", description: "Rent, Deposits And Balances" },
  { id: "charges", label: "Charges", icon: Receipt, minTier: "manager", group: "RENTALS", description: "Tolls And Violations, Matched To The Renter Who Had The Car" },
  { id: "vehicles", label: "Vehicles", icon: Car, minTier: "coordinator", group: "FLEET", description: "Fleet Inventory & Vehicle Status" },
  { id: "fleet_inbox", label: "Fleet Inbox", icon: Inbox, minTier: "coordinator", group: "FLEET", description: "Drop Fleet Files — Sorted, Matched To Vehicles And Ready For Review" },
  { id: "maintenance", label: "Service", icon: Wrench, minTier: "manager", group: "FLEET", description: "Vehicles Down, Due, Scheduled And In Shop" },
  { id: "inspections", label: "Inspections", icon: ClipboardCheck, minTier: "coordinator", group: "FLEET", description: "Pre-Delivery And Return Checklists With Photo Proof" },
  { id: "incidents", label: "Incidents", icon: ShieldAlert, minTier: "manager", group: "FLEET", description: "Accidents, Damage And Insurance Claims" },
  { id: "expenses", label: "Expenses", icon: Wallet, minTier: "manager", group: "BUSINESS", description: "Every Cost Against Every Car, And What Each One Earns" },
  { id: "vendors", label: "Vendors", icon: Truck, minTier: "coordinator", group: "BUSINESS", description: "Every Vendor We Work With — Repair Shops, Towing, GPS, Insurance" },
  // Repair Shops: still its own table/screen (data merge deferred), shown inside Vendors.
  { id: "shops", label: "Repair Shops", icon: Truck, minTier: "manager", description: "Preferred Maintenance Providers By Market" },
  { id: "partners", label: "Partners", icon: Handshake, minTier: "manager", group: "BUSINESS", description: "Vehicle Owners, Capital Partners And Lenders" },
  { id: "websites", label: "Websites", icon: Globe, minTier: "manager", group: "BUSINESS", description: "Market-Specific Marketing Sites" },
  { id: "activity", label: "Activity", icon: History, minTier: "manager", group: "MANAGE", description: "Who Did What, And What Is About To Expire" },
  { id: "settings", label: "Settings", icon: SettingsIcon, minTier: "manager", group: "MANAGE", description: "Company Configuration, Automations and Team" },
];

/** Old destinations that now live elsewhere; bookmarks resolve through this. */
export const LEGACY_TABS: Record<string, { tab: string; section?: string; messages?: true }> = {
  automations: { tab: "settings", section: "automations" },
  team: { tab: "settings", section: "team" },
  messages: { tab: "overview", messages: true },
};

/** Settings workspace menu. Only sections with real settings/functionality. */
export type SettingsSectionDef = { id: string; label: string; group: string; minTier: StaffTier };
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  { id: "company", label: "Company", group: "GENERAL", minTier: "owner" },
  { id: "vehicle_defaults", label: "Vehicle Defaults", group: "FLEET", minTier: "manager" },
  { id: "rental_terms", label: "Rental Terms", group: "RENTALS", minTier: "owner" },
  { id: "deposits", label: "Deposits", group: "RENTALS", minTier: "owner" },
  { id: "applications", label: "Applications", group: "RENTALS", minTier: "owner" },
  { id: "esign", label: "Agreements & eSign", group: "RENTALS", minTier: "owner" },
  { id: "payments", label: "Payment Settings", group: "PAYMENTS", minTier: "owner" },
  { id: "partners", label: "Partner Terms", group: "BUSINESS", minTier: "owner" },
  { id: "notifications", label: "Notifications & Email", group: "COMMUNICATIONS", minTier: "owner" },
  { id: "automations", label: "Automations", group: "AUTOMATION", minTier: "manager" },
  { id: "team", label: "Team", group: "TEAM", minTier: "owner" },
];
export function visibleSettingsSections(tier: StaffTier | null): SettingsSectionDef[] {
  return SETTINGS_SECTIONS.filter((s) => tierAllows(tier, s.minTier));
}

export function visibleTabs(tier: StaffTier | null): TabDef[] {
  return TABS.filter((t) => tierAllows(tier, t.minTier));
}

/** Which nav entry is highlighted for a tab (Repair Shops highlights Vendors). */
export function navOwner(tab: string): string {
  return tab === "shops" ? "vendors" : tab;
}

/** Global "+ Create" — each entry is an existing flow reached by deep link. */
export type CreateAction = { id: string; label: string; icon: LucideIcon; tab: string; add: boolean; minTier: StaffTier };
export const CREATE_ACTIONS: readonly CreateAction[] = [
  { id: "vehicle", label: "Vehicle", icon: Car, tab: "vehicles", add: true, minTier: "coordinator" },
  { id: "fleet_files", label: "Files", icon: Upload, tab: "fleet_inbox", add: false, minTier: "coordinator" },
  { id: "payment", label: "Payment", icon: CreditCard, tab: "payments", add: true, minTier: "manager" },
  { id: "expense", label: "Expense", icon: Wallet, tab: "expenses", add: true, minTier: "manager" },
];

export function visibleCreateActions(tier: StaffTier | null): CreateAction[] {
  return CREATE_ACTIONS.filter((a) => tierAllows(tier, a.minTier));
}

/** Tabs that accept `add=1` to open their creation flow. */
export const ADD_TABS = ["vehicles", "payments", "expenses"] as const;
