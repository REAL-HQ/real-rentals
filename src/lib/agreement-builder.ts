// Agreement Builder: the REAL RENTALS Vehicle Rental Agreement v1.6 (No
// Insurance) as a template, plus template-level "terms" (fees, notice
// periods, service area...). Terms are written into the template body as
// [[term_key]] placeholders and a trailing %%BUILDER_TERMS {...}%% line that
// holds their values. Both are part of the saved body, so the SHA-256
// fingerprint covers every value, and resolveTerms() turns them into plain
// text before the canonical {{merge}} step. Client-safe (no server imports).

export type TermField = { key: string; label: string; group: TermGroup; multiline?: boolean };
export type TermGroup = "Rental Terms" | "Pricing & Deposit" | "Fee Schedule" | "Restrictions" | "Signatures";
export const TERM_GROUPS: TermGroup[] = ["Rental Terms", "Pricing & Deposit", "Fee Schedule", "Restrictions", "Signatures"];

export const TERM_FIELDS: TermField[] = [
  { key: "min_term_weeks", label: "Minimum Term (Weeks, Number)", group: "Rental Terms" },
  { key: "min_term_words", label: "Minimum Term (Words)", group: "Rental Terms" },
  { key: "renewal_period", label: "Renewal Period", group: "Rental Terms" },
  { key: "notice_hours", label: "Termination Notice (Hours)", group: "Rental Terms" },
  { key: "early_return_rule", label: "Early-Return Rule", group: "Rental Terms", multiline: true },
  { key: "reservation_line", label: "Reservation Fee Line", group: "Rental Terms" },
  { key: "reservation_cancel_hours", label: "Reservation Cancellation Deadline (Hours)", group: "Rental Terms" },
  { key: "unreachable_days", label: "Unreachable Before Reporting (Days)", group: "Rental Terms" },
  { key: "report_hours", label: "Report Problems Within (Hours)", group: "Rental Terms" },

  { key: "deposit_clause", label: "Security Deposit Clause", group: "Pricing & Deposit", multiline: true },
  { key: "deposit_ack", label: "Security Deposit Acknowledgment", group: "Pricing & Deposit", multiline: true },
  { key: "processing_fee", label: "Toll / Citation Processing Fee", group: "Pricing & Deposit" },

  { key: "fee_late_payment", label: "Late Payment", group: "Fee Schedule" },
  { key: "fee_returned_payment", label: "Declined / Returned Payment", group: "Fee Schedule" },
  { key: "fee_late_return", label: "Late Vehicle Return", group: "Fee Schedule" },
  { key: "fee_unauthorized_driver", label: "Unauthorized Driver Or Subleasing", group: "Fee Schedule" },
  { key: "fee_smoking", label: "Smoking, Vaping Or Odor", group: "Fee Schedule" },
  { key: "fee_cleaning", label: "Excessive Cleaning", group: "Fee Schedule" },
  { key: "fee_refuel", label: "Returned Low On Fuel", group: "Fee Schedule" },
  { key: "fee_key", label: "Lost Or Damaged Key / Fob", group: "Fee Schedule" },
  { key: "fee_lockout", label: "Lockout / Locksmith Call", group: "Fee Schedule" },
  { key: "fee_tire", label: "Flat Or Damaged Tire", group: "Fee Schedule" },
  { key: "fee_towing", label: "Towing, Impound & Recovery", group: "Fee Schedule" },
  { key: "fee_additional_driver", label: "Additional Approved Driver", group: "Fee Schedule" },

  { key: "service_area", label: "Service Area / Mileage Limit", group: "Restrictions" },
  { key: "home_state", label: "Permitted State", group: "Restrictions" },
  { key: "min_age_economy", label: "Minimum Age — Economy", group: "Restrictions" },
  { key: "min_age_premium", label: "Minimum Age — Luxury / Premium", group: "Restrictions" },
  { key: "governing_venue", label: "Governing Law & Venue", group: "Restrictions", multiline: true },

  { key: "esign_consent", label: "Electronic-Signature Consent", group: "Signatures", multiline: true },
];

