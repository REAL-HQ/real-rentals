/**
 * Phone layout for staff Overview and Bookings. Class checks only.
 * At lg the utilities that paint match release/rc12-driver-finance.
 * Below lg the phone utilities still apply. No database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let checks = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  checks += 1;
  console.log("PASS", label);
}

const DISPLAY = new Set(["flex", "inline-flex", "grid", "inline-grid", "hidden", "block", "contents", "inline"]);
const DIRECTION = new Set(["flex-row", "flex-col", "flex-row-reverse", "flex-col-reverse"]);
/** CSS initial values. An lg: class that only puts one of these back is not a desktop change. */
const INITIAL = new Set([
  "flex-nowrap",
  "shrink",
  "min-w-[auto]",
  "max-w-none",
  "w-auto",
  "break-normal",
  "justify-start",
  "gap-x-0",
  "gap-y-0",
  "mx-0",
  "px-0",
  "leading-normal",
  "tracking-normal",
  "overflow-visible",
]);

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
  if (name.startsWith("overflow")) return "overflow";
  if (name.startsWith("grid-cols-")) return "grid-cols";
  if (name.startsWith("min-w-")) return "min-w";
  if (name.startsWith("max-w-")) return "max-w";
  if (name.startsWith("min-h-")) return "min-h";
  if (name === "w-full" || name === "w-auto" || name.startsWith("w-[")) return "width";
  if (name === "shrink-0" || name === "shrink") return "shrink";
  if (name.startsWith("whitespace-")) return "whitespace";
  if (name === "ml-auto" || name === "ml-0") return "ml";
  if (name.startsWith("gap-x-")) return "gap-x";
  if (name.startsWith("gap-y-")) return "gap-y";
  if (name.startsWith("gap-")) return "gap";
  if (name.startsWith("px-")) return "px";
  if (name.startsWith("py-")) return "py";
  if (name.startsWith("leading-")) return "leading";
  if (name.startsWith("tracking-")) return "tracking";
  if (name === "break-words" || name === "break-normal") return "break";
  if (name === "mx-auto" || name === "mx-0" || name.startsWith("-mx-") || name.startsWith("mx-")) return "mx";
  if (/^text-\[\d/.test(name)) return "text-size";
  if (name.startsWith("rounded")) return "rounded";
  if (name.startsWith("my-")) return "my";
  return null;
}

/** Utilities that still apply at min-width 1024px. max-* variants drop out.
 * A later breakpoint wins inside one property group. flex-row is the default
 * direction of flex, so an lg:flex-row that only cancels a phone flex-col is
 * not a desktop change. The same is true of the initial values in INITIAL. */
export function resolvedAtLg(className) {
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
  for (const name of INITIAL) out.delete(name);
  return [...out].sort();
}

function sameAtLg(before, after, label) {
  const left = resolvedAtLg(before);
  const right = resolvedAtLg(after);
  assert.deepEqual(right, left, `${label}\n  rc12  ${left.join(" ")}\n  now   ${right.join(" ")}`);
  checks += 1;
  console.log("PASS", label);
}

const overview = readFileSync("src/components/admin/OverviewPanel.tsx", "utf8");
const bookings = readFileSync("src/components/admin/BookingsPanel.tsx", "utf8");
const details = readFileSync("src/components/admin/BookingDetails.tsx", "utf8");

