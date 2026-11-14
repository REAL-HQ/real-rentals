/**
 * The insurance authorization REAL RENTALS shows applicants, verbatim, with a
 * version. Client-safe.
 *
 * Insurance is included in the weekly rate, on a policy issued in the renter's
 * own name. Before staff may ask the insurance agency for a quote, the
 * applicant has to authorize it. This is that authorization.
 *
 * Changing a word means bumping INSURANCE_CONSENT_VERSION, so stored evidence
 * keeps pointing at the text the person actually agreed to. The server stores
 * the text from this module, never text sent by the browser.
 */
export const INSURANCE_CONSENT_VERSION = "2026-11-13.v1";

export const INSURANCE_CONSENT_LABEL =
  "I have read and agree to the Insurance Authorization below.";

export const INSURANCE_CONSENT_ITEMS: readonly { title: string; text: string }[] = [
  {
    title: "Quotes",
    text: "I authorize REAL RENTALS and its insurance agency to use the information I provide, including my driver's license, driving record, and household members, to request insurance quotes for me, and to obtain my motor vehicle report and any insurance score the insurance company uses.",
  },
  {
    title: "Policy In My Name",
    text: "If I am approved and choose to rent, I authorize REAL RENTALS and its insurance agency to set up a liability auto policy in my name, covering me and the rental vehicle, and to pay for and manage it.",
  },
  {
    title: "Included In My Rate",
    text: "The policy is included in my weekly rate. It is liability coverage only and does not cover damage to the rental vehicle.",
  },
  {
    title: "Accurate Information",
    text: "Everything I provide is true and complete, including every person who lives in my household, and I will sign any form the insurance company requires.",
  },
  {
    title: "No Obligation",
    text: "A quote does not obligate me to rent, and REAL RENTALS is not obligated to rent to me.",
  },
];

/** Full text stored as evidence with each affirmative authorization. */
export const INSURANCE_CONSENT_TEXT = [
  INSURANCE_CONSENT_LABEL,
  ...INSURANCE_CONSENT_ITEMS.map((item, i) => `${i + 1}. ${item.title}. ${item.text}`),
].join(" ");

export const INSURANCE_CONSENT_ACTION = "application.insurance_authorization_given";
export const INSURANCE_CONSENT_SOURCE_WEB = "website_application";
