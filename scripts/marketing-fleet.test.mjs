/**
 * The marketing catalog and live inventory must stay two different things.
 *
 * The homepage used to render whatever `vehicles_public` returned for
 * `status = 'available'`. With the operational table empty that is an empty
 * grid, so every paid click landed on nothing. The fix was a static catalog
 * of vehicle TYPES — which creates a new risk the moment it exists: a
 * merchandising entry that drifts into looking like a real, VIN-level unit.
 *
 * These assertions hold that line. They read the shipped source, not a
 * transcription of it.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let fail = 0;
const ok = (cond, label) => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${label}`);
};
const read = (p) => readFileSync(p, "utf8");

const CATALOG = "src/lib/marketing-fleet.ts";
const ADAPTER = "src/lib/public-vehicle-card.ts";
const CARD = "src/components/site/VehicleCard.tsx";
const HOME = "src/routes/index.tsx";
const FLEET = "src/routes/fleet.index.tsx";
const DETAIL = "src/routes/fleet.$id.tsx";
const APPLY = "src/routes/apply.tsx";

const catalog = read(CATALOG);
const entriesOrEmpty = () =>
  catalog.slice(
    catalog.indexOf("export const MARKETING_FLEET"),
    catalog.indexOf("export function marketingFleetByCategory"),
  );
const adapter = read(ADAPTER);
const card = read(CARD);
const home = read(HOME);
const fleet = read(FLEET);
const detail = read(DETAIL);
const apply = read(APPLY);

/* ---------------------------------------------------------------- shape -- */
console.log("\ncatalog shape");

