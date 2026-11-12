# Vehicle Rental Agreement v1.14 (Insurance Included) in eSign

**Source:** `REAL-RENTALS-Vehicle-Rental-Agreement-v1.14-Final.pdf`, supplied by the Owner on 2026-11-12. It is not in the repository. Keep the original with Template Library → Upload Template, which stores it privately.

**Family:** `insurance_included`, version 1.14. It sits beside `no_insurance` (v1.10) and `insurance_required` (v1.10.2) in the Agreement Template Library. Their wording and fingerprints are unchanged.

## Wording

Transcribed verbatim into `src/lib/agreement-v114.ts`. Every section from 1 to 28 is included, along with:
- the insurance notice;
- the Section 4 fee table and the Section 7.5 waiver comparison;
- the Florida required notice;
- What's Included;
- the signatures;
- the Vehicle Condition Report.

`scripts/agreement-v114.test.ts` checks 20 distinctive sentences against the PDF.

**Differences from the PDF**, all of form, not substance:

| PDF | eSign version | Why |
|---|---|---|
| REAL RENTALS LLC, its address, email and phone | Merge fields from Settings → Company | Same as every other family. **Settings → Company must hold "REAL RENTALS LLC" and the Bruce B Downs address.** |
| §23 "team@drivereal.com" | `{{company_email}}` | Same source as the header |
| "Renter Initials: ____" after Sections 3, 4, 5, 6, 7, 8, 10, 14, 15, 17.2, 20, 21, 22, 23 and 27 | An acknowledgment row the renter initials electronically, labelled with the section ("Section 3: Payment, Card on File & Autopay") | eSign captures initials per row |
| Damage Waiver row with "Renter Initials: ____" | An initialed row showing the staff-recorded choice | The renter initials the choice itself |
| Page footer "Renter Initials ____ / Page x of 12" | The eSign renderer's own footer | The renderer is pinned |
| ☐ checkboxes | `[X]` / `[ ]` | The PDF font cannot draw ☐ |
| Bold-lead bullets (Definitions, §7.5, §28, What's Included) | Bold-lead paragraphs | The renderer prints bullet text without bold |
| Blank Mileage Out / Fuel Out | "To Be Completed At Pickup" | Same as v1.6. Recorded on the Condition Report. |
| Blank Renter Policy rows | Either the bound policy entered by staff, or "To Be Issued After Signing (Section 5.1)" | §5.1: the policy is set up after signing |
| Toll Transponder # | The vehicle record's transponder, or "None on file" | Real data only |
| Signature block with "Additional Driver Signature (if any)" | The standard eSign signature block (renter and REAL RENTALS) | eSign can capture only the renter. v1.14 therefore refuses listed additional drivers; add them with the additional-driver form (§9). |

## Page-1 fields: where each value comes from

Nothing is invented. A blank value blocks Send on every path, including approval auto-send.

| Field | Source |
|---|---|
| Rental Start Date & Time | Date from the rental record; time entered by staff (Rental Terms) |
| Minimum Term Ends | Start date + 4 weeks (template value) |
| Weekly Rate (Insurance Included) | Application or vehicle rate on record |
| Payment Schedule | Staff: Weekly or Every 4 Weeks |
| Amount Due Each Payment / Due Day | Calculated: Weekly Rate, + $35 if the Damage Waiver is accepted, ×4 on the 4-week schedule; due on the start date's weekday (§3.4) |
| Payment Method | Staff: Card Autopay, Zelle, Cash App, Venmo or Other (named). Autopay is off in the app, so the Owner charges the card on each due day. |
| License Inspected By / Date | Staff: full name and a date not in the future (§19) |
| Vehicle Owner (registration) | Staff, copied from the registration |
| Approved Platform Use | Staff: Rideshare and/or Delivery, at least one |
| Damage Waiver | Staff: Accepted or Declined; the renter initials it |
| Renter Policy rows | Staff, both values or neither |
| Reservation Fee | Existing Prepare Agreement entry |
| Service Area | Template value, set once by the Owner in the Template Library (Edit Values) |
| Everything else | Existing records, with existing blockers |

v1.14 also refuses a security deposit, because §3.3 says there is none.

## Sending it: what is still needed

v1.14 can be **previewed** in the Template Library and in Prepare Agreement, with a real driver's data. It **cannot be sent yet**. Two pre-existing gaps block it, and they apply equally to v1.6, v1.10 and v1.10.2:

1. **Agreement numbers.** Any template that prints `{{agreement_number}}` is refused at Send until the RRA-000001 numbering database change exists. A design was drafted in October (`scripts/esign-release/0024_esign_agreement_numbering.sql` on branch `claude/focused-wright-shzjgt`) and never installed.
2. **Owner approval of a library family.** Library families are always Draft. The Approve button waits for the template database update (`0023_esign_template_versioning_library.sql` on the same branch, never installed; its number now collides with Drizzle 0023).

Each needs its own reviewed package and Owner approval.

## Tests

`bun scripts/agreement-v114.test.ts [out.pdf]`. It checks:
- the wording;
- the initials;
- the staff entries and their blockers;
- that other families are unchanged;
- the server wiring;
- a full render through the eSign PDF renderer.

It is also added to `npm test`.
