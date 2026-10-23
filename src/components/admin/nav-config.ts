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
  FileSpreadsheet,
  HeartPulse,
  CircleDollarSign,
  BarChart3,
  CalendarClock,
  CalendarRange,
  RotateCcw,
  RefreshCw,
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
import { ACCOUNTANT_EXPORT_ENABLED } from "@/lib/accountant-export-flag";
import { TAX_EXPORT_ENABLED } from "@/lib/tax-export-flag";
import { PAYOUT_BREAKDOWN_ENABLED } from "@/lib/payout-breakdown-flag";
import { BILLING_HEALTH_ENABLED } from "@/lib/billing-health-flag";
import { FINANCE_DATA_QUALITY_ENABLED } from "@/lib/finance-data-quality-flag";
import { FINANCE_AR_AGING_ENABLED } from "@/lib/rent-aging-flag";
import { FINANCE_DEPOSIT_LEDGER_ENABLED } from "@/lib/finance-deposit-ledger-flag";
import { STRIPE_RISK_MONITOR_ENABLED } from "@/lib/stripe-risk-monitor-flag";
import { STRIPE_PAYOUT_RECON_ENABLED } from "@/lib/stripe-payout-recon-flag";
import { APPLICANT_FUNNEL_ENABLED } from "@/lib/applicant-funnel";
import { TODAYS_OPS_ENABLED } from "@/lib/todays-ops-flag";
import { FLEET_CALENDAR_ENABLED } from "@/lib/fleet-calendar-flag";
import { REVENUE_FORECAST_ENABLED } from "@/lib/revenue-forecast-flag";
import { RECEIVABLES_AGING_ENABLED } from "@/lib/receivables-aging-flag";
import { DEPOSIT_LEDGER_ENABLED } from "@/lib/deposit-ledger-flag";
import { VEHICLE_TURNAROUND_ENABLED } from "@/lib/vehicle-turnaround-flag";
import { RENT_RECONCILIATION_ENABLED } from "@/lib/rent-reconciliation-flag";
import { OWNER_FINANCE_SNAPSHOT_ENABLED } from "@/lib/owner-finance-snapshot-flag";
import { RENEWALS_DUE_ENABLED } from "@/lib/renewals-due-flag";

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

/** Shown only while Today's Ops is compiled on. Kept out of TABS so a dark build cannot list it. */
const TODAYS_OPS_TAB: TabDef = {
  id: "todays_ops",
  label: "Today's Ops",
  icon: CalendarClock,
  minTier: "manager",
  group: "HOME",
  description: "Pickups, Returns, Payments And Open Issues For Today",
};

/** Shown only while Owner Weekly Finance Snapshot is compiled on. Kept out of TABS so a dark build cannot list it. Owners only. */
const OWNER_FINANCE_SNAPSHOT_TAB: TabDef = {
  id: "owner_finance_snapshot",
  label: "Weekly Finance Snapshot",
  icon: LayoutGrid,
  minTier: "owner",
  group: "BUSINESS",
  description: "One Eastern Time Week Of Rent, Balances, Deposits And Exceptions",
};

/** Shown only while Rent Payment Reconciliation is compiled on. Kept out of TABS so a dark build cannot list it. */
const RENT_RECONCILIATION_TAB: TabDef = {
  id: "rent_reconciliation",
  label: "Rent Reconciliation",
  icon: Scale,
  minTier: "manager",
  group: "BUSINESS",
  description: "Rent Payments Compared With Stripe For One Eastern Time Week",
};

/** Shown only while Vehicle Turnaround is compiled on. Kept out of TABS so a dark build cannot list it. */
const VEHICLE_TURNAROUND_TAB: TabDef = {
  id: "vehicle_turnaround",
  label: "Vehicle Turnaround",
  icon: RotateCcw,
  minTier: "manager",
  group: "FLEET",
  description: "Vehicles Between Rentals, Longest Idle First",
};

