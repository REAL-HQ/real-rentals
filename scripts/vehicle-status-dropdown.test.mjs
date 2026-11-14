import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const funcs = readFileSync("src/lib/vehicles.functions.ts", "utf8");
const fields = readFileSync("src/components/admin/VehicleProfileFields.tsx", "utf8");

const block =
  funcs.match(/export const VEHICLE_STATUSES = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
const entries = [...block.matchAll(/\{ value: "([^"]+)", label: "([^"]+)" \}/g)].map((m) => ({
  value: m[1],
  label: m[2],
}));

assert.ok(entries.length >= 8, "the status dropdown must still offer every lifecycle status");
assert.ok(
  entries.some((e) => e.value === "maintenance" && e.label === "Maintenance"),
  "the maintenance status must be labeled Maintenance",
);
assert.ok(!block.includes("In maintenance"), "the dropdown must not say In maintenance");
for (const e of entries) {
  assert.match(
    e.label,
    /^[A-Z][a-z0-9]*(?: [A-Z][a-z0-9]*)*$/,
    `status label "${e.label}" must be Title Case`,
  );
}

assert.match(
  fields,
  /from "@\/components\/ui\/select"/,
  "vehicle field dropdowns must use the shared white dropdown",
);
assert.match(fields, /<SelectContent>/, "the dropdown panel must be the shared popover panel");
assert.doesNotMatch(fields, /<select\b/, "vehicle fields must not render native selects");

console.log("PASS vehicle status dropdown reads Maintenance and uses the white shared panel");
