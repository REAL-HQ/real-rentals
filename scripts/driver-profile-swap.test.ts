// Swap Vehicle from the driver profile: one swap flow reused in a popup,
// Manager/Owner only, Return stays the primary, and Send says why it is off.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const { swapSendBlockers } = await import("@/lib/vehicle-swap");
const read = (f: string) => readFileSync(f, "utf8");
const base = { hasVehicle: true, hasPreview: true, stale: false, previewBlocked: false, reasonLength: 10, companyPending: false };

describe("swapSendBlockers", () => {
  test("nothing blocks a ready swap", () => expect(swapSendBlockers(base)).toEqual([]));
  test("short Reason Details is called out (FLEET got stuck on this)", () => {
    expect(swapSendBlockers({ ...base, reasonLength: 4 })).toEqual(["Add Reason Details (5+ Characters) To Send"]);
  });
  test("no vehicle comes first and hides the preview hint", () => {
    expect(swapSendBlockers({ ...base, hasVehicle: false, hasPreview: false })).toEqual(["Choose A Replacement Vehicle"]);
  });
  test("a cleared preview says Preview Again, a fresh form says Preview The Agreement", () => {
    expect(swapSendBlockers({ ...base, hasPreview: false, stale: true })).toEqual(["Preview Again To Send"]);
    expect(swapSendBlockers({ ...base, hasPreview: false })).toEqual(["Preview The Agreement To Send"]);
  });
  test("preview blockers and the company box are listed", () => {
    expect(swapSendBlockers({ ...base, previewBlocked: true, companyPending: true })).toEqual(["Fix The Items Listed Above", "Confirm The Company Details Box"]);
  });
  test("hints are Title Case", () => {
    for (const h of swapSendBlockers({ hasVehicle: false, hasPreview: false, stale: true, previewBlocked: true, reasonLength: 0, companyPending: true })) expect(h).toMatch(/^[A-Z]/);
  });
});

describe("driver profile wiring", () => {
  const d = read("src/components/admin/DriversPanel.tsx");
  const n = read("src/components/admin/NextStepCard.tsx");
  const dlg = read("src/components/admin/DriverSwapDialog.tsx");
  const h = read("src/components/admin/BookingVehicleHistory.tsx");
  test("button is gated to Manager/Owner with an active rental", () => {
    expect(d).toContain("const canSwap = (isManager || isOwner) && rentalActive && Boolean(activeRentalId);");
  });
  test("Swap appears in the header, Next Step card and Actions row", () => {
    expect(d).toContain('data-testid="profile-swap"');
    expect(d).toContain('data-testid="driver-swap-actions"');
    expect(n).toContain('data-testid="next-step-swap"');
    expect(d.match(/onSwap=\{canSwap/g)?.length).toBe(2);
  });
  test("Return stays the primary red; Swap is outline", () => {
    expect(n).toMatch(/onClick=\{onSwap\} className=\{secondary\}/);
    expect(d).toMatch(/setSwapOpen\(true\)\} data-testid="driver-swap-actions"/);
    expect(d).toContain('className={btnPrimary} onClick={() => setReturnFlowOpen(true)}');
  });
  test("the popup reuses the booking swap panel, wide, with no duplicate swap logic", () => {
    expect(dlg).toContain('import { SwapVehiclePanel } from "./BookingVehicleHistory"');
    expect(dlg).toContain("max-w-6xl");
    expect(dlg).not.toMatch(/previewSwapVehicle|sendSwapVehicleAgreement|completeSwapVehicle/);
    expect(h).toContain("export function SwapVehiclePanel");
    expect(h).toContain("{!openSwap && !autoOpen && (");
    expect(h).toContain("{enabled && openSwap && <OpenSwapCard");
  });
  test("the feature flag still gates the form", () => {
    expect(h).toContain("const enabled = opt?.ok === true && opt.enabled === true;");
    expect(h).toContain("{enabled && !openSwap && open && opt && (");
  });
  test("send hint is shown and the dialog is titled in Title Case", () => {
    expect(h).toContain('data-testid="swap-send-hint"');
    expect(dlg).toContain("Swap Vehicle");
    expect(dlg).not.toMatch(/uppercase|text-transform/);
  });
});
