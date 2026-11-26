// REAL RENTALS Vehicle Rental Agreement v1.16 (Insurance Included): v1.15
// (agreement-v115.ts) with Section 13 replaced by the toll and citation terms.
// Client-safe.
//
// v1.16 is derived from the v1.15 source by exact substitutions (sub() throws
// if the v1.15 text it anchors on ever changes), so every other v1.15 word is
// kept. v1.15 stays exported and renderable: signed agreements keep the exact
// text they were signed with (agreements.body), and the library keeps v1.15
// as its own family.
//
// Section 13 values set Nov 21 2026: 1 day to provide a working payment
// method after a failed toll or citation charge, a $25 toll-transponder
// replacement charge, and 3 days to ask in writing for a review. A review
// request does not delay an agency deadline, including a transfer affidavit. The
// citation administrative fee stays fee_citation_admin ($25), the same amount
// Section 4 prints. Ordinary tolls stay at the amount the agency charges.

import { V115_SOURCE, V115_TERM_DEFAULTS } from "@/lib/agreement-v115";

/** 13.4: days to provide a working payment method after notice of a failed charge. */
export const TOLL_PAYMENT_CURE = "1 day";
/** 13.5: replacement charge if the toll transponder is missing, damaged, or tampered with. */
export const TRANSPONDER_REPLACEMENT_CHARGE = "$25";
/** 13.7: days to ask in writing for a review of a toll or citation charge. */
export const TOLL_REVIEW_WINDOW = "3 days";

const CITATION_ADMIN_FEE = "$25";
if (V115_TERM_DEFAULTS.fee_citation_admin !== CITATION_ADMIN_FEE) {
  throw new Error("agreement-v116: fee_citation_admin is no longer $25");
}

/** v1.15 Section 13, the only block v1.16 replaces. */
const V115_SECTION_13 = `## 13. Tolls & Tickets
**13.1 Tolls.** You are responsible for all tolls during the Rental Period. The Vehicle may have a toll transponder or be billed by plate. Do not remove or move the transponder, and tell us before using your own transponder to avoid double billing.
**13.2 Tickets & Citations.** You are responsible for all parking tickets, camera citations, moving violations, fines, and penalties during the Rental Period. If we receive one, we may transfer it to you by giving the issuing agency your name, address, and license information, as Florida law allows, or pay it and charge you. Disputes about a citation are between you and the issuing agency.`;

/**
 * Section 13 of v1.16. The citation administrative fee is [[fee_citation_admin]]
 * so it stays the Section 4 amount. The transponder replacement is its own
 * charge, not that fee.
 */
export const SECTION_13 = `## 13. Tolls & Tickets
**13.1 Tolls.** You are responsible for all tolls during the Rental Period. The Vehicle may have a toll transponder or be billed by plate. Do not remove or move the transponder, and tell us before using your own transponder to avoid double billing. You pay the actual toll amount, including toll-by-plate rates and any invoice, late, or collection fees the toll agency adds. We add no fee of our own on ordinary tolls.
**13.2 Tickets & Citations.** You are responsible for all parking tickets, camera citations, moving violations, fines, and penalties during the Rental Period. If we receive one, we may transfer it to you by giving the issuing agency your name, address, date of birth, driver license number, the rental dates, and a copy of this Agreement, as Florida law allows, or pay it and charge you. Disputes about a citation are between you and the issuing agency. For each ticket, citation, camera fine, or mailed notice we handle, you also pay the [[fee_citation_admin]] administrative fee shown in Section 4, in addition to the amount charged by the agency or court.
**13.3 Transfer-of-Liability Affidavits & Your Consent.** You understand that, as the registered owner, we may be held liable for tolls and citations unless we identify the person who had the Vehicle. You consent to us preparing, signing, and filing affidavits that name you as the person who rented, or had care, custody, or control of, the Vehicle, including under Florida Statutes §316.1001(2)(c) (toll citations), §316.0083 (red-light camera notices), §316.1896 (school-zone speed cameras), and similar laws. You consent to us giving your name, address, date of birth, driver license number, the rental dates, and a copy of this Agreement to any toll agency, law enforcement agency, camera-enforcement program, court or clerk, or their vendors for this purpose. You agree to give us accurate, current identity and address information and to update it if it changes. Once a notice is transferred to you, you must pay or contest it directly and on time. A transfer does not waive the [[fee_citation_admin]] administrative fee if we already handled or paid the item. Because agencies set strict deadlines, we may act before you respond.
**13.4 Items That Arrive Late; Declined Charges.** A toll or citation may reach us after the Rental Period ends. You remain responsible for it, and under Section 3.3 we may charge your card on file for it as it comes in, until everything you owe is paid. If a charge for a toll, citation, or fee is declined, you must give us a working payment method within ${TOLL_PAYMENT_CURE} of our notice.
**13.5 Toll Transponder.** Keep any toll transponder installed and mounted in the Vehicle. Do not remove, cover, shield, disable, swap, or tamper with it, and do not use it in another vehicle. If it is missing, damaged, or tampered with, you pay a replacement charge of ${TRANSPONDER_REPLACEMENT_CHARGE}, plus any tolls and fees that result.
**13.6 Third-Party Toll Billing.** If we use a third-party toll billing service, that service's fee may be billed to you instead of, and not in addition to, any fee of ours on ordinary tolls. Our fee on ordinary tolls remains $0. You authorize us to share the information in Section 13.3 with that service.
**13.7 Questions About a Charge.** If you believe a toll or citation charge is wrong, tell us in writing within ${TOLL_REVIEW_WINDOW} of the charge. A review does not pause any deadline we must meet with an agency, including the deadline to file a transfer affidavit.`;

for (const re of [/\[__\]/, /\[\$__\]/, /attorney/i, /DRAFT/i, /\(optional\)/i, /suggested 14/i]) {
  if (re.test(SECTION_13)) throw new Error(`agreement-v116: Section 13 still has review or blank markup (${re})`);
}

/** Exact substitution that fails loudly if the v1.15 anchor text is not found. */
function sub(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`agreement-v116: v1.15 anchor not found: ${from.slice(0, 80)}`);
  if (text.indexOf(from, at + from.length) >= 0) throw new Error(`agreement-v116: v1.15 anchor is not unique: ${from.slice(0, 80)}`);
  return text.replace(from, to);
}

let s = V115_SOURCE;
s = sub(s, "#- Vehicle Rental Agreement (v1.15)", "#- Vehicle Rental Agreement (v1.16)");
s = sub(s, V115_SECTION_13, SECTION_13);
if (!s.includes("**13.7 Questions About a Charge.**")) throw new Error("agreement-v116: Section 13.7 is missing");
if (s.includes("name, address, and license information")) throw new Error("agreement-v116: v1.15 Section 13.2 wording is still present");

export const V116_SOURCE = s;

/**
 * v1.16 prints the same contract values as v1.15, except the additional-driver
 * fee. That fee is a fill-in term, so signed agreements keep the amount that
 * was printed when they were signed. Older families stay on their own amounts.
 */
export const V116_TERM_DEFAULTS: Record<string, string> = {
  ...V115_TERM_DEFAULTS,
  fee_additional_driver: "$100 per week, per driver",
};