/** Values exactly as printed in v1.6, including its bracketed open items. */
export const V16_TERM_DEFAULTS: Record<string, string> = {
  min_term_weeks: "4",
  min_term_words: "four (4)",
  renewal_period: "week to week and renews automatically each week",
  notice_hours: "[48]",
  early_return_rule:
    "If you return the vehicle before the minimum term ends, you remain responsible for the weekly rate for the rest of the minimum term, charged on the regular weekly schedule. If we re-rent the vehicle during that time, we will credit you for each week it is re-rented.",
  reservation_line: "[ ] Required: $________ paid      [ ] Not required for this rental",
  reservation_cancel_hours: "[24]",
  unreachable_days: "[3]",
  report_hours: "[24]",
  deposit_clause: "There is no security deposit.",
  deposit_ack: "There is no security deposit; my card on file covers what I owe, including the charges in the Fee Schedule.",
  processing_fee: "3.5%",
  fee_late_payment: "$50 per day past due",
  fee_returned_payment: "$35 per occurrence",
  fee_late_return: "$250 + $[25] per hour late",
  fee_unauthorized_driver: "$1,000 per occurrence; rental may be ended immediately",
  fee_smoking: "$[5,000]",
  fee_cleaning: "$75 to $150",
  fee_refuel: "$75 refuel fee + $10 per gallon",
  fee_key: "Actual replacement cost + Loss of Use",
  fee_lockout: "$[75] per call",
  fee_tire: "Actual repair or replacement cost",
  fee_towing: "$[500] + any third-party tow, impound, or storage costs",
  fee_additional_driver: "$[__] per week",
  service_area: "[100]-mile radius of Tampa, FL; Florida only",
  home_state: "Florida",
  min_age_economy: "21",
  min_age_premium: "25",
  governing_venue:
    "This Agreement is governed by Florida law, and any dispute will be handled in the courts of Hillsborough County, Florida.",
  esign_consent:
    "You agree an electronic signature is valid, and signed or electronically signed copies are effective as originals.",
};

/** Terms used only by later agreement families (v1.10 / v1.10.2). They are
 * written into a body only when its source references them, so existing
 * v1.6 bodies (and their fingerprints) are unchanged. */
export const EXTRA_TERM_FIELDS: TermField[] = [
  { key: "fee_citation_admin", label: "Ticket / Citation Administrative Fee", group: "Pricing & Deposit" },
  { key: "insurance_notice_hours", label: "Insurance Change Notice (Hours)", group: "Rental Terms" },
  { key: "mileage_allowance", label: "Mileage Allowance", group: "Restrictions" },
  { key: "excess_mileage_fee", label: "Excess-Mileage Fee (Not Printed — Needs Approved Clause)", group: "Restrictions" },
];
/** Saved with a library draft but never printed: no approved clause exists yet. */
export const UNPRINTED_TERMS = ["excess_mileage_fee"];
export const ALL_TERM_FIELDS: TermField[] = [...TERM_FIELDS, ...EXTRA_TERM_FIELDS];

const MARKER = /\n?%%BUILDER_TERMS (\{.*\})%%\s*$/s;

