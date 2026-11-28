// REAL RENTALS Vehicle Rental Agreement v1.18 (Insurance Included): v1.17
// (agreement-v117.ts) with Section 13 also listing GPS history and photos,
// and Section 15 starter-interrupt wording that discloses remote disable
// without saying the engine must be off or that we will not activate the
// device while the vehicle is moving. Client-safe.
//
// v1.18 is derived from the v1.17 source by exact substitutions (sub() throws
// if the v1.17 text it anchors on ever changes), so every other v1.17 word is
// kept. v1.17 stays exported and renderable: signed agreements keep the exact
// text they were signed with (agreements.body), and the library keeps v1.17
// as its own family.
//
// Section 15 still discloses that we may remotely disable the Vehicle. It
// does not describe when the device takes effect. Internal staff rules about
// a safe location stay out of the agreement.

import { CLAUSE_STARTER_INTERRUPT } from "@/lib/agreement-v115";
import { V117_SOURCE, V117_TERM_DEFAULTS } from "@/lib/agreement-v117";

/** v1.17 (and v1.15-v1.16) Section 13.2 list of what we may give an agency. */
export const V117_SECTION_13_2_INFO =
  "giving the issuing agency your name, address, date of birth, driver license number, the rental dates, and a copy of this Agreement";

/** v1.18 Section 13.2: same list, plus GPS history and photos. */
export const V118_SECTION_13_2_INFO =
  "giving the issuing agency your name, address, date of birth, driver license number, the rental dates, a copy of this Agreement, GPS history, and photos";

/** v1.17 Section 13.3 consent list. */
export const V117_SECTION_13_3_INFO =
  "You consent to us giving your name, address, date of birth, driver license number, the rental dates, and a copy of this Agreement to any";

/** v1.18 Section 13.3: same consent list, plus GPS history and photos. */
export const V118_SECTION_13_3_INFO =
  "You consent to us giving your name, address, date of birth, driver license number, the rental dates, a copy of this Agreement, GPS history, and photos to any";

/**
 * v1.18 starter-interrupt disclosure. Still says we may remotely disable the
 * Vehicle when you are in default. Removes the engine-off and moving-vehicle
 * sentences. No timing conditions.
 */
export const CLAUSE_STARTER_INTERRUPT_V118 =
  "The Vehicle has a remote starter-interrupt device. If you are in default under Section 16, we may activate it to remotely disable the Vehicle. You agree we are not liable for lost earnings or other losses from its proper use.";

/** Exact substitution that fails loudly if the v1.17 anchor text is not found. */
function sub(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`agreement-v118: v1.17 anchor not found: ${from.slice(0, 80)}`);
  if (text.indexOf(from, at + from.length) >= 0) throw new Error(`agreement-v118: v1.17 anchor is not unique: ${from.slice(0, 80)}`);
  return text.replace(from, to);
}

if (!V117_SOURCE.includes(CLAUSE_STARTER_INTERRUPT)) {
  throw new Error("agreement-v118: v1.17 no longer has the v1.15 starter-interrupt clause");
}

let s = V117_SOURCE;
s = sub(s, "#- Vehicle Rental Agreement (v1.17)", "#- Vehicle Rental Agreement (v1.18)");
s = sub(s, V117_SECTION_13_2_INFO, V118_SECTION_13_2_INFO);
s = sub(s, V117_SECTION_13_3_INFO, V118_SECTION_13_3_INFO);
s = sub(
  s,
  `**Starter-Interrupt Device.** ${CLAUSE_STARTER_INTERRUPT}`,
  `**Starter-Interrupt Device.** ${CLAUSE_STARTER_INTERRUPT_V118}`,
);

if (!s.includes("**13.7 Questions About a Charge.**")) throw new Error("agreement-v118: Section 13.7 is missing");
if (!s.includes("GPS history, and photos")) throw new Error("agreement-v118: Section 13 is missing GPS history and photos");
if (!s.includes("we may activate it to remotely disable the Vehicle")) {
  throw new Error("agreement-v118: Section 15 is missing the remote-disable disclosure");
}
if (s.includes("engine is turned off")) throw new Error("agreement-v118: Section 15 still mentions the engine being turned off");
if (s.includes("We will not activate it to stop a moving vehicle")) {
  throw new Error("agreement-v118: Section 15 still says we will not activate the device while the vehicle is moving");
}
if (/while the vehicle is moving/i.test(s)) throw new Error("agreement-v118: Section 15 still mentions a moving vehicle");
if (/[\u2013\u2014]/.test(s)) throw new Error("agreement-v118: source has an em dash or en dash");

export const V118_SOURCE = s;

/** v1.18 prints the same contract values as v1.17. */
export const V118_TERM_DEFAULTS: Record<string, string> = { ...V117_TERM_DEFAULTS };
