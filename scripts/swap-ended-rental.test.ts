import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  etCalendarDate,
  presentRentalSpan,
  rentalLengthLabel,
  swapEndsByRentalId,
  type RentalSpan,
  type SwapRecord,
} from "../src/lib/swap-ended-rental";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OLD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEXT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONTINUING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LEFTOVER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const APRIL = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function rental(over: Partial<RentalSpan> & Pick<RentalSpan, "id" | "status">): RentalSpan {
  return {
    vehicleId: OLD,
    applicationId: A,
    startDate: "2026-11-19",
    endDate: null,
    ...over,
  };
}

function swap(over: Partial<SwapRecord> = {}): SwapRecord {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    swapNumber: 1000,
    rentalId: CONTINUING,
    applicationId: A,
    fromVehicleId: OLD,
    completedAt: "2026-11-21T16:00:00Z",
    reasonCode: "replacement",
    reason: "The car would not start",
    ...over,
  };
}

describe("rental length", () => {
  it("says 14 days as 2 weeks", () => {
    expect(rentalLengthLabel("2026-11-01", "2026-11-15")).toBe("14 Days (2 Weeks)");
  });

  it("uses Title Case for a partial week and a single day", () => {
    expect(rentalLengthLabel("2026-11-01", "2026-11-09")).toBe("8 Days (1 Week 1 Day)");
    expect(rentalLengthLabel("2026-11-01", "2026-11-08")).toBe("7 Days (1 Week)");
    expect(rentalLengthLabel("2026-11-19", "2026-11-20")).toBe("1 Day");
  });

  it("shows nothing when there is no end, and does not invent a span", () => {
    expect(rentalLengthLabel("2026-11-19", null)).toBeNull();
    expect(rentalLengthLabel(null, "2026-11-21")).toBeNull();
    expect(rentalLengthLabel("2026-11-21", "2026-11-19")).toBeNull();
  });

  it("names a same-day return instead of zero days", () => {
    expect(rentalLengthLabel("2026-11-19", "2026-11-19")).toBe("Same Day");
  });
});

describe("swap end date", () => {
  it("reads the completion instant in Eastern time", () => {
    expect(etCalendarDate("2026-11-21T03:30:00Z")).toBe("2026-11-20");
    expect(etCalendarDate("2026-11-21T16:00:00Z")).toBe("2026-11-21");
    expect(etCalendarDate("2026-11-21")).toBe("2026-11-21");
  });
});

describe("which cancelled rental a swap ended", () => {
  const continuing = rental({ id: CONTINUING, status: "active", vehicleId: NEXT, startDate: "2026-11-19" });
  const leftover = rental({ id: LEFTOVER, status: "cancelled", startDate: "2026-11-19", endDate: null });
  const april = rental({ id: APRIL, status: "cancelled", startDate: "2026-04-01", endDate: null });

  it("labels the leftover of the outgoing car as Swap and uses the completion date", () => {
    const found = swapEndsByRentalId([continuing, leftover, april], [swap()]);
    expect([...found.keys()]).toEqual([LEFTOVER]);
    const shown = presentRentalSpan(leftover, found.get(LEFTOVER) ?? null);
    expect(shown.phase).toBe("swap");
    expect(shown.endDate).toBe("2026-11-21");
    expect(shown.lengthLabel).toBe("2 Days");
    expect(presentRentalSpan(april, null).phase).toBe("cancelled");
    expect(presentRentalSpan(continuing, null).phase).toBe("active");
    expect(presentRentalSpan(continuing, null).lengthLabel).toBeNull();
  });

  it("does not treat the continuing rental as ended when the pointer already moved", () => {
    const found = swapEndsByRentalId([continuing, leftover], [swap()]);
    expect(found.has(CONTINUING)).toBe(false);
  });

  it("uses the cancelled row that still names the old car when the swap never moved it", () => {
    const stuck = rental({ id: CONTINUING, status: "cancelled", vehicleId: OLD, endDate: null });
    const found = swapEndsByRentalId([stuck], [swap({ rentalId: CONTINUING })]);
    expect(found.has(CONTINUING)).toBe(true);
    expect(presentRentalSpan(stuck, found.get(CONTINUING) ?? null).endDate).toBe("2026-11-21");
  });

  it("leaves a returned rental Completed even if a swap happened earlier", () => {
    const returned = rental({
      id: CONTINUING,
      status: "closed",
      vehicleId: NEXT,
      startDate: "2026-11-19",
      endDate: "2026-12-01",
    });
    expect(swapEndsByRentalId([returned], [swap()]).size).toBe(0);
    expect(presentRentalSpan(returned, null)).toMatchObject({
      phase: "completed",
      endDate: "2026-12-01",
      lengthLabel: "12 Days (1 Week 5 Days)",
    });
  });

  it("ignores a swap that completed before this rental started", () => {
    const later = rental({ id: LEFTOVER, status: "cancelled", startDate: "2026-12-01" });
    expect(swapEndsByRentalId([later], [swap()]).size).toBe(0);
    expect(presentRentalSpan(later, null).lengthLabel).toBeNull();
  });
});

describe("swap writer and the unapplied backfill", () => {
  const fn = readFileSync("supabase/migrations/20261121070000_swap_insurance_optional.sql", "utf8");
  const body = fn.slice(fn.indexOf("CREATE OR REPLACE FUNCTION public.complete_rental_vehicle_swap_tx"));

  it("does not cancel the rental or write an end date", () => {
    expect(body).toContain("SET vehicle_id = s.to_vehicle_id");
    expect(body).not.toMatch(/rentals[\s\S]{0,200}status\s*=\s*'cancelled'/);
    expect(body).not.toMatch(/SET[\s\S]{0,400}end_date/);
    expect(body).toContain("completed_at = now()");
  });

  it("keeps the backfill out of migrations and limited to a null end date", () => {
    const sql = readFileSync("proposed/backfill-swap-ended-rentals.sql", "utf8");
    expect(sql).toMatch(/NOT APPLIED/);
    expect(sql).toContain("SET end_date = x.swap_end_date");
    expect(sql).toContain("AND r.end_date IS NULL");
    expect(sql).not.toMatch(/SET status\s*=/);
    expect(sql).toContain("Boykins");
    expect(readFileSync("supabase/migrations/20261121070000_swap_insurance_optional.sql", "utf8")).not.toContain("Boykins");
  });
});