export function readTerms(body: string): Record<string, string> | null {
  const m = body.match(MARKER);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

export function stripTerms(body: string): string {
  return body.replace(MARKER, "");
}

export function writeTerms(source: string, terms: Record<string, string>): string {
  const clean: Record<string, string> = {};
  const used = new Set(termsIn(source));
  for (const f of TERM_FIELDS) clean[f.key] = (terms[f.key] ?? "").replace(/%%/g, "%");
  for (const f of EXTRA_TERM_FIELDS) if (used.has(f.key)) clean[f.key] = (terms[f.key] ?? "").replace(/%%/g, "%");
  return `${stripTerms(source).replace(/\s+$/, "")}\n%%BUILDER_TERMS ${JSON.stringify(clean)}%%`;
}

/** [[term]] → value (blank line if empty); removes the terms line. No-op for bodies without builder terms. */
export function resolveTerms(body: string): string {
  const terms = readTerms(body);
  if (!terms) return body;
  return stripTerms(body).replace(/\[\[([a-z0-9_]+)\]\]/g, (_m, k: string) => {
    const v = terms[k];
    return v && v.trim() ? v : "__________";
  });
}

export function termsIn(source: string): string[] {
  return [...new Set([...stripTerms(source).matchAll(/\[\[([a-z0-9_]+)\]\]/g)].map((m) => m[1]))];
}

export function unknownTermsIn(source: string): string[] {
  const known = new Set(ALL_TERM_FIELDS.map((f) => f.key));
  return termsIn(source).filter((k) => !known.has(k));
}

export function missingTerms(terms: Record<string, string>, source: string): string[] {
  return termsIn(source).filter((k) => !(terms[k] ?? "").trim());
}

/** v1.6 wording, verbatim except: company placeholders became merge fields,
 * term values became [[terms]], and characters the PDF font cannot print
 * (checkboxes, bullets) became "[ ]" and "-". */
export const V16_SOURCE = `%%LAYOUT 1%%
# REAL RENTALS
#- Vehicle Rental Agreement (v1.6)

This Vehicle Rental Agreement ("Agreement") is between {{company_name}} d/b/a REAL RENTALS ("REAL RENTALS," "we," "us"), {{company_address}}, and the renter who signs below ("you," "Renter"). It covers the vehicle described below. Please read it carefully. The Fee Schedule and the Renter Acknowledgments need your attention and initials.

## Rental & Vehicle Information
| Agreement Number | {{agreement_number}}
| Renter Name | {{driver_name}}
| Phone / Email | {{driver_phone}} / {{driver_email}}
| Driver's License # / State | {{license_number}} / {{license_state}}
| Date of Birth | {{driver_dob}}
| Home Address | {{driver_address}}
| Vehicle (Year / Make / Model) | {{vehicle}}
| Color / VIN | {{vehicle_color}} / {{vehicle_vin}}
| License Plate / State | {{license_plate}}
| Mileage Out / Fuel Out | To Be Completed At Pickup
| Rental Start Date | {{start_date}}
| Minimum Term Ends ([[min_term_weeks]] Weeks) | {{min_term_end}}
| Weekly Rate | {{weekly_rate}}
| Reservation Fee | [[reservation_line]]
| Payment Card on File | {{card_on_file}}
| Service Area / Mileage Limit | [[service_area]]
| Approved Additional Driver(s) | {{additional_drivers}}
| Renter's Insurance Carrier (If Any) | {{insurance_carrier}}
| Policy # / Carrier Phone (If Any) | {{insurance_policy}}

## 1. Rental Term, Minimum Term & Renewal
**Minimum Term.** Your rental has a minimum term of [[min_term_words]] consecutive weeks, starting on the start date above.
**Renewal.** After the minimum term, your rental continues [[renewal_period]] when the weekly rate is paid. Either of us may end it with [[notice_hours]] hours' notice, and you return the vehicle at the agreed place and time. All terms here continue to apply for any renewal or extension.
**Early Return.** [[early_return_rule]]

## 2. Reservation Fee, Payment & Card on File
**Reservation Fee.** If a Reservation Fee is marked as required in the Rental & Vehicle Information above, it is due when your pickup or delivery is scheduled and is applied in full to your first week's rate. It is non-refundable if you do not show for your scheduled pickup or delivery, or cancel less than [[reservation_cancel_hours]] hours before it. It is fully refunded if you cancel [[reservation_cancel_hours]] hours or more before your scheduled pickup or delivery, or if we cancel or cannot provide a vehicle. The Reservation Fee is not a security deposit. If it is marked as not required, this paragraph does not apply to your rental.
**Weekly Payment.** The weekly rate is due in advance. You keep a valid payment card on file, and you authorize us to charge it for the weekly rate and any other amount you owe under this Agreement, including anything in the Fee Schedule, plus a reasonable processing fee. [[deposit_clause]] If a charge is declined, you authorize us to run it again, and you remain responsible for the balance.
**No Refunds.** A weekly rate, once charged, is not refunded. After the minimum term, no future weeks will be charged once you return the vehicle in acceptable condition and give the notice in Section 1.

## 3. Insurance & Your Financial Responsibility
REAL RENTALS does not require you to carry insurance in order to rent, and REAL RENTALS does not provide insurance that covers you. Our insurance covers the vehicle only when it is not rented (on our lot, being moved by us, fueling, or in maintenance). It does not cover you, your passengers, or anyone else while you have the vehicle.
Whether or not you carry insurance, you are personally and solely responsible for everything that happens with the vehicle while it is in your possession, including all damage to the vehicle, all injuries, property damage, and claims by anyone else, and all related costs and legal fees. If you choose to carry insurance, including rideshare or delivery coverage, any valid and collectible insurance you carry applies first, as stated below.
> "The valid and collectible liability insurance and personal injury protection insurance of any authorized rental or leasing driver is primary for the limits of liability and personal injury protection coverage required by §§324.021(7) and 627.736, Florida Statutes."
Regardless of fault, and whether or not any insurance pays, you are responsible for physical damage to, or loss or theft of, the vehicle, including repairs, any deductible, Loss of Use (our rental rate for each day the vehicle is out of service), and diminished value, which we may charge to your card on file.
**Your Insurance, If Any.** If you provide insurance information, you authorize REAL RENTALS to verify it with your insurance company or agent. Any insurance you carry, and any change, cancellation, or lapse in it, does not reduce your responsibility under this Agreement or shift any responsibility to REAL RENTALS.

## 4. Tolls, Tickets & Citations
You're responsible for all tolls, tickets, camera citations, and violations during your rental. We'll charge them to your card on file plus a [[processing_fee]] processing fee, and you authorize us to share the information toll and enforcement authorities require to identify you as the driver.

## 5. Use of the Vehicle & Prohibited Uses
Only you, or a driver we approve in writing and list above, may drive the vehicle. You may use it only for approved rideshare/delivery work under your own platform accounts and for personal driving. You may not:
- Let anyone else drive the vehicle, or let another driver use it to work on any rideshare or delivery account.
- Sublease, re-rent, or lend the vehicle to anyone.
- Use the vehicle to tow, push, or pull any trailer or other vehicle.
- Use it for any illegal activity, racing, speed contests, or off-road driving.
- Drive outside the service area and mileage limit listed above, or outside [[home_state]], without our written consent.
- Smoke or vape in the vehicle, or carry animals other than service animals without our written consent.
- Make any modification to the vehicle, including window tint, stereo, lighting, or decals other than required platform signage.
- Drive recklessly or at excessive speed. Excessive speeding or reckless driving, including as shown by vehicle telematics, may result in immediate termination of the rental.
Keep the vehicle clean and return it with the same fuel level it had at pickup. We're not responsible for personal belongings left in or lost from the vehicle. Fees for these items are listed in the Fee Schedule.

## 6. Maintenance, Repairs & Breakdowns
- Keep up basic care: check tire pressure and fluids, and keep the vehicle available for scheduled maintenance when we ask.
- Report any dashboard warning light, mechanical problem, or damage to us within [[report_hours]] hours. Stop driving if continuing could cause further damage.
- Do not have any repair, service, or towing done without our approval. We choose the repair shop. Unapproved repairs are not reimbursed.
- Normal maintenance and mechanical failures not caused by you are our cost. Flat or damaged tires, and towing or repairs caused by misuse, neglect, or a prohibited use, are your cost.
- Return the key or fob with the vehicle. Lost keys and lockout service calls are charged as listed in the Fee Schedule.

## 7. Accidents, Damage & Indemnification
Return the vehicle in the same condition, minus normal wear. If you're in an accident: call 911 if anyone is hurt and get a police report, photograph the scene and the other driver's license and insurance, then contact us right away at {{company_phone}} and email the details to {{company_email}}. Provide a written statement of the accident within [[report_hours]] hours. Report any damage, loss, or theft immediately.
To the fullest extent the law allows, you agree to defend, indemnify, and hold harmless REAL RENTALS and its owners, employees, and agents from all claims, lawsuits, damages, judgments, and costs, including reasonable attorney's fees and recovery costs, brought by anyone (including passengers, other drivers, pedestrians, and property owners) that arise from your use, operation, or possession of the vehicle during your rental. You're also responsible for damage and related charges as described in Section 3 and the Fee Schedule.

## 8. GPS, Telematics & Vehicle Recovery
Our vehicles are equipped with GPS and telematics technology that we use to manage the fleet, support maintenance and safety, monitor compliance with this Agreement, and locate and recover a vehicle when needed. By signing, you consent to the use of this technology during your rental.
If the rental ends, payments stop, or this Agreement is breached, you authorize us to use any lawful means, including vehicle telematics technology, to prevent further use of and recover the vehicle. You authorize us and our agents to access the vehicle wherever it is located to do so. Recovery, towing, impound, and storage costs are your responsibility, as listed in the Fee Schedule.

## 9. Ending the Rental & Return
Either of us may end the rental as described in Section 1. If you breach this Agreement (for example, non-payment, unauthorized drivers, a prohibited use, excessive speeding), we may end it immediately and recover the vehicle, and amounts owed for the minimum term remain due. Return the vehicle on time, at the agreed place, with all personal items removed. Late returns are subject to the late return fee in the Fee Schedule. If the vehicle isn't returned and we can't reach you for [[unreachable_days]] days, we may report it as unauthorized use to law enforcement.

## 10. Who Can Rent
You must be at least [[min_age_economy]] to rent an economy vehicle and at least [[min_age_premium]] to rent a luxury or premium vehicle, and hold a valid driver's license. You confirm your license is valid and not suspended and that the information you've given is accurate. You authorize us to check your driving record and background, and we may decline or end a rental based on what we find.

## 11. Fee Schedule (Quick Reference)
These are the charges that may apply. We'll always charge the actual amount owed and send a receipt.
|#45 Item | Amount
| Weekly rate | As listed above, due in advance each week
| Reservation Fee (if marked required) | Amount shown above, applied to first week; non-refundable on no-show or cancellation under [[reservation_cancel_hours]] hours
| Early return (before [[min_term_weeks]]-week minimum) | Remaining weeks of minimum term, charged weekly; credited for any week the vehicle is re-rented
| Late payment | [[fee_late_payment]]
| Declined / returned payment | [[fee_returned_payment]]
| Late vehicle return | [[fee_late_return]]
| Tolls, tickets & citations | Actual amount + [[processing_fee]] processing fee
| Unauthorized driver or subleasing | [[fee_unauthorized_driver]]
| Smoking, vaping, or persistent odor | [[fee_smoking]]
| Excessive cleaning (beyond normal wear) | [[fee_cleaning]]
| Returned low on fuel | [[fee_refuel]]
| Lost or damaged key / fob | [[fee_key]]
| Lockout / locksmith service call | [[fee_lockout]]
| Flat or damaged tire (renter-caused) | [[fee_tire]]
| Towing, impound & recovery | [[fee_towing]]
| Additional approved driver | [[fee_additional_driver]]
| Physical damage or loss | Repair or replacement cost + insurance deductible + Loss of Use + diminished value
| Loss of Use | Weekly rate (prorated daily) for each day the vehicle is out of service
| Unapproved out-of-area / out-of-state use | Rental may be ended; you cover any recovery costs

## 12. General
[[governing_venue]] It is the entire agreement between us and can be changed only in writing. If any part is unenforceable, the rest still applies. Our not enforcing a term is not a waiver of it. [[esign_consent]] Nothing in this Agreement limits any liability or right that cannot be limited or waived under Florida law, including liability for our own gross negligence. Any text-message consent is handled on a separate form.

%%PAGE%%
## Renter Acknowledgments
~ Please initial each line to confirm you have read and understand it.
|#14 Initial | Renter Acknowledgment
|i I have received and read this entire Agreement, including the Fee Schedule.
|i My rental has a [[min_term_weeks]]-week minimum term. If I return the vehicle early, I owe the remaining weeks of the minimum term, less credit for any week the vehicle is re-rented.
|i If a Reservation Fee is marked as required, it is applied to my first week and is non-refundable if I don't show or cancel less than [[reservation_cancel_hours]] hours before pickup or delivery. (Initial even if not required.)
|i REAL RENTALS does not require me to carry insurance and does not provide insurance that covers me while I have the vehicle.
|i Whether or not I carry insurance, I am personally responsible for everything that happens with the vehicle during my rental, including injuries, property damage, and claims by others, and I will defend and indemnify REAL RENTALS against those claims.
|i I'm responsible for physical damage to or loss of the vehicle regardless of fault, including any deductible and Loss of Use, even if insurance doesn't pay.
|i [[deposit_ack]]
|i I'm responsible for all tolls, tickets, and citations during my rental.
|i Only I, or a driver approved in writing and listed in this Agreement, may drive the vehicle. I will not sublease it or let anyone else work on it.
|i I understand the service area, mileage limit, return, and prohibited-use restrictions in this Agreement.
|i No smoking or vaping. I'll keep the vehicle clean, return the key/fob, and return it with the same fuel level.
|i I'll report warning lights, mechanical problems, and damage within [[report_hours]] hours and won't authorize repairs without approval.
|i I consent to vehicle GPS and telematics technology as described in this Agreement, and understand the vehicle may be located and recovered, at my cost, if the rental ends, payment stops, or this Agreement is breached.

%%PAGE%%
## Signatures
~ By signing, both parties agree to all terms of this Agreement.
%%SIGNATURES {{agreement_number}}%%

## Vehicle Condition Report
| Agreement Number | {{agreement_number}}
| Renter | {{driver_name}}
| Vehicle / Plate | {{vehicle}} / {{license_plate}}

### At Pickup
| Date & Time | 
| Mileage | 
| Fuel Level | 
| Tires (Condition / Tread) | 
| Existing Damage (Y/N) | 
| Notes / Photos Taken | 
| Renter Initials | 

### At Return
| Date & Time | 
| Mileage | 
| Fuel Level | 
| Tires (Condition / Tread) | 
| New Damage (Y/N) | 
| Personal Items Removed (Y/N) | 
| Notes / Photos Taken | 
| Renter Initials |`;

export const V16_BODY = writeTerms(V16_SOURCE, V16_TERM_DEFAULTS);
