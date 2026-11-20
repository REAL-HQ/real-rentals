// Florida 812.155 Addendum (v1.0) for current renters whose signed agreement
// predates v1.14/v1.15 (or who signed on paper). Client-safe.
//
// It carries the eight v1.15 additions (agreement-v115.ts) word for word, each
// with its own Renter Initials row, plus the line tying it to the renter's
// Vehicle Rental Agreement number (auto-filled when we know it, "___" when we
// do not, e.g. a paper agreement). Built Nov 19 2026 at Dolmar's direction
// (relayed by FLEET, 9:04 PM ET). It is NOT approved for renters: nothing
// sends it, and the staff PDF stays a watermarked preview until the Owner
// approves the wording (FL_ADDENDUM_OWNER_APPROVAL) after a Florida attorney
// reviews it.

import { LAYOUT_MARKER } from "@/lib/agreement-layout";
import {
  FL_812155_NOTICE,
  CLAUSE_RENTAL_PERIOD_ENDS,
  CLAUSE_CONSENT_WITHDRAWN,
  CLAUSE_NOTICE_ADDRESS,
  CLAUSE_SERVICE_AREA_CONSENT,
  CLAUSE_STARTER_INTERRUPT,
  PEST_FEE_ITEM,
  PEST_FEE_AMOUNT,
  CLAUSE_LICENSE_COPY,
} from "@/lib/agreement-v115";
import { V115_TERM_DEFAULTS } from "@/lib/agreement-v115";

export const FL_ADDENDUM_VERSION = "1.0";
export const FL_ADDENDUM_TITLE = "Florida 812.155 Addendum";
/** What prints when the renter's agreement number is not on file (paper agreements). */
export const UNKNOWN_AGREEMENT_NUMBER = "___";
/**
 * Owner approval of the addendum wording for renters. null = not approved:
 * staff can preview it (watermarked) but cannot print it for signature.
 * Set only on Dolmar's explicit approval, after attorney review.
 */
export const FL_ADDENDUM_OWNER_APPROVAL: { at: string; by: string } | null = null;

/** Verbatim line required by the Owner; {{agreement_number}} is filled per renter. */
export const ADDENDUM_PART_OF_LINE_TEMPLATE =
  "This addendum is part of your Vehicle Rental Agreement No. {{agreement_number}} and applies to the Vehicle and any replacement vehicle.";

/**
 * Drafted for this addendum (not from the Owner's list), so older agreements
 * with different section numbers read correctly. Flagged for attorney review.
 */
export const ADDENDUM_SECTION_REFERENCES =
  "Your Vehicle Rental Agreement may number its sections differently from our current agreement. In this addendum, a reference to Section 16 means the default and termination terms of your Agreement, Section 2.2 means its rental term and renewal terms, and Section 4 means its fee schedule. If this addendum and your Agreement differ, this addendum controls. All other terms of your Agreement stay the same.";
/** Drafted for item 7: pests added to the Damage Waiver exclusions of an older agreement. */
export const ADDENDUM_PEST_WAIVER =
  "If your Agreement includes a damage waiver, it does not cover pest, insect, or biohazard infestation.";

export const FL_ADDENDUM_SOURCE = `${LAYOUT_MARKER}
# REAL RENTALS
#- ${FL_ADDENDUM_TITLE} (v${FL_ADDENDUM_VERSION})

This addendum is between {{company_name}} ("REAL RENTALS," "we," "us"), {{company_address}}, {{company_email}}, {{company_phone}}, and the renter who signs below ("you," "Renter").
${ADDENDUM_PART_OF_LINE_TEMPLATE}

## Renter & Vehicle
| Agreement Number | {{agreement_number}}
| Renter Name | {{driver_name}}
| Home Address | {{driver_address}}
| Vehicle (Year / Make / Model) | {{vehicle}}
| VIN | {{vehicle_vin}}
| License Plate / State | {{license_plate}}
| Service Area | {{service_area}}

## How This Addendum Works
${ADDENDUM_SECTION_REFERENCES}

## 1. Florida Required Notice
! **FLORIDA REQUIRED NOTICE (Section 812.155(6), Florida Statutes).** ${FL_812155_NOTICE.slice(FL_812155_NOTICE.indexOf("Failure"))}

## 2. Rental Period Ends on Nonpayment (Section 2.2)
${CLAUSE_RENTAL_PERIOD_ENDS}

## 3. Consent Withdrawn (Sections 16 & 17)
${CLAUSE_CONSENT_WITHDRAWN}

## 4. Notice Address
${CLAUSE_NOTICE_ADDRESS}

## 5. Service Area
${CLAUSE_SERVICE_AREA_CONSENT}

## 6. Starter-Interrupt Device
${CLAUSE_STARTER_INTERRUPT}

## 7. Pest, Insect & Biohazard Infestation (Section 4)
|#40 Item | Amount
| ${PEST_FEE_ITEM} | ${PEST_FEE_AMOUNT}
${ADDENDUM_PEST_WAIVER}

## 8. Driver's License Copy
${CLAUSE_LICENSE_COPY}

## Renter Initials
~ Please initial each line to show you have read and agree to that section.
|#14 Initial | Section
|i 1. Florida Required Notice (Section 812.155(6), Florida Statutes).
|i 2. Rental Period Ends on Nonpayment.
|i 3. Consent Withdrawn.
|i 4. Notice Address.
|i 5. Service Area.
|i 6. Starter-Interrupt Device.
|i 7. Pest, Insect & Biohazard Infestation.
|i 8. Driver's License Copy.

## Signatures
~ By signing, you agree this addendum is part of your Vehicle Rental Agreement.
%%SIGNATURES {{agreement_number}}%%`;

export type AddendumFields = {
  agreement_number?: string | null;
  driver_name: string;
  driver_address: string;
  vehicle: string;
  vehicle_vin: string;
  license_plate: string;
  company_name: string;
  company_address: string;
  company_email: string;
  company_phone: string;
  service_area?: string;
};

/** Fields the addendum cannot be printed without (Home Address is the notice address). */
export function addendumBlockers(f: AddendumFields): { field: string; label: string }[] {
  const out: { field: string; label: string }[] = [];
  const need: [keyof AddendumFields, string][] = [
    ["driver_name", "Renter Name"],
    ["driver_address", "Home Address (Street, City, State, ZIP)"],
    ["vehicle", "Vehicle"],
    ["vehicle_vin", "VIN"],
    ["license_plate", "License Plate"],
  ];
  for (const [k, label] of need)
    if (!String(f[k] ?? "").trim()) out.push({ field: String(k), label });
  return out;
}

/** The addendum text for one renter. Unknown agreement numbers print "___". */
export function renderFloridaAddendum(f: AddendumFields): string {
  const values: Record<string, string> = {
    ...f,
    agreement_number: String(f.agreement_number ?? "").trim() || UNKNOWN_AGREEMENT_NUMBER,
    service_area: String(f.service_area ?? "").trim() || V115_TERM_DEFAULTS.service_area,
  } as Record<string, string>;
  return FL_ADDENDUM_SOURCE.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k: string) => {
    const v = values[k.toLowerCase()];
    return v == null || !String(v).trim() ? "__________" : String(v).replace(/\r?\n/g, " ");
  });
}
