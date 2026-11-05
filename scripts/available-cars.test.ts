import { expect, test } from "bun:test";
import { canAssign } from "../src/lib/available-cars";
const car = { status: "available", archived_at: null, assignedTo: null };
test("approved driver can be assigned", () => expect(canAssign({ status: "approved", vehicle_id: null }, car, "d").ok).toBe(true));
test("active driver without car can be assigned", () => expect(canAssign({ status: "active", vehicle_id: null }, car, "d").ok).toBe(true));
test("lead / pending / closed cannot", () => {
  for (const s of ["new_lead", "pending", "closed", "rejected", null]) expect(canAssign({ status: s as any, vehicle_id: null }, car, "d").ok).toBe(false);
});
test("car not available", () => expect(canAssign({ status: "approved", vehicle_id: null }, { ...car, status: "rented" }, "d").ok).toBe(false));
test("car already held by someone else", () => expect(canAssign({ status: "approved", vehicle_id: null }, { ...car, assignedTo: "x" }, "d").ok).toBe(false));
test("driver already has a car", () => expect(canAssign({ status: "approved", vehicle_id: "v" }, car, "d").ok).toBe(false));
test("archived car", () => expect(canAssign({ status: "approved", vehicle_id: null }, { ...car, archived_at: "2026-01-01" }, "d").ok).toBe(false));