/** Shown only while Rental Renewal Due is compiled on. Kept out of TABS so a dark build cannot list it. */
const RENEWALS_DUE_TAB: TabDef = {
  id: "renewals_due",
  label: "Renewal Due",
  icon: RefreshCw,
  minTier: "manager",
  group: "RENTALS",
  description: "Active Rentals With A Billing Or End Date In The Next 7 Days",
};

/** Shown only while Fleet Calendar is compiled on. Kept out of TABS so a dark build cannot list it. */
const FLEET_CALENDAR_TAB: TabDef = {
  id: "fleet_calendar",
  label: "Fleet Calendar",
  icon: CalendarRange,
  minTier: "manager",
  group: "FLEET",
  description: "The Week Ahead For Every Vehicle",
};

/** Shown only while Receivables Aging is compiled on. Kept out of TABS so a dark build cannot list it. */
const AGING_TAB: TabDef = {
  id: "receivables_aging",
  label: "Receivables Aging",
  icon: CalendarClock,
  minTier: "manager",
  group: "BUSINESS",
  description: "Unpaid Rent By How Long It Has Been Due",
};

/** Shown only while Deposit Ledger is compiled on. Kept out of TABS so a dark build cannot list it. */
const DEPOSIT_TAB: TabDef = {
  id: "deposit_ledger",
  label: "Deposit Ledger",
  icon: Banknote,
  minTier: "manager",
  group: "BUSINESS",
  description: "Security Deposits Held, Due Back, Or Unknown",
};

/** Shown only while Finance Data Quality is compiled on. Kept out of TABS so a dark build cannot list it. */
const FINANCE_DATA_QUALITY_TAB: TabDef = {
  id: "finance_data_quality",
  label: "Finance Data Quality",
  icon: ListChecks,
  minTier: "manager",
  group: "BUSINESS",
  description: "Gaps That Leave Finance Totals Partial Or Unavailable",
};

function withFinanceDataQuality<T extends TabDef>(tabs: T[], tier: StaffTier | null, href?: string): T[] {
  if (!FINANCE_DATA_QUALITY_ENABLED || !tierAllows(tier, "manager")) return tabs;
  const next = [...tabs];
  const at = next.findIndex((t) => t.id === "expenses");
  const entry = href ? { ...FINANCE_DATA_QUALITY_TAB, href } : FINANCE_DATA_QUALITY_TAB;
  next.splice(at + 1, 0, entry as T);
  return next;
}

/** Shown only while Rent Aging is compiled on. Kept out of TABS so a dark build cannot list it. */
const RENT_AGING_TAB: TabDef = {
  id: "rent_aging",
  label: "Rent Aging",
  icon: Scale,
  minTier: "manager",
  group: "BUSINESS",
  description: "Outstanding Renter Balances By How Far Past Due",
};

function withRentAging<T extends TabDef>(tabs: T[], tier: StaffTier | null, href?: string): T[] {
  if (!FINANCE_AR_AGING_ENABLED || !tierAllows(tier, "manager")) return tabs;
  const next = [...tabs];
  const at = next.findIndex((t) => t.id === "expenses");
  const entry = href ? { ...RENT_AGING_TAB, href } : RENT_AGING_TAB;
  next.splice(at + 1, 0, entry as T);
  return next;
}

/** Shown only while Deposit Ledger is compiled on. Kept out of TABS so a dark build cannot list it. */
const FINANCE_DEPOSIT_LEDGER_TAB: TabDef = {
  id: "finance_deposit_ledger",
  label: "Deposit Ledger",
  icon: CircleDollarSign,
  minTier: "manager",
  group: "BUSINESS",
  description: "Deposit Collected, Held, Applied, Refunded, And Still Held",
};

function withFinanceDepositLedger<T extends TabDef>(tabs: T[], tier: StaffTier | null, href?: string): T[] {
  if (!FINANCE_DEPOSIT_LEDGER_ENABLED || !tierAllows(tier, "manager")) return tabs;
  const next = [...tabs];
  const at = next.findIndex((t) => t.id === "expenses");
  const entry = href ? { ...FINANCE_DEPOSIT_LEDGER_TAB, href } : FINANCE_DEPOSIT_LEDGER_TAB;
  next.splice(at + 1, 0, entry as T);
  return next;
}

/** Shown only while Revenue Forecast is compiled on. Kept out of TABS so a dark build cannot list it. Owners only. */
const REVENUE_FORECAST_TAB: TabDef = {
  id: "revenue_forecast",
  label: "Revenue Forecast",
  icon: TrendingUp,
  minTier: "owner",
  group: "BUSINESS",
  description: "Projected Rental Income For The Next 4 Weeks",
};

/** Shown only while Unified Finance is compiled on. Kept out of TABS so a dark build cannot list it. */
const FINANCE_TAB: TabDef = {
  id: "finance",
  label: "Unified Finance",
  icon: Landmark,
  minTier: "manager",
  group: "BUSINESS",
  description: "Combined Finance Coverage And Per-Vehicle Profitability",
};

/** Shown only while Payout Breakdown is compiled on. Kept out of TABS so a dark build cannot list it. */
const PAYOUT_BREAKDOWN_TAB: TabDef = {
  id: "payout_breakdown",
  label: "Payout Breakdown",
  icon: Banknote,
  minTier: "owner",
  group: "BUSINESS",
  description: "Stripe Payouts Split Into Charges, Refunds, Fees And Adjustments",
};

/** Shown only while the Stripe risk monitor is compiled on. Kept out of TABS so a dark build cannot list it. */
const STRIPE_RISK_MONITOR_TAB: TabDef = {
  id: "stripe_risk_monitor",
  label: "Disputes & Failed Payments",
  icon: ShieldAlert,
  minTier: "manager",
  group: "BUSINESS",
  description: "Open Disputes, Failed Payments And Past Due Subscriptions",
};

/** Shown only while Stripe Payout Reconciliation is compiled on. Kept out of TABS so a dark build cannot list it. */
const STRIPE_PAYOUT_RECON_TAB: TabDef = {
  id: "stripe_payout_recon",
  label: "Payout Reconciliation",
  icon: Receipt,
  minTier: "manager",
  group: "BUSINESS",
  description: "Payouts For The Last 60 Days Matched To App Payments",
};

/** Shown only while Billing Health is compiled on. Kept out of TABS so a dark build cannot list it. Owners only. */
const BILLING_HEALTH_TAB: TabDef = {
  id: "billing_health",
  label: "Billing Health",
  icon: HeartPulse,
  minTier: "owner",
  group: "BUSINESS",
  description: "Active Rentals Compared With Stripe Subscriptions",
};

/** Shown only while the applicant funnel is compiled on. Kept out of TABS so a dark build cannot list it. */
const FUNNEL_TAB: TabDef = {
  id: "funnel",
  label: "Applicant Funnel",
  icon: BarChart3,
  minTier: "manager",
  group: "PEOPLE",
  description: "Application Counts And Conversion For An Eastern Time Range",
};

