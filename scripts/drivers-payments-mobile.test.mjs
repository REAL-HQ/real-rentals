/**
 * Phone layout for staff Drivers and Payments. Class checks only.
 * Below lg the Payments toolbar stacks and the wide Payments table scrolls
 * inside the card. Drivers chips wrap at every width and the Drivers table
 * is table-fixed with no min-width side scroll (PR 347).
 * At lg the remaining utilities that paint are the ones the screens already
 * had on rental-ops 3e6b3494, except the Drivers list layout above.
 * Rental-ops sections stay mounted.
 * No database and no change to the data those screens read.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let checks = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  checks += 1;
  console.log("PASS", label);
}

const drivers = readFileSync("src/components/admin/DriversPanel.tsx", "utf8");
const payments = readFileSync("src/components/admin/PaymentsPanel.tsx", "utf8");

const DISPLAY = new Set(["flex", "inline-flex", "grid", "inline-grid", "hidden", "block", "contents", "inline"]);
const DIRECTION = new Set(["flex-row", "flex-col", "flex-row-reverse", "flex-col-reverse"]);

function specificity(token) {
  if (token.startsWith("lg:")) return 3;
  if (token.startsWith("md:")) return 2;
  if (token.startsWith("sm:")) return 1;
  return 0;
}

function bare(token) {
  return token.replace(/^(sm:|md:|lg:)/, "");
}

function groupOf(name) {
  if (DIRECTION.has(name)) return "direction";
  if (DISPLAY.has(name)) return "display";
  if (name === "flex-wrap" || name === "flex-nowrap") return "wrap";
  if (name.startsWith("items-")) return "items";
  if (name.startsWith("justify-")) return "justify";
  if (name === "overflow-x-auto" || name === "overflow-x-clip" || name === "overflow-visible" || name === "overflow-auto" || name === "overflow-hidden") return "overflow";
  if (name.startsWith("grid-cols-")) return "grid-cols";
  if (name === "w-full" || name === "w-40" || name === "w-auto" || name.startsWith("w-[")) return "width";
  if (name.startsWith("max-w-")) return "max-w";
  if (name.startsWith("min-w-")) return "min-w";
  if (name === "shrink-0" || name === "shrink") return "shrink";
  if (name.startsWith("whitespace-")) return "whitespace";
  if (name === "ml-auto" || name === "ml-0") return "ml";
  if (name.startsWith("gap-x-")) return "gap-x";
  if (name.startsWith("gap-y-")) return "gap-y";
  if (name.startsWith("gap-")) return "gap";
  return null;
}

/** Utilities that still apply at min-width 1024px. max-lg/max-md/max-sm drop out.
 * A later breakpoint wins inside one property group. flex-row is the default
 * direction of flex, so an lg:flex-row that only cancels a phone flex-col is
 * not a desktop change. */
function resolvedAtLg(className) {
  const tokens = className.split(/\s+/).filter(Boolean).filter((token) => !/^max-(sm|md|lg):/.test(token));
  const winners = new Map();
  const free = [];
  for (const token of tokens) {
    const name = bare(token);
    const spec = specificity(token);
    const group = groupOf(name);
    if (!group) {
      free.push(name);
      continue;
    }
    const prev = winners.get(group);
    if (!prev || spec >= prev.spec) winners.set(group, { spec, name });
  }
  const out = new Set(free);
  for (const { name } of winners.values()) out.add(name);
  if (out.has("flex-row") && !out.has("flex-col") && (out.has("flex") || out.has("inline-flex"))) out.delete("flex-row");
  return [...out].sort();
}

function sameAtLg(before, after, label) {
  const left = resolvedAtLg(before);
  const right = resolvedAtLg(after);
  assert.deepEqual(right, left, `${label}\n  before ${left.join(" ")}\n  after  ${right.join(" ")}`);
  checks += 1;
  console.log("PASS", label);
}

