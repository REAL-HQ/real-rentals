import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requiredDocCounts } from "../src/lib/required-docs";
import { buildReadinessIndex } from "../src/lib/readiness-index";
import { computeReadiness } from "../src/lib/readiness";
import { summarizeFleet } from "../src/lib/fleet-summary";
describe("shared readiness", () => {
  it("deduplicates required documents, excludes rejected and superseded", () => {
    assert.deepEqual(requiredDocCounts([
      { lead_id: "a", category: "license_front" }, { lead_id: "a", category: "insurance" },
      { lead_id: "a", category: "insurance_card" },
      { lead_id: "a", category: "license_back", review_status: "rejected" },
      { lead_id: "a", category: "gig_profile", is_current: false },
    ]), { a: 2 });
  });
  it("shares Drivers computation", () => {
    const app = { id: "a", platforms: ["uber"], license_valid: true };
    assert.deepEqual(buildReadinessIndex([app], [], []).get("a"), computeReadiness(app, null, []));
  });
  it("preserves Fleet Available definition", () => {
    assert.equal(summarizeFleet([{ status: "available" }, { status: "available", archived_at: "synthetic" }, { status: "reserved" }]).available, 1);
  });
});
