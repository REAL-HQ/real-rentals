// REAL RENTALS Vehicle Rental Agreement v1.17 (Insurance Included): v1.16
// with the luxury / premium minimum age set to 23, matching the site.
// Client-safe.
//
// v1.17 is derived from the v1.16 source by an exact title substitution
// (sub() throws if that anchor changes). The age itself is the fill-in term
// min_age_premium, so signed v1.16 agreements keep 25. Every other v1.16 word
// stays.

import { V116_SOURCE, V116_TERM_DEFAULTS } from "@/lib/agreement-v116";

/** Exact substitution that fails loudly if the v1.16 anchor text is not found. */
function sub(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0) throw new Error(`agreement-v117: v1.16 anchor not found: ${from.slice(0, 80)}`);
  if (text.indexOf(from, at + from.length) >= 0) throw new Error(`agreement-v117: v1.16 anchor is not unique: ${from.slice(0, 80)}`);
  return text.replace(from, to);
}

if (V116_TERM_DEFAULTS.min_age_premium !== "25") {
  throw new Error("agreement-v117: v1.16 premium minimum age is no longer 25");
}

let s = V116_SOURCE;
s = sub(s, "#- Vehicle Rental Agreement (v1.16)", "#- Vehicle Rental Agreement (v1.17)");

export const V117_SOURCE = s;

/**
 * v1.17 prints the same contract values as v1.16, except the luxury / premium
 * minimum age is 23 (the site minimum). Economy stays 23.
 */
export const V117_TERM_DEFAULTS: Record<string, string> = {
  ...V116_TERM_DEFAULTS,
  min_age_premium: "23",
};
