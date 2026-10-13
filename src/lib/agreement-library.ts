// Agreement Template Library: independent agreement families, each with its
// own key, version history and fingerprint. Client-safe (no server imports).
//
// The two built-in families are transcribed from the Owner-supplied PDFs:
//   no_insurance        v1.10, then v1.13 (current draft)
//   insurance_required  v1.10.2 (Insurance Required)
//
// A family is a list of versions, oldest first; the newest is its current
// draft. Older versions are kept byte-identical so an edition can be compared
// against the one it replaced.
// Wording is verbatim except: company placeholders ([Legal Entity Name],
// [address], [phone], the support email) are merge fields from Settings →
// Company; reusable values are [[terms]]; bullets/checkboxes the PDF font
// cannot print became "-". Both start as Draft — Legal Review Required and
// can never be sent until the Owner approves a saved version.

import { V16_SOURCE, V16_TERM_DEFAULTS, writeTerms } from "@/lib/agreement-builder";
import { parseLayout } from "@/lib/agreement-layout";

/** One published edition of a family's wording. Never mutated once added. */
export type LibraryVersion = {
  displayVersion: string;
  sourceFile: string;
  source: string;
  terms: Record<string, string>;
  body: string;
};
export type LibraryTemplate = {
  key: string;
  name: string;
  insuranceRequired: boolean;
  /** Reservation Fee row prints the entered amount (or "None"), not checkboxes. */
  reservationStyle: "amount";
  /** Oldest first; the last entry is the current draft. */
  versions: LibraryVersion[];
} & LibraryVersion;

/** Exact substitution that fails loudly if the source text is not found. */
function sub(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`agreement-library: source text not found: ${from.slice(0, 60)}`);
  return text.replace(from, to);
}

// ---------------------------------------------------------------- v1.10
let s = V16_SOURCE;
s = sub(s, "#- Vehicle Rental Agreement (v1.6)", "#- Vehicle Rental Agreement (v1.10)");
s = sub(s, "**Reservation Fee.** If a Reservation Fee is marked as required in the Rental & Vehicle Information above,", "**Reservation Fee.** If a Reservation Fee amount is entered in the Rental & Vehicle Information above,");
s = sub(s, "If it is marked as not required, this paragraph does not apply to your rental.", "If no Reservation Fee is entered, this paragraph does not apply to your rental.");
s = sub(s, "including repairs, any deductible, Loss of Use (our rental rate for each day the vehicle is out of service), and diminished value, which we may charge to your card on file.", "including the repair or replacement cost (or our insurance deductible, if our insurance pays the claim) and Loss of Use (our rental rate for each day the vehicle is out of service), which we may charge to your card on file.");
s = sub(s, "We'll charge them to your card on file plus a [[processing_fee]] processing fee, and you authorize us", "Tolls are charged to your card on file at the actual amount owed, with no added fee. Parking tickets, camera citations, and other violations are charged at the actual amount owed plus a [[fee_citation_admin]] administrative fee per citation to cover processing or transferring it to you. You authorize us");
s = sub(s, "| Reservation Fee (if marked required) |", "| Reservation Fee (if entered above) |");
s = sub(s, "| Tolls, tickets & citations | Actual amount + [[processing_fee]] processing fee", "| Tolls | Actual amount owed, no added fee\n| Parking tickets, camera citations & violations | Actual amount owed + [[fee_citation_admin]] administrative fee per citation");
s = sub(s, "| Physical damage or loss | Repair or replacement cost + insurance deductible + Loss of Use + diminished value", "| Physical damage or loss | Repair or replacement cost (or our insurance deductible, if our insurance pays) + Loss of Use");
s = sub(s, "|i If a Reservation Fee is marked as required, it is applied", "|i If a Reservation Fee is entered in this Agreement, it is applied");
s = sub(s, "including any deductible and Loss of Use, even if insurance doesn't pay.", "including repair costs and Loss of Use, even if insurance doesn't pay.");
s = sub(s, "|i I'm responsible for all tolls, tickets, and citations during my rental.", "|i I'm responsible for all tolls, tickets, and citations during my rental. Tolls are charged at cost; each ticket or citation also carries a [[fee_citation_admin]] administrative fee.");
// Service Area and Mileage Allowance are separate values in the one blank row v1.10 provides.
s = sub(s, "| Service Area / Mileage Limit | [[service_area]]", "| Service Area / Mileage Limit | [[service_area]]; [[mileage_allowance]]");
export const V110_SOURCE = s;

export const V110_TERM_DEFAULTS: Record<string, string> = {
  ...V16_TERM_DEFAULTS,
  // v1.10 leaves the Reservation Fee and Service Area rows blank to be filled.
  reservation_line: "",
  service_area: "",
  mileage_allowance: "",
  fee_late_return: "Daily rate (weekly rate ÷ 7) for each day late, + $50 if you don't notify us in advance",
  fee_unauthorized_driver: "$500 per occurrence; rental may be ended immediately",
  fee_smoking: "$250 + actual repair cost for any burns or damage",
  fee_refuel: "$25 refuel fee + actual cost of fuel",
  fee_towing: "$250 + any third-party tow, impound, or storage costs",
  fee_additional_driver: "$10 per week, per driver",
  fee_citation_admin: "$[25]",
};

// ---------------------------------------------------------------- v1.10.2 Insurance Required
let r = V110_SOURCE;
r = sub(r, "#- Vehicle Rental Agreement (v1.10)", "#- Vehicle Rental Agreement (v1.10.2, Insurance Required)");
r = sub(r, "| Renter's Insurance Carrier (If Any) |", "| Renter's Insurance Carrier |");
r = sub(r, "| Policy # / Carrier Phone (If Any) |", "| Policy # / Carrier Phone |");
r = sub(r,
  "REAL RENTALS does not require you to carry insurance in order to rent, and REAL RENTALS does not provide insurance that covers you. Our insurance covers the vehicle only when it is not rented (on our lot, being moved by us, fueling, or in maintenance). It does not cover you, your passengers, or anyone else while you have the vehicle.\nWhether or not you carry insurance, you are personally and solely responsible for everything that happens with the vehicle while it is in your possession, including all damage to the vehicle, all injuries, property damage, and claims by anyone else, and all related costs and legal fees. If you choose to carry insurance, including rideshare or delivery coverage, any valid and collectible insurance you carry applies first, as stated below.",
  "Our insurance covers the vehicle only when it is not rented (on our lot, being moved by us, fueling, or in maintenance). It does not cover you while you are driving. You must keep your own valid auto insurance in your name for the entire rental, meeting at least Florida's minimum limits, and provide proof.\nBecause you'll use the vehicle for rideshare and/or delivery, you understand that a standard personal policy usually does not cover you once a rideshare or delivery app is on (including while you're logged in and waiting for a request), and that a platform's insurance may cover only active trips and may not cover damage to the vehicle. Getting the right rideshare or delivery coverage for all periods is your responsibility.");
r = sub(r,
  "which we may charge to your card on file.\n**Your Insurance, If Any.** If you provide insurance information, you authorize REAL RENTALS to verify it with your insurance company or agent. Any insurance you carry, and any change, cancellation, or lapse in it, does not reduce your responsibility under this Agreement or shift any responsibility to REAL RENTALS.",
  "which we may charge to your card on file. If your insurance or a platform's insurance denies or underpays, you remain responsible for the full amount.\n**Insurance Verification.** You authorize REAL RENTALS and its agents to contact your insurance company or agent, at any time before or during your rental, to verify that your policy is active, the coverage it provides, and the drivers and vehicles it covers. You agree to provide any additional authorization your insurer requires. You must notify us within [[insurance_notice_hours]] hours if your policy is cancelled, lapses, or changes. If we cannot verify active coverage, we may end the rental immediately and recover the vehicle.\n**Lapse in Coverage.** Your insurance must remain active every day you have the vehicle. Cancelling, failing to renew, or letting your policy lapse is a breach of this Agreement, and you must stop driving the vehicle immediately and notify us. Our verification of your insurance at any time does not shift any responsibility to us. If your coverage lapses for any reason, whether or not we know about it, you are personally and solely responsible for all damage to the vehicle, all injuries, property damage, and claims by anyone else, and all related costs, legal fees, and Loss of Use arising during your rental.");
r = sub(r, "(for example, non-payment, unauthorized drivers, a prohibited use, excessive speeding)", "(for example, non-payment, unauthorized drivers, a prohibited use, excessive speeding, or letting your insurance lapse)");
r = sub(r,
  "|i REAL RENTALS does not require me to carry insurance and does not provide insurance that covers me while I have the vehicle.\n|i Whether or not I carry insurance, I am personally responsible for everything that happens with the vehicle during my rental, including injuries, property damage, and claims by others, and I will defend and indemnify REAL RENTALS against those claims.",
  "|i REAL RENTALS does not provide insurance that covers me while I drive. I must carry my own valid insurance for the whole rental, and I've provided proof.\n|i My personal policy likely won't cover me while a rideshare or delivery app is on, including while waiting for a request, and getting that coverage is my responsibility.");
r = sub(r,
  "|i I consent to vehicle GPS",
  "|i I authorize REAL RENTALS to verify my insurance with my carrier or agent at any time before or during my rental, and I will notify REAL RENTALS within [[insurance_notice_hours]] hours if my policy is cancelled, lapses, or changes.\n|i I understand that if my insurance lapses or is cancelled during my rental, I am personally responsible for everything that happens with the vehicle, including injuries and claims by others, and that REAL RENTALS checking my insurance does not make it responsible.\n|i I consent to vehicle GPS");
export const V1102_INS_SOURCE = r;

export const V1102_TERM_DEFAULTS: Record<string, string> = { ...V110_TERM_DEFAULTS, insurance_notice_hours: "[24]" };

// ---------------------------------------------------------------- v1.13
/**
 * v1.13, transcribed from REAL-RENTALS-Vehicle-Rental-Agreement-v1.13.pdf.
 *
 * A new VERSION of the no_insurance family, not a new family: Section 3 is
 * the same "we do not require you to carry insurance" clause v1.10 carries,
 * so this supersedes v1.10 and the insurance_required family is untouched.
 *
 * Written as its own literal rather than a sub() chain off V110_SOURCE. The
 * sub() discipline exists to keep a derived VARIANT in step with its parent
 * (v1.10.2 off v1.10); v1.13 is a new edition of the document — new sections,
 * new fee rows, 16 acknowledgments — and twenty-five brittle substitutions
 * would describe the diff, not the contract. The insurance-required v1.13.x
 * will derive from THIS source the way v1.10.2 derives from v1.10.
 *
 * TWO APPROVED DEPARTURES FROM THE PDF:
 *
 *   1. The "What's Included in Your Rental" marketing panel is removed. Its
 *      six cards are preserved, unpublished, in
 *      docs/marketing/v113-whats-included.md. They name Uber, Lyft, DoorDash
 *      and Instacart and describe what maintenance covers, so they need
 *      insurer and platform verification before they appear anywhere.
 *
 *   2. The minimum term is [[min_term_weeks]] / [[min_term_words]] rather
 *      than the PDF's hardcoded four. Staff choose it per agreement.
 *
 * THE MINIMUM TERM AND THE PAYMENT PERIOD ARE DIFFERENT NUMBERS. The term is
 * dynamic. "Monthly" means a four-week / 28-day payment period, which is what
 * the word means here, and stays fixed text — making it follow the minimum
 * term would silently change what a monthly payment buys.
 *
 * Bracketed values ([48], [24], [25], [5,000], [75], [3]) are carried through
 * as terms with their brackets intact. They are unresolved legal items, and
 * the Owner's approval gate already refuses a version that still has any.
 */
export const V113_SOURCE = `%%LAYOUT 1%%
# REAL RENTALS
#- Vehicle Rental Agreement (v1.13)

This Vehicle Rental Agreement ("Agreement") is between {{company_name}} ("REAL RENTALS," "we," "us"), {{company_address}}, and the renter who signs below ("you," "Renter"). It covers the vehicle described below. Please read it carefully. The Fee Schedule and the Renter Acknowledgments need your attention and initials.

## Key Rental Terms
|= Start Date | {{start_date}} | End Date ([[min_term_weeks]]-Week Minimum) | {{min_term_end}} | Weekly Rate | {{weekly_rate}}

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
| Mileage Out | To Be Completed At Pickup
| Fuel Out | To Be Completed At Pickup
| Rental Start Date | {{start_date}}
| Minimum Term Ends ([[min_term_weeks]] Weeks) | {{min_term_end}}
| Weekly Rate | {{weekly_rate}}
| Payment Schedule (Weekly or Monthly) | {{payment_schedule}}
| Amount Due Each Payment | {{payment_amount_each}}
| Reservation Fee | [[reservation_line]]
| Payment Method | {{payment_method}}
| Payment Card on File | {{card_on_file}}
| Service Area | [[service_area]]
| Approved Additional Driver(s) | {{additional_drivers}}
| Renter's Insurance Carrier (If Any) | {{insurance_carrier}}
| Policy # / Carrier Phone (If Any) | {{insurance_policy}}

## 1. Rental Term, Minimum Term & Renewal
**Minimum Term.** Your rental has a minimum term of [[min_term_words]] consecutive weeks, starting on the start date above.
**Renewal.** After the minimum term, your rental continues and renews automatically for each payment period (weekly or monthly, as listed above) when payment is made. Either of us may end it with [[notice_hours]] hours' notice, and you return the vehicle at the agreed place and time. All terms here continue to apply for any renewal or extension.
**Early Return.** [[early_return_rule]]

## 2. Reservation Fee, Payment & Card on File
**Reservation Fee.** If a Reservation Fee amount is entered in the Rental & Vehicle Information above, it is due when your pickup or delivery is scheduled and is applied in full to your first week's rate. It is non-refundable if you do not show for your scheduled pickup or delivery, or cancel less than [[reservation_cancel_hours]] hours before it. It is fully refunded if you cancel [[reservation_cancel_hours]] hours or more before your scheduled pickup or delivery, or if we cancel or cannot provide a vehicle. The Reservation Fee is not a security deposit. If no Reservation Fee is entered, this paragraph does not apply to your rental.
**Payment Schedule.** You pay weekly or monthly, as listed in the Rental & Vehicle Information above. Weekly payments are due in advance each week. Monthly payments are due in advance for each 4-week period and cover four weeks of rent at the Weekly Rate. The Weekly Rate is also used to calculate prorated charges under this Agreement, such as late returns and Loss of Use.
**Payment Methods.** You may pay rent by automatic card payment (Autopay) or by an approved payment app or transfer, such as Zelle, Cash App, or Venmo, as listed above. If you pay by app or transfer, each payment must be received by us on or before its due date; a payment is not considered made until we receive it. Payment app fees, if any, are your responsibility.
**Card on File.** Whatever payment method you use for rent, you must keep a valid debit or credit card in your name on file for the entire rental. You authorize us to charge it for any amount you owe under this Agreement, including missed or late rent and anything in the Fee Schedule. [[deposit_clause]] If a charge is declined, you authorize us to run it again, and you remain responsible for the balance.
**Autopay Authorization.** If you choose Autopay, you authorize REAL RENTALS to automatically charge your card on file for the Amount Due Each Payment, in advance, on the same day of each payment period (every 7 days for weekly, or every 28 days for monthly), starting on the Rental Start Date. Autopay continues until your rental ends as described below. You will receive a receipt for each charge. You must keep your card information current; a failed Autopay charge is treated as a late payment.
**Ending Autopay.** You may end your rental, and with it Autopay, by giving the notice in Section 1 and returning the vehicle, subject to the minimum term. Contact us at {{company_email}} or {{company_phone}} to give notice. Billing ends when the vehicle is returned and checked in, and we will cancel your Autopay within one (1) business day after that. No further rent will be charged after the return, though we may still charge your card for amounts owed under this Agreement, such as tolls, citations, fuel, or damage discovered at return. Cancelling Autopay without returning the vehicle does not end your rental or your obligation to pay rent.
**No Refunds.** Rent, once charged, is not refunded, except as stated in this Agreement. After the minimum term, no future payments will be charged once you return the vehicle in acceptable condition and give the notice in Section 1. If you paid monthly and return the vehicle after the minimum term, we will refund any full unused weeks.

## 3. Insurance & Your Financial Responsibility
REAL RENTALS does not require you to carry insurance in order to rent, and REAL RENTALS does not provide insurance that covers you. Our insurance covers the vehicle only when it is not rented (on our lot, being moved by us, fueling, or in maintenance). It does not cover you, your passengers, or anyone else while you have the vehicle.
Whether or not you carry insurance, you are personally and solely responsible for everything that happens with the vehicle while it is in your possession, including all damage to the vehicle, all injuries, property damage, and claims by anyone else, and all related costs and legal fees. If you choose to carry insurance, including rideshare or delivery coverage, any valid and collectible insurance you carry applies first, as stated below.
> "The valid and collectible liability insurance and personal injury protection insurance of any authorized rental or leasing driver is primary for the limits of liability and personal injury protection coverage required by §§324.021(7) and 627.736, Florida Statutes."
Regardless of fault, and whether or not any insurance pays, you are responsible for physical damage to, or loss or theft of, the vehicle, including the repair or replacement cost (or our insurance deductible, if our insurance pays the claim) and Loss of Use (our rental rate for each day the vehicle is out of service), which we may charge to your card on file.
**Your Insurance, If Any.** If you provide insurance information, you authorize REAL RENTALS to verify it with your insurance company or agent. Any insurance you carry, and any change, cancellation, or lapse in it, does not reduce your responsibility under this Agreement or shift any responsibility to REAL RENTALS.

## 4. Tolls, Tickets & Citations
You're responsible for all tolls, tickets, camera citations, and violations during your rental. Tolls are charged to your card on file at the actual amount owed, with no added fee. Parking tickets, camera citations, and other violations are charged at the actual amount owed plus a [[fee_citation_admin]] administrative fee per citation to cover processing or transferring it to you. You authorize us to share the information toll and enforcement authorities require to identify you as the driver.

## 5. Use of the Vehicle & Prohibited Uses
**Unlimited Miles.** Your rental includes unlimited miles within [[home_state]], with no mileage limit or per-mile charge.
Only you, or a driver we approve in writing and list above, may drive the vehicle. You may use it only for approved rideshare/delivery work under your own platform accounts and for personal driving. You may not:
- Let anyone else drive the vehicle, or let another driver use it to work on any rideshare or delivery account.
- Sublease, re-rent, or lend the vehicle to anyone.
- Use the vehicle to tow, push, or pull any trailer or other vehicle.
- Use it for any illegal activity, racing, speed contests, or off-road driving.
- Drive outside [[home_state]], or outside any service area listed above, without our written consent.
- Smoke or vape in the vehicle, or carry animals other than service animals without our written consent.
- Make any modification to the vehicle, including window tint, stereo, lighting, or decals other than required platform signage.
- Drive recklessly or at excessive speed. Excessive speeding or reckless driving, including as shown by vehicle telematics, may result in immediate termination of the rental.
Keep the vehicle clean and return it with the same fuel level it had at pickup. We're not responsible for personal belongings left in or lost from the vehicle. Fees for these items are listed in the Fee Schedule.

## 6. Maintenance, Repairs & Breakdowns
- Scheduled maintenance is your responsibility to complete on time. This includes oil changes (every [[service_miles]] miles or as we direct), tire rotations and replacements, and any other service we schedule. We pay for it; you are responsible for getting it done on time.
- All maintenance and repairs must be done at a REAL RENTALS approved vendor or shop. We will give you the current list of approved vendors. Service at a non-approved shop is not reimbursed, and you are responsible for any problems it causes.
- Check tire pressure and fluid levels regularly, and keep the vehicle available for maintenance or inspection when we ask.
- Report any vehicle issue to us as soon as you notice it, and no later than [[report_hours]] hours, including dashboard warning lights, unusual noises, leaks, tire problems, or damage, so we can fix it quickly. Stop driving if continuing could cause further damage.
- Do not have any repair, service, or towing done without our approval. We choose the repair shop from our approved vendors. Unapproved repairs are not reimbursed.
- Damage caused by missed or late maintenance, or by an issue you did not report promptly, is your cost. Normal maintenance and mechanical failures not caused by you are our cost. Flat or damaged tires, and towing or repairs caused by misuse, neglect, or a prohibited use, are your cost.
- Return the key or fob with the vehicle. Lost keys and lockout service calls are charged as listed in the Fee Schedule.
**Vehicle Exchange.** We may require you to exchange the vehicle for a comparable vehicle at any time, including for maintenance, repairs, inspections, or safety recalls. You agree to bring the vehicle to the location we specify, or make it available to us, within [[report_hours]] hours of our request. This Agreement applies to any replacement vehicle, and we will record it on a new Vehicle Condition Report.
**Replacement Vehicle During Repairs.** If your vehicle needs repairs, we will try to provide a comparable replacement vehicle if one is available, but we do not guarantee a replacement vehicle or a specific make, model, or class. If the repair is due to normal wear or a mechanical failure not caused by you and no replacement is available, you will not be charged rent for the days you are without a vehicle, and we will credit or prorate your next payment. If the repair is caused by an accident, misuse, neglect, or a prohibited use while the vehicle is in your possession, we are not required to provide a replacement, rent remains due under this Agreement, and Loss of Use applies.

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
| Rent | Weekly Rate, paid in advance weekly or every 4 weeks (monthly), as listed above
| Reservation Fee (if entered above) | Amount shown above, applied to first week; non-refundable on no-show or cancellation under [[reservation_cancel_hours]] hours
| Early return (before [[min_term_weeks]]-week minimum) | Remaining weeks of minimum term, charged weekly; credited for any week the vehicle is re-rented
| Late payment | [[fee_late_payment]]
| Declined / returned payment | [[fee_returned_payment]]
| Late vehicle return | [[fee_late_return]]
| Tolls | Actual amount owed, no added fee
| Parking tickets, camera citations & violations | Actual amount owed + [[fee_citation_admin]] administrative fee per citation
| Unauthorized driver or subleasing | [[fee_unauthorized_driver]]
| Smoking, vaping, or persistent odor | [[fee_smoking]]
| Excessive cleaning (beyond normal wear) | [[fee_cleaning]]
| Returned low on fuel | [[fee_refuel]]
| Lost or damaged key / fob | [[fee_key]]
| Lockout / locksmith service call | [[fee_lockout]]
| Flat or damaged tire (renter-caused) | [[fee_tire]]
| Towing, impound & recovery | [[fee_towing]]
| Additional approved driver | [[fee_additional_driver]]
| Physical damage or loss | Repair or replacement cost (or our insurance deductible, if our insurance pays) + Loss of Use
| Loss of Use | Weekly rate (prorated daily) for each day the vehicle is out of service
| Mechanical repair (not caused by you), no replacement available | No rent charged for days without a vehicle; credited to your next payment
| Unapproved out-of-area / out-of-state use | Rental may be ended; you cover any recovery costs

## 12. General
[[governing_venue]] It is the entire agreement between us and can be changed only in writing. If any part is unenforceable, the rest still applies. Our not enforcing a term is not a waiver of it. [[esign_consent]] Nothing in this Agreement limits any liability or right that cannot be limited or waived under Florida law, including liability for our own gross negligence. Any text-message consent is handled on a separate form.

%%PAGE%%
## Renter Acknowledgments
~ Please initial each line to confirm you have read and understand it.
|#14 Initial | Renter Acknowledgment
|i I have received and read this entire Agreement, including the Fee Schedule.
|i If I chose Autopay, I authorize recurring charges to my card each payment period until my rental ends and the vehicle is returned. Cancelling Autopay without returning the vehicle does not end my rental.
|i A replacement vehicle during repairs is subject to availability and is not guaranteed. REAL RENTALS may require me to exchange the vehicle for a comparable one, and this Agreement applies to any replacement vehicle.
|i My rental has a [[min_term_weeks]]-week minimum term. If I return the vehicle early, I owe the remaining weeks of the minimum term, less credit for any week the vehicle is re-rented.
|i If a Reservation Fee is entered in this Agreement, it is applied to my first week and is non-refundable if I don't show or cancel less than [[reservation_cancel_hours]] hours before pickup or delivery. (Initial even if not required.)
|i REAL RENTALS does not require me to carry insurance and does not provide insurance that covers me while I have the vehicle.
|i Whether or not I carry insurance, I am personally responsible for everything that happens with the vehicle during my rental, including injuries, property damage, and claims by others, and I will defend and indemnify REAL RENTALS against those claims.
|i I'm responsible for physical damage to or loss of the vehicle regardless of fault, including repair costs and Loss of Use, even if insurance doesn't pay.
|i [[deposit_ack]]
|i I'm responsible for all tolls, tickets, and citations during my rental. Tolls are charged at cost; each ticket or citation also carries a [[fee_citation_admin]] administrative fee.
|i Only I, or a driver approved in writing and listed in this Agreement, may drive the vehicle. I will not sublease it or let anyone else work on it.
|i I understand my rental includes unlimited miles within [[home_state]], and I understand the service area, return, and prohibited-use restrictions in this Agreement.
|i No smoking or vaping. I'll keep the vehicle clean, return the key/fob, and return it with the same fuel level.
|i I'll complete scheduled maintenance (oil changes, tires, and other service) on time at REAL RENTALS approved vendors, report vehicle issues as soon as I notice them, and won't authorize repairs without approval. Damage from missed maintenance or unreported issues is my cost.
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
| Renter Initials | `;

export const V113_TERM_DEFAULTS: Record<string, string> = {
  ...V110_TERM_DEFAULTS,
  // v1.13 renews per payment period, which Section 1 now states in full, so
  // the v1.10 renewal_period phrase is not printed by this version.
  renewal_period: "",
  // Unlimited miles within the permitted state: v1.13 prints no mileage limit
  // and has no Service Area / Mileage Limit row to fill.
  mileage_allowance: "",
  // v1.13's Card on File paragraph carries the no-deposit sentence inline.
  deposit_clause: "There is no security deposit.",
  // Oil-change interval, still bracketed in the PDF.
  service_miles: "[5,000]",
};

/**
 * One family, its versions oldest first. The LAST version is the family's
 * current draft: that is what a preview renders and what `libraryTemplate`
 * mirrors, so adding a version supersedes the one before it without any call
 * site changing.
 *
 * Older versions stay addressable (`libraryVersion`) and byte-identical.
 * Nothing here can reach a signed agreement — a signed row stores its own
 * body and body_sha256 — and nothing here is approved: `libraryAsActive`
 * marks every family draft, and `templateSendRefusal` refuses to send a
 * family that is not approved.
 */
function family(
  key: string,
  name: string,
  insuranceRequired: boolean,
  versions: Omit<LibraryVersion, "body">[],
): LibraryTemplate {
  const vs: LibraryVersion[] = versions.map((v) => ({ ...v, body: writeTerms(v.source, v.terms) }));
  const latest = vs[vs.length - 1]!;
  return { key, name, insuranceRequired, reservationStyle: "amount", versions: vs, ...latest };
}

export const LIBRARY: LibraryTemplate[] = [
  family("no_insurance", "Vehicle Rental Agreement — No Insurance Required", false, [
    { displayVersion: "1.10", sourceFile: "REAL-RENTALS-Vehicle-Rental-Agreement-v1.6_no_insurance-2.pdf", source: V110_SOURCE, terms: V110_TERM_DEFAULTS },
    { displayVersion: "1.13", sourceFile: "REAL-RENTALS-Vehicle-Rental-Agreement-v1.13.pdf", source: V113_SOURCE, terms: V113_TERM_DEFAULTS },
  ]),
  family("insurance_required", "Vehicle Rental Agreement — Insurance Required", true, [
    { displayVersion: "1.10.2", sourceFile: "REAL-RENTALS-Vehicle-Rental-Agreement-v1.10.2_insurance_required.pdf", source: V1102_INS_SOURCE, terms: V1102_TERM_DEFAULTS },
  ]),
];

export const LIBRARY_KEYS = LIBRARY.map((t) => t.key) as [string, ...string[]];

export function libraryTemplate(key: string): LibraryTemplate | null {
  return LIBRARY.find((t) => t.key === key) ?? null;
}

/** A family's versions, oldest first. */
export function libraryVersions(key: string): LibraryVersion[] {
  return libraryTemplate(key)?.versions ?? [];
}

/** One named version of a family — for comparing editions, never for sending. */
export function libraryVersion(key: string, displayVersion: string): LibraryVersion | null {
  return libraryVersions(key).find((v) => v.displayVersion === displayVersion) ?? null;
}

/** Acknowledgment rows the signer must initial, taken from the template itself. */
export function acknowledgmentsOf(body: string): string[] {
  const out: string[] = [];
  for (const b of parseLayout(body)) if (b.k === "table") for (const row of b.rows) if (row.initial) out.push(row.cells[1]);
  return out;
}

export const DRAFT_STATUS_LABEL = "Draft — Legal Review Required";

/** Line diff (LCS) for Compare Versions. */
export function lineDiff(a: string, b: string): { t: "same" | "del" | "add"; line: string }[] {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: "same" | "del" | "add"; line: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: "same", line: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: "del", line: A[i++] });
    else out.push({ t: "add", line: B[j++] });
  }
  while (i < n) out.push({ t: "del", line: A[i++] });
  while (j < m) out.push({ t: "add", line: B[j++] });
  return out;
}