const pairs = [
  [
    "admin-sticky-bar mb-4 flex flex-col gap-2 text-xs",
    "admin-sticky-bar mb-4 flex flex-col gap-2 text-xs",
    "drivers filter bar at lg",
  ],
  [
    "ml-auto",
    "ml-auto",
    "drivers merge slot at lg",
  ],
  [
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-border hover:bg-soft disabled:opacity-50",
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-border hover:bg-soft disabled:opacity-50",
    "drivers merge button at lg",
  ],
  [
    "rounded-lg border border-border bg-white",
    "max-lg:min-w-0 rounded-lg border border-border bg-white",
    "drivers table scroller at lg",
  ],
  [
    "w-full table-fixed text-sm",
    "w-full table-fixed text-sm",
    "drivers table min width at lg",
  ],
  [
    "inline-flex items-center gap-1.5 max-w-[105px]",
    "inline-flex items-center gap-1.5 max-w-[105px] max-lg:max-w-[12rem]",
    "drivers name width at lg",
  ],
  [
    "-m-4 md:-mx-8 md:-mt-4 md:-mb-8 min-h-full bg-[#FAFAFB] overflow-x-clip",
    "-m-4 md:-mx-8 md:-mt-4 md:-mb-8 min-h-full bg-[#FAFAFB] overflow-x-clip max-lg:min-w-0",
    "driver record root at lg",
  ],
  [
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex",
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex max-lg:flex-wrap",
    "driver identity row at lg",
  ],
  [
    "mt-1 hidden sm:flex items-center gap-3 flex-wrap text-[12px] text-[#55555E]",
    "mt-1 flex flex-wrap items-center gap-3 text-[12px] text-[#55555E]",
    "driver contact line at lg",
  ],
  [
    "inline-flex items-center gap-1 truncate max-w-[240px]",
    "inline-flex items-center gap-1 truncate max-w-[240px] max-lg:max-w-full max-lg:min-w-0",
    "driver header email at lg",
  ],
  [
    "ml-auto rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium",
    "ml-auto rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium max-lg:ml-0 max-lg:flex-1",
    "manual payments button at lg",
  ],
  [
    "rounded-md bg-[#D03020] text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity duration-150",
    "rounded-md bg-[#D03020] text-white px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity duration-150 max-lg:flex-1",
    "add payment button at lg",
  ],
  [
    "rounded-2xl border border-[#EDEDF0] bg-white shadow-sm",
    "max-lg:min-w-0 rounded-2xl border border-[#EDEDF0] bg-white shadow-sm",
    "payments table scroller at lg",
  ],
  [
    "w-full text-sm",
    "w-full text-sm max-lg:min-w-[52rem]",
    "payments table min width at lg",
  ],
  [
    "px-3 text-[13px] font-medium text-[#111114]",
    "px-3 text-[13px] font-medium text-[#111114] max-lg:whitespace-nowrap",
    "payments driver cell at lg",
  ],
  [
    "px-3 text-xs text-[#55555E]",
    "px-3 text-xs text-[#55555E] max-lg:whitespace-nowrap",
    "payments vehicle cell at lg",
  ],
  [
    "grid grid-cols-2 gap-2",
    "grid grid-cols-1 gap-2 lg:grid-cols-2",
    "add payment fields at lg",
  ],
];

for (const [before, after, label] of pairs) sameAtLg(before, after, label);

const present = [
  [drivers, "max-lg:min-w-0", "drivers list can shrink inside the admin column"],
  [drivers, "admin-sticky-bar mb-4 flex flex-col gap-2 text-xs", "drivers filters stack; chips wrap at every width"],
  [drivers, "flex min-w-0 flex-wrap items-center gap-2", "drivers chips wrap without a horizontal scroller"],
  [drivers, "data-contact-filter", "the contact status filter stays"],
  [drivers, "Merge Duplicates", "merge duplicates stays"],
  [drivers, "w-full table-fixed text-sm", "the drivers table is fixed-width with no min-width scroll"],
  [drivers, "mt-1 flex flex-wrap items-center gap-3 text-[12px] text-[#55555E]", "driver phone and email stay on the record header"],
  [payments, "admin-sticky-bar mb-4 grid grid-cols-1 gap-2 pb-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center", "payments controls stack only below lg"],
  [payments, "flex shrink-0 items-center gap-2 max-lg:w-full", "payment actions share a row on a phone and rejoin the bar at lg"],
  [payments, "Manual Payments", "manual payments stays"],
  [payments, "+ Add Payment", "add payment stays"],
  [payments, '.from("payments")', "payments still reads the payments table"],
  [payments, "max-lg:min-w-[52rem]", "the payments table keeps a phone min width"],
  [payments, "grid grid-cols-1 gap-2 lg:grid-cols-2", "add payment fields stack only below lg"],
];
for (const [src, needle, label] of present) check(src.includes(needle), label);

