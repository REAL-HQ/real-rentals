/**
 * Copy and one-tab flag for the page shown right after application Step 1
 * (Automation Blueprint, Nov 14). Kept in one place so the page, the tests
 * and any later email share the exact words.
 *
 * Rules (tested in scripts/step-one-thank-you.test.ts):
 *  - Title Case on every headline and button.
 *  - About 120 words on the page.
 *  - The gig app profile screenshot is the main document; earnings are optional.
 *  - Never name an insurance broker or carrier.
 */

/**
 * The main business line, the same number as the site header, every other
 * applicant message and the follow-up texts (texts default to it).
 */
export const STEP_ONE_LINE = { display: "(888) 833-8280", e164: "+18888338280" } as const;

export const STEP_ONE_THANK_YOU = {
  /** Same applicant-facing brand as the live site header and every other message. */
  brand: "REAL RENTALS",
  progress: "Step 1 of 2 Done",
  headline: "You're In! Application Received",
  intro: "Cars are limited and go first come, first served. Finish Step 2 to hold your spot.",
  primaryCta: "Upload Documents",
  /** D8 (decided Nov 16): helper line under the button. */
  primaryHelper: "5 quick questions, then upload.",
  secondaryCta: "Text Us",
  insuranceTitle: "Insurance Included in Your Weekly Rate",
  insuranceBody: "We pay for it. No extra cost to you.",
  nextTitle: "What Happens Next",
  steps: [
    { title: "Upload Your Documents", note: "Step 2, about 5 minutes" },
    { title: "Quick Background Check", note: "Usually same day" },
    { title: "Short Call With Our Team", note: "Answer your questions" },
    { title: "Pick Your Car and Pickup Time", note: "Tampa pickup location" },
  ],
  readyTitle: "Have These Ready",
  ready: [
    "Driver's License (Front)",
    "Gig App Profile Screenshot Showing Your # of Trips/Deliveries and Rating",
    "Your Current Home Address",
    "Optional: Earnings Screenshots or Other Proof of Income",
  ],
  privacy: "Why we ask: to verify you and set up your insurance. Stored securely, never sold.",
  contact: `Questions? Call or text ${STEP_ONE_LINE.display}`,
} as const;

/** Every visible string, in page order. Used for the word-count and wording tests. */
export function stepOneThankYouStrings(): string[] {
  const c = STEP_ONE_THANK_YOU;
  return [
    c.brand,
    c.progress,
    c.headline,
    c.intro,
    c.primaryCta,
    c.primaryHelper,
    c.secondaryCta,
    c.insuranceTitle,
    c.insuranceBody,
    c.nextTitle,
    ...c.steps.flatMap((s) => [s.title, s.note]),
    c.readyTitle,
    ...c.ready,
    c.privacy,
    c.contact,
  ];
}

const FLAG = "rr.step1-welcome";

/** Set by the Step 1 forms just before they hand off to /thank-you. */
export function markStepOneJustSubmitted(): void {
  try {
    window.sessionStorage.setItem(FLAG, "1");
  } catch {
    // Blocked storage: the applicant goes straight to Step 2, as before.
  }
}

export function stepOneJustSubmitted(): boolean {
  try {
    return window.sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function clearStepOneJustSubmitted(): void {
  try {
    window.sessionStorage.removeItem(FLAG);
  } catch {
    // ignore
  }
}
