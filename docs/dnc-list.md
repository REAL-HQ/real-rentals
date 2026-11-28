# Internal DNC List

Requested by Dolmar Nov 27 2026 (11:11 AM ET). Migration `supabase/migrations/20261127170000_internal_dnc_list.sql` (not applied).

The DNC list is our own "do not contact" list. It is separate from:
- `sms_opt_outs`: the carrier STOP list (phone only, set by inbound STOP / Quo). Still enforced in `sendSms`.
- `renter_blacklist`: who we will not rent to. The blacklist never blocks communication; DNC does.

## Where it shows
- Admin → Drivers → **DNC** tab (`?tab=dnc`; the Drivers rail entry stays highlighted): everyone on the list, with Name, Reason, Message, Added By, Added, search, and an On List / Removed view. Every name opens that person's driver profile (applicants included). A waitlist signup opens its promoted application, or a read-only record when there is no profile. The message text opens the latest inbound text or email on or before Added — the row does not store a message id — or shows "No Message Found". Added By is a short name (staff first name, or a bot name such as VIBE or Responder); the full stored label stays on the tooltip. Remove From DNC sits in the row's options menu.
- A red **DNC** pill in normal layout flow (never absolutely positioned): driver list rows, the driver profile header, Lead Priorities cards, Waitlist rows, and the Messages conversation list, thread header and info pane.
- A **Do Not Contact** card on the driver profile (reason, added by, added date).

## Who can do what
- Any staff (Coordinator and up): Move To DNC (reason required, then a confirm step).
- Manager / Owner: Remove From DNC (reason required, then a confirm step).
- Every add/remove records who and when on the row and writes an audit entry (`dnc.added`, `dnc.removed`). Rows are never deleted; removal is recorded on the row.

## Matching
A person is on DNC when an active row links their application or waitlist row, or when their normalized phone (digits, leading 1 dropped) or lowercased email is on an active row. Contact details are snapshotted server-side from the application / driver_contacts / waitlist row; the browser never supplies them. `src/lib/dnc.ts` normalizers must stay identical to `private.dnc_norm_phone` / `private.dnc_norm_email` (tested in `scripts/dnc-list-postgres.test.ts`).

## Staff contact: popup
Every staff contact entry point calls `useDnc().confirmContact()` before acting. A person on DNC gets an **On DNC List** popup with the reason; Cancel is the default (focused, Escape), and only **Contact Anyway** proceeds. `tel:` / `sms:` / `mailto:` links anywhere inside the admin are intercepted by `DncProvider` (opt out with `data-dnc-skip`).

Server functions for staff-initiated sends use `staffContactMiddleware` so a confirmed send is not suppressed. `sendStaffMessage` refuses a DNC person unless the browser sends `dncAcknowledged: true` (set only after Contact Anyway).

## Automated messages: suppressed
`sendSms` and `sendEmail` skip any automated message to a DNC person (`public.dnc_suppressed`), log the skip (`on DNC list: automated messages suppressed`), and return `skipped`/`blocked: "dnc"`. Exempt: staff_message, team_alert_*, *_staff kinds, STAFF_WORKFLOWS / BAD_EMAIL_EXEMPT_WORKFLOWS (password reset, sign-in, signup confirm), and sends inside `staffContact()`. The check fails open on a database error, like the blacklist. Inbound messages are untouched.

## Not covered
- FLEET's own Quo texts sent outside the app must check the DNC list themselves.
- `contact_leads` (LeadsPanel is not rendered) and phone/email-only manual adds are not supported yet.
