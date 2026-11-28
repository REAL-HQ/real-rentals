# Agreement v1.18 redline: Section 13 and Section 15

Date: Saturday, Nov 28, 2026 (America/New_York).
Owner request: t772u / t773u (Dolmar Cross).
Status: wording prepared on branch `feat/agreement-v118-sec13-15`. Not merged, not published, no database writes.

## What changes, and what does not

The current default agreement is v1.17 (library family `insurance_included_v117`). This update adds a new family, **v1.18** (`insurance_included_v118`), derived from v1.17 by exact substitutions. v1.17, v1.16, v1.15 and v1.14 stay byte-identical and remain Owner-approved and selectable.

Already-signed agreements are not altered. Each signed agreement stores its wording in `agreements.body`. Viewing, printing, or downloading a signed agreement uses that stored body, not the new default.

New sends, mid-rental rate-change amendments, and vehicle-swap agreements use v1.18 only after this change is merged (and only if no older saved template is marked active in the database). The live `agreement_templates` table was empty when this was prepared (read-only check, Nov 28, 2026), so new sends today already come from the in-code default. No SQL update is needed, and none was applied.

Changing the remote-disable wording affects how this is disclosed to renters. A Florida attorney should review the final wording before it is relied on.

## Locations of the agreement text

| Location | Role | Action in v1.18 |
| --- | --- | --- |
| `src/lib/agreement-v117.ts` (current default, derived from v1.16 / v1.15 / v1.14) | Printed Section 13 and 15 on new v1.17 sends | Unchanged. Stays renderable for signed v1.17 agreements. |
| `src/lib/agreement-v116.ts` | Section 13 toll and citation terms first added here | Unchanged. |
| `src/lib/agreement-v115.ts` | Section 15 starter-interrupt paragraph first added here (`CLAUSE_STARTER_INTERRUPT`) | Unchanged. The old clause stays in v1.15-v1.17. |
| `src/lib/agreement-v118.ts` (new) | v1.18 source: Section 13.2 / 13.3 and the starter-interrupt paragraph only | New default. |
| `src/lib/agreement-library.ts` | `DEFAULT_LIBRARY_KEY`, Owner-approved families | Default becomes `insurance_included_v118`. |
| `src/lib/rental-amendment.ts` | `AMENDMENT_TEMPLATE_KEY` | Points at v1.18. |
| `src/lib/vehicle-swap.ts` | `SWAP_TERMS_VERSION` and swap notice ("Version 1.18") | Points at v1.18. The swap PDF prints the full current default agreement. |
| `src/components/admin/PrepareAgreementDialog.tsx` | "Current Agreement In Use" fallback label | Updated to v1.18. |
| `src/lib/agreements.functions.ts` | Send path comments; uses `DEFAULT_LIBRARY_KEY` | Comments updated. Send still stores the chosen template's body on the agreement row. |
| `src/lib/agreement-fl-addendum.ts` | Florida 812.155 Addendum, Section 6 (Starter-Interrupt Device), for renters on pre-v1.14 / paper agreements | Preview wording updated to the same v1.18 starter-interrupt sentence. Version bumped 1.0 to 1.1. Still not Owner-approved (`FL_ADDENDUM_OWNER_APPROVAL` is null), so nothing can send it. Already-signed addenda, if any, keep their stored body. |
| eSign / PDF generator | Renders the agreement or addendum `body` already stored or prepared | No separate template text. No wording change here. |
| Start-date addendum | Mentioned in chat as a possible future change | Does not exist in the repo. Nothing to edit. |
| `src/lib/agreement-builder.ts` (retired v1.10 / v1.10.2) | Older combined GPS section; not sendable | Unchanged. |
| Live DB `public.agreement_templates` | Optional saved templates that can override the in-code default if one is active | **Empty.** No SQL file and no database write. |
| Live DB `public.agreements.body` | Signed and sent agreement text | Not touched. |

Section 14 (GPS, Telematics & Data Consent) and Section 26 (Privacy & Information Sharing) already allow Telematics data to be used and shared for claims, law enforcement, and running the rental. Those sections were left as they are. The only Section 13 change is adding "GPS history, and photos" to the lists in 13.2 and 13.3 of what we may give an agency. 13.6 already shares "the information in Section 13.3," so the new items are included there automatically.

---

## Section 13. Tolls & Tickets

Printed text below is from the resolved v1.17 / v1.18 body (the $25 citation administrative fee is the filled `fee_citation_admin` term). The only wording change is in 13.2 and 13.3, marked here in context.

### Current (v1.17, and v1.16)

