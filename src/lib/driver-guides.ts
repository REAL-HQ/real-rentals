/**
 * "What To Do If..." checklists shown in the renter portal. Client-safe, pure.
 *
 * Every step comes from the Vehicle Rental Agreement v1.14 (the section is
 * named on each guide) or is a plain safety step. No fee amounts are printed
 * here: fees live in the agreement and can change there without this file
 * going stale. Change a step only when the agreement changes.
 */
export type DriverGuideId =
  | "accident"
  | "breakdown"
  | "flat"
  | "lockout"
  | "theft"
  | "ticket"
  | "insurance"
  | "changes"
  | "payment";

export type DriverGuide = {
  id: DriverGuideId;
  title: string;
  summary: string;
  /** Where the steps come from, shown under the checklist. */
  source: string;
  steps: readonly string[];
  /** Things the agreement says not to do. */
  dont?: readonly string[];
  /** Shows the call button for the REAL RENTALS number. */
  call?: boolean;
};

export const DRIVER_GUIDES: readonly DriverGuide[] = [
  {
    id: "accident",
    title: "Accident",
    summary: "Any crash, no matter how small or who is at fault.",
    source: "Rental Agreement, Sections 5.4 and 8",
    call: true,
    steps: [
      "Call 911 if anyone is hurt.",
      "Report it to the police and get the report number.",
      "Take photos of the scene and every vehicle involved.",
      "Take photos of the other driver's license, license plate, and insurance card.",
      "Get names and phone numbers of any witnesses.",
      "Call or text REAL RENTALS as soon as it is safe, and within 2 hours.",
      "If the car is unsafe to drive, do not drive it. We will arrange the tow.",
      "If you were logged in to a rideshare or delivery app, report the accident to that platform within 24 hours.",
      "Send us a written, signed statement within 24 hours.",
      "Send us any letter, demand, or lawsuit papers you receive within 24 hours.",
    ],
    dont: [
      "Do not admit fault.",
      "Do not accept or offer money, or settle with anyone.",
      "Do not arrange towing or repairs yourself.",
    ],
  },
  {
    id: "breakdown",
    title: "Breakdown",
    summary:
      "The car will not start, stalls, overheats, leaks, makes a new noise, or shows a warning light.",
    source: "Rental Agreement, Section 12",
    call: true,
    steps: [
      "Stop driving if continuing could be unsafe or cause more damage.",
      "Pull over somewhere safe and turn on your hazard lights.",
      "Take a photo of the dashboard and anything that looks wrong.",
      "Call REAL RENTALS, or send a Roadside Request on this page with your location.",
      "Wait for us to tell you the next step. We choose the shop and arrange any tow.",
      "Report every problem as soon as you notice it, and no later than 24 hours.",
    ],
    dont: [
      "Do not have any repair, service, or towing done without our approval. Unapproved repairs are not reimbursed.",
    ],
  },
  {
    id: "flat",
    title: "Flat Tire",
    summary: "A flat, a blowout, a nail in the tire, or a bent wheel.",
    source: "Rental Agreement, Sections 4 and 12",
    call: true,
    steps: [
      "Slow down and pull over somewhere safe. Do not keep driving on a flat.",
      "Turn on your hazard lights.",
      "Take photos of the tire and wheel.",
      "Call REAL RENTALS, or send a Roadside Request on this page with your location.",
      "Wait for us to approve the repair or replacement before anyone works on the car.",
    ],
    dont: ["Do not have the tire repaired or replaced without our approval."],
  },
  {
    id: "lockout",
    title: "Lockout",
    summary: "Keys locked in the car, or a key or fob that is lost or damaged.",
    source: "Rental Agreement, Section 4",
    call: true,
    steps: [
      "Stay with the car if it is safe to do so.",
      "Call REAL RENTALS, or send a Roadside Request on this page with your location.",
      "If a key or fob is lost, tell us right away so the car can be secured.",
      "Wait for us to send help. The lockout and key charges in your agreement apply.",
    ],
    dont: ["Do not call your own locksmith or force a door or window."],
  },
  {
    id: "theft",
    title: "Theft",
    summary: "The car is stolen, broken into, or damaged on purpose.",
    source: "Rental Agreement, Section 8",
    call: true,
    steps: [
      "Call 911 if you are in danger.",
      "Report it to the police and get the report number.",
      "Call or text REAL RENTALS as soon as it is safe, and within 2 hours.",
      "Take photos of any damage and of where the car was parked.",
      "Keep every key and fob. We will need them back.",
      "Send us a written, signed statement within 24 hours.",
    ],
    dont: ["Do not arrange towing or repairs yourself."],
  },
  {
    id: "ticket",
    title: "Tickets & Tolls",
    summary: "A parking ticket, a camera citation, a moving violation, or a toll notice.",
    source: "Rental Agreement, Sections 13 and 19",
    steps: [
      "Tolls, tickets, and citations during your rental are yours to pay.",
      "Pay or contest a ticket directly with the agency that issued it, before its due date.",
      "Send us a photo of any ticket or notice left on the car or handed to you.",
      "Tell us within 24 hours about any moving violation, in any vehicle.",
      "Tell us before using your own toll transponder, so you are not billed twice.",
    ],
    dont: ["Do not remove or move the toll transponder in the car."],
  },
  {
    id: "insurance",
    title: "Insurance",
    summary:
      "A letter, text, or email from the insurance company, or a notice that the policy was cancelled or lapsed.",
    source: "Rental Agreement, Sections 5.7 and 6.3",
    call: true,
    steps: [
      "Forward any notice from the insurance company to us within 24 hours.",
      "Sign or e-sign any form the insurance company sends you within 24 hours.",
      "If you learn the policy is cancelled, suspended, or has lapsed: stop driving, park the car safely, and tell us at once.",
      "Wait for us to confirm the policy is in effect before you drive again.",
    ],
    dont: [
      "Do not drive at any time the car is not insured.",
      "Do not cancel or change the policy, or add a driver or vehicle to it, without our written consent.",
    ],
  },
  {
    id: "changes",
    title: "Personal Changes",
    summary:
      "Your license, your record, your contact details, your household, or a platform account.",
    source: "Rental Agreement, Section 19",
    steps: [
      "Tell us within 24 hours if your license is suspended, revoked, restricted, or expires.",
      "Tell us within 24 hours if you are in an accident or get a moving violation, in any vehicle.",
      "Tell us within 24 hours if you are arrested for or charged with DUI or reckless driving.",
      "Tell us within 24 hours if your address, phone, email, or household members change.",
      "Tell us within 24 hours if a rideshare or delivery platform deactivates your account.",
      "Update your phone, email, and address under Settings.",
    ],
    dont: ["Do not drive while your license is suspended or invalid."],
  },
  {
    id: "payment",
    title: "Payments",
    summary: "A declined card, or a payment you cannot make on time.",
    source: "Rental Agreement, Sections 3 and 4",
    steps: [
      "Contact us before the payment is due. Do not wait for it to be late.",
      "Check your card and update it under Payments if it changed or expired.",
      "Keep a valid card in your name on file for the whole rental.",
      "Contact us before disputing any charge with your bank, so we can fix it.",
    ],
  },
];
