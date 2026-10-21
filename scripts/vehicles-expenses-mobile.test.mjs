/**
 * Phone layout for staff Vehicles and Expenses. Class checks only.
 * Below lg the toolbars stack and the wide tables scroll inside the card.
 * At lg the utilities that paint are the ones the screens already had
 * on 7e3e6eb. No database and no change to the data those screens read.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let checks = 0;
function check(cond, label) {
  assert.equal(cond, true, label);
  checks += 1;
  console.log("PASS", label);
}

const vehicles = readFileSync("src/components/admin/VehiclesPanel.tsx", "utf8");
const expenses = readFileSync("src/components/admin/ExpensesPanel.tsx", "utf8");

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
 * not a desktop change. Same resolver as the Drivers and Payments layout test. */
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
    "admin-sticky-bar flex flex-col lg:flex-row lg:items-center gap-3 mb-4 pb-2",
    "admin-sticky-bar flex flex-col lg:flex-row lg:items-center gap-3 mb-4 pb-2 max-lg:min-w-0",
    "vehicles filter bar at lg",
  ],
  [
    "flex-1 flex flex-wrap gap-2",
    "flex-1 flex gap-2 max-lg:min-w-0 max-lg:flex-col lg:flex-wrap",
    "vehicles filter cluster at lg",
  ],
  [
    "flex-1 min-w-[200px] border border-border rounded-md px-3 py-2 text-sm bg-white",
    "flex-1 min-w-[200px] border border-border rounded-md px-3 py-2 text-sm bg-white max-lg:w-full max-lg:min-w-0",
    "vehicles search at lg",
  ],
  [
    "h-9 w-[140px] bg-white text-foreground text-sm",
    "h-9 w-[140px] bg-white text-foreground text-sm max-lg:w-full",
    "vehicles status and body selects at lg",
  ],
  [
    "h-9 w-[160px] bg-white text-foreground text-sm",
    "h-9 w-[160px] bg-white text-foreground text-sm max-lg:w-full",
    "vehicles partner select at lg",
  ],
  [
    "h-9 w-[150px] bg-white text-foreground text-sm",
    "h-9 w-[150px] bg-white text-foreground text-sm max-lg:w-full",
    "vehicles sort select at lg",
  ],
  [
    "inline-flex items-center gap-2",
    "inline-flex items-center gap-2 max-lg:max-w-full max-lg:flex-wrap",
    "vehicles readiness chips at lg",
  ],
  [
    "flex items-center gap-2 self-start lg:self-auto",
    "flex items-center gap-2 self-start lg:self-auto max-lg:w-full max-lg:flex-wrap",
    "vehicles action row at lg",
  ],
  [
    "hidden md:inline-flex rounded-md border border-[#EDEDF0] bg-white p-0.5",
    "hidden md:inline-flex rounded-md border border-[#EDEDF0] bg-white p-0.5 max-lg:w-full max-lg:justify-center",
    "vehicles view toggle at lg",
  ],
  [
    "inline-flex items-center gap-2 rounded-md border border-[#EDEDF0] bg-white px-4 py-2 text-sm font-medium hover:bg-[#FAFAFB]",
    "inline-flex items-center gap-2 rounded-md border border-[#EDEDF0] bg-white px-4 py-2 text-sm font-medium hover:bg-[#FAFAFB] max-lg:w-full max-lg:justify-center",
    "vehicles import button at lg",
  ],
  [
    "inline-flex items-center gap-2 rounded-md bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150",
    "inline-flex items-center gap-2 rounded-md bg-[#D03020] text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity duration-150 max-lg:w-full max-lg:justify-center",
    "vehicles add button at lg",
  ],
  [
    "hidden md:block mt-4 rounded-xl border border-border bg-white overflow-hidden",
    "hidden md:block mt-4 max-lg:min-w-0 max-lg:overflow-x-auto rounded-xl border border-border bg-white lg:overflow-hidden",
    "vehicles table scroller at lg",
  ],
  [
    "w-full text-sm",
    "w-full text-sm max-lg:min-w-[64rem]",
    "vehicles table min width at lg",
  ],
  [
    "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
    "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-lg:min-w-0",
    "vehicles card grid at lg",
  ],
  [
    "rounded-2xl bg-soft overflow-hidden cursor-pointer transition-shadow hover:shadow-md",
    "rounded-2xl bg-soft overflow-hidden cursor-pointer transition-shadow hover:shadow-md max-lg:min-w-0",
    "vehicles card at lg",
  ],
  [
    "mt-3 flex gap-2",
    "mt-3 flex gap-2 max-lg:flex-wrap",
    "vehicles card actions at lg",
  ],
  [
    "mt-4 flex items-center justify-between text-sm text-muted-foreground",
    "mt-4 flex items-center justify-between text-sm text-muted-foreground max-lg:flex-wrap max-lg:gap-y-2",
    "vehicles pager at lg",
  ],
  [
    "space-y-5",
    "space-y-5 max-lg:min-w-0",
    "expenses root at lg",
  ],
  [
    "flex items-start justify-between gap-3 flex-wrap",
    "flex items-start justify-between gap-3 flex-wrap max-lg:flex-col",
    "expenses header at lg",
  ],
  [
    "flex items-center gap-2",
    "flex items-center gap-2 max-lg:w-full max-lg:flex-wrap",
    "expenses period controls at lg",
  ],
  [
    "rounded-lg border border-border bg-white px-3 py-2 text-sm",
    "rounded-lg border border-border bg-white px-3 py-2 text-sm max-lg:w-full max-lg:min-w-0",
    "expenses selects at lg",
  ],
  [
    "inline-flex rounded-lg border border-border overflow-hidden",
    "inline-flex rounded-lg border border-border overflow-hidden max-lg:shrink-0",
    "expenses view toggle at lg",
  ],
  [
    "space-y-4",
    "space-y-4 max-lg:min-w-0",
    "expenses sections at lg",
  ],
  [
    "grid gap-3 sm:grid-cols-3",
    "grid gap-3 grid-cols-1 lg:grid-cols-3",
    "expenses stat grid at lg",
  ],
  [
    "rounded-xl border p-4",
    "rounded-xl border p-4 max-lg:min-w-0",
    "expenses stat card at lg",
  ],
  [
    "mt-1 text-2xl font-semibold tabular-nums",
    "mt-1 text-2xl font-semibold tabular-nums max-lg:break-words",
    "expenses stat value at lg",
  ],
  [
    "rounded-xl border border-border",
    "max-lg:min-w-0 rounded-xl border border-border",
    "expenses table scroller at lg",
  ],
  [
    "w-full text-sm",
    "w-full text-sm max-lg:min-w-[48rem]",
    "expenses p and l table min width at lg",
  ],
  [
    "w-full text-sm",
    "w-full text-sm max-lg:min-w-[56rem]",
    "expenses ledger table min width at lg",
  ],
  [
    "px-4 py-3",
    "px-4 py-3 max-lg:whitespace-nowrap",
    "expenses vehicle cell at lg",
  ],
  [
    "flex items-center gap-2 flex-wrap",
    "flex items-center gap-2 flex-wrap max-lg:flex-col max-lg:items-stretch",
    "expenses ledger filters at lg",
  ],
  [
    "ml-auto inline-flex items-center gap-2 rounded-lg bg-real-red text-white px-4 py-2 text-sm font-medium disabled:opacity-50",
    "ml-auto inline-flex items-center gap-2 rounded-lg bg-real-red text-white px-4 py-2 text-sm font-medium disabled:opacity-50 max-lg:ml-0 max-lg:w-full max-lg:justify-center",
    "record expense button at lg",
  ],
  [
    "px-4 py-3 capitalize",
    "px-4 py-3 capitalize max-lg:whitespace-nowrap",
    "expenses category cell at lg",
  ],
  [
    "bg-white rounded-xl p-6 max-w-lg w-full space-y-3 my-8",
    "bg-white rounded-xl p-6 max-w-lg w-full space-y-3 my-8 max-lg:min-w-0",
    "expense form at lg",
  ],
  [
    "grid grid-cols-2 gap-3",
    "grid grid-cols-1 gap-3 lg:grid-cols-2 max-lg:min-w-0",
    "expense form fields at lg",
  ],
  [
    "col-span-2",
    "lg:col-span-2 max-lg:min-w-0",
    "expense full-width field at lg",
  ],
  [
    "",
    "max-lg:min-w-0",
    "expense field and vehicles root at lg",
  ],
  [
    "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm",
    "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm max-lg:min-w-0",
    "expense form selects at lg",
  ],
  [
    "w-full rounded-lg border border-border px-3 py-2 text-sm",
    "w-full rounded-lg border border-border px-3 py-2 text-sm max-lg:min-w-0",
    "expense form inputs at lg",
  ],
];