const pairs = [
  ["space-y-6", "max-lg:min-w-0 space-y-6", "overview root at lg"],
  ["flex items-center gap-2", "flex items-center lg:gap-2 max-lg:flex-wrap max-lg:gap-x-2 max-lg:gap-y-1", "hot prospects row at lg"],
  ["w-4 h-4 text-[#D03020]", "w-4 h-4 text-[#D03020] max-lg:shrink-0", "hot prospects icon at lg"],
  [
    "grid grid-cols-[auto_1fr] gap-6 items-center",
    "grid grid-cols-1 items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-6 lg:grid-cols-[auto_1fr]",
    "fleet chart grid at lg",
  ],
  ["text-[#111114] flex-1", "min-w-0 flex-1 text-[#111114] lg:min-w-[auto]", "fleet legend label at lg"],
  ["tabular-nums font-medium text-[#111114]", "shrink-0 tabular-nums font-medium text-[#111114] lg:shrink", "fleet legend value at lg"],
  ["tabular-nums text-[11px] text-[#9A9AA3] w-9 text-right", "w-9 shrink-0 text-right text-[11px] tabular-nums text-[#9A9AA3] lg:shrink", "fleet legend percent at lg"],
  [
    "flex items-baseline justify-between mb-1",
    "mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 lg:flex-nowrap lg:gap-x-0 lg:gap-y-0",
    "utilization row at lg",
  ],
  ["", "min-w-0 lg:min-w-[auto]", "utilization label at lg"],
  ["text-[11px] text-[#9A9AA3] tabular-nums", "shrink-0 text-[11px] text-[#9A9AA3] tabular-nums lg:shrink", "utilization count at lg"],
  [
    "flex items-center gap-3 px-5 py-3 border-b border-[#F4F4F6] last:border-0 hover:bg-[#FAFAFB] transition-colors",
    "flex flex-wrap items-center max-lg:gap-x-3 max-lg:gap-y-2 border-b border-[#F4F4F6] px-4 py-3 last:border-0 transition-colors hover:bg-[#FAFAFB] sm:px-5 lg:flex-nowrap lg:gap-3",
    "application row at lg",
  ],
  [
    "w-9 h-9 rounded-full bg-gradient-to-br from-[#F4F4F6] to-[#EDEDF0] grid place-items-center text-[12px] font-semibold text-[#55555E] shrink-0",
    "w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-[#F4F4F6] to-[#EDEDF0] grid place-items-center text-[12px] font-semibold text-[#55555E]",
    "application avatar at lg",
  ],
  ["min-w-0 flex-1", "min-w-0 flex-1", "application name block at lg"],
  [
    "text-[13px] font-medium text-[#111114] truncate flex items-center gap-1.5",
    "flex items-center gap-1.5 truncate text-[13px] font-medium text-[#111114]",
    "application name line at lg",
  ],
  ["h-1.5 w-1.5 rounded-full bg-[#D03020] shrink-0", "h-1.5 w-1.5 shrink-0 rounded-full bg-[#D03020]", "unread dot at lg"],
  ["text-[11px] text-[#9A9AA3] mt-0.5 truncate", "mt-0.5 truncate text-[11px] text-[#9A9AA3]", "application time at lg"],
  [
    "flex items-baseline gap-3",
    "flex max-w-[11rem] flex-wrap justify-end max-lg:gap-x-3 max-lg:gap-y-0.5 sm:max-w-none lg:max-w-none lg:flex-nowrap lg:items-baseline lg:justify-start lg:gap-3",
    "billed figures at lg",
  ],
  [
    "rounded-xl border border-[#EDEDF0] bg-white px-3 py-2.5",
    "min-w-0 rounded-xl border border-[#EDEDF0] bg-white px-2 py-2.5 sm:px-3 lg:min-w-[auto] lg:px-3",
    "overview stat card at lg",
  ],
  [
    "text-[10px] uppercase tracking-[0.12em] font-semibold text-[#9A9AA3]",
    "text-[9px] font-semibold uppercase leading-tight tracking-normal text-[#9A9AA3] sm:text-[10px] sm:tracking-[0.12em] lg:text-[10px] lg:leading-normal lg:tracking-[0.12em]",
    "overview stat label at lg",
  ],
  [
    "mt-1 text-[18px] font-semibold tabular-nums leading-none",
    "mt-1 break-words text-[16px] font-semibold tabular-nums leading-tight sm:text-[18px] lg:break-normal lg:text-[18px] lg:leading-none",
    "overview stat value at lg",
  ],
  ["relative shrink-0", "relative mx-auto shrink-0 sm:mx-0", "fleet donut at lg"],
  [
    "admin-sticky-bar flex flex-col lg:flex-row lg:items-center gap-3 mb-4 pb-2",
    "admin-sticky-bar mb-4 flex flex-col gap-2 pb-2 lg:flex-row lg:items-center lg:gap-3",
    "bookings toolbar at lg",
  ],
  [
    "flex-1 flex flex-wrap items-center gap-2",
    "flex max-lg:w-full max-lg:min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2",
    "bookings filter group at lg",
  ],
  [
    "flex-1 min-w-[200px] border border-border rounded-md px-3 py-2 text-sm bg-white",
    "w-full min-w-0 rounded-md border border-border bg-white px-3 py-2 text-sm lg:w-auto lg:min-w-[200px] lg:flex-1",
    "bookings search at lg",
  ],
  ["inline-flex items-center gap-2", "inline-flex max-lg:shrink-0 items-center gap-2", "phase chips at lg"],
  ["h-9 w-[150px] bg-white text-foreground text-sm", "h-9 w-[150px] max-lg:shrink-0 bg-white text-foreground text-sm", "bookings sort at lg"],
  [
    "text-sm text-muted-foreground hover:text-foreground px-2",
    "max-lg:shrink-0 max-lg:whitespace-nowrap px-2 text-sm text-muted-foreground hover:text-foreground",
    "clear filters at lg",
  ],
  [
    "mt-4 flex items-center justify-between text-sm text-muted-foreground",
    "mt-4 flex items-center justify-between text-sm text-muted-foreground max-lg:flex-wrap max-lg:gap-x-3 max-lg:gap-y-2",
    "bookings pager at lg",
  ],
  [
    "bg-[#FAFAFB] w-full max-w-5xl rounded-none sm:rounded-2xl min-h-full sm:min-h-0 sm:my-2 overflow-hidden shadow-2xl",
    "min-w-0 w-full max-w-5xl overflow-hidden rounded-none bg-[#FAFAFB] shadow-2xl sm:my-2 sm:min-h-0 sm:rounded-2xl min-h-full lg:min-w-[auto]",
    "booking drawer at lg",
  ],
  [
    "text-[17px] font-semibold text-[#111114] truncate",
    "min-w-0 max-w-full truncate text-[17px] font-semibold text-[#111114] lg:min-w-[auto] lg:max-w-none",
    "booking title at lg",
  ],
  ["text-[13px] text-[#55555E] mt-1", "mt-1 break-words text-[13px] text-[#55555E] lg:break-normal", "booking subtitle at lg"],
  ["", "-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0 lg:overflow-visible", "booking payments scroller at lg"],
  ["w-full text-[12px]", "w-full min-w-[36rem] text-[12px] lg:min-w-[auto]", "booking payments table at lg"],
];

for (const [before, after, label] of pairs) {
  sameAtLg(before, after, label);
  if (after.length > 0) {
    const haystack = overview + "\n" + bookings + "\n" + details;
    check(haystack.includes(after), `${label} is in the source`);
  }
}

const contents = [
  "flex min-w-0 items-center gap-2 overflow-x-auto pb-1 lg:contents",
  "flex w-full min-w-0 items-center gap-3 sm:w-auto sm:flex-1 lg:contents",
  "flex flex-wrap items-center gap-1.5 pl-12 sm:pl-0 lg:contents",
];
for (const cls of contents) {
  check((overview + bookings).includes(cls), `wrapper is present: ${cls.slice(0, 48)}`);
  check(resolvedAtLg(cls).includes("contents"), "wrapper is display contents at lg, so it adds no box");
}

check(overview.includes('className="max-lg:min-w-0 space-y-6"'), "the overview root can shrink inside the admin column");
check(overview.includes("grid-cols-1 items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)]"), "the fleet chart stacks under the donut on a phone");
check(overview.includes("getOverviewApplicants"), "overview still reads applicants through the server function");
check(!overview.includes("text-transform"), "overview does not add a text-transform");
check(bookings.includes('aria-label="Search bookings"'), "the bookings search stays");
check(bookings.includes("max-lg:w-full") && !bookings.includes("flex w-full max-lg:min-w-0"), "the bookings filter group is full width only below lg");
check(bookings.includes("lg:flex-row lg:items-center lg:gap-3"), "the bookings toolbar stacks only below lg");
check(bookings.includes('data-testid="booking-phases"'), "the phase chips stay");
check(bookings.includes("hidden md:block") && bookings.includes("md:hidden grid grid-cols-1"), "the table and the phone cards both remain");
const cards = bookings.slice(bookings.indexOf("md:hidden grid grid-cols-1"), bookings.indexOf("data-booking-card") + 400);
check(cards.includes('className="shrink-0"') || bookings.includes('StatusPill className="shrink-0"'), "a phone card keeps the status from shrinking");
check(bookings.includes("max-lg:flex-wrap max-lg:gap-x-3 max-lg:gap-y-2"), "the page controls wrap under the count");
check(bookings.includes("listBookings"), "bookings still loads through the list function");

const payments = details.slice(details.indexOf('title="Payments"'), details.indexOf("</table>") + 8);
check(payments.includes("overflow-x-auto") && payments.includes("min-w-[36rem]") && payments.includes('data-testid="booking-payments"'), "the payments table scrolls inside the booking");
check(details.includes("min-w-0 w-full max-w-5xl"), "the booking drawer cannot grow past the screen");

console.log(`${checks} overview and bookings mobile checks passed`);
