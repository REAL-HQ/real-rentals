// Agreement Template Library: independent agreement families, each with its
// own key, version history and fingerprint. Client-safe (no server imports).
//
// The two built-in families are transcribed from the Owner-supplied PDFs:
//   no_insurance        "REAL RENTALS - Vehicle Rental Agreement (v1.10)"
//   insurance_required  "REAL RENTALS - Vehicle Rental Agreement (v1.10.2, Insurance Required)"
// Wording is verbatim except: company placeholders ([Legal Entity Name],
// [address], [phone], the support email) are merge fields from Settings →
// Company; reusable values are [[terms]]; bullets/checkboxes the PDF font
// cannot print became "-". Both start as Draft — Legal Review Required and
// can never be sent until the Owner approves a saved version.

import { V16_SOURCE, V16_TERM_DEFAULTS, writeTerms } from "@/lib/agreement-builder";
import { parseLayout } from "@/lib/agreement-layout";

export type LibraryTemplate = {
  key: string;
  name: string;
  displayVersion: string;
  insuranceRequired: boolean;
  sourceFile: string;
  source: string;
  terms: Record<string, string>;
  body: string;
  /** Reservation Fee row prints the entered amount (or "None"), not checkboxes. */
  reservationStyle: "amount";
};

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

export const LIBRARY: LibraryTemplate[] = [
  {
    key: "no_insurance", name: "Vehicle Rental Agreement — No Insurance Required", displayVersion: "1.10",
    insuranceRequired: false, sourceFile: "REAL-RENTALS-Vehicle-Rental-Agreement-v1.6_no_insurance-2.pdf",
    source: V110_SOURCE, terms: V110_TERM_DEFAULTS, body: writeTerms(V110_SOURCE, V110_TERM_DEFAULTS), reservationStyle: "amount",
  },
  {
    key: "insurance_required", name: "Vehicle Rental Agreement — Insurance Required", displayVersion: "1.10.2",
    insuranceRequired: true, sourceFile: "REAL-RENTALS-Vehicle-Rental-Agreement-v1.10.2_insurance_required.pdf",
    source: V1102_INS_SOURCE, terms: V1102_TERM_DEFAULTS, body: writeTerms(V1102_INS_SOURCE, V1102_TERM_DEFAULTS), reservationStyle: "amount",
  },
];

export const LIBRARY_KEYS = LIBRARY.map((t) => t.key) as [string, ...string[]];

export function libraryTemplate(key: string): LibraryTemplate | null {
  return LIBRARY.find((t) => t.key === key) ?? null;
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
