import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { VEHICLE_STATUSES } from "../src/lib/vehicles.functions";
import { availabilityLabel } from "../src/lib/vehicles-list";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Unavailable is a settable status with a Title Case label", () => {
  expect(VEHICLE_STATUSES.find((s) => s.value === "unavailable")?.label).toBe("Unavailable");
  expect(availabilityLabel({ on_rent: false, status: "unavailable" })).toBe("Unavailable");
});

test("badge colors: Available white, Reserved yellow, Rented green, Maintenance and Unavailable red", () => {
  const src = read("src/components/VehicleStatusBadge.tsx");
  expect(src).toContain('key === "available" ? "white"');
  expect(src).toContain('key === "reserved" ? "warning"');
  expect(src).toContain('["rented", "on_rent"].includes(key) ? "success"');
  expect(src).toMatch(/\["maintenance", "unavailable"[^\]]*\]\.includes\(key\) \? "attention"/);
  expect(read("src/components/ui/badge.tsx")).toContain('white: "border-border bg-white text-muted-foreground"');
});

test("Unavailable cars are blocked from reservations, payment holds and swap picker; need no migration", () => {
  expect(read("src/lib/reservations.functions.ts")).toContain('"rented", "unavailable"');
  expect(read("src/lib/payment-received.server.ts")).toContain('"rented", "unavailable"');
  // Swap picker: the server offers and accepts only Available cars.
  expect(read("src/lib/vehicle-swap.server.ts")).toContain('.eq("status", "available").is("archived_at", null)');
  expect(read("src/lib/vehicle-swap.server.ts")).toContain('if (v.data.status !== "available") return fail(409, "The replacement car must be Available.");');
  // Switch Vehicle / available-cars / assign only accept explicit allow-lists that exclude it.
  expect(read("src/lib/reservation-switch.ts")).toContain('SWITCH_TARGET_STATUSES = ["available", "ready", "onboarding"]');
  expect(read("src/lib/available-cars.ts")).toContain('BOARD_VEHICLE_STATUSES = ["available", "onboarding", "reserved"]');
});

test("Status filter always offers Unavailable and fleet board treats it as Not Rentable", () => {
  expect(read("src/lib/vehicles-list.functions.ts")).toContain('["archived", "unavailable"]');
  expect(read("src/lib/fleet-availability.ts")).toContain('status === "unavailable" ||');
});
