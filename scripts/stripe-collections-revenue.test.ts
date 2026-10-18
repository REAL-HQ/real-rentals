import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { collectionsRequestRange, stripeCollectedLabel, type CollectionsReport } from "../src/lib/stripe-collections";

vi.mock("@/lib/stripe-collections.functions", () => ({ getStripeCollections: vi.fn() }));
const { stripeCollectionsQuery } = await import("../src/lib/stripe-collections-query");

const report = (over: Partial<CollectionsReport> = {}) => ({
  collectionsComplete: true,
  totals: [{ currency: "usd", gross: 105000, refunds: 0, fees: 3135, net: 101865, successful: 3, failed: 0 }],
  ...over,
}) as CollectionsReport;

describe("Revenue card Stripe Collected", () => {
  it("shows verified net after fees and refunds", () => { expect(stripeCollectedLabel(report())).toBe("$1,018.65"); });
  it("shows — when unavailable, incomplete or net unknown", () => {
    expect(stripeCollectedLabel(undefined)).toBe("—");
    expect(stripeCollectedLabel(report({ collectionsComplete: false }))).toBe("—");
    expect(stripeCollectedLabel(report({ totals: null }))).toBe("—");
    expect(stripeCollectedLabel(report({ totals: [{ currency: "usd", gross: 1, refunds: 0, fees: null, net: null, successful: 1, failed: 0 }] }))).toBe("—");
  });
  it("covers the selected local days: midnight of From to midnight after To", () => {
    const r = collectionsRequestRange("2026-10-12", "2026-10-18")!;
    expect(new Date(r.from).getTime()).toBe(new Date("2026-10-12T00:00:00").getTime());
    expect(new Date(r.to).getTime()).toBe(new Date("2026-10-19T00:00:00").getTime());
    expect(collectionsRequestRange("2026-10-18", "2026-10-12")).toBeNull();
    expect(collectionsRequestRange("2025-01-01", "2026-10-18")).toBeNull();
  });
  it("sends the exact period to the authorized endpoint and surfaces errors", async () => {
    const load = vi.fn().mockResolvedValue({ report: report() });
    const q = stripeCollectionsQuery(load as never, "live", "2026-10-12", "2026-10-18", true);
    await q.queryFn();
    expect(load).toHaveBeenCalledWith({ data: { environment: "live", ...collectionsRequestRange("2026-10-12", "2026-10-18") } });
    const failing = stripeCollectionsQuery(vi.fn().mockResolvedValue({ error: "Forbidden" }) as never, "live", "2026-10-12", "2026-10-18", true);
    await expect(failing.queryFn()).rejects.toThrow("Forbidden");
  });
  it("shares one cache key with the Collections section for the same period", () => {
    const a = stripeCollectionsQuery(vi.fn() as never, "live", "2026-10-12", "2026-10-18", true);
    const b = stripeCollectionsQuery(vi.fn() as never, "live", "2026-10-12", "2026-10-18", true);
    expect(a.queryKey).toEqual(b.queryKey);
    expect(stripeCollectionsQuery(vi.fn() as never, "live", "2026-10-18", "2026-10-12", true).enabled).toBe(false);
  });
  it("mounts the line only for Owner/Manager and never adds it to revenue", () => {
    const src = readFileSync(new URL("../src/components/admin/OverviewPanel.tsx", import.meta.url), "utf8");
    expect(src).toContain("stripeCollected={canSeeCollections ? <StripeCollectedLine range={range} /> : null}");
    expect(src).toContain("amount={revenue}");
    expect(src).toMatch(/\.from\("payments"\)\s*\.select\("net_collected"\)/);
  });
});
