// A signed swap leaves the cars unmoved until Complete Swap. James's S-1000 sat
// signed for a day with ED40NC still Rented and EC20LK still Available because
// nothing outside the booking said so (Dolmar t614u, Nov 22 2026).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const { vehicleSwapNotices, vehicleSwapNoticeLabel, swapBookingHref } = await import("@/lib/vehicle-swap");
const { matchRenterPayment } = await import("@/lib/renter-payments");
const read = (f: string) => readFileSync(f, "utf8");

const OLD = "02f8bac0-0ade-4ab6-89bc-a2693cc691ad";
const NEW = "ca3d2cc6-0144-4efa-b0d6-5091b27db254";
const RENTAL = "9108ea8c-528f-4a81-9237-af505a1b208a";
const swap = (status: string, n = 1000, from = OLD, to = NEW) => ({ id: `s-${status}-${n}`, swap_number: n, status, rental_id: RENTAL, from_vehicle_id: from, to_vehicle_id: to });

describe("vehicleSwapNotices", () => {
  test("a signed swap flags both cars and links to the booking", () => {
    const m = vehicleSwapNotices([swap("signed")]);
    expect(m.get(OLD)).toMatchObject({ role: "outgoing", status: "signed", label: "Swap S-1000 Signed · Complete Swap" });
    expect(m.get(NEW)).toMatchObject({ role: "incoming", status: "signed" });
    expect(m.get(OLD)?.href).toBe(`/admin?tab=bookings&view=past&id=${RENTAL}`);
  });
  test("waiting for signature has its own label", () => {
    expect(vehicleSwapNoticeLabel("pending_signature", 1001)).toBe("Swap S-1001 Waiting For Signature");
  });
  test("completed, voided and failed swaps show nothing", () => {
    expect(vehicleSwapNotices([swap("completed"), swap("voided"), swap("send_failed")]).size).toBe(0);
  });
  test("a signed swap wins over a pending one on the same car", () => {
    const m = vehicleSwapNotices([swap("pending_signature", 1002, OLD, "x"), swap("signed", 1000)]);
    expect(m.get(OLD)?.swapNumber).toBe(1000);
    expect(m.get("x")?.status).toBe("pending_signature");
  });
  test("no rental means no link", () => expect(swapBookingHref(null)).toBeNull());
});

describe("Vehicles list wiring", () => {
  const fn = read("src/lib/vehicles-list.functions.ts");
  const ui = read("src/components/admin/VehiclesPanel.tsx");
  test("the list reads open swaps for the page's cars and never fails on them", () => {
    expect(fn).toContain("from(VEHICLE_SWAPS_TABLE)");
    expect(fn).toContain('.in("status", [...OPEN_SWAP_STATUSES])');
    expect(fn).toContain(".catch(() => ({ data: null }))");
    expect(fn).toContain("swap_notice: swapNotices.get(r.id) ?? null");
  });
  test("cards and table rows both show the notice", () => {
    expect(ui.match(/<SwapNotice v=\{v\} \/>/g)?.length).toBe(2);
    expect(ui).toContain('data-testid="vehicle-swap-notice"');
  });
});

describe("Complete Swap moves every reference", () => {
  const sql = read("supabase/migrations/20261121070000_swap_insurance_optional.sql");
  test("rental, application and both cars change in one transaction", () => {
    expect(sql).toMatch(/UPDATE public\.rentals\s+SET vehicle_id = s\.to_vehicle_id/);
    expect(sql).toMatch(/UPDATE public\.applications SET vehicle_id = s\.to_vehicle_id/);
    expect(sql).toMatch(/UPDATE public\.vehicles SET status = 'rented' WHERE id = s\.to_vehicle_id/);
    expect(sql).toMatch(/UPDATE public\.vehicles SET status = _from_vehicle_status WHERE id = s\.from_vehicle_id/);
  });
});

describe("payments after a swap", () => {
  test("a payment matched by an earlier payment takes the rental's current car", () => {
    const m = matchRenterPayment(
      { customerId: "cus_X", subscriptionId: null, applicationId: null } as any,
      {
        rentals: [{ id: RENTAL, application_id: "a", vehicle_id: NEW }],
        applications: [],
        priorPayments: [{ rental_id: RENTAL, driver_id: "a", vehicle_id: OLD, stripe_customer_id: "cus_X" }],
      },
    );
    expect(m.vehicleId).toBe(NEW);
    expect(m.via).toBe("prior_payment");
  });
  test("an unknown rental keeps the earlier payment's car", () => {
    const m = matchRenterPayment(
      { customerId: "cus_X", subscriptionId: null, applicationId: null } as any,
      { rentals: [], applications: [], priorPayments: [{ rental_id: "gone", driver_id: "a", vehicle_id: OLD, stripe_customer_id: "cus_X" }] },
    );
    expect(m.vehicleId).toBe(OLD);
  });
});