/** Shown only while Vehicle Profitability is compiled on. Kept out of TABS so a dark build cannot list it. */
const VEHICLE_PROFIT_TAB: TabDef = {
  id: "vehicle_profit",
  label: "Vehicle Profitability",
  icon: PieChart,
  minTier: "manager",
  group: "BUSINESS",
  description: "Collected Revenue, Costs And Utilization By Vehicle",
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

/** Shown only while the Accountant Export is compiled on. Kept out of TABS so a dark build cannot list it. */
const ACCOUNTANT_EXPORT_TAB: TabDef = {
  id: "accountant_export",
  label: "Accountant Export",
  icon: FileSpreadsheet,
  minTier: "owner",
  group: "BUSINESS",
  description: "Year To Date Revenue, Refunds, Expenses And Net",
};

/** Shown only while Tax Year Export is compiled on. Kept out of TABS so a dark build cannot list it. Owners only. */
const TAX_EXPORT_TAB: TabDef = {
  id: "tax_export",
  label: "Tax Year Export",
  icon: ScrollText,
  minTier: "owner",
  group: "BUSINESS",
  description: "Calendar Year Income, Deposits, Refunds, Fees And Costs",
};

function withTaxExport<T extends TabDef>(tabs: T[], tier: StaffTier | null, href?: string): T[] {
  if (!TAX_EXPORT_ENABLED || !tierAllows(tier, "owner")) return tabs;
  const next = [...tabs];
  const accountant = next.findIndex((tab) => tab.id === "accountant_export");
  const at = accountant >= 0 ? accountant : next.findIndex((tab) => tab.id === "partners");
  const entry = href ? { ...TAX_EXPORT_TAB, href } : TAX_EXPORT_TAB;
  next.splice(at + 1, 0, entry as T);
  return next;
}

function withAccountantExport<T extends TabDef>(tabs: T[], tier: StaffTier | null, href?: string): T[] {
  if (!ACCOUNTANT_EXPORT_ENABLED || !tierAllows(tier, "owner")) return tabs;
  const next = [...tabs];
  const ownerPnl = next.findIndex((t) => t.id === "owner_pnl");
  const at = ownerPnl >= 0 ? ownerPnl : next.findIndex((t) => t.id === "partners");
  const entry = href ? { ...ACCOUNTANT_EXPORT_TAB, href } : ACCOUNTANT_EXPORT_TAB;
  next.splice(at + 1, 0, entry as T);
  return next;
}

export function visibleTabs(tier: StaffTier | null): TabDef[] {
  const tabs = TABS.filter((t) => tierAllows(tier, t.minTier));
  if (!APPLICANT_FUNNEL_ENABLED || !tierAllows(tier, "manager")) return withFinance(tabs, tier);
  return withFinance(insertFunnel(tabs), tier);
}

function insertFunnel(tabs: TabDef[]): TabDef[] {
  const next = [...tabs];
  const at = next.findIndex((tab) => tab.id === "drivers");
  next.splice(at + 1, 0, FUNNEL_TAB);
  return next;
}

function withFinance(tabs: TabDef[], tier: StaffTier | null): TabDef[] {
  let next = tabs;
  if (TODAYS_OPS_ENABLED && tierAllows(tier, "manager")) {
    next = spliceAfter(next, "overview", TODAYS_OPS_TAB);
  }
  if (FLEET_CALENDAR_ENABLED && tierAllows(tier, "manager")) {
    next = spliceAfter(next, "vehicles", FLEET_CALENDAR_TAB);
  }
  if (VEHICLE_TURNAROUND_ENABLED && tierAllows(tier, "manager")) {
    next = spliceAfter(next, "vehicles", VEHICLE_TURNAROUND_TAB);
  }
  if (RENEWALS_DUE_ENABLED && tierAllows(tier, "manager")) {
    next = spliceAfter(next, "bookings", RENEWALS_DUE_TAB);
  }
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
  if (PAYOUT_BREAKDOWN_ENABLED && tierAllows(tier, "owner")) extra.push(PAYOUT_BREAKDOWN_TAB);
  if (BILLING_HEALTH_ENABLED && tierAllows(tier, "owner")) extra.push(BILLING_HEALTH_TAB);
  if (RECEIVABLES_AGING_ENABLED && tierAllows(tier, "manager")) extra.push(AGING_TAB);
  if (DEPOSIT_LEDGER_ENABLED && tierAllows(tier, "manager")) extra.push(DEPOSIT_TAB);
  if (REVENUE_FORECAST_ENABLED && tierAllows(tier, "owner")) extra.push(REVENUE_FORECAST_TAB);
  if (RENT_RECONCILIATION_ENABLED && tierAllows(tier, "manager")) extra.push(RENT_RECONCILIATION_TAB);
  if (OWNER_FINANCE_SNAPSHOT_ENABLED && tierAllows(tier, "owner")) extra.push(OWNER_FINANCE_SNAPSHOT_TAB);
  if (STRIPE_RISK_MONITOR_ENABLED && tierAllows(tier, "manager")) extra.push(STRIPE_RISK_MONITOR_TAB);
  if (STRIPE_PAYOUT_RECON_ENABLED && tierAllows(tier, "manager")) extra.push(STRIPE_PAYOUT_RECON_TAB);
  if (!extra.length) return withFinanceDepositLedger(withRentAging(withFinanceDataQuality(withTaxExport(withAccountantExport(withExpenseEntry(withOwnerPnl(withPartnerStatement(next, tier), tier), tier), tier), tier), tier), tier), tier);
  const at = next.findIndex((t) => t.id === "expenses");
  next.splice(at + 1, 0, ...extra);
  return withFinanceDepositLedger(withRentAging(withFinanceDataQuality(withTaxExport(withAccountantExport(withExpenseEntry(withOwnerPnl(withPartnerStatement(next, tier), tier), tier), tier), tier), tier), tier), tier);
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
  if (TODAYS_OPS_ENABLED && tierAllows(tier, "manager")) {
    entries = spliceAfter(entries, "overview", { ...TODAYS_OPS_TAB, href: "todays_ops" });
  }
  if (FLEET_CALENDAR_ENABLED && tierAllows(tier, "manager")) {
    entries = spliceAfter(entries, "vehicles", { ...FLEET_CALENDAR_TAB, href: "fleet_calendar" });
  }
  if (VEHICLE_TURNAROUND_ENABLED && tierAllows(tier, "manager")) {
    entries = spliceAfter(entries, "vehicles", { ...VEHICLE_TURNAROUND_TAB, href: "vehicle_turnaround" });
  }
  if (RENEWALS_DUE_ENABLED && tierAllows(tier, "manager")) {
    entries = spliceAfter(entries, "bookings", { ...RENEWALS_DUE_TAB, href: "renewals_due" });
  }
  if (FLEET_AVAILABILITY_ENABLED && tierAllows(tier, "coordinator")) {
    entries = spliceAfter(entries, "vehicles", { ...FLEET_AVAILABILITY_TAB, href: "fleet_availability" });
  }
  if (INCIDENT_BOARD_ENABLED && tierAllows(tier, "coordinator")) {
    const at = entries.findIndex((t) => t.id === "incidents");
    const insertAt = at >= 0 ? at : entries.findIndex((t) => t.id === "maintenance");
    entries.splice(insertAt >= 0 ? insertAt : entries.length, 0, { ...INCIDENT_BOARD_TAB, href: "incident_board" });
  }
  if (APPLICANT_FUNNEL_ENABLED && tierAllows(tier, "manager")) {
    const drivers = entries.findIndex((t) => t.id === "drivers");
    entries.splice(drivers + 1, 0, { ...FUNNEL_TAB, href: "funnel" });
  }
  const extra: (TabDef & { href: string })[] = [];
  const financeHidden = !UNIFIED_FINANCE_ENDPOINT_ENABLED || !tierAllows(tier, "manager");
  if (!financeHidden) extra.push({ ...FINANCE_TAB, href: "finance" });
  if (VEHICLE_PROFITABILITY_ENABLED && tierAllows(tier, "manager")) extra.push({ ...VEHICLE_PROFIT_TAB, href: "vehicle_profit" });
  if (PAYOUT_BREAKDOWN_ENABLED && tierAllows(tier, "owner")) extra.push({ ...PAYOUT_BREAKDOWN_TAB, href: "payout_breakdown" });
  if (BILLING_HEALTH_ENABLED && tierAllows(tier, "owner")) extra.push({ ...BILLING_HEALTH_TAB, href: "billing_health" });
  if (RECEIVABLES_AGING_ENABLED && tierAllows(tier, "manager")) extra.push({ ...AGING_TAB, href: "receivables_aging" });
  if (DEPOSIT_LEDGER_ENABLED && tierAllows(tier, "manager")) extra.push({ ...DEPOSIT_TAB, href: "deposit_ledger" });
  if (REVENUE_FORECAST_ENABLED && tierAllows(tier, "owner")) extra.push({ ...REVENUE_FORECAST_TAB, href: "revenue_forecast" });
  if (RENT_RECONCILIATION_ENABLED && tierAllows(tier, "manager")) extra.push({ ...RENT_RECONCILIATION_TAB, href: "rent_reconciliation" });
  if (OWNER_FINANCE_SNAPSHOT_ENABLED && tierAllows(tier, "owner")) extra.push({ ...OWNER_FINANCE_SNAPSHOT_TAB, href: "owner_finance_snapshot" });
  if (STRIPE_RISK_MONITOR_ENABLED && tierAllows(tier, "manager")) extra.push({ ...STRIPE_RISK_MONITOR_TAB, href: "stripe_risk_monitor" });
  if (STRIPE_PAYOUT_RECON_ENABLED && tierAllows(tier, "manager")) extra.push({ ...STRIPE_PAYOUT_RECON_TAB, href: "stripe_payout_recon" });
  if (!extra.length) {
    return withFinanceDepositLedger(withRentAging(withFinanceDataQuality(withTaxExport(withAccountantExport(withExpenseEntry(withOwnerPnl(withPartnerStatement(entries, tier, "partner_statement"), tier, "owner_pnl"), tier, "expense_entry"), tier, "accountant_export"), tier, "tax_export"), tier, "finance_data_quality"), tier, "rent_aging"), tier, "finance_deposit_ledger");
  }
  const at = entries.findIndex((t) => t.id === "expenses");
  entries.splice(at + 1, 0, ...extra);
  return withFinanceDepositLedger(withRentAging(withFinanceDataQuality(withTaxExport(withAccountantExport(withExpenseEntry(withOwnerPnl(withPartnerStatement(entries, tier, "partner_statement"), tier, "owner_pnl"), tier, "expense_entry"), tier, "accountant_export"), tier, "tax_export"), tier, "finance_data_quality"), tier, "rent_aging"), tier, "finance_deposit_ledger");
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

/**
 * Where the admin shell is. An unknown tab renders Overview. A direct link to
 * a flag-gated screen falls back while that flag is off, including before the
 * role lookup returns.
 */
export function resolveAdminTab(args: {
  urlTab: string | null;
  tier: StaffTier | null;
  navTabs: readonly { id: string }[];
}): string {
  if (args.urlTab === "settings") return "settings";
  if (args.urlTab === "finance") {
    if (!UNIFIED_FINANCE_ENDPOINT_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "finance";
  }
  if (args.urlTab === "vehicle_profit") {
    if (!VEHICLE_PROFITABILITY_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "vehicle_profit";
  }
  if (args.urlTab === "incident_board") {
    if (!INCIDENT_BOARD_ENABLED || (args.tier && !tierAllows(args.tier, "coordinator"))) return "overview";
    return "incident_board";
  }
  if (args.urlTab === "fleet_availability") {
    if (!FLEET_AVAILABILITY_ENABLED || (args.tier && !tierAllows(args.tier, "coordinator"))) return "overview";
    return "fleet_availability";
  }
  if (args.urlTab === "partner_statement") {
    if (!PARTNER_STATEMENT_ENABLED || (args.tier && !tierAllows(args.tier, "owner"))) return "overview";
    return "partner_statement";
  }
  if (args.urlTab === "owner_pnl") {
    if (!OWNER_PNL_ENABLED || (args.tier && !tierAllows(args.tier, "owner"))) return "overview";
    return "owner_pnl";
  }
  if (args.urlTab === "expense_entry") {
    if (!OWNER_EXPENSE_ENTRY_ENABLED || (args.tier && !tierAllows(args.tier, "owner"))) return "overview";
    return "expense_entry";
  }
  if (args.urlTab === "accountant_export") {
    if (!ACCOUNTANT_EXPORT_ENABLED || (args.tier && !tierAllows(args.tier, "owner"))) return "overview";
    return "accountant_export";
  }
  if (args.urlTab === "payout_breakdown") {
    if (!PAYOUT_BREAKDOWN_ENABLED || (args.tier && !tierAllows(args.tier, "owner"))) return "overview";
    return "payout_breakdown";
  }
  if (args.urlTab === "billing_health") {
    if (!BILLING_HEALTH_ENABLED || (args.tier && !tierAllows(args.tier, "owner"))) return "overview";
    return "billing_health";
  }
  if (args.urlTab === "funnel") {
    if (!APPLICANT_FUNNEL_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "funnel";
  }
  if (args.urlTab === "todays_ops") {
    if (!TODAYS_OPS_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "todays_ops";
  }
  if (args.urlTab === "fleet_calendar") {
    if (!FLEET_CALENDAR_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "fleet_calendar";
  }
  if (args.urlTab === "revenue_forecast") {
    if (!REVENUE_FORECAST_ENABLED || (args.tier && !tierAllows(args.tier, "owner"))) return "overview";
    return "revenue_forecast";
  }
  if (args.urlTab === "receivables_aging") {
    if (!RECEIVABLES_AGING_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "receivables_aging";
  }
  if (args.urlTab === "deposit_ledger") {
    if (!DEPOSIT_LEDGER_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "deposit_ledger";
  }
  if (args.urlTab === "vehicle_turnaround") {
    if (!VEHICLE_TURNAROUND_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "vehicle_turnaround";
  }
  if (args.urlTab === "rent_reconciliation") {
    if (!RENT_RECONCILIATION_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "rent_reconciliation";
  }
  if (args.urlTab === "owner_finance_snapshot") {
    if (!OWNER_FINANCE_SNAPSHOT_ENABLED || (args.tier && !tierAllows(args.tier, "owner"))) return "overview";
    return "owner_finance_snapshot";
  }
  if (args.urlTab === "stripe_risk_monitor") {
    if (!STRIPE_RISK_MONITOR_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "stripe_risk_monitor";
  }
  if (args.urlTab === "renewals_due") {
    if (!RENEWALS_DUE_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "renewals_due";
  }
  if (args.urlTab === "stripe_payout_recon") {
    if (!STRIPE_PAYOUT_RECON_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "stripe_payout_recon";
  }
  if (args.urlTab === "tax_export") {
    if (!TAX_EXPORT_ENABLED || (args.tier && !tierAllows(args.tier, "owner"))) return "overview";
    return "tax_export";
  }
  if (args.urlTab === "finance_data_quality") {
    if (!FINANCE_DATA_QUALITY_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "finance_data_quality";
  }
  if (args.urlTab === "rent_aging") {
    if (!FINANCE_AR_AGING_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "rent_aging";
  }
  if (args.urlTab === "finance_deposit_ledger") {
    if (!FINANCE_DEPOSIT_LEDGER_ENABLED || (args.tier && !tierAllows(args.tier, "manager"))) return "overview";
    return "finance_deposit_ledger";
  }
  if (!args.urlTab || !TABS.some((t) => t.id === args.urlTab)) return "overview";
  if (args.tier && !args.navTabs.some((t) => t.id === args.urlTab)) return "overview";
  return args.urlTab;
}

export function visibleCreateActions(tier: StaffTier | null): CreateAction[] {
  return CREATE_ACTIONS.filter((a) => tierAllows(tier, a.minTier));
}

/** Tabs that accept `add=1` to open their creation flow. */
export const ADD_TABS = ["vehicles", "payments", "expenses"] as const;
