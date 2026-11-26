import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const portal = readFileSync(new URL("../src/routes/portal.tsx", import.meta.url), "utf8");
const partner = readFileSync(new URL("../src/routes/partner.tsx", import.meta.url), "utf8");

test("driver portal nav and empty-state heading say Vehicle, not My Vehicle", () => {
  assert.match(portal, /export const Route = createFileRoute\("\/portal"\)/);
  assert.match(portal, /\{ id: "vehicle", label: "Vehicle", icon: Car \}/);
  assert.match(portal, /if \(!data\.vehicle\) return <Stub label="Vehicle" \/>;/);
  assert.equal(portal.includes("My Vehicle"), false);
});

test("partner portal My Vehicles label is unchanged", () => {
  assert.match(partner, /<Section title="My Vehicles" icon=\{Car\}>/);
});