for (const [before, after, label] of pairs) {
  sameAtLg(before, after, label);
  if (after) check((vehicles + "\n" + expenses).includes(after), `${label} is in the source`);
}

const present = [
  [vehicles, 'className="max-lg:min-w-0"', "the vehicles screen can shrink inside the admin column"],
  [vehicles, "flex-1 flex gap-2 max-lg:min-w-0 max-lg:flex-col lg:flex-wrap", "vehicle filters stack only below lg"],
  [vehicles, "max-lg:min-w-[64rem]", "the vehicles table keeps a phone min width"],
  [vehicles, "lg:overflow-hidden", "the vehicles table clips only from lg up"],
  [vehicles, "data-testid=\"fleet-readiness\"", "fleet readiness stays in the filter row"],
  [vehicles, "Import / Fleet Inbox", "import stays"],
  [vehicles, "Add Vehicle", "add vehicle stays"],
  [vehicles, "listVehicles", "vehicles still loads through listVehicles"],
  [expenses, "space-y-5 max-lg:min-w-0", "expenses can shrink inside the admin column"],
  [expenses, "grid gap-3 grid-cols-1 lg:grid-cols-3", "profit stats stack only below lg"],
  [expenses, "max-lg:min-w-[48rem]", "the profit table keeps a phone min width"],
  [expenses, "max-lg:min-w-[56rem]", "the ledger table keeps a phone min width"],
  [expenses, "grid grid-cols-1 gap-3 lg:grid-cols-2 max-lg:min-w-0", "expense fields stack only below lg"],
  [expenses, "Record Expense", "record expense stays"],
  [expenses, "getVehiclePL", "the profit view still loads through getVehiclePL"],
  [expenses, "listExpenses", "the ledger still loads through listExpenses"],
  [expenses, "P&L", "the profit view stays"],
  [expenses, "Ledger", "the ledger view stays"],
];
for (const [src, needle, label] of present) check(src.includes(needle), label);

check(!vehicles.includes("flex-1 flex flex-wrap gap-2"), "the vehicle filter cluster is no longer an unprefixed flex-wrap child");
check(!vehicles.includes("bg-white overflow-hidden"), "the vehicles table no longer clips on a phone");
check(!expenses.includes("grid grid-cols-2 gap-3"), "expense fields are not two columns below lg");
check(!expenses.includes('"col-span-2"'), "a full expense field does not span two columns below lg");
check(!vehicles.includes("text-transform") && !expenses.includes("text-transform"), "neither screen adds a text-transform");
check(expenses.includes("px-4 py-3 capitalize max-lg:whitespace-nowrap"), "the existing capitalize on a category stays");
check(!vehicles.includes("max-lg:uppercase") && !expenses.includes("max-lg:uppercase") && !vehicles.includes("max-lg:capitalize") && !expenses.includes("max-lg:capitalize"), "phone classes do not add a case transform");

const filterCluster = "flex-1 flex gap-2 max-lg:min-w-0 max-lg:flex-col lg:flex-wrap";
check(!filterCluster.split(/\s+/).includes("flex-wrap"), "phone css nowrap rule does not match the vehicle filter cluster");

console.log(`${checks} vehicles and expenses mobile checks passed`);