const slugs = [...catalog.matchAll(/^\s*slug: "([^"]+)",$/gm)].map((m) => m[1]);
const cats = [...catalog.matchAll(/^\s*category: "([^"]+)",$/gm)].map((m) => m[1]);
ok(slugs.length === 3, `catalog has 3 entries (got ${slugs.length})`);
ok(new Set(slugs).size === slugs.length, "every slug is unique");
for (const c of ["sedan", "suv", "xl"]) {
  const n = cats.filter((x) => x === c).length;
  ok(n === 1, `${c}: 1 entry (got ${n})`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
ok(
  slugs.every((s) => !UUID.test(s)),
  "no catalog slug is a UUID — it can never be mistaken for a vehicles.id",
);
ok(
  slugs.every((s) => /^[a-z0-9-]+$/.test(s)),
  "every slug is a plain lowercase slug",
);

/* ------------------------------------------------------------ imagery --- */
console.log("\nimagery");

const imageImports = [...catalog.matchAll(/from "@\/assets\/(cars\/[^"]+)"/g)].map((m) => m[1]);
ok(imageImports.length === 3, `3 images imported (got ${imageImports.length})`);
for (const rel of imageImports) {
  ok(existsSync(join("src/assets", rel)), `${rel} exists in the repo`);
}
ok(
  new Set(imageImports).size === imageImports.length,
  "no image is reused across two catalog entries",
);
ok(
  !/placeholder|data:image|unsplash|picsum/i.test(catalog),
  "no placeholder, data-URI, or stock-photo URL — approved repo imagery only",
);

/* ------------------------------------------- never names a make or model -- */
console.log("\nthe catalog advertises types, not specific vehicles");

ok(
  !/Toyota|Honda|Nissan|Hyundai|Kia|Ford|Chevrolet|Corolla|Civic|Accord|Camry|CR-V|RAV4|Odyssey|Sienna/i.test(
    catalog.slice(catalog.indexOf("export const MARKETING_FLEET"), catalog.indexOf("export function marketingFleetByCategory")),
  ),
  "no catalog entry names a make or model — we carry multiple of both per type",
);

/* ------------------------------------------------- operational leakage --- */
console.log("\noperational data must not leak into marketing");

const FORBIDDEN = [
  "vin",
  "plate",
  "gps",
  "insurance",
  "registration",
  "finance",
  "lienholder",
  "payoff",
  "odometer",
  "mileage",
  "maintenance",
  "keys",
  "renter",
  "utilization",
];
for (const word of FORBIDDEN) {
  // Field names only. The prose header deliberately NAMES these to say they
  // are banned, so only `word:` / `word_x:` style keys count as a violation.
  const re = new RegExp(`^\\s*${word}[a-z_]*\\s*:`, "im");
  ok(!re.test(catalog), `catalog declares no "${word}" field`);
}

ok(
  !/from "@\/integrations\/supabase/.test(catalog) && !/\bsupabase\b/.test(catalog),
  "catalog module has no database dependency at all",
);
ok(
  !/\.from\(["']vehicles/.test(catalog),
  "catalog never reads or writes the operational vehicles table",
);

/* ------------------------------------------- never reaches the back office */
console.log("\nback office stays inventory-only");

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const adminFiles = [...walk("src/components/admin"), "src/routes/admin.tsx"].filter(existsSync);
const leaked = adminFiles.filter((f) => /marketing-fleet|MARKETING_FLEET/.test(read(f)));
ok(
  leaked.length === 0,
  `no admin surface imports the catalog${leaked.length ? ` (found: ${leaked.join(", ")})` : ""}`,
);
const serverFiles = walk("src/lib").filter((f) => /\.functions\.ts$|\.server\.ts$/.test(f));
const serverLeaked = serverFiles.filter((f) => /marketing-fleet/.test(read(f)));
ok(
  serverLeaked.length === 0,
  `no server function imports the catalog${serverLeaked.length ? ` (found: ${serverLeaked.join(", ")})` : ""}`,
);

/* ------------------------------- §16 structural admin separation --------- */
console.log("\nthe catalog does not exist to the back office");

// Not "the admin UI filters it out" — it is not in the database, so there is
// nothing for an operational query to return.
// walk() only yields .ts/.tsx; migrations need their own pass.
const sqlFiles = (function walkSql(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkSql(p));
    else if (/\.sql$/.test(name)) out.push(p);
  }
  return out;
})("supabase");
const sql = sqlFiles.map(read).join("\n");
ok(sqlFiles.length > 0, `found ${sqlFiles.length} migration files to check`);
ok(
  slugs.every((slug) => !sql.includes(slug)),
  "no catalog slug appears anywhere in the schema or its migrations",
);
ok(
  !/marketing_fleet|marketing_catalog|catalog_vehicles/i.test(sql),
  "no marketing catalog table was created",
);
// A catalog entry has no `id`, so it cannot be passed where a vehicles.id goes.
ok(
  !/^\s*id:\s/m.test(entriesOrEmpty()),
  "no catalog entry declares an `id` field",
);
const operationalSurfaces = adminFiles.filter((f) =>
  /Vehicle|Fleet|Overview|Expense|Maintenance|Insurance|Registration|Finance|Rental/i.test(f),
);
ok(operationalSurfaces.length > 0, `found ${operationalSurfaces.length} operational admin surfaces`);
for (const f of operationalSurfaces) {
  const src = read(f);
  const touches =
    /marketing-fleet|MARKETING_FLEET|catalogCardModel/.test(src) ||
    slugs.some((slug) => src.includes(slug));
  ok(!touches, `${f.replace("src/components/admin/", "")} knows nothing of the catalog`);
}

/* -------------------------------------------------------- truthfulness --- */
console.log("\nno invented availability or pricing");

ok(
  /availabilityNote: null/.test(catalog),
  "a catalog card never carries an availability note",
);
// Scoped to the data literal: the surrounding prose names these phrases in
// order to forbid them, and liveAvailabilityNote() legitimately formats a
// real, section-level count.
const entries = catalog.slice(
  catalog.indexOf("export const MARKETING_FLEET"),
  catalog.indexOf("export function marketingFleetByCategory"),
);
ok(entries.length > 500, "found the catalog data literal to inspect");
ok(
  !/in ?stock|available|on the lot|ready now|reserve now/i.test(entries),
  "no catalog entry claims stock status",
);
ok(
  /status === "available"/.test(adapter),
  "only a real unit marked available gets an availability note",
);
// The detail page's JSON-LD Offer is a machine-readable availability claim.
ok(
  /status === "available"[\s\S]{0,120}schema\.org\/InStock/.test(detail),
  "fleet/$id emits schema.org/InStock only when the unit is actually available",
);

const rates = [
  ...catalog.matchAll(/weeklyRateFrom: (null|PUBLISHED_WEEKLY_FLOOR|PUBLISHED_WEEKLY_RATES\.\w+)/g),
].map((m) => m[1]);
ok(rates.length === 3, `every entry declares weeklyRateFrom (got ${rates.length})`);
ok(
  rates.every(
    (r) =>
      r === "null" || r === "PUBLISHED_WEEKLY_FLOOR" || r.startsWith("PUBLISHED_WEEKLY_RATES."),
  ),
  "no catalog entry carries a hand-written rate — it comes from the published rate card",
);
ok(
  /PUBLISHED_WEEKLY_RATES[^}]*sedan: 350,[\s\S]*?suv: 375,[\s\S]*?xl: 400,/.test(catalog),
  "the published rate card is Sedan $350, SUV $375, Minivan $400",
);
ok(
  /PUBLISHED_WEEKLY_FLOOR = 350/.test(catalog),
  "the published floor matches the $350/week the site already advertises",
);
// The /fleet meta description publishes that same floor. If one moves the
// other has to move with it.
ok(
  /From \$350\/week/.test(fleet),
  "/fleet still publishes the same floor the catalog prices against",
);
ok(
  /Rate confirmed on your call/.test(catalog),
  "an unpriced category says so rather than guessing a number",
);
ok(
  !/only \d+ left|hurry|act fast|last one|selling fast/i.test(catalog + card + home),
  "no manufactured scarcity",
);

/* ------------------------------------------------------- the card seam --- */
console.log("\nthe card renders a view model, not an entity");

ok(
  /function VehicleCard\(\{ model \}: \{ model: PublicVehicleCardModel \}\)/.test(card),
  "VehicleCard takes a PublicVehicleCardModel",
);
ok(
  !/Tables<"vehicles_public">/.test(card),
  "VehicleCard has no direct dependency on the inventory view",
);
ok(
  /kind: "catalog" \| "inventory"/.test(catalog),
  "the model records which kind it came from",
);
// A catalog card must not be able to produce a /fleet/$id link.
ok(
  /href: \{ kind: linkTo, type: v\.category \}/.test(catalog),
  "a catalog card links to its category or to apply, never to a vehicle route",
);
ok(
  /catalogCardModel\(v, "apply"\)/.test(fleet),
  "on the fleet page the catalog card goes to apply, not back to /fleet",
);
ok(
  /href: \{ kind: "vehicle", id: vehicle\.id \}/.test(adapter),
  "only a real unit links to /fleet/$id",
);
ok(
  /ctaHref: `\/apply\?vehicle_type=\$\{v\.category\}`/.test(catalog),
  "a catalog CTA passes a category, not a fabricated vehicle id",
);
ok(
  /"vehicle_type"/.test(apply) && /\bvehicle\b[\s\S]{0,40}vehicle_type/.test(apply),
  "/apply accepts vehicle_type as a key distinct from vehicle",
);
ok(!/\bany\b(?!\w)/.test(catalog.replace(/\/\*[\s\S]*?\*\//g, "")), "catalog uses no `any`");
ok(!/\bas any\b/.test(card + adapter + home + fleet), "no `as any` at the call sites");

/* ------------------------------------------------------- the homepage --- */
console.log("\nhomepage renders without inventory");

ok(
  /MARKETING_FLEET\.map\(\(v\) => catalogCardModel\(v\)\)/.test(home),
  "the featured grid is built from the catalog",
);
ok(
  !/\.from\("vehicles_public"\)[\s\S]{0,200}\.eq\("body_type"/.test(home),
  "the old per-body-type inventory query is gone",
);
ok(
  /\.select\("body_type"\)[\s\S]{0,80}\.eq\("status", "available"\)/.test(home),
  "inventory is read only for body types of genuinely available units",
);
ok(
  !/setVehicles|vehicles\.map|data\.map/.test(home),
  "no inventory row reaches the grid — the read can only add a line",
);
ok(
  /if \(cancelled \|\| error \|\| !data\) return;/.test(home),
  "a failed availability read leaves the grid standing",
);
ok(
  /\} catch \{/.test(home),
  "a rejected availability read leaves the grid standing too",
);

/* ------------------------------------------------ §21 the business rule -- */
console.log("\nthe rule: marketing must not depend on operational availability");

// This is the regression that matters. If someone rewires the featured grid
// back to "whatever vehicles_public returns for status = available", the
// homepage goes blank again the next time the lot empties.
const homeGrid = home.slice(home.indexOf("function Index()"));
ok(
  !/\{\s*vehicles\.map\(/.test(homeGrid),
  "the featured grid does not map over an inventory array",
);
ok(
  !/useState<Tables<"vehicles_public">\[\]>/.test(home),
  "the homepage holds no list of inventory rows at all",
);
ok(
  /const cards = useMemo\(\(\) => MARKETING_FLEET/.test(home),
  "the cards come from the catalog constant, not from a query result",
);
// And the catalog can never become inventory.
ok(
  !/insert|upsert|\.from\(/.test(catalog),
  "the catalog module performs no database writes or reads of any kind",
);
// The adapter may know the shared card TYPE and nothing else about the
// catalog — no entries, no helper, no runtime import.
ok(
  /^import type \{ PublicVehicleCardModel \} from "@\/lib\/marketing-fleet";$/m.test(adapter),
  "the adapter imports the shared card type",
);
ok(
  !/^import \{[^}]*\} from "@\/lib\/marketing-fleet"/m.test(adapter) &&
    !/MARKETING_FLEET|catalogCardModel/.test(adapter),
  "and nothing else from the catalog — no entries, no helpers, no runtime import",
);
ok(
  /npm run test:fleet-e2e|marketing-fleet-e2e/.test(readFileSync("package.json", "utf8")),
  "the browser half of this rule is wired into package.json",
);
ok(
  existsSync("scripts/marketing-fleet-e2e.test.mjs"),
  "the browser half of this rule exists",
);
ok(
  /Vehicles Built For Gig Work\./.test(home),
  "heading: Vehicles Built For Gig Work.",
);
ok(
  /Browse the types of vehicles we regularly offer\. Availability changes daily\./.test(home),
  "supporting copy present",
);
ok(/Check Availability/.test(card), "CTA still reads Check Availability");
// A paid landing page must never show a broken-image icon, and the page is
// server rendered, so the error can land before React hydrates.
ok(
  /onError=\{\(\) => setImageFailed\(true\)\}/.test(card),
  "a failed image swaps to a neutral tile",
);
ok(
  /el\.complete && el\.naturalWidth === 0/.test(card),
  "an image that failed before hydration is caught too",
);
// "Rate confirmed on your call" is not a price and must not be typeset as one.
ok(
  /const hasRate = model\.priceLabel\.includes\("\$"\)/.test(card),
  "only a real figure gets the price treatment",
);

/* ----------------------------------------------------- the fleet page --- */
console.log("\nfleet page keeps its count honest");

ok(
  /Showing <span className="font-semibold">\{filtered\.length\}<\/span>/.test(fleet),
  "the visible count still counts live inventory only",
);
ok(
  /loaded && filtered\.length === 0/.test(fleet),
  "the catalog only appears once inventory has loaded and come back empty",
);
ok(
  /catalogFallback/.test(fleet) && !/filtered[\s\S]{0,40}catalogFallback/.test(fleet),
  "catalog cards are a separate section, never merged into the inventory grid",
);
ok(
  /These are the types of vehicles we regularly offer\./.test(fleet),
  "the empty state offers the catalog instead of a dead end",
);
ok(
  /\} finally \{[\s\S]{0,260}setLoaded\(true\)/.test(fleet),
  "the fallback is reached even when the inventory query rejects",
);
ok(
  /isMarketingCategory\(s\.type\)/.test(fleet),
  "/fleet validates its type param against the known categories",
);

console.log(`\n${fail === 0 ? "PASS" : `FAIL — ${fail} assertion(s)`}`);
process.exit(fail === 0 ? 0 : 1);