check(!drivers.includes("admin-sticky-bar flex gap-2 mb-4 text-xs overflow-x-auto"), "the old drivers bar class is gone");
check(!drivers.includes("lg:overflow-x-auto lg:-mx-1"), "the drivers chip scroller is gone");
check(!drivers.includes("max-lg:min-w-[56rem]"), "the drivers table has no phone min-width scroll");
check(!payments.includes("admin-sticky-bar flex flex-wrap items-center gap-2 mb-4 pb-2"), "the old payments bar class is gone");
check(!drivers.includes("text-transform") && !payments.includes("text-transform"), "neither screen adds a text-transform");
check(!drivers.includes("max-lg:uppercase") && !payments.includes("max-lg:uppercase") && !drivers.includes("max-lg:capitalize") && !payments.includes("max-lg:capitalize"), "phone classes do not add a case transform");

check(payments.includes("flex shrink-0 items-center gap-2 max-lg:w-full"), "payment phone actions keep one compact wrapper");

const mounts = [
  ["<OnboardingChecklist", "onboarding checklist stays mounted"],
  ["<ApplicationDocGaps", "application document gaps stay mounted"],
  ["<DocumentsExpiringList", "documents expiring stays mounted"],
  ["<ApprovedNotRentingList", "approved not renting stays mounted"],
  ["<StalledApplications", "stalled applications stay mounted"],
  ["<DriverDocExpiryNotice", "driver document expiry notice stays mounted"],
  ["<DriverDocExpiryFilter", "driver document expiry filter stays mounted"],
  ["<DocumentReviewAging", "document review aging stays mounted"],
  ["<ApplicationQuickReview", "application quick review stays mounted"],
  ["<DriverStatement", "driver statement stays mounted"],
  ["<WaitlistPanel", "waitlist stays mounted"],
  ["data-stalled-filter", "the stalled filter stays"],
  ["data-documents-expiring-filter", "the documents expiring filter stays"],
  ["data-approved-not-renting-filter", "the approved not renting filter stays"],
  ["ONBOARDING_CHECKLIST_ENABLED === true", "onboarding renders only when its flag is true"],
  ["DRIVER_DOC_EXPIRY_ENABLED === true", "document expiry renders only when its flag is true"],
  ["APPLICATION_DOC_GAPS_ENABLED === true", "document gaps render only when its flag is true"],
  ["DOCUMENT_REVIEW_AGING_ENABLED === true", "review aging renders only when its flag is true"],
  ["APPLICATION_QUICK_REVIEW_ENABLED", "quick review still reads its flag"],
  ["STALLED_APPLICATIONS_ENABLED === true", "stalled applications render only when the flag is true"],
];
for (const [needle, label] of mounts) check(drivers.includes(needle), label);
check(payments.includes("COLLECTIONS_WATCH_STATUSES"), "payments still uses the collections watch statuses");

const flags = [
  ["src/lib/onboarding-checklist.ts", "ONBOARDING_CHECKLIST_ENABLED: boolean = false"],
  ["src/lib/driver-doc-expiry-column.ts", "DRIVER_DOC_EXPIRY_ENABLED: boolean = false"],
  ["src/lib/application-doc-gaps.ts", "APPLICATION_DOC_GAPS_ENABLED: boolean = false"],
  ["src/lib/stalled-applications.ts", "STALLED_APPLICATIONS_ENABLED: boolean = false"],
  ["src/lib/document-review-aging.ts", "DOCUMENT_REVIEW_AGING_ENABLED: boolean = false"],
  ["src/lib/application-quick-review.ts", "APPLICATION_QUICK_REVIEW_ENABLED: boolean = false"],
  ["src/lib/document-expiry-flag.ts", "DOCUMENT_EXPIRY_NOTICES_ENABLED = false"],
];
for (const [file, needle] of flags) {
  check(readFileSync(file, "utf8").includes(needle), `${needle.split(" ")[0]} stays false`);
}

console.log(`${checks} drivers and payments mobile checks passed`);