```
## 13. Tolls & Tickets
**13.1 Tolls.** You are responsible for all tolls during the Rental Period. The Vehicle may have a toll transponder or be billed by plate. Do not remove or move the transponder, and tell us before using your own transponder to avoid double billing. You pay the actual toll amount, including toll-by-plate rates and any invoice, late, or collection fees the toll agency adds. We add no fee of our own on ordinary tolls.
**13.2 Tickets & Citations.** You are responsible for all parking tickets, camera citations, moving violations, fines, and penalties during the Rental Period. If we receive one, we may transfer it to you by giving the issuing agency your name, address, date of birth, driver license number, the rental dates, and a copy of this Agreement, as Florida law allows, or pay it and charge you. Disputes about a citation are between you and the issuing agency. For each ticket, citation, camera fine, or mailed notice we handle, you also pay the $25 administrative fee shown in Section 4, in addition to the amount charged by the agency or court.
**13.3 Transfer-of-Liability Affidavits & Your Consent.** You understand that, as the registered owner, we may be held liable for tolls and citations unless we identify the person who had the Vehicle. You consent to us preparing, signing, and filing affidavits that name you as the person who rented, or had care, custody, or control of, the Vehicle, including under Florida Statutes §316.1001(2)(c) (toll citations), §316.0083 (red-light camera notices), §316.1896 (school-zone speed cameras), and similar laws. You consent to us giving your name, address, date of birth, driver license number, the rental dates, and a copy of this Agreement to any toll agency, law enforcement agency, camera-enforcement program, court or clerk, or their vendors for this purpose. You agree to give us accurate, current identity and address information and to update it if it changes. Once a notice is transferred to you, you must pay or contest it directly and on time. A transfer does not waive the $25 administrative fee if we already handled or paid the item. Because agencies set strict deadlines, we may act before you respond.
**13.4 Items That Arrive Late; Declined Charges.** A toll or citation may reach us after the Rental Period ends. You remain responsible for it, and under Section 3.3 we may charge your card on file for it as it comes in, until everything you owe is paid. If a charge for a toll, citation, or fee is declined, you must give us a working payment method within 1 day of our notice.
**13.5 Toll Transponder.** Keep any toll transponder installed and mounted in the Vehicle. Do not remove, cover, shield, disable, swap, or tamper with it, and do not use it in another vehicle. If it is missing, damaged, or tampered with, you pay a replacement charge of $25, plus any tolls and fees that result.
**13.6 Third-Party Toll Billing.** If we use a third-party toll billing service, that service's fee may be billed to you instead of, and not in addition to, any fee of ours on ordinary tolls. Our fee on ordinary tolls remains $0. You authorize us to share the information in Section 13.3 with that service.
**13.7 Questions About a Charge.** If you believe a toll or citation charge is wrong, tell us in writing within 3 days of the charge. A review does not pause any deadline we must meet with an agency, including the deadline to file a transfer affidavit.
```

### Proposed (v1.18)

```
## 13. Tolls & Tickets
**13.1 Tolls.** You are responsible for all tolls during the Rental Period. The Vehicle may have a toll transponder or be billed by plate. Do not remove or move the transponder, and tell us before using your own transponder to avoid double billing. You pay the actual toll amount, including toll-by-plate rates and any invoice, late, or collection fees the toll agency adds. We add no fee of our own on ordinary tolls.
**13.2 Tickets & Citations.** You are responsible for all parking tickets, camera citations, moving violations, fines, and penalties during the Rental Period. If we receive one, we may transfer it to you by giving the issuing agency your name, address, date of birth, driver license number, the rental dates, a copy of this Agreement, GPS history, and photos, as Florida law allows, or pay it and charge you. Disputes about a citation are between you and the issuing agency. For each ticket, citation, camera fine, or mailed notice we handle, you also pay the $25 administrative fee shown in Section 4, in addition to the amount charged by the agency or court.
**13.3 Transfer-of-Liability Affidavits & Your Consent.** You understand that, as the registered owner, we may be held liable for tolls and citations unless we identify the person who had the Vehicle. You consent to us preparing, signing, and filing affidavits that name you as the person who rented, or had care, custody, or control of, the Vehicle, including under Florida Statutes §316.1001(2)(c) (toll citations), §316.0083 (red-light camera notices), §316.1896 (school-zone speed cameras), and similar laws. You consent to us giving your name, address, date of birth, driver license number, the rental dates, a copy of this Agreement, GPS history, and photos to any toll agency, law enforcement agency, camera-enforcement program, court or clerk, or their vendors for this purpose. You agree to give us accurate, current identity and address information and to update it if it changes. Once a notice is transferred to you, you must pay or contest it directly and on time. A transfer does not waive the $25 administrative fee if we already handled or paid the item. Because agencies set strict deadlines, we may act before you respond.
**13.4 Items That Arrive Late; Declined Charges.** A toll or citation may reach us after the Rental Period ends. You remain responsible for it, and under Section 3.3 we may charge your card on file for it as it comes in, until everything you owe is paid. If a charge for a toll, citation, or fee is declined, you must give us a working payment method within 1 day of our notice.
**13.5 Toll Transponder.** Keep any toll transponder installed and mounted in the Vehicle. Do not remove, cover, shield, disable, swap, or tamper with it, and do not use it in another vehicle. If it is missing, damaged, or tampered with, you pay a replacement charge of $25, plus any tolls and fees that result.
**13.6 Third-Party Toll Billing.** If we use a third-party toll billing service, that service's fee may be billed to you instead of, and not in addition to, any fee of ours on ordinary tolls. Our fee on ordinary tolls remains $0. You authorize us to share the information in Section 13.3 with that service.
**13.7 Questions About a Charge.** If you believe a toll or citation charge is wrong, tell us in writing within 3 days of the charge. A review does not pause any deadline we must meet with an agency, including the deadline to file a transfer affidavit.
```

