// Back-office navigation model: Dock apps → contextual groups → destinations.
// Pure data + functions (no React state) so it can be tested per role.
// Visibility is convenience only — server functions and RLS stay authoritative.
import {
  Users,
  Car,
  Handshake,
  CreditCard,
  Settings as SettingsIcon,
  Wrench,
  MessageSquare,
  Globe,
  UserCog,
  LayoutDashboard,
  Hourglass,
  Zap,
  ClipboardCheck,
  Truck,
  Receipt,
  History,
  ShieldAlert,
  Wallet,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { tierAllows, type StaffTier } from "@/lib/roles";

export type AppId = "operations" | "messages" | "automations";

export type TabDef = {
  id: string;
  label: string;
  icon: LucideIcon;
  minTier: StaffTier;
  app: AppId;
  /** Contextual-nav group. Omitted = reachable but not listed (e.g. "shops" lives under Vendors). */
  group?: Group;
  description: string;
};

export const GROUP_ORDER = ["HOME", "PEOPLE", "RENTALS", "FLEET", "BUSINESS", "MANAGE"] as const;
export type Group = (typeof GROUP_ORDER)[number];

export const TABS: readonly TabDef[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, minTier: "coordinator", app: "operations", group: "HOME", description: "Pipeline, Fleet And Revenue At A Glance" },
  { id: "drivers", label: "Drivers", icon: Users, minTier: "coordinator", app: "operations", group: "PEOPLE", description: "Manage Applicants, Active Renters And Driver Lifecycle" },
  { id: "waitlist", label: "Waitlist", icon: Hourglass, minTier: "coordinator", app: "operations", group: "PEOPLE", description: "Drivers Waiting When No Cars Are Available" },
  { id: "payments", label: "Payments", icon: CreditCard, minTier: "manager", app: "operations", group: "RENTALS", description: "Rent, Deposits And Balances" },
  { id: "charges", label: "Charges", icon: Receipt, minTier: "manager", app: "operations", group: "RENTALS", description: "Tolls And Violations, Matched To The Renter Who Had The Car" },
  { id: "vehicles", label: "Vehicles", icon: Car, minTier: "coordinator", app: "operations", group: "FLEET", description: "Fleet Inventory & Vehicle Status" },
  { id: "maintenance", label: "Service", icon: Wrench, minTier: "manager", app: "operations", group: "FLEET", description: "Vehicles Down, Due, Scheduled And In Shop" },
  { id: "inspections", label: "Inspections", icon: ClipboardCheck, minTier: "coordinator", app: "operations", group: "FLEET", description: "Pre-Delivery And Return Checklists With Photo Proof" },
  { id: "incidents", label: "Incidents", icon: ShieldAlert, minTier: "manager", app: "operations", group: "FLEET", description: "Accidents, Damage And Insurance Claims" },
  { id: "expenses", label: "Expenses", icon: Wallet, minTier: "manager", app: "operations", group: "BUSINESS", description: "Every Cost Against Every Car, And What Each One Earns" },
  { id: "vendors", label: "Vendors", icon: Truck, minTier: "coordinator", app: "operations", group: "BUSINESS", description: "Every Vendor We Work With — Repair Shops, Towing, GPS, Insurance" },
  // Repair Shops: still its own table/screen (data merge deferred), shown inside Vendors.
  { id: "shops", label: "Repair Shops", icon: Truck, minTier: "manager", app: "operations", description: "Preferred Maintenance Providers By Market" },
  { id: "partners", label: "Partners", icon: Handshake, minTier: "manager", app: "operations", group: "BUSINESS", description: "Vehicle Owners, Capital Partners And Lenders" },
  { id: "websites", label: "Websites", icon: Globe, minTier: "manager", app: "operations", group: "BUSINESS", description: "Market-Specific Marketing Sites" },
  { id: "activity", label: "Activity", icon: History, minTier: "manager", app: "operations", group: "MANAGE", description: "Who Did What, And What Is About To Expire" },
  { id: "team", label: "Team", icon: UserCog, minTier: "owner", app: "operations", group: "MANAGE", description: "Internal Roles & Access Control" },
  { id: "settings", label: "Settings", icon: SettingsIcon, minTier: "owner", app: "operations", group: "MANAGE", description: "Rental Terms, Payments, Admin Users And Preferences" },
  { id: "messages", label: "Messages", icon: MessageSquare, minTier: "coordinator", app: "messages", description: "Inbound Driver & Partner Conversations" },
  { id: "automations", label: "Automations", icon: Zap, minTier: "manager", app: "automations", description: "Automatic SMS And Email Follow-Up Sequences" },
];

export type AppDef = { id: AppId; label: string; icon: LucideIcon; home: string };

// eSign and Reports are intentionally absent: no standalone destination exists yet.
export const APPS: readonly AppDef[] = [
  { id: "operations", label: "Operations", icon: LayoutGrid, home: "overview" },
  { id: "messages", label: "Messages", icon: MessageSquare, home: "messages" },
  { id: "automations", label: "Automations", icon: Zap, home: "automations" },
];

export function visibleTabs(tier: StaffTier | null): TabDef[] {
  return TABS.filter((t) => tierAllows(tier, t.minTier));
}

export function visibleApps(tier: StaffTier | null): AppDef[] {
  const tabs = visibleTabs(tier);
  return APPS.filter((a) => tabs.some((t) => t.id === a.home));
}

export function appOf(tab: string): AppId {
  return TABS.find((t) => t.id === tab)?.app ?? "operations";
}

/** Which nav entry is highlighted for a tab (Repair Shops highlights Vendors). */
export function navOwner(tab: string): string {
  return tab === "shops" ? "vendors" : tab;
}

/** Global "+ Create" — each entry is an existing flow reached by deep link. */
export type CreateAction = { id: string; label: string; icon: LucideIcon; tab: string; add: boolean; minTier: StaffTier };
export const CREATE_ACTIONS: readonly CreateAction[] = [
  { id: "vehicle", label: "Add Vehicle", icon: Car, tab: "vehicles", add: true, minTier: "coordinator" },
  { id: "payment", label: "Record Payment", icon: CreditCard, tab: "payments", add: true, minTier: "manager" },
  { id: "expense", label: "Add Expense", icon: Wallet, tab: "expenses", add: true, minTier: "manager" },
  { id: "message", label: "Send Message", icon: MessageSquare, tab: "messages", add: false, minTier: "coordinator" },
];

export function visibleCreateActions(tier: StaffTier | null): CreateAction[] {
  return CREATE_ACTIONS.filter((a) => tierAllows(tier, a.minTier));
}

/** Tabs that accept `add=1` to open their creation flow. */
export const ADD_TABS = ["vehicles", "payments", "expenses"] as const;
