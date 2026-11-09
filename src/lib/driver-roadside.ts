/**
 * Static roadside help. The flag is a hard constant. While it is false the
 * portal renders no Roadside Help link, and /portal/roadside redirects to
 * /portal before the page component runs. Nothing here reads or writes data.
 *
 * Sentences are copied from the rental agreement, the incident categories,
 * or the portal. A gap is a TODO, not a made-up rule, fee, or coverage.
 */

import { COMPANY_DEFAULTS } from "@/lib/agreement-merge";
import { toBusinessPhone } from "@/lib/company";

export const DRIVER_ROADSIDE_ENABLED: boolean = false;

const phone = toBusinessPhone(null);

/** Fallback display of Settings → Company → Business Phone. No settings read. */
export const ROADSIDE_PHONE = phone.display;
export const ROADSIDE_PHONE_TEL = phone.tel;
export const ROADSIDE_EMAIL = COMPANY_DEFAULTS.company_email;
export const ROADSIDE_EMERGENCY_TEL = "tel:911";
export const ROADSIDE_PATH = "/portal/roadside" as const;

/** Href for the My Car card. Null while this flag is off. */
export function roadsideHelpHref(enabled: boolean = DRIVER_ROADSIDE_ENABLED): typeof ROADSIDE_PATH | null {
  return enabled === true ? ROADSIDE_PATH : null;
}

export type RoadsideSection = {
  title: string;
  /** Staff incident category when one already exists. */
  category: string | null;
  stated: string[];
  todo: string | null;
};

export const ROADSIDE_SECTIONS: RoadsideSection[] = [
  {
    title: "After An Accident",
    category: "Accident",
    stated: [
      "If you're in an accident: call 911 if anyone is hurt and get a police report, photograph the scene and the other driver's license and insurance, then contact us right away.",
      `Contact us at ${ROADSIDE_PHONE} and email the details to ${ROADSIDE_EMAIL}.`,
      "Report any damage, loss, or theft immediately.",
    ],
    todo: "The written-statement deadline. The agreement says to provide one within [[report_hours]] hours, and that hours value is still a bracketed open item.",
  },
  {
    title: "Breakdown",
    category: "Breakdown",
    stated: [
      "Report any dashboard warning light, mechanical problem, or damage to us.",
      "Stop driving if continuing could cause further damage.",
      "Do not have any repair, service, or towing done without our approval. We choose the repair shop. Unapproved repairs are not reimbursed.",
      "Normal maintenance and mechanical failures not caused by you are our cost.",
    ],
    todo: "How many hours you have to report it. The agreement's [[report_hours]] value is still a bracketed open item.",
  },
  {
    title: "Flat Tire",
    category: null,
    stated: [
      "Flat or damaged tires, and towing or repairs caused by misuse, neglect, or a prohibited use, are your cost.",
      "Do not have any repair, service, or towing done without our approval. We choose the repair shop.",
    ],
    todo: "The flat-tire amount. The fee schedule still has an open item for it, so no amount is shown here.",
  },
  {
    title: "Lockout",
    category: null,
    stated: [
      "Lost keys and lockout service calls are charged as listed in the Fee Schedule.",
      "Return the key or fob with the vehicle.",
    ],
    todo: "The lockout amount, and who to call for a locksmith. The fee schedule amount is still a bracketed open item, and the repo does not name a locksmith.",
  },
  {
    title: "Ticket Or Toll",
    category: null,
    stated: [
      "You're responsible for all tolls, tickets, camera citations, and violations during your rental.",
    ],
    todo: "Any fee added on top of the toll or ticket. One agreement family adds a processing fee and a later family says tolls have no added fee, so no fee is shown here.",
  },
];

export const ROADSIDE_CHECKLIST = [
  "Photos of the scene, and of the other driver's license and insurance.",
  "The other driver's info: name, insurer, and plate.",
  "A police report number.",
] as const;
