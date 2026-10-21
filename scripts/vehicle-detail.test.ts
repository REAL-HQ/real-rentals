import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PUBLIC_VEHICLE_DETAIL_COLUMNS,
  RENTAL_REQUIREMENTS,
  VEHICLE_DETAIL_PAGE_ENABLED,
  presentPublicVehicle,
} from "../src/lib/vehicle-detail";

const lib = readFileSync("src/lib/vehicle-detail.ts", "utf8");
const route = readFileSync("src/routes/vehicles.$id.tsx", "utf8");
const view = readFileSync("src/components/site/VehicleDetailView.tsx", "utf8");
const card = readFileSync("src/components/site/VehicleCard.tsx", "utf8");
const listing = readFileSync("src/routes/fleet.index.tsx", "utf8");

function flagValue(source: string): string | null {
  const match = source.match(/const VEHICLE_DETAIL_PAGE_ENABLED: boolean = (false|true)/);
  return match?.[1] ?? null;
}

const listed = {
  id: "veh-1",
  status: "available",
  make: "Toyota",
  model: "Camry",
  year: 2022,
  weekly_rate: 350,
  photos: ["lot/camry.jpg", "https://cdn.example/camry-2.jpg"],
  uber_eligibility: ["Uber", "Lyft"],
  description: "Ready for rideshare.",
  plate: "PLATE-9XYZ",
  vin: "1HGCM82633A004352",
  license_plate: "SECRET-PLATE",
  deposit: 500,
  deposit_amount: 500,
};

describe("vehicle detail flag", () => {
  it("is a hard false, and the listing does not import or link the new page", () => {
    assert.equal(VEHICLE_DETAIL_PAGE_ENABLED, false);
    assert.equal(flagValue(lib), "false");
    assert.equal(flagValue(route), "false");
    assert.equal(flagValue(card), "false");

    const gate = route.indexOf("VEHICLE_DETAIL_PAGE_ENABLED !== true");
    const redirectAt = route.indexOf('throw redirect({ to: "/fleet" })');
    const load = route.indexOf('import("@/components/site/VehicleDetailView")');
    assert.ok(gate !== -1 && redirectAt > gate && load > gate);
    assert.equal(route.indexOf(".from("), -1);
    assert.doesNotMatch(route, /loader\s*:/);
    assert.doesNotMatch(route, /from "@\/lib\/vehicle-detail"|from "@\/components\/site\/VehicleDetailView"|supabase/);

    assert.doesNotMatch(card, /from "@\/lib\/vehicle-detail"|from "@\/components\/site\/VehicleDetailView"/);
    const cardGate = card.indexOf("VEHICLE_DETAIL_PAGE_ENABLED === true");
    const newLink = card.indexOf('to="/vehicles/$id"');
    assert.ok(cardGate !== -1 && newLink > cardGate);
    assert.match(card, /to="\/fleet\/\$id"/);
    assert.doesNotMatch(listing, /\/vehicles\/|VEHICLE_DETAIL_PAGE_ENABLED|vehicle-detail/);
  });

  it("reads only the public view, with no writes, admin client, or interpolated filter", () => {
    assert.match(view, /\.from\("vehicles_public"\)/);
    assert.match(view, /\.select\(PUBLIC_VEHICLE_DETAIL_COLUMNS\)/);
    assert.match(view, /\.eq\("id", id\)/);
    assert.doesNotMatch(PUBLIC_VEHICLE_DETAIL_COLUMNS, /plate|vin|deposit/i);
    for (const source of [lib, view, route, card]) {
      assert.doesNotMatch(source, /supabaseAdmin|\.or\(`|\.filter\(`|\.insert\(|\.update\(|\.delete\(|select\("\*"\)/);
    }
    assert.match(route, /name: "description"/);
    assert.match(route, /Vehicle Details — REAL RENTALS/);
    assert.match(view, /min-h-11/);
    assert.doesNotMatch(view, /uppercase|text-transform/);
  });
});

describe("vehicle detail presentation", () => {
  it("omits plate and VIN and links Apply to /apply", () => {
    const result = presentPublicVehicle(listed);
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") return;
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /PLATE-9XYZ|1HGCM82633A004352|SECRET-PLATE/);
    assert.equal(result.vehicle.depositLabel, null);
    assert.equal(result.vehicle.applyHref, "/apply");
    assert.equal(result.vehicle.heading, "2022 Toyota Camry");
    assert.equal(result.vehicle.weeklyRateLabel, "$350/week");
    assert.deepEqual(result.vehicle.eligibility, ["Uber", "Lyft"]);
    assert.deepEqual(result.vehicle.requirements, RENTAL_REQUIREMENTS);
    assert.deepEqual(
      result.vehicle.photos.map((photo) => photo.src),
      ["/api/public/vehicle-photos/lot/camry.jpg", "https://cdn.example/camry-2.jpg"],
    );
    assert.equal(result.vehicle.metaTitle.includes("2022 Toyota Camry"), true);
    assert.equal(result.vehicle.metaDescription.includes("$350/week"), true);
    assert.match(view, /to="\/apply"/);
    assert.doesNotMatch(view, /search=\{\{ vehicle|\?vehicle=/);
  });

  it("returns a friendly not-found for an unknown or unavailable id", () => {
    assert.deepEqual(presentPublicVehicle(null), { kind: "missing" });
    assert.deepEqual(presentPublicVehicle(listed, true), { kind: "missing" });
    assert.equal(presentPublicVehicle({ ...listed, id: "  " }).kind, "missing");
    for (const status of ["retired", "rented", "maintenance", "reserved", null, ""]) {
      assert.equal(presentPublicVehicle({ ...listed, status }).kind, "missing", String(status));
    }
    assert.equal(presentPublicVehicle({ ...listed, uber_eligibility: [] }).kind, "ready");
    const withoutColumn = { ...listed };
    delete (withoutColumn as { uber_eligibility?: unknown }).uber_eligibility;
    const hidden = presentPublicVehicle(withoutColumn);
    assert.equal(hidden.kind, "ready");
    if (hidden.kind === "ready") assert.equal(hidden.vehicle.eligibility, null);
    assert.match(view, /Vehicle Not Available/);
    assert.match(view, /This vehicle is no longer listed/);
    assert.match(view, /to="\/fleet"/);
    assert.match(view, /Back To Fleet/);
  });
});
