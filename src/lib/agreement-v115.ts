// REAL RENTALS Vehicle Rental Agreement v1.15 (Insurance Included): v1.14
// (agreement-v114.ts) plus the eight Florida additions Dolmar approved for
// building on Nov 19 2026 (relayed by FLEET, 9:04 PM ET). Client-safe.
//
// v1.15 is derived from the v1.14 source by exact substitutions (sub() throws
// if the v1.14 text it anchors on ever changes), so every v1.14 word is kept
// and the only differences are the additions below. The added wording is
// verbatim from the Owner's request and still needs review by a Florida
// attorney before it is relied on.
//
// v1.14 stays exported and renderable: signed agreements keep the exact text
// they were signed with (agreements.body), and the library keeps v1.14 as its
// own family so it can still be previewed and compared.

import { V114_SOURCE, V114_TERM_DEFAULTS } from "@/lib/agreement-v114";

/** 1. Florida s. 812.155(6) notice (already in v1.14 Section 17.2; unchanged). */
export const FL_812155_NOTICE =
  "FLORIDA REQUIRED NOTICE (Section 812.155(6), Florida Statutes). Failure to return rental property or equipment upon expiration of the rental period and failure to pay all amounts due (including costs for damage to the property or equipment) are evidence of abandonment or refusal to redeliver the property, punishable in accordance with section 812.155, Florida Statutes.";
/** 2. Section 2.2: the Rental Period ends at the end of the last paid period. */
export const CLAUSE_RENTAL_PERIOD_ENDS =
  "If any payment is not received when due, the Rental Period expires at the end of the last paid period, and your right to possess the Vehicle ends at that time without further notice.";
/** 3. Section 16.3: consent to possess is withdrawn. */
export const CLAUSE_CONSENT_WITHDRAWN =
  "When the Rental Period expires or we end the rental for default, our consent for you to possess or use the Vehicle is withdrawn. Any continued possession is without our consent, and rent continues to accrue at the daily rate until the Vehicle is returned or recovered.";
/** 4. Notice address (printed under Rental & Vehicle Information). */
export const CLAUSE_NOTICE_ADDRESS =
  "The Home Address above is your address for all legal notices and demands, including demands under Section 812.155. You must tell us in writing within 24 hours if it changes. Notice sent to the last address you gave us is effective even if returned undelivered.";
/** 5. Section 10.3: consent outside the pickup county is limited to the Service Area. */
export const CLAUSE_SERVICE_AREA_CONSENT =
  "Our written consent to use the Vehicle outside the county where you picked it up is limited to the Service Area. Taking the Vehicle outside the Service Area or outside Florida without our separate written consent is not authorized.";
/** 6. Section 15: starter-interrupt disclosure (own Renter Initials row). */
export const CLAUSE_STARTER_INTERRUPT =
  "The Vehicle has a remote starter-interrupt device. If you are in default under Section 16, we may activate it, which prevents the Vehicle from restarting after the engine is turned off. We will not activate it to stop a moving vehicle. You agree we are not liable for lost earnings or other losses from its proper use.";
/** 7. Section 4 fee row, as requested ("item: amount"); printed as the row's two cells. */
export const CLAUSE_PEST_FEE =
  "Pest, insect, or biohazard infestation caused during your rental: actual treatment cost + Loss of Use while the Vehicle is out of service.";
export const PEST_FEE_ITEM = "Pest, insect, or biohazard infestation caused during your rental";
export const PEST_FEE_AMOUNT = "actual treatment cost + Loss of Use while the Vehicle is out of service.";
/** 7b. Damage Waiver exclusion added to Section 7.5 "What it does not cover". */
export const PEST_WAIVER_EXCLUSION = "pest, insect, or biohazard infestation";
/** 8. Section 19: driver's license copy consent. */
export const CLAUSE_LICENSE_COPY =
  "You consent to our copying and keeping your driver's license, and we may re-verify it during the rental.";

/** The Renter Initials row for the starter-interrupt disclosure. */
export const STARTER_INTERRUPT_INITIALS_ROW = "Section 15: Starter-Interrupt Device.";

