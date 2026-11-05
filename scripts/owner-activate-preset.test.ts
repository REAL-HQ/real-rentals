import { describe, expect, test } from "bun:test";
import {
  OWNER_APPROVED_RENTAL_REASON,
  canUseOwnerActivatePreset,
  decideActivation,
  isOwnerApprovedRentalPreset,
  type InsuranceReadiness,
} from "../src/lib/activation-readiness";

const insurance: InsuranceReadiness = {
  status: "verified",
  exceptionAllowed: false,
  hasCurrent: true,
  expiresAt: null,
};

const soft = [{ code: "no_interview" as const, message: "Interview incomplete" }];

describe("owner approved rental preset", () => {
  test("exact phrase matches case-insensitively", () => {
    expect(isOwnerApprovedRentalPreset("owner approved rental")).toBe(true);
    expect(isOwnerApprovedRentalPreset(" Owner Approved Rental ")).toBe(true);
    expect(isOwnerApprovedRentalPreset("owner says ok")).toBe(false);
    expect(OWNER_APPROVED_RENTAL_REASON).toBe("owner approved rental");
  });

  test("only owner/admin may use the one-click preset", () => {
    expect(canUseOwnerActivatePreset(true)).toBe(true);
    expect(canUseOwnerActivatePreset(false)).toBe(false);
  });

  test("owner can activate soft blockers with the preset", () => {
    const d = decideActivation(
      { blockers: soft, insurance },
      { overrideBlockers: true, overrideReason: OWNER_APPROVED_RENTAL_REASON, actorIsOwner: true },
    );
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.overridden.map((b) => b.code)).toEqual(["no_interview"]);
  });

  test("manager cannot use the preset even with override checked", () => {
    const d = decideActivation(
      { blockers: soft, insurance },
      { overrideBlockers: true, overrideReason: "owner approved rental", actorIsOwner: false },
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.blockers[0]?.code).toBe("override_reason_required");
  });

  test("manager may still type their own reason", () => {
    const d = decideActivation(
      { blockers: soft, insurance },
      { overrideBlockers: true, overrideReason: "Checked docs in person with renter", actorIsOwner: false },
    );
    expect(d.ok).toBe(true);
  });
});
