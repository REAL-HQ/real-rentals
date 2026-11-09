import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  MY_CAR_CARD_ENABLED,
  MY_CAR_LINKS,
  MY_CAR_PLATE_COLUMN,
  assertMyCarCardEnabled,
  buildMyCar,
} from "../src/lib/my-car-card";

const rental = {
  status: "active",
  start_date: "2026-10-21",
  weekly_rate: 350,
};

const vehicle = {
  year: 2022,
  make: "Toyota",
  model: "Camry",
  color: "Silver",
  photos: ["cars/camry.jpg"],
};

describe("my car card flag", () => {
  it("is off and the guard refuses", () => {
    assert.equal(MY_CAR_CARD_ENABLED, false);
    assert.throws(() => assertMyCarCardEnabled(), /My car card is not enabled/);
  });

  it("throws in the handler before the portal scope and before any table read", () => {
    const source = readFileSync("src/lib/my-car-card.functions.ts", "utf8");
    const handler = source.slice(source.indexOf(".handler("));
    const guard = handler.indexOf("assertMyCarCardEnabled()");
    const scoped = handler.indexOf("await scope(");
    const read = handler.indexOf('.from("');
    assert.ok(guard !== -1 && scoped !== -1 && guard < scoped && scoped < read);
    assert.match(source, /portalScope/);
    assert.match(source, /\.from\("rentals"\)/);
    assert.match(source, /\.from\("vehicles_public"\)/);
    assert.match(source, /select\("status,start_date,weekly_rate,vehicle_id"\)/);
    assert.match(source, /select\("year,make,model,color,photos"\)/);
    assert.equal(source.split('.from("').length - 1, 2);
    assert.doesNotMatch(source, /supabaseAdmin|stripe|\.insert\(|\.update\(|\.delete\(|from\("vehicles"\)|license_plate|\.or\(`|\.filter\(`/);
    const portal = readFileSync("src/routes/portal.tsx", "utf8");
    assert.match(portal, /MY_CAR_CARD_ENABLED \? <MyCarGate/);
    assert.match(portal, /usePortalRead\(getMyCar\)/);
    const card = readFileSync("src/components/portal/MyCarCard.tsx", "utf8");
    assert.match(card, /min-h-11/);
    assert.match(card, /Payments/);
    assert.match(card, /Documents/);
    assert.match(card, /Not Linked: \{link\.label\}/);
    assert.match(card, /Not Shown: Plate/);
    assert.doesNotMatch(card, /supabase|\.from\(|license_plate|uppercase/);
  });
});

describe("my car card", () => {
  it("reads the rental and the public vehicle, and leaves the plate off", () => {
    const card = buildMyCar(rental, vehicle);
    assert.ok(card);
    assert.equal(card.year, 2022);
    assert.equal(card.make, "Toyota");
    assert.equal(card.model, "Camry");
    assert.equal(card.color, "Silver");
    assert.equal(card.photo, "cars/camry.jpg");
    assert.equal(card.startDate, "Oct 21, 2026");
    assert.equal(card.weeklyRate, "$350.00");
    assert.deepEqual(card.missing, []);
    assert.equal(card.plate, null);
    assert.equal(card.plateColumn, MY_CAR_PLATE_COLUMN);
    assert.equal(MY_CAR_PLATE_COLUMN, "license_plate");
    assert.deepEqual(
      card.links.map((link) => link.tab),
      ["payments", "documents", null],
    );
    assert.equal(MY_CAR_LINKS[2]?.label, "Roadside Help");
  });

  it("returns nothing unless the rental is active, and lists fields the row does not have", () => {
    assert.equal(buildMyCar({ ...rental, status: "completed" }, vehicle), null);
    assert.equal(buildMyCar({ ...rental, status: null }, vehicle), null);
    const partial = buildMyCar(
      { status: "active", start_date: null, weekly_rate: null },
      { year: null, make: "Honda", model: "", color: null, photos: [] },
    );
    assert.ok(partial);
    assert.equal(partial.make, "Honda");
    assert.equal(partial.model, null);
    assert.equal(partial.photo, null);
    assert.equal(partial.plate, null);
    assert.deepEqual(partial.missing, ["Year", "Model", "Color", "Photo", "Start Date", "Weekly Rate"]);
  });
});
