import { strict as assert } from "node:assert";
import { LEGACY_TABS, railEntries, visibleTabs } from "../src/components/admin/nav-config";

assert.deepEqual(LEGACY_TABS.available_cars, { tab: "vehicles", vstatus: "available" });
console.log("PASS: Old Available Cars links use the existing Vehicles Available filter");

for (const tier of ["owner", "manager", "coordinator"] as const) {
  const destinations = visibleTabs(tier);
  assert.equal(destinations.some(({ id }) => id === "available_cars"), false);
  assert.equal(destinations.some(({ id }) => id === "vehicles"), true);
  assert.equal(railEntries(tier).filter(({ id }) => id === "vehicles").length, 1);
  assert.equal(railEntries(tier).some(({ id }) => id === "available_cars"), false);
  console.log(`PASS: ${tier} retains Vehicles without a separate Available Cars destination`);
}

assert.equal(visibleTabs(null).some(({ id }) => id === "vehicles"), false);
console.log("PASS: Signed-out navigation does not gain fleet access");