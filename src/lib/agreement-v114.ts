// REAL RENTALS Vehicle Rental Agreement v1.14 (Insurance Included), transcribed
// from the Owner-supplied "REAL-RENTALS-Vehicle-Rental-Agreement-v1.14-Final.pdf".
// Client-safe (no server imports).
//
// Wording is verbatim except:
//  - the company's legal name, address, email and phone are merge fields from
//    Settings → Company;
//  - the minimum term (4 / "four (4)") and the Service Area are template values;
//  - page-1 rental details are merge fields filled from real records or from
//    staff entries in Prepare Agreement, and a blank one blocks sending;
//  - Mileage Out / Fuel Out print "To Be Completed At Pickup" (recorded on the
//    Vehicle Condition Report at pickup);
//  - each "Renter Initials" line is an acknowledgment row the renter initials
//    electronically, named after the section it follows; the printed page
//    footer comes from the eSign renderer;
//  - checkboxes print as [X] / [ ] and bulleted items with a bold lead-in print
//    as paragraphs, because the PDF font cannot draw ☐ or bold bullets.

const INITIALS_HEAD = "|#14 Initial | Renter Initials";
const initials = (what: string) => `${INITIALS_HEAD}\n|i ${what}`;

export const V114_SOURCE = `%%LAYOUT 1%%
# REAL RENTALS
#- Vehicle Rental Agreement (v1.14)

This Vehicle Rental Agreement ("Agreement") is between {{company_name}} ("REAL RENTALS," "we," "us"), {{company_address}}, {{company_email}}, {{company_phone}}, and the renter who signs below ("you," "Renter"). It covers the vehicle described below and any replacement vehicle we provide. Please read it carefully. Sections with an initials line need your initials.

### IMPORTANT INSURANCE NOTICE (Section 627.7263, Florida Statutes)
> "The valid and collectible liability insurance and personal injury protection insurance of any authorized rental or leasing driver is primary for the limits of liability and personal injury protection coverage required by ss. 324.021(7) and 627.736, Florida Statutes."

## Key Rental Terms
| Rental Start Date & Time | {{start_datetime}}
| Minimum Term Ends ([[min_term_weeks]] Weeks) | {{min_term_end}}
| Weekly Rate (Insurance Included) | {{weekly_rate}}
| Payment Schedule (Weekly / Every 4 Weeks) | {{payment_schedule}}

## Rental & Vehicle Information
| Agreement Number | {{agreement_number}}
| Renter Name | {{driver_name}}
| Phone / Email | {{driver_phone}} / {{driver_email}}
| Driver's License # / State / Expiration | {{license_number}} / {{license_state}} / {{license_expiration}}
| License Inspected By / Date | {{license_inspected}}
| Date of Birth | {{driver_dob}}
| Home Address | {{driver_address}}
| Vehicle (Year / Make / Model) | {{vehicle}}
| Color / VIN | {{vehicle_color}} / {{vehicle_vin}}
| License Plate / State | {{license_plate}}
| Vehicle Owner (as shown on the registration) | {{vehicle_owner}}
| Mileage Out / Fuel Out | To Be Completed At Pickup
| Amount Due Each Payment / Due Day | {{amount_due}}
| Reservation Fee (if any) | [[reservation_line]]
| Payment Method (Card Autopay, Zelle, Cash App, Venmo, Other) | {{payment_method}}
| Payment Card on File (last 4) | {{card_on_file}}
| Service Area | [[service_area]]
| Approved Additional Driver(s) | {{additional_drivers}}
| Approved Platform Use | {{platform_use}}

${initials("Optional Damage Waiver ($35 per week, Section 7.5): {{damage_waiver}}")}

| Renter Policy Insurance Company / Policy # | {{renter_policy}}
| Renter Policy Effective Date / Claims Phone | {{renter_policy_dates}}
| Toll Transponder # (if any) | {{toll_transponder}}

## 1. Definitions
**Vehicle** means the vehicle listed above, any replacement vehicle, and its keys, fobs, tires, equipment, accessories, and GPS and telematics devices.
**Vehicle Owner** means the owner shown on the Vehicle's registration, if it is not REAL RENTALS. REAL RENTALS manages the Vehicle and acts for the Vehicle Owner under this Agreement.
**Renter Policy** means the auto insurance policy issued in your name by a third-party insurance company that REAL RENTALS arranges under Section 5.
**Weekly Rate** means the weekly rent shown above. The daily rate is the Weekly Rate divided by 7.
**Rental Period** means from the time you take the Vehicle until it is returned to us and checked in, or recovered by us.
**Authorized Driver** means you and any additional driver who meets Section 9.
**Platform** means a rideshare or delivery company (such as Uber, Lyft, or DoorDash) whose app you use to work.
**Loss of Use** means the daily rate for each day the Vehicle cannot be rented because of damage, loss, theft, impound, or recovery, whether or not another vehicle was available.
**Telematics** means the GPS and vehicle data devices installed in the Vehicle.

## 2. Rental Term, Minimum Term & Renewal
**2.1 Minimum Term.** Your rental has a minimum term of [[min_term_words]] consecutive weeks, starting on the Rental Start Date.
**2.2 Automatic Renewal.** After the minimum term, your rental renews automatically for each payment period until you or we give notice under Section 2.3. You may not keep the Vehicle for any period that has not been paid for.
**2.3 Ending After the Minimum Term.** After the minimum term, either of us may end the rental with 48 hours' notice by text or email. You then return the Vehicle at the agreed place and time.
**2.4 Early Return.** If you return the Vehicle before the minimum term ends, you still owe the Weekly Rate for the rest of the minimum term, charged on the regular weekly schedule. We will credit you for each week the Vehicle is re-rented during that time.

## 3. Payment, Card on File & Autopay
**3.1 Payment Schedule.** Rent is paid in advance. Weekly payments are due every 7 days. If you pay every 4 weeks, each payment covers 28 days at the Weekly Rate. A payment is made only when we receive it.
**3.2 Payment Methods.** You may pay by automatic card payment (Autopay) or by an approved payment app or transfer, as listed above. Payment app fees are yours.
**3.3 Card on File.** Whatever method you use for rent, you must keep a valid debit or credit card in your name on file for the entire rental and until everything you owe is paid. You authorize us to charge that card for any amount you owe under this Agreement, with a receipt for each charge. There is no security deposit. If a charge is declined, you authorize us to retry it and to charge any replacement card you give us, and you remain responsible for the balance.
**3.4 Autopay.** If you choose Autopay, you authorize REAL RENTALS to charge your card on file for the Amount Due Each Payment, in advance, on the same day of each payment period, starting on the Rental Start Date, until your rental ends and the Vehicle is returned. A failed Autopay charge is a late payment. Billing for rent ends when the Vehicle is returned and checked in, and we will cancel Autopay within one (1) business day after that. Cancelling Autopay, disputing a charge, or removing your card without returning the Vehicle does not end your rental or your duty to pay.
**3.5 Refunds.** Rent once charged is not refunded, except: (a) if you paid for 4 weeks and return the Vehicle after the minimum term, we refund any full unused weeks; (b) the mechanical-repair credit in Section 12.5; and (c) any refund the law requires.
**3.6 How Payments Are Applied.** Payments are applied first to fees and charges, then to past-due rent, then to current rent.
${initials("Section 3: Payment, Card on File & Autopay")}

## 4. What You Pay
This table lists everything you may be charged. Where it says "actual," we charge the actual cost and send a receipt or invoice.
|#40 Item | Amount
| Rent | Weekly Rate shown above, paid in advance
| Insurance (Renter Policy premium) | Included in the Weekly Rate, subject to Section 5.5
| Taxes and government surcharges | Included in the Weekly Rate. Nothing is added.
| Reservation Fee (if entered above) | Amount shown above, due when pickup is scheduled and applied in full to your first week. Non-refundable if you do not show or cancel less than 24 hours before pickup. Refunded if you cancel earlier or we cannot provide a vehicle. It is not a security deposit.
| Late payment | $50 for each day a payment is late
| Declined or returned payment | $35 per occurrence
| Late vehicle return | Daily rate for each day late, + $50 if you don't tell us in advance
| Additional approved driver | $50 per week, per driver, + any added Renter Policy premium
| Tolls (SunPass / toll-by-plate) | Actual amount owed, no added fee
| Parking tickets, camera citations & violations | Actual amount owed + $25 administrative fee per citation
| Damage to, or loss or theft of, the Vehicle | Actual repair cost, or the Vehicle's actual cash value under Section 7.2. You owe nothing for it if the Damage Waiver applies (Section 7.5).
| Damage Waiver (optional) | $35 per week, charged with rent, if accepted on page 1
| Loss of Use | Daily rate for each day the Vehicle is out of service
| Diminished value | Actual reduction in the Vehicle's value from damage or repair, based on a written appraisal or estimate
| Insurance deductible | Actual deductible of any insurance policy (the Renter Policy's or a Platform's) that pays a claim from your rental
| Towing, storage & impound | Actual third-party cost
| Flat or damaged tire, wheel or rim (renter-caused) | Actual repair or replacement cost
| Lost or damaged key / fob | Actual replacement cost + Loss of Use
| Lockout / locksmith service call | $75 per call
| Smoking, vaping, or persistent odor | $250 + actual cost to repair any burns or damage
| Excessive cleaning, including pet hair and spills | $75 to $150, depending on the cleaning needed
| Returned low on fuel | $25 refuel fee + actual cost of fuel
| Unauthorized driver or subleasing | $500 per occurrence + all resulting losses
| Vehicle recovery | $250 + actual third-party recovery, tow, impound, and storage costs
| Renter Policy cancelled or changed by you | Actual cost to us (lost premium, reinstatement, or replacement policy)
| Payment disputes and chargebacks you file that are not upheld | Actual fees our payment processor charges us + the disputed amount
| Collection costs and attorney's fees | As stated in Section 24
${initials("Section 4: What You Pay")}

## 5. Insurance Included: The Renter Policy
**5.1 Renter Policy.** Your Weekly Rate includes an auto insurance policy that REAL RENTALS arranges and pays for through a licensed insurance agency. The Renter Policy is issued by a third-party insurance company in your name, as the named insured, on the Vehicle. We set it up after you sign this Agreement, and you may not take or drive the Vehicle until we tell you it is in effect. You will receive an insurance ID card to keep in the Vehicle and to upload to your Platform accounts.
**5.2 What It Covers.** The Renter Policy is a personal auto policy with the liability coverage Florida requires (bodily injury liability, property damage liability, and personal injury protection) at Florida's minimum limits, with a rideshare endorsement. The Renter Policy's own terms set the exact coverages and limits.
**5.3 What It Does Not Cover.** The Renter Policy is liability coverage only. It does not cover damage to or theft of the Vehicle. You are responsible for that under Section 7. Its limits may be much lower than the cost of a serious accident. Coverage is subject to the insurance company's terms and exclusions, and the insurance company, not REAL RENTALS, decides claims. REAL RENTALS is not an insurance company or insurance agent and does not guarantee that any claim will be paid.
**5.4 Rideshare & Delivery.** The rideshare endorsement applies only to the kinds of Platform work it lists. Use the Vehicle only for the Approved Platform Use marked on page 1. While you are on a trip, the Platform's insurance applies as the Platform provides. You must keep your Platform accounts in good standing, follow each Platform's vehicle and insurance rules, and report any accident that happens while you are logged in to the Platform within 24 hours.
**5.5 Insurance Cost.** REAL RENTALS pays the Renter Policy premium. If the insurance company raises the premium because of your driving record, a claim, a citation, an added driver, or information that was inaccurate or not disclosed, we may raise your Weekly Rate by the amount of the increase with 7 days' written notice. If you don't accept the change, you may end the rental without the early-return charge by returning the Vehicle before the new rate starts. Any premium refund belongs to REAL RENTALS. If a refund is sent to you, you will pay it to us within 5 days.
**5.6 Coverage Is Only for This Rental.** We will cancel the Renter Policy, or remove the Vehicle from it, when the rental ends, the Vehicle is returned or recovered, or this Agreement is terminated. If rent is more than 48 hours past due, we may cancel it after notice to you by text or email. Once the policy is cancelled, the insurance ID card is no longer valid, and you must remove the Vehicle from your Platform accounts.
**5.7 Lapse or Cancellation.** You may not drive the Vehicle at any time it is not insured. If you learn the Renter Policy has been cancelled, suspended, or has lapsed, stop driving, park the Vehicle safely, and tell us at once. If anyone drives while the Vehicle is uninsured, you are personally responsible for all resulting claims and losses.
**5.8 Other Insurance.** Our own insurance covers the Vehicle only when it is not rented. It does not cover you, your passengers, or anyone else during the Rental Period. Any other insurance you carry applies as its terms allow. No insurance, and no change, cancellation, or lapse in any insurance, reduces your responsibility under this Agreement.
${initials("Section 5: Insurance Included: The Renter Policy")}

## 6. Insurance Authorization
**6.1 Appointment.** You appoint REAL RENTALS, its owners and staff, and the insurance agency we use, as your limited agent and attorney-in-fact for the sole purpose of the Renter Policy. This appointment lasts until the Renter Policy is cancelled and all claims from your rental are closed. Under it, they may, in your name and for you:
a. request quotes for, apply for, bind, renew, and change the Renter Policy, and add or remove the Vehicle, replacement vehicles, and approved drivers;
b. pay the premium, set up and manage premium billing, and receive any premium refund;
c. cancel the Renter Policy, or remove the Vehicle from it, as described in Section 5.6;
d. receive and keep copies of your policy documents, declarations pages, ID cards, billing and cancellation notices, and claim correspondence;
e. have REAL RENTALS and the Vehicle Owner listed as additional insured, additional interest, or loss payee, as the insurance company allows;
f. communicate with the insurance company, its agents, and adjusters about the policy and any claim, and report claims;
g. endorse and deposit any check or payment made to you, or to you and us jointly, for damage to or loss of the Vehicle, and apply it to what you owe us; and
h. give the insurance company and its agents the information they need, including your name, date of birth, address, phone, email, driver's license, driving record, claims history, and household members, and obtain your motor vehicle report and any insurance score the insurance company uses.
**6.2 What We Do Not Do.** We do not sign forms that the insurance company requires the named insured to sign, and we do not settle bodily injury claims against you.
**6.3 Your Cooperation.** You agree to sign or e-sign any form the insurance company sends you within 24 hours; answer the insurance company's questions truthfully; forward to us within 24 hours any notice you receive from the insurance company; and not cancel or change the Renter Policy, or add any driver or vehicle to it, without our written consent.
${initials("Section 6: Insurance Authorization")}

## 7. Damage, Loss & Theft: Your Responsibility
**7.1 You Are Responsible for the Vehicle.** Except as limited by the Damage Waiver in Section 7.5, you are responsible, regardless of fault, for all physical damage to, and loss or theft of, the Vehicle during the Rental Period, up to its full actual cash value, plus the related charges in Section 4, less any insurance payment we actually receive for the same loss. Normal wear is not damage.
**7.2 Total Loss or Theft.** If the Vehicle is stolen and not recovered, is a total loss, or we reasonably decide it is not worth repairing, you owe its actual cash value on the date of loss, based on a recognized valuation guide or written appraisal, less any salvage value we receive.
**7.3 Proof of Cost.** We will give you a written estimate or invoice, photos, and the Vehicle Condition Reports supporting any damage charge. We may charge your card on file when the cost is known, or set up a written payment plan at our option.
**7.4 Third-Party Recovery.** If another driver is at fault, we may pursue that driver and their insurer. We will credit you for any amount we actually recover for the same loss, minus our collection costs, up to the amount you paid us for that loss. You assign to us your rights to recover for damage to the Vehicle.
**7.5 Optional Damage Waiver.** You may accept or decline the Damage Waiver on page 1. It is optional and is not required to rent. The Damage Waiver is not insurance. It is our agreement to give up our right to collect from you for damage to the Vehicle.
|#50 Without the Damage Waiver | With the Damage Waiver: $35 per week
| You pay the full cost | You pay $0. No deductible.
| You owe the full repair cost, or the Vehicle's full value if it is stolen or totaled, plus Loss of Use and the related charges in Section 4, regardless of fault. | You owe us nothing for damage to, or loss or theft of, the Vehicle, including repairs, the Vehicle's value, Loss of Use, diminished value, and towing, as long as the conditions below are met.

**What it does not cover.** It does not apply to tires, wheels, keys or fobs, interior damage, cleaning, smoking or odor charges, tolls, tickets, or any other charge in Section 4. It does not cover injuries, damage to other people's property, or any claim by anyone else.
**When it does not apply.** The Damage Waiver does not apply, and you owe the full amount under Section 7.1, if the damage or loss happens: while an unauthorized driver has the Vehicle; during a prohibited use under Section 10; through your intentional or reckless act; while the Vehicle is uninsured; while any rent or charge is past due; when you did not report it and get a police report as Section 8 requires; when the Vehicle is stolen and you cannot return its keys; or when you gave false information to us or an insurance company.
**Price and timing.** The Damage Waiver fee is in Section 4 and is not refundable. It applies only to incidents that happen while it is in effect. If you declined it at the start, you may add it later only with our written approval after we inspect the Vehicle, and it does not apply to earlier damage.
${initials("Section 7: Damage, Loss & Theft: Your Responsibility")}

## 8. Accidents, Theft & Claims
If the Vehicle is in an accident, or is stolen, broken into, or vandalized, you must:
a. call 911 if anyone is hurt, report it to the police, and get a report number;
b. tell us by phone or text as soon as it is safe and within 2 hours, and send photos of the scene and all vehicles, the other driver's license, plate, and insurance card, and witness contacts;
c. give us a written, signed statement within 24 hours;
d. report the claim to the Renter Policy insurance company, or let us report it for you;
e. send us any letter, demand, or lawsuit papers you receive within 24 hours;
f. cooperate with us, the insurers, and their investigators, and give truthful and complete information, including whether you were logged in to a Platform at the time; and
g. not admit fault, accept or offer money, settle, or arrange towing or repairs yourself.
If you don't, an insurer may deny coverage, and you are responsible for what it would have paid. If the Vehicle is unsafe to drive, do not drive it; we will arrange towing.
${initials("Section 8: Accidents, Theft & Claims")}

## 9. Authorized Drivers
Only you may drive the Vehicle, unless we approve an additional driver in writing. An additional driver must meet Section 19, be listed on page 1, sign our additional-driver form, and be added to the Renter Policy before driving. You may not let anyone else drive the Vehicle or use it to work on any Platform account, even briefly. There may be no insurance if they do. You are responsible for every act of any person you allow to use the Vehicle.

## 10. Permitted & Prohibited Uses
**10.1 Permitted Use.** You may use the Vehicle for personal driving and for the Approved Platform Use marked on page 1, under your own Platform accounts. Unlimited miles within Florida are included, with no per-mile charge.
**10.2 Prohibited Uses.** You may not:
- use the Vehicle for a kind of Platform work that is not marked as Approved Platform Use;
- sublease, re-rent, list on a car-sharing app, lend, sell, pledge, or try to transfer the Vehicle;
- carry passengers or goods for pay outside a Platform app;
- drive while impaired by alcohol, drugs, or medication, or while your license is suspended or invalid;
- use the Vehicle for any crime, to carry illegal items, or to flee law enforcement;
- race, drive off-road, or drive recklessly or at excessive speed, including as shown by Telematics;
- tow, push, or pull anything, or overload the Vehicle;
- drive outside Florida, or outside the Service Area listed above, without our written consent;
- live in, sleep overnight in, or store your belongings in the Vehicle;
- smoke or vape in the Vehicle, or carry animals other than service animals without our written consent;
- modify the Vehicle, including window tint, stereo, lighting, or decals other than required Platform signage; or
- leave the Vehicle unlocked, running unattended, or with the keys inside.
A prohibited use may void insurance coverage, and you are responsible for all losses that result.
${initials("Section 10: Permitted & Prohibited Uses")}

## 11. Vehicle Condition & Inspections
**11.1 Pickup.** We will inspect and photograph the Vehicle with you at pickup and record it on the Vehicle Condition Report. By signing the report, you agree it is accurate and that the Vehicle was in safe working order.
**11.2 Return.** We will inspect and photograph the Vehicle at return. If you are not present, our dated photos and report control. Damage not shown on the most recent report is presumed to have happened during your rental unless you show otherwise.
**11.3 Periodic Inspections.** You agree to make the Vehicle available for an inspection and photos every 30 days or 3,000 miles, whichever comes first, or when we ask, and to send photos by text when we ask.

## 12. Maintenance, Repairs & Breakdowns
**12.1 What We Do.** We pay for routine maintenance, oil changes, tires replaced because of normal wear, safety recall repairs, and mechanical repairs not caused by you, done at REAL RENTALS-approved vendors. We keep maintenance and repair records for each Vehicle.
**12.2 What You Do.** You must bring the Vehicle for scheduled maintenance on time, including oil changes every 5,000 miles or as we direct, and keep the Vehicle available for maintenance, inspection, or recall repair.
**12.3 Report Problems.** Report any issue, including warning lights, unusual noises, leaks, tire problems, or damage, as soon as you notice it and no later than 24 hours. Stop driving if continuing could be unsafe or cause more damage.
**12.4 No Unapproved Repairs.** Do not have any repair, service, or towing done without our approval. We choose the shop. Unapproved repairs are not reimbursed, and you are responsible for problems they cause. Damage caused by missed maintenance, an issue you did not report promptly, misuse, neglect, or a prohibited use is your cost.
**12.5 Vehicle Exchange & Repair Credit.** We may require you to exchange the Vehicle for a comparable vehicle at any time, within 24 hours of our request. We will try to provide a comparable replacement during repairs but do not guarantee one. If the repair is from normal wear or a mechanical failure not caused by you and no replacement is available, you are not charged rent for the days without a vehicle, credited to your next payment. If the repair is from an accident, misuse, neglect, or a prohibited use, rent remains due and Loss of Use applies.

## 13. Tolls & Tickets
**13.1 Tolls.** You are responsible for all tolls during the Rental Period. The Vehicle may have a toll transponder or be billed by plate. Do not remove or move the transponder, and tell us before using your own transponder to avoid double billing.
**13.2 Tickets & Citations.** You are responsible for all parking tickets, camera citations, moving violations, fines, and penalties during the Rental Period. If we receive one, we may transfer it to you by giving the issuing agency your name, address, and license information, as Florida law allows, or pay it and charge you. Disputes about a citation are between you and the issuing agency.

## 14. GPS, Telematics & Data Consent
**14.1 Consent.** The Vehicle has GPS tracking and telematics devices installed. By signing and initialing below, you give your express consent, under Section 934.425, Florida Statutes, and any other applicable law, for REAL RENTALS and its vendors to use these devices to determine the location and movement of the Vehicle and collect driving data (such as location, speed, mileage, and time of use) during the Rental Period and until the Vehicle is returned or recovered.
**14.2 Uses.** We use this data to manage the fleet, schedule maintenance, protect safety, check compliance with this Agreement, locate and recover the Vehicle, respond to accidents, claims, and law enforcement, and prove charges and defend payment disputes.
**14.3 No Tampering.** You may not disable, block, unplug, move, or damage any device. You pay the actual cost of repair or replacement.
${initials("Section 14: GPS, Telematics & Data Consent")}

## 15. Remote Disable & Vehicle Recovery
**15.1 Remote Disable.** The Vehicle is equipped so that we can remotely prevent it from restarting. We may do so when you are in default under Section 16. For non-payment, we will do so only when a payment is more than 48 hours past due and after texting or emailing you at least 24 hours ahead. We will only disable the Vehicle when it is parked, never while it is moving. We may act without advance notice if the Vehicle is reported stolen, has left Florida without our consent, its Telematics has been tampered with, the Renter Policy is not in effect, or there is a safety emergency.
**15.2 Recovery.** When the rental ends or you are in default, you must return the Vehicle. If you don't, you authorize REAL RENTALS and its recovery agents to locate the Vehicle and to enter onto property where it is parked, where lawful, to recover it without breach of the peace.
${initials("Section 15: Remote Disable & Vehicle Recovery")}

## 16. Default & Termination
**16.1 Default.** You are in default if:
- rent or any charge is not paid by its due date;
- an unauthorized person drives the Vehicle, or you commit a prohibited use under Section 10;
- the Vehicle is driven while uninsured, or you cancel, change, or interfere with the Renter Policy;
- you give false or incomplete information to us or the insurance company;
- you fail to report an accident, theft, or damage, or fail to cooperate with a claim;
- you miss scheduled maintenance, or refuse an inspection or vehicle exchange;
- your license is suspended, revoked, or expires, or the insurance company declines, cancels, or will not renew coverage for you;
- you tamper with Telematics, or the Vehicle is abandoned under Section 17.3;
- you are arrested for a crime involving the Vehicle, or the Vehicle is seized;
- you file a chargeback in breach of Section 23; or
- you break any other term of this Agreement and do not fix it within 24 hours after our notice, if it can be fixed.
**16.2 Our Rights.** If you are in default, we may, in any combination and in addition to any other legal right: end the rental immediately by text or email; require you to return the Vehicle at once; disable and recover the Vehicle under Section 15; cancel the Renter Policy; and charge your card for all amounts owed. Amounts owed for the minimum term remain due, less credit for weeks re-rented.

## 17. Return, Failure to Return & Abandonment
**17.1 Return.** Return the Vehicle on time, at the agreed place, with its keys and all equipment, all personal items removed, the same fuel level, and in the same condition except normal wear. The rental ends only when we check the Vehicle in.
**17.2 Failure to Return.** If the Vehicle is not returned when the rental ends, we may send a written demand for its return by certified mail, return receipt requested, or by courier with tracking, to your address in this Agreement. If you don't return it within 5 days after the demand is delivered or returned undelivered, we may report the Vehicle stolen to law enforcement as Section 812.155, Florida Statutes, allows. A demand sent to your address in this Agreement is effective even if you don't receive it.

### FLORIDA REQUIRED NOTICE (Section 812.155(6), Florida Statutes)
> Failure to return rental property or equipment upon expiration of the rental period and failure to pay all amounts due (including costs for damage to the property or equipment) are evidence of abandonment or refusal to redeliver the property, punishable in accordance with section 812.155, Florida Statutes.
${initials("Section 17.2 and the Florida Required Notice")}

**17.3 Abandonment.** The Vehicle is abandoned if it is left unattended in an unsafe or unlawful place, or if rent is unpaid and we cannot reach you for 48 hours by phone, text, and email. We may recover an abandoned Vehicle at once.

## 18. Personal Property
We are not responsible for personal property left in, carried in, or lost from the Vehicle, including in a recovered Vehicle, except for loss caused by our gross negligence or intentional misconduct. We will try to contact you about items we find and hold them for 30 days. After that, we may dispose of them as Florida law allows.

## 19. Who Can Rent & Drive
You and every Authorized Driver must: be at least 21 to rent an economy vehicle and at least 25 to rent a luxury or premium vehicle; hold a valid U.S. driver's license, held for at least one year, which we inspect before the rental begins; have a driving record acceptable to us; and be approved by the Renter Policy insurance company. You authorize us to check your driving record and background before and during the rental, and we may decline or end a rental based on what we find.
**Accurate Information.** The Renter Policy is priced and issued based on what you tell us. You state that everything you have given us is true and complete, including your address, your license status, your accidents and violations, and every person who lives in your household. If inaccurate or incomplete information leads the insurance company to deny a claim or cancel the policy, you are responsible for all resulting losses.
**Tell Us About Changes.** During your rental, you must tell us within 24 hours if your license is suspended, revoked, restricted, or expires; if you are in an accident or receive a moving violation, in any vehicle; if you are arrested for or charged with DUI or reckless driving; if your address, phone, email, or household members change; or if a Platform deactivates your account.
We rent without regard to race, color, religion, sex, national origin, disability, or any other characteristic protected by law.

## 20. Rental Company Status & Your Control of the Vehicle
**20.1 Rental Business.** REAL RENTALS is engaged in the trade or business of renting motor vehicles. This Agreement is a rental of a motor vehicle for a period of less than one year.
**20.2 Your Possession and Control.** During the Rental Period you have exclusive possession, operation, and control of the Vehicle. REAL RENTALS does not direct or control your driving, routes, hours, passengers, or deliveries.
**20.3 You Are Not Our Agent or Employee.** You are not an employee, agent, partner, or contractor of REAL RENTALS or of any Vehicle Owner. Any Platform work you do is for your own account under your own agreement with the Platform. REAL RENTALS is not a transportation network company or delivery company.
**20.4 Federal Law.** The parties intend that 49 U.S.C. § 30106 applies to this rental. REAL RENTALS and any Vehicle Owner rely on its protection for owners engaged in the business of renting motor vehicles. Nothing in this Agreement is an admission of liability by REAL RENTALS or any Vehicle Owner.
${initials("Section 20: Rental Company Status & Your Control of the Vehicle")}

## 21. Indemnification
To the fullest extent the law allows, you will defend, indemnify, and hold harmless REAL RENTALS, any Vehicle Owner, and their owners, members, managers, employees, and agents (the "Protected Parties") from all claims, lawsuits, demands, damages, judgments, settlements, fines, penalties, losses, and costs, including reasonable attorney's fees, expert fees, and recovery costs, brought by anyone (including passengers, other drivers, pedestrians, property owners, Platforms, insurers, and government agencies) that arise from: (a) the use, operation, possession, or condition of the Vehicle during the Rental Period, by you or anyone you allowed to use it; (b) any breach of this Agreement; or (c) any false information you gave. This includes amounts above, or excluded from, the Renter Policy or any Platform insurance, and any amount a Protected Party must pay as owner of the Vehicle. This indemnity does not cover a Protected Party's own sole negligence, gross negligence, or intentional misconduct. It survives the end of this Agreement.
${initials("Section 21: Indemnification")}

## 22. Limitation of Our Liability
**22.1** To the fullest extent the law allows, REAL RENTALS is not liable to you for lost income, lost Platform earnings, deactivation by a Platform, missed trips, or any indirect, incidental, special, consequential, or punitive damages, including from a breakdown, recall, remote disable, recovery, or vehicle exchange done under this Agreement.
**22.2** To the fullest extent the law allows, our total liability to you for any claim related to this Agreement is limited to the rent you paid in the 4 weeks before the claim arose.
**22.3** Nothing in this Agreement limits any liability or right that cannot be limited or waived under Florida law, including liability for our own gross negligence or intentional misconduct.
${initials("Section 22: Limitation of Our Liability")}

## 23. Payment Disputes & Chargebacks
You agree that charges made under this Agreement are authorized by you. Before disputing any charge with your bank or card company, you will contact us at {{company_email}} and give us 10 business days to resolve it. You may not file a chargeback or payment dispute for rent or charges you authorized in this Agreement. You authorize us to submit this Agreement, your initials and e-signature records, payment history, Vehicle Condition Reports, photos, Telematics records, messages, invoices, and receipts to your bank, card company, or our payment processor as evidence. A dispute does not stop rent from accruing while you keep the Vehicle.
${initials("Section 23: Payment Disputes & Chargebacks")}

## 24. Collections, Attorney's Fees & Costs
If you don't pay what you owe, we may send your account to a collection agency or attorney and report it as the law allows. To the extent Florida law allows, you will pay our reasonable costs of collection, court costs, and reasonable attorney's fees. In any lawsuit about this Agreement, the prevailing party may recover its reasonable attorney's fees and costs, including on appeal.

## 25. Electronic Signatures & Communications
**25.1 E-Sign Consent.** You agree to sign this Agreement and related documents electronically, and that your electronic signature and initials are as valid as handwritten ones under the federal ESIGN Act and Section 668.50, Florida Statutes. You are able to access, download, and keep electronic records, and you may ask us for a paper copy at no charge.
**25.2 Electronic Notices.** You agree to receive this Agreement, receipts, policy documents, ID cards, and notices by email or text at the contact details on file, except where the law requires another method. A notice is received when sent to your contact details on file.
**25.3 Calls and Texts About Your Rental.** You agree that REAL RENTALS, its vendors, and the insurance agency and company may call and text you at the phone number you gave us, including with automated systems, about your application, rental, payments, insurance, Vehicle, maintenance, accidents, claims, and recovery. Message and data rates may apply. Marketing texts require your separate consent on our text-message consent form.

## 26. Privacy & Information Sharing
We do not sell your personal information. We may share it, and Telematics data, only as needed to run your rental and protect the Vehicle: with the insurance agency, the Renter Policy insurance company, and its adjusters; Platforms when needed for insurance or an incident; toll and enforcement agencies; our payment processor and banks; maintenance, repair, towing, and telematics vendors; recovery agents; collection agencies and attorneys; the Vehicle Owner; and law enforcement or courts when the Vehicle is not returned, is involved in an incident, or the law requires.

## 27. Governing Law, Venue & Jury Trial Waiver
**27.1** This Agreement is governed by Florida law and, where it applies, federal law. Any lawsuit about this Agreement or the rental must be brought in the state courts located in Hillsborough County, Florida.
**27.2** JURY TRIAL WAIVER. YOU AND REAL RENTALS EACH KNOWINGLY AND VOLUNTARILY WAIVE ANY RIGHT TO A TRIAL BY JURY IN ANY LAWSUIT ARISING OUT OF OR RELATING TO THIS AGREEMENT, THE VEHICLE, OR THE RENTAL.
${initials("Section 27: Governing Law, Venue & Jury Trial Waiver")}

## 28. General Terms
**Entire Agreement.** This Agreement, its Vehicle Condition Reports, the additional-driver form, and any signed addendum are the entire agreement between us about the rental. If anything on our website, ads, or messages differs from this Agreement, this Agreement controls. Insurance coverage is controlled by the Renter Policy.
**Changes.** This Agreement may be changed only in a writing signed or accepted by both of us, except a Weekly Rate change under Section 5.5.
**Severability and No Waiver.** If any part is unenforceable, the rest still applies. Our not enforcing a term, or accepting a late payment, is not a waiver.
**Assignment.** You may not assign or transfer this Agreement or the Vehicle. We may assign this Agreement, or our right to payment, without your consent.
**Vehicle Owner.** Any Vehicle Owner is a Protected Party and may enforce Sections 7, 20, and 21.
**Survival.** Your payment, damage, indemnity, toll and citation, chargeback, and collection obligations survive the end of this Agreement.

## What's Included in Your Rental
**Insurance Included.** A liability policy with a rideshare endorsement, in your name, with an ID card for your Platform accounts.
**Unlimited Miles.** Drive as much as you need within Florida. No mileage limits or per-mile charges.
**Maintenance Included.** We pay for routine maintenance, oil changes, tires from normal wear, and mechanical repairs.
**Drive for Your Platforms.** Work under your own accounts on your approved Platforms, plus personal driving.
**Repair Swaps.** Mechanical repair? We'll try to swap you into a comparable vehicle. If none is available, no rent while you're without a car.
**No Security Deposit.** Just a valid card on file. Pay weekly or every 4 weeks, by card autopay or an approved payment app.

%%PAGE%%
## Signatures
~ By signing, both parties agree to all terms of this Agreement.
%%SIGNATURES {{agreement_number}}%%

%%PAGE%%
## Vehicle Condition Report
| Agreement Number | {{agreement_number}}
| Renter | {{driver_name}}
| Vehicle / Plate / VIN | {{vehicle}} / {{license_plate}} / {{vehicle_vin}}

### At Pickup
| Date & Time |
| Mileage |
| Fuel Level |
| Tires and Wheels (Condition / Tread) |
| Existing Damage (Y/N) and Locations |
| Dashboard Warning Lights (Y/N) |
| Interior Condition / Odor |
| Keys / Fobs Count |
| Insurance ID Card & Registration in Vehicle (Y/N) |
| Number of Photos Taken (all sides, interior, odometer, fuel) |
| Notes |
| Renter Initials / REAL RENTALS Initials |

### At Return
| Date & Time |
| Mileage |
| Fuel Level |
| Tires and Wheels (Condition / Tread) |
| New Damage (Y/N) and Locations |
| Dashboard Warning Lights (Y/N) |
| Interior Condition / Odor |
| Keys / Fobs Count |
| Number of Photos Taken (all sides, interior, odometer, fuel) |
| Personal Items Removed (Y/N) |
| Notes |
| Renter Initials / REAL RENTALS Initials |
`;

/** Template values for v1.14. Everything else in the wording is fixed text. */
export const V114_TERM_DEFAULTS: Record<string, string> = {
  min_term_weeks: "4",
  min_term_words: "four (4)",
  // Left blank to be set by the Owner, as in v1.10: nothing is invented.
  reservation_line: "",
  service_area: "",
};
