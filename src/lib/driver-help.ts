/**
 * Static driver help. The flag is a hard constant. While it is false the
 * portal renders no Help link, and /portal/help redirects to /portal before
 * the page component runs. Nothing here reads or writes data.
 *
 * Sentences are copied from the public site, the portal, or the rental
 * agreement already in the repo. A gap is a TODO, not a made-up rule.
 */

import { COMPANY_DEFAULTS } from "@/lib/agreement-merge";
import { toBusinessPhone } from "@/lib/company";

export const DRIVER_HELP_ENABLED: boolean = false;

const phone = toBusinessPhone(null);

/** Fallback display of Settings → Company → Business Phone. No settings read. */
export const DRIVER_HELP_PHONE = phone.display;
export const DRIVER_HELP_PHONE_TEL = phone.tel;
/** Same address as the contact page and COMPANY_DEFAULTS. */
export const DRIVER_HELP_EMAIL = COMPANY_DEFAULTS.company_email;

export type HelpTopic = {
  title: string;
  stated: string[];
  /** Null when the repo already answers the question. */
  todo: string | null;
};

export const DRIVER_HELP_TOPICS: HelpTopic[] = [
  {
    title: "How To Pay",
    stated: [
      "Debit, credit, or Cash App. Rent is paid in advance every week via auto-pay.",
      "The Payments page shows Autopay and Pay Now.",
    ],
    todo: null,
  },
  {
    title: "When Payment Is Due",
    stated: [
      "Rent is paid in advance every week.",
      "The weekly rate is due in advance.",
      "When a due date is recorded on the rental, Payments shows it as Due and that date.",
    ],
    todo: "The exact weekday and time. The site only says weekly, in advance.",
  },
  {
    title: "If A Payment Fails",
    stated: [
      "If a charge is declined, you authorize us to run it again, and you remain responsible for the balance.",
      "Please update your card to avoid interruption.",
      "Your rent payment is past due. Update your card or pay the balance below.",
      "Late payments may incur late fees and may result in suspension of the rental.",
    ],
    todo: "The late-fee amount. The agreement fee schedule still has open items, so no amount is shown here.",
  },
  {
    title: "Upload Or Replace Documents",
    stated: [
      "Keep your license and insurance current. Uploading a new file replaces the old one — we keep the history.",
      "Upload or replace your licence and insurance, and read your rental agreement.",
      "Files must be under 15 MB.",
    ],
    todo: null,
  },
  {
    title: "Pickup And Return",
    stated: [
      "Schedule pickup at our lot. Your vehicle is detailed, inspected, fueled, and rideshare-ready.",
      "Photograph the car when you pick it up and again when you bring it back.",
      "Return the vehicle in the same condition.",
      "Return the vehicle on time, at the agreed place, with all personal items removed.",
    ],
    todo: "The lot address, the hours, how to schedule the pickup, and the agreed return place and time.",
  },
  {
    title: "Who To Contact",
    stated: [
      `Need help? Call ${DRIVER_HELP_PHONE} or email ${DRIVER_HELP_EMAIL}.`,
      "24/7 driver support.",
    ],
    todo: null,
  },
];