### Diff (the only changed phrases)

13.2, current:

> giving the issuing agency your name, address, date of birth, driver license number, the rental dates, and a copy of this Agreement

13.2, proposed:

> giving the issuing agency your name, address, date of birth, driver license number, the rental dates, a copy of this Agreement, GPS history, and photos

13.3, current:

> You consent to us giving your name, address, date of birth, driver license number, the rental dates, and a copy of this Agreement to any

13.3, proposed:

> You consent to us giving your name, address, date of birth, driver license number, the rental dates, a copy of this Agreement, GPS history, and photos to any

13.1, 13.4, 13.5, 13.6, and 13.7 are unchanged. No insurer, broker, or GPS provider is named.

---

## Section 15. Vehicle Recovery

The Recovery paragraph is unchanged. It already says we may disable the Vehicle and that we may locate it. The starter-interrupt paragraph still discloses remote disable. The sentences about the engine being off, and about not activating the device while the vehicle is moving, are removed. No new timing condition is added. Internal staff rules about a safe location stay out of the agreement.

### Current (v1.17, and v1.15 / v1.16)

```
## 15. Vehicle Recovery
**Recovery.** When the rental ends or you are in default under Section 16, you must return the Vehicle. We may disable the Vehicle and take it back for non-payment (a payment more than 48 hours past due), or if the Vehicle is reported stolen, leaves Florida without our consent, has its GPS or Telematics tampered with, is uninsured, or you are otherwise in default. You authorize REAL RENTALS and its recovery agents to locate the Vehicle and to enter onto property where it is parked, where lawful, to recover it without breach of the peace.
**Starter-Interrupt Device.** The Vehicle has a remote starter-interrupt device. If you are in default under Section 16, we may activate it, which prevents the Vehicle from restarting after the engine is turned off. We will not activate it to stop a moving vehicle. You agree we are not liable for lost earnings or other losses from its proper use.
```

### Proposed (v1.18)

```
## 15. Vehicle Recovery
**Recovery.** When the rental ends or you are in default under Section 16, you must return the Vehicle. We may disable the Vehicle and take it back for non-payment (a payment more than 48 hours past due), or if the Vehicle is reported stolen, leaves Florida without our consent, has its GPS or Telematics tampered with, is uninsured, or you are otherwise in default. You authorize REAL RENTALS and its recovery agents to locate the Vehicle and to enter onto property where it is parked, where lawful, to recover it without breach of the peace.
**Starter-Interrupt Device.** The Vehicle has a remote starter-interrupt device. If you are in default under Section 16, we may activate it to remotely disable the Vehicle. You agree we are not liable for lost earnings or other losses from its proper use.
```

### Diff (starter-interrupt paragraph only)

Current:

> The Vehicle has a remote starter-interrupt device. If you are in default under Section 16, we may activate it, which prevents the Vehicle from restarting after the engine is turned off. We will not activate it to stop a moving vehicle. You agree we are not liable for lost earnings or other losses from its proper use.

Proposed:

> The Vehicle has a remote starter-interrupt device. If you are in default under Section 16, we may activate it to remotely disable the Vehicle. You agree we are not liable for lost earnings or other losses from its proper use.

The Renter Initials row "Section 15: Starter-Interrupt Device." is unchanged.

### Florida 812.155 Addendum, Section 6 (preview only)

Current (addendum v1.0), same sentence as the v1.15 clause:

> The Vehicle has a remote starter-interrupt device. If you are in default under Section 16, we may activate it, which prevents the Vehicle from restarting after the engine is turned off. We will not activate it to stop a moving vehicle. You agree we are not liable for lost earnings or other losses from its proper use.

Proposed (addendum v1.1), same sentence as v1.18:

> The Vehicle has a remote starter-interrupt device. If you are in default under Section 16, we may activate it to remotely disable the Vehicle. You agree we are not liable for lost earnings or other losses from its proper use.

This addendum is still preview-only until Dolmar approves it after attorney review. It is not sent with new v1.14+ agreements.

---

## Version bump and go-live

- New library family: `insurance_included_v118` / display version 1.18.
- `DEFAULT_LIBRARY_KEY`, `AMENDMENT_TEMPLATE_KEY`, and `SWAP_TERMS_VERSION` point at v1.18.
- Owner approval in code is marked "on merging the v1.18 PR," the same pattern as v1.15-v1.17. Sending v1.18 takes effect only when this PR is merged.
- No database migration. No `agreement_templates` SQL, because that table is empty and the live default is the in-code library.
- Do not merge or publish until Dolmar approves, and have a Florida attorney look at the Section 15 wording.
