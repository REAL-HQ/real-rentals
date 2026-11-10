import { describe, expect, it } from "vitest";
import { ACTIVATE_FROM_LIST, driverListStatusMenu, nextActivationResolution, activationAgreementPatch } from "./driver-list-activation";

describe("driverListStatusMenu", () => {
  it("adds Active action and drops status active for managers", () => {
    const menu = driverListStatusMenu("approved", "manager", false);
    expect(menu.some((c) => c.value === "active")).toBe(false);
    const act = menu.find((c) => c.value === ACTIVATE_FROM_LIST);
    expect(act?.label).toBe("Active");
    expect(act?.disabled).toBe(false);
  });

  it("disables Active when a rental already exists or actor is coordinator", () => {
    expect(driverListStatusMenu("approved", "manager", true).find((c) => c.value === ACTIVATE_FROM_LIST)?.disabled).toBe(true);
    expect(driverListStatusMenu("approved", "coordinator", false).find((c) => c.value === ACTIVATE_FROM_LIST)?.disabled).toBe(true);
  });
});

describe("nextActivationResolution", () => {
  it("returns null when already active", () => {
    expect(nextActivationResolution([{ code: "already_active", label: "x" } as any])).toBeNull();
  });
  it("prefers email before documents", () => {
    expect(nextActivationResolution([
      { code: "missing_documents", label: "d" },
      { code: "no_email", label: "e" },
    ] as any)?.key).toBe("email");
  });
});

describe("activationAgreementPatch", () => {
  it("maps a valid draft", () => {
    expect(activationAgreementPatch({
      vehicleId: "v1", weeklyRate: 400, depositAmount: 0, startDate: "2026-11-10", endDate: null,
    })).toEqual({
      vehicle_id: "v1", weekly_rent: 400, deposit_amount: 0,
      contract_start_date: "2026-11-10", contract_end_date: null,
    });
  });
  it("rejects a zero weekly rate", () => {
    expect(() => activationAgreementPatch({
      vehicleId: "v1", weeklyRate: 0, depositAmount: 0, startDate: "2026-11-10", endDate: null,
    })).toThrow(/weekly rate/i);
  });
});
