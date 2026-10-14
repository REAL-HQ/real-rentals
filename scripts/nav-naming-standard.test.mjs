/**
 * THE RULE THIS FILE EXISTS FOR:
 *
 *   EVERY PRIMARY SIDEBAR NAVIGATION TITLE IS ONE WORD, IN TITLE CASE.
 *   OWNER, MANAGER, COORDINATOR AND DRIVER ALIKE.
 *
 * The standard covers the primary sidebar only. Settings subsection
 * headings, form labels and descriptive page headings are deliberately NOT
 * covered — they say what a thing is, and compressing "Agreements & eSign"
 * to one word would change its meaning rather than tidy it.
 *
 * Checked here rather than agreed in a document, because a nav label is the
 * easiest thing in the codebase to add casually. The two label sets are read
 * from source, so a new tab in either file is held to the standard the day it
 * lands.
 *
 * Renaming a label is a DISPLAY change. Route ids, permissions, minTier and
 * database fields are separate values and are asserted untouched below, so
 * this standard can never quietly become a behaviour change.
 *
 * Run: node scripts/nav-naming-standard.test.mjs   (npm run test:nav-naming)
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

/** Labels from a `{ id: "x", label: "Y", ... }` list, in source order. */
function labelsOf(src, from, to) {
  const start = src.indexOf(from);
  const body = src.slice(start, to ? src.indexOf(to, start) : undefined);
  return [...body.matchAll(/\{\s*id:\s*"([a-z_]+)"\s*,\s*label:\s*"([^"]+)"/g)]
    .map((m) => ({ id: m[1], label: m[2] }));
}

const navConfig = readFileSync("src/components/admin/nav-config.ts", "utf8");
const portal = readFileSync("src/routes/portal.tsx", "utf8");

const staff = labelsOf(navConfig, "export const TABS", "export type SettingsSectionDef");
const driver = labelsOf(portal, "const TABS = [", "] as const;");

ok(staff.length >= 12, `found the staff sidebar tabs (${staff.length})`);
ok(driver.length === 10, `found the driver sidebar tabs (${driver.length})`);

// ------------------------------------------------- the standard itself
const ONE_WORD_TITLE_CASE = /^[A-Z][a-z]*$/;

console.log("\nevery staff sidebar title is one word, Title Case");
for (const { id, label } of staff)
  ok(ONE_WORD_TITLE_CASE.test(label), `${id.padEnd(14)} "${label}"`);

console.log("\nevery driver sidebar title is one word, Title Case");
for (const { id, label } of driver)
  ok(ONE_WORD_TITLE_CASE.test(label), `${id.padEnd(14)} "${label}"`);

// ------------------------------------------------- the approved labels
console.log("\nthe approved driver labels, in order");
const EXPECTED_DRIVER = [
  ["dashboard", "Dashboard"], ["vehicle", "Vehicle"], ["documents", "Documents"],
  ["pictures", "Photos"], ["payments", "Payments"], ["deposit", "Deposit"],
  ["maintenance", "Maintenance"], ["issue", "Support"], ["referrals", "Referrals"],
  ["settings", "Settings"],
];
for (const [i, [id, label]] of EXPECTED_DRIVER.entries())
  ok(driver[i]?.id === id && driver[i]?.label === label,
    `${i}: ${id} -> "${label}" (got ${driver[i]?.id} -> "${driver[i]?.label}")`);

console.log("\nthe two renamed staff labels");
for (const [id, label] of [["fleet_inbox", "Inbox"], ["shops", "Shops"]])
  ok(staff.find((t) => t.id === id)?.label === label,
    `${id} -> "${label}" (got "${staff.find((t) => t.id === id)?.label}")`);

// ------------------------------- a rename is a display change, and nothing else
console.log("\nrenaming changed the display and nothing underneath");
{
  // Route ids are what the URL and every permission check use. If one of
  // these moved, a label edit has become a routing change.
  const DRIVER_IDS = EXPECTED_DRIVER.map(([id]) => id).join(",");
  ok(driver.map((t) => t.id).join(",") === DRIVER_IDS, "driver route ids are unchanged");
  for (const id of ["overview", "drivers", "bookings", "payments", "charges", "vehicles",
                    "fleet_inbox", "maintenance", "inspections", "incidents", "expenses",
                    "vendors", "shops", "partners"])
    ok(staff.some((t) => t.id === id), `  staff route id "${id}" still exists`);

  // The legacy redirect map keys on ids too; "pictures" and "issue" keep
  // their ids even though they now read Photos and Support.
  ok(/id:\s*"pictures"/.test(portal), "the Photos tab still has the id 'pictures'");
  ok(/id:\s*"issue"/.test(portal), "the Support tab still has the id 'issue'");
  ok(/id:\s*"fleet_inbox"/.test(navConfig), "Inbox still has the id 'fleet_inbox'");

  // minTier is the permission. A label edit must not have touched one.
  ok(/\{ id: "fleet_inbox", label: "Inbox", icon: Inbox, minTier: "coordinator"/.test(navConfig),
    "Inbox keeps minTier coordinator");
  ok(/\{ id: "shops", label: "Shops", icon: Truck, minTier: "manager"/.test(navConfig),
    "Shops keeps minTier manager");
}

// ------------------------------------------- what the standard does NOT cover
console.log("\nthe standard stops at the sidebar");
{
  // Settings subsections are headings, not nav titles. Several are two words
  // and must stay that way; this asserts the standard was not over-applied.
  ok(/label: "Agreement Templates"/.test(navConfig), "Settings keeps 'Agreement Templates'");
  ok(/label: "Payment Settings"/.test(navConfig), "Settings keeps 'Payment Settings'");
  ok(/label: "Notifications & Email"/.test(navConfig), "Settings keeps 'Notifications & Email'");
  // Body copy naming the Fleet Inbox feature is prose, not a nav title.
  const vehicles = readFileSync("src/components/admin/VehiclesPanel.tsx", "utf8");
  ok(/Fleet Inbox/.test(vehicles), "feature prose still says 'Fleet Inbox' where it reads naturally");
}

console.log(fail ? `\n${fail} BLOCKER(S)` : "\nall navigation naming checks pass");
process.exit(fail ? 1 : 0);
