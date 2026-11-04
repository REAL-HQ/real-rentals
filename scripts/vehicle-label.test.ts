// Vehicle label helpers. Run: bun scripts/vehicle-label.test.ts
import {
  formatVehicleIdentityLine,
  formatVehicleLabel,
  vehicleMatchesQuery,
  vehicleSearchText,
  vinLast6,
} from "../src/lib/vehicle-label";

let fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`);
  if (!c) fail++;
};

const v = {
  id: "abc",
  unit_number: "RR-006",
  year: 2015,
  make: "Ford",
  model: "Fusion",
  license_plate: "CZ07DA",
  vin: "1FA6P0H74F5118769",
  status: "available",
};

ok(vinLast6(v.vin) === "118769", "vinLast6 returns last 6");
ok(vinLast6("123") === "123", "vinLast6 short VIN returns whole string");
ok(vinLast6(null) === "", "vinLast6 null is empty");

ok(
  formatVehicleLabel(v) === "RR-006 · 2015 Ford Fusion · CZ07DA · VIN …118769 · available",
  "formatVehicleLabel includes unit, ymm, plate, last6, status",
);
ok(
  formatVehicleLabel({ year: 2013, make: "Ford", model: "Fusion" }) === "2013 Ford Fusion",
  "formatVehicleLabel omits empty segments",
);

ok(formatVehicleIdentityLine(v) === "CZ07DA · VIN …118769", "identity line is plate + last6");
ok(formatVehicleIdentityLine({ year: 2015 }) === "", "identity line empty when no plate/vin");

ok(vehicleSearchText(v).includes("cz07da"), "search text includes plate");
ok(vehicleSearchText(v).includes("1fa6p0h74f5118769"), "search text includes full VIN");
ok(vehicleSearchText(v).includes("118769"), "search text includes last 6");

ok(vehicleMatchesQuery(v, "CZ07DA"), "matches plate");
ok(vehicleMatchesQuery(v, "cz07"), "matches plate fragment");
ok(vehicleMatchesQuery(v, "118769"), "matches VIN last 6");
ok(vehicleMatchesQuery(v, "1FA6P0H74F5118769"), "matches full VIN");
ok(vehicleMatchesQuery(v, "RR-006"), "matches unit");
ok(vehicleMatchesQuery(v, "fusion"), "matches model");
ok(vehicleMatchesQuery(v, "2015"), "matches year");
ok(!vehicleMatchesQuery(v, "tesla"), "rejects unrelated query");
ok(vehicleMatchesQuery(v, ""), "empty query matches all");

console.log(fail ? `\n${fail} failed` : "\nall assertions passed");
if (fail) process.exit(1);
