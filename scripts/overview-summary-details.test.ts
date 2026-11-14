import { describe, expect, it } from "vitest";
import { serviceSummaryPreview, type ServiceSummaryRow } from "../src/components/admin/overview-summary-details";

function row(id: string, status = "maintenance", item = "Oil Change"): ServiceSummaryRow {
  return { vehicle: { id, unit_number: id, status }, item, due: { state: "open" } };
}

describe("Overview service preview", () => {
  it("shows at most two distinct service vehicles, not all cars or multiple jobs for one car", () => {
    const rows = [row("RR-001"), row("RR-001", "maintenance", "Brakes"), row("RR-002"), row("RR-003")];
    expect(serviceSummaryPreview(rows).map((r) => r.vehicle.id)).toEqual(["RR-001", "RR-002"]);
    expect(rows).toHaveLength(4);
  });

  it("prioritizes cars actually in maintenance without relabeling due-only cars", () => {
    const preview = serviceSummaryPreview([row("RR-001", "available"), row("RR-002"), row("RR-003")]);
    expect(preview.map((r) => r.vehicle.id)).toEqual(["RR-002", "RR-003"]);
    const dueOnly = serviceSummaryPreview([row("RR-001", "available")]);
    expect(dueOnly[0].vehicle.status).toBe("available");
  });

  it("does not invent vehicles when there are zero or one and excludes archived records", () => {
    expect(serviceSummaryPreview([])).toEqual([]);
    expect(serviceSummaryPreview([row("RR-001")])).toEqual([row("RR-001")]);
    const archived = row("RR-002");
    archived.vehicle.archived_at = "2026-11-08";
    expect(serviceSummaryPreview([archived, row("RR-001")])).toEqual([row("RR-001")]);
  });
});