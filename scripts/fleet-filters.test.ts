import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FLEET_FILTERS_ENABLED,
  FLEET_LISTING_COLUMNS,
  applyFleetFilters,
  fleetSearchParams,
  readFleetSearch,
  type FleetFilterState,
} from "../src/lib/fleet-filters";

const lib = readFileSync("src/lib/fleet-filters.ts", "utf8");
const route = readFileSync("src/routes/fleet.index.tsx", "utf8");
const bar = readFileSync("src/components/site/FleetFiltersBar.tsx", "utf8");

function flagValue(source: string): string | null {
  const match = source.match(/const FLEET_FILTERS_ENABLED: boolean = (false|true)/);
  return match?.[1] ?? null;
}

function marked(source: string): string {
  const start = source.indexOf("// fleet-search-start");
  const end = source.indexOf("// fleet-search-end");
  assert.ok(start !== -1 && end > start);
  return source.slice(start, end).replace(/^export /gm, "");
}

const defaults: FleetFilterState = {
  make: "all",
  minRate: null,
  maxRate: null,
  uberOnly: false,
  availableOnly: true,
  sort: "price_asc",
};

const rows = [
  { id: "a", make: "Toyota", weekly_rate: 400, year: 2020, status: "available", uber_eligibility: ["Uber"], plate: "SECRET", vin: "VIN" },
  { id: "b", make: "Honda", weekly_rate: 300, year: 2024, status: "available", uber_eligibility: [] },
  { id: "c", make: "Toyota", weekly_rate: 350, year: 2022, status: "rented", uber_eligibility: ["Uber", "Lyft"] },
  { id: "d", make: "Ford", weekly_rate: null, year: 2023, status: "available", uber_eligibility: null },
  { id: "e", make: "Ford", weekly_rate: 500, year: null, status: "available", uber_eligibility: ["Lyft"] },
];

describe("fleet filters flag", () => {
  it("is a hard false, and /fleet does not load the new controls", () => {
    assert.equal(FLEET_FILTERS_ENABLED, false);
    assert.equal(flagValue(lib), "false");
    assert.equal(flagValue(route), null);
    assert.equal(marked(route), marked(lib));
    assert.match(route, /import \{ FLEET_FILTERS_ENABLED \} from "@\/lib\/fleet-filters"/);
    assert.doesNotMatch(route, /from ["']@\/components\/site\/FleetFiltersBar["']/);

    const gate = route.indexOf("if (FLEET_FILTERS_ENABLED !== true) return;");
    const barLoad = route.indexOf('import("@/components/site/FleetFiltersBar")');
    const libLoad = route.indexOf('import("@/lib/fleet-filters")');
    assert.ok(gate !== -1 && gate < barLoad && gate < libLoad);
    const searchFn = route.slice(route.indexOf("validateSearch:"), route.indexOf("head:"));
    assert.match(searchFn, /const filtersOn: boolean = false as boolean/);
    assert.ok(searchFn.indexOf("if (filtersOn !== true) return base;") < searchFn.indexOf("extra.make"));
    assert.doesNotMatch(searchFn, /readFleetSearch|fleetSearchParams|FLEET_FILTERS_ENABLED/);
    assert.match(
      route,
      /\.from\("vehicles_public"\)\s*\.select\("\*"\)\s*\.neq\("status", "retired"\)\s*\.order\("weekly_rate", \{ ascending: true \}\)/,
    );
    const fetchGate = route.indexOf("const mod = await import(\"@/lib/fleet-filters\")");
    assert.ok(fetchGate > gate);
    assert.ok(route.indexOf(".select(mod.FLEET_LISTING_COLUMNS)") > fetchGate);
  });

  it("reads the public listing with explicit columns and no interpolated filter", () => {
    assert.deepEqual(
      FLEET_LISTING_COLUMNS.split(",").sort(),
      "badges,body_type,color,description,doors,fuel_type,id,make,miles_per_tank,model,monthly_rate,mpg,photos,seats,status,trim,uber_eligibility,weekly_rate,year".split(",").sort(),
    );
    assert.doesNotMatch(FLEET_LISTING_COLUMNS, /plate|vin|deposit|created_at/i);
    for (const source of [lib, bar]) {
      assert.doesNotMatch(source, /supabaseAdmin|\.or\(`|\.filter\(`|\.insert\(|\.update\(|\.delete\(|select\("\*"\)|\.from\(/);
    }
    assert.doesNotMatch(route, /supabaseAdmin|\.or\(`|\.filter\(`|\.insert\(|\.update\(|\.delete\(/);
    assert.match(bar, /min-h-11/);
    assert.doesNotMatch(bar, /uppercase|text-transform/);
    for (const label of ["All Makes", "Min Weekly Rate", "Max Weekly Rate", "Uber Eligible Only", "Available Only", "Price: Low To High", "Price: High To Low", "Newest"]) {
      assert.match(bar, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

describe("fleet filter state", () => {
  it("keeps today's defaults when the search params are absent", () => {
    assert.deepEqual(readFleetSearch({}), defaults);
    assert.deepEqual(readFleetSearch({ type: "suv", make: "all", sort: "nope", min: "-5", uber: "0" }), defaults);
    assert.deepEqual(fleetSearchParams(defaults), {});
  });

  it("round-trips make, rate range, uber, available, and sort", () => {
    const chosen: FleetFilterState = {
      make: "Toyota",
      minRate: 300,
      maxRate: 450,
      uberOnly: true,
      availableOnly: false,
      sort: "newest",
    };
    assert.deepEqual(readFleetSearch(fleetSearchParams(chosen)), chosen);
    assert.deepEqual(readFleetSearch({ make: "  Honda  ", min: "275", max: "400", uber: "1", available: "0", sort: "price_desc" }), {
      make: "Honda",
      minRate: 275,
      maxRate: 400,
      uberOnly: true,
      availableOnly: false,
      sort: "price_desc",
    });
  });
});

describe("fleet filter results", () => {
  it("filters by make, weekly rate, uber eligibility, and availability", () => {
    assert.deepEqual(applyFleetFilters(rows, defaults).map((row) => row.id), ["b", "a", "e", "d"]);
    assert.deepEqual(applyFleetFilters(rows, { ...defaults, make: "Toyota" }).map((row) => row.id), ["a"]);
    assert.deepEqual(
      applyFleetFilters(rows, { ...defaults, minRate: 350, maxRate: 450, availableOnly: false }).map((row) => row.id),
      ["c", "a"],
    );
    assert.deepEqual(applyFleetFilters(rows, { ...defaults, uberOnly: true }).map((row) => row.id), ["a", "e"]);
    assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c", "d", "e"]);
  });

  it("sorts by price in either direction and by model year for newest", () => {
    assert.deepEqual(
      applyFleetFilters(rows, { ...defaults, availableOnly: false, sort: "price_desc" }).map((row) => row.id),
      ["e", "a", "c", "b", "d"],
    );
    assert.deepEqual(
      applyFleetFilters(rows, { ...defaults, availableOnly: false, sort: "newest" }).map((row) => row.id),
      ["b", "d", "c", "a", "e"],
    );
    assert.match(lib, /vehicles_public has no created_at/);
  });
});
