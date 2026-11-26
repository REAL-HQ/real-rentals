/**
 * Next Step markers: Terms Confirmed and Reservation Paid use the same circle
 * as other rows. Nothing here changes whether a step is complete.
 */
import { describe, expect, test } from "bun:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivationRequirementList } from "../src/components/admin/ActivationRequirementList";
import { driverNextStepRequirements } from "../src/lib/driver-next-step-requirements";
import { termsConfirmedRequirement } from "../src/lib/staff-terms";
import type { ActivationRequirement } from "../src/lib/activation-readiness";

function row(html: string, key: string) {
  const match = html.match(new RegExp(`<li[^>]*data-requirement="${key}"[\\s\\S]*?</li>`));
  if (!match) throw new Error(`missing ${key}`);
  return match[0];
}

const sample: ActivationRequirement[] = [
  { key: "approved", label: "Application Approved", met: true, enforcement: "hard" },
  { key: "signed_agreement", label: "Agreement Signed", met: false, enforcement: "hard" },
  { key: "inspection", label: "Pickup Inspection", met: null, enforcement: "hard" },
];

describe("checklist status circles", () => {
  test("After Approval and Not Recorded draw an empty circle, and a check once done", () => {
    const waiting = termsConfirmedRequirement(null, { approved: false, agreementSigned: false });
    const done = termsConfirmedRequirement(null, { approved: true, agreementSigned: true });
    expect(waiting).toMatchObject({ met: null, detail: "After Approval" });
    expect(done.met).toBe(true);

    const open = renderToStaticMarkup(
      h(ActivationRequirementList, {
        embedded: true,
        requirements: driverNextStepRequirements(sample, null, waiting),
      }),
    );
    const terms = row(open, "terms_confirmed");
    const fee = row(open, "reservation_paid");
    const agreement = row(open, "signed_agreement");
    const inspection = row(open, "inspection");
    for (const marker of [terms, fee, agreement]) {
      expect(marker).toContain('aria-label="Incomplete"');
      expect(marker).toContain("text-destructive");
      expect(marker).not.toContain('aria-label="Not Checked Yet"');
    }
    expect(terms).toContain("After Approval");
    expect(fee).toContain("Not Recorded");
    expect(fee).toContain('data-met="null"');
    // A step that still cannot be judged keeps the dash.
    expect(inspection).toContain('aria-label="Not Checked Yet"');

    const closed = renderToStaticMarkup(
      h(ActivationRequirementList, {
        embedded: true,
        requirements: driverNextStepRequirements(sample, "paid", done),
      }),
    );
    for (const key of ["terms_confirmed", "reservation_paid", "approved"]) {
      const marker = row(closed, key);
      expect(marker).toContain('aria-label="Complete"');
      expect(marker).toContain('data-met="true"');
      expect(marker).not.toContain('aria-label="Incomplete"');
    }
  });
});