/** Every v1.15 addition, for tests and the PR checklist. */
export const V115_ADDITIONS = [
  FL_812155_NOTICE,
  CLAUSE_RENTAL_PERIOD_ENDS,
  CLAUSE_CONSENT_WITHDRAWN,
  CLAUSE_NOTICE_ADDRESS,
  CLAUSE_SERVICE_AREA_CONSENT,
  CLAUSE_STARTER_INTERRUPT,
  CLAUSE_PEST_FEE,
  CLAUSE_LICENSE_COPY,
] as const;

/** Exact substitution that fails loudly if the v1.14 anchor text is not found. */
function sub(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`agreement-v115: v1.14 anchor not found: ${from.slice(0, 60)}`);
  if (text.indexOf(from, at + from.length) >= 0) throw new Error(`agreement-v115: v1.14 anchor is not unique: ${from.slice(0, 60)}`);
  return text.replace(from, to);
}

let s = V114_SOURCE;
s = sub(s, "#- Vehicle Rental Agreement (v1.14)", "#- Vehicle Rental Agreement (v1.15)");
// 4. Notice address, right under the table that prints the Home Address.
s = sub(
  s,
  "| Optional Damage Waiver ([[damage_waiver_fee]] per week, Section 7.5) | {{damage_waiver}}\n",
  `| Optional Damage Waiver ([[damage_waiver_fee]] per week, Section 7.5) | {{damage_waiver}}\n**Notice Address.** ${CLAUSE_NOTICE_ADDRESS}\n`,
);
// 2. Section 2.2.
s = sub(
  s,
  "You may not keep the Vehicle for any period that has not been paid for.",
  `You may not keep the Vehicle for any period that has not been paid for. ${CLAUSE_RENTAL_PERIOD_ENDS}`,
);
// 7. Section 4 fee row (after the other renter-caused condition charges).
s = sub(
  s,
  "| Excessive cleaning, including pet hair and spills | [[fee_cleaning]]\n",
  `| Excessive cleaning, including pet hair and spills | [[fee_cleaning]]\n| ${PEST_FEE_ITEM} | ${PEST_FEE_AMOUNT}\n`,
);
// 7b. Damage Waiver exclusions.
s = sub(
  s,
  "**What it does not cover.** It does not apply to tires, wheels, keys or fobs, interior damage, cleaning, smoking or odor charges, fuel,",
  `**What it does not cover.** It does not apply to tires, wheels, keys or fobs, interior damage, cleaning, smoking or odor charges, ${PEST_WAIVER_EXCLUSION}, fuel,`,
);
// 5. Section 10.3.
s = sub(
  s,
  "A prohibited use may void insurance coverage, and you are responsible for all losses that result.\n",
  `A prohibited use may void insurance coverage, and you are responsible for all losses that result.\n**10.3 Service Area.** ${CLAUSE_SERVICE_AREA_CONSENT}\n`,
);
// 6. Section 15 disclosure.
s = sub(
  s,
  "to recover it without breach of the peace.\n",
  `to recover it without breach of the peace.\n**Starter-Interrupt Device.** ${CLAUSE_STARTER_INTERRUPT}\n`,
);
// 3. Section 16.3.
s = sub(
  s,
  "Amounts owed for the minimum term remain due, less credit for weeks re-rented.\n",
  `Amounts owed for the minimum term remain due, less credit for weeks re-rented.\n**16.3 Consent Withdrawn.** ${CLAUSE_CONSENT_WITHDRAWN}\n`,
);
// 8. Section 19.
s = sub(
  s,
  "and we may decline or end a rental based on what we find.\n",
  `and we may decline or end a rental based on what we find.\n**Driver's License Copy.** ${CLAUSE_LICENSE_COPY}\n`,
);
// 6. Own Renter Initials row, right after Section 15.
s = sub(
  s,
  "|i Section 15: Vehicle Recovery.\n",
  `|i Section 15: Vehicle Recovery.\n|i ${STARTER_INTERRUPT_INITIALS_ROW}\n`,
);
// 1. The s. 812.155(6) notice stays exactly as v1.14 prints it (Section 17.2, "! " box).
if (!s.replace(/\*\*/g, "").includes(`! ${FL_812155_NOTICE}`)) throw new Error("agreement-v115: the s. 812.155(6) notice is missing");

export const V115_SOURCE = s;

/** v1.15 prints the same contract values as v1.14 (fees, Service Area, venue). */
export const V115_TERM_DEFAULTS: Record<string, string> = { ...V114_TERM_DEFAULTS };
