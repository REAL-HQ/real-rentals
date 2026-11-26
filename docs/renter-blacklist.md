# Renter Blacklist

Requested by Dolmar Nov 19 2026 (10:50, 10:51 and 11:07 PM ET). Migration `supabase/migrations/20261120040000_renter_blacklist.sql` (not applied). Heather Bell data fix: `proposed/blacklist/01-blacklist-heather-bell.sql` (not run).

## Reasons (any ONE = blacklist)
1. Vehicle Repossessed For Non-Payment Or Refusal To Return
2. Unpaid Balance After Return (Rent, Damage, Fees, Tolls)
3. Tampered With / Bypassed GPS Or Starter-Interrupt
4. Unauthorized Driver Or Sublease
5. Left FL / Service Area Without Permission After A Warning
6. Application Fraud (Fake ID, Someone Else's License / Gig Account, Doctored Screenshots)
7. Chargeback On Rent Actually Owed
8. Serious Unreported Damage, Or Drugs / Weapons / Heavy Infestation In Car
9. Threats / Harassment Of Staff Or Crime In The Car

## Two strikes (warning first, blacklist on the 2nd)
- Late Payment More Than Once In 60 Days: two logged Late Payment warnings within 60 days of each other.
- Smoking: two logged Smoking warnings.
- Returning Car Dirty: two logged Returned Car Dirty warnings.

Any staff member logs a warning (Log Warning on the driver profile). Only an Owner / Admin voids one.

## Who can do what
- Owner / Admin / Manager: Add To Blacklist (reason + note + date + who are still required; the note is saved to Notes). Confirmed by Dolmar Nov 20 2026.
- Owner / Admin (user role `admin`, the Owner tier): Remove From Blacklist, Void Warning, clear a blacklist match ("Not The Same Person"). Confirmed by Dolmar Nov 20 2026.
- Manager / Coordinator: see the list and badges, Log Warning (Manager can also Add To Blacklist, above; neither can remove, void or clear).

Every add needs a reason, a note and a date, and records who added it. The note is also appended to the renter's Notes (skipped when the identical text is already there). Removal records who, when and why; entries are never deleted.

## What the system does
- Drivers list: red "Blacklisted" pill (same pastel red as Unqualified) and a Blacklisted option in the Filters menu (Status section).
- Blacklisted only means we don't rent to them again. The server refuses approval, reservations, resuming from On Hold, activation, and agreement sends. Ending or closing their current rental still works. Communication is never blocked.

### Automated messages (permanently off while blacklisted)
- `sendSms` (sms.server.ts) and `sendEmail` (email.server.ts) are the only paths to Quo/Twilio/Resend; both ask `public.renter_blacklist_suppressed(application, phone, email)` before an automated send. A suppressed text is logged in outbound_messages as `skipped` / "blacklisted: automated messages suppressed"; an email returns `blocked: "blacklisted"`.
- Still works: staff typing a text or email in the Messages tab (`staff_message`), alerts that go to staff (`team_alert_*`, `*_staff`, internal email workflows), inbound texts/calls/email.
- This is NOT the 45-day payment text pause and NOT the STOP opt-out list; neither is touched. Removing someone from the blacklist turns automated messages back on.
- If the check itself errors the message is sent (logged), so a database hiccup cannot silence every renter.
- FLEET's own Quo texts are sent outside this app and must check the blacklist themselves.

### Re-entry and linked people (flagged, never declined)
Any new or edited application, extra phone/email/address on a driver, signed agreement, waitlist signup or website contact lead is compared with every active blacklisted person:

| Field | How it is compared |
| --- | --- |
| Phone | Digits only, US leading 1 dropped (application phone, extra phones on the profile) |
| Email | Trimmed, lowercase |
| License Number | Uppercase letters and digits only |
| Address | Street + ZIP with abbreviations (Street=St, Apt/Unit/#=Apt...) normalized |
| Same Building | Same street + ZIP ignoring the apartment/suite/building/floor/room/lot |
| Similar Address | Same house number + ZIP, street within 2 typos or only N/S/E/W differs |
| DOB + Last Name | Date of birth plus last name (Jr/Sr/II/III ignored) |
| Saved Card | Card brand + last 4 + expiry month/year as stored on the application |
| Signer IP | The public IP the agreement was signed from (private/office IPs ignored) |

Waitlist signups and website leads only carry phone and email, so those two are compared.

A match is recorded in `renter_blacklist_matches` (which fields, which blacklisted person) and shown as a red alert at the top of the Drivers list and on the driver profile. Applications also get Needs Staff with reason "blacklist match: <Fields> (matches <Name>)", are never auto-approved, and approval/rentals stay refused until an Owner / Admin clicks Not The Same Person (recorded with a reason). Waitlist rows are marked for review. Nothing is declined automatically, and matched (linked) people still receive normal messages; only the blacklisted person is silenced.

When the blacklisted person's own record gains a new detail (new phone, address, signed IP), it is added to their match list and existing records are re-checked. Blacklisting someone also checks everyone already on file.

### Not possible with today's data
- Emergency contact / reference phones: the app has no such fields. Extra phones staff add to a profile are compared. Flagging an applicant who lists a blacklisted person as a reference needs those fields added first.
- Stripe card fingerprint: not stored. Getting it would need new Stripe API calls with server keys, so it was not done; matching uses brand + last 4 + expiry instead (weaker: two different cards can share these).
- Device / IP: only the agreement signer IP is captured; nothing is captured at application time.
