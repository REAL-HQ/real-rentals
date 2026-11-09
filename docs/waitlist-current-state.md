# Waitlist current state

Read-only review of live `7e3e6eb` (`Merge pull request #68 from REAL-HQ/release/rc2-dark-features`, tip of `codex/revenue-publication`). No schema was applied, no hosted database was queried, and no row counts below come from production. Line numbers are that commit. This note does not change the Waitlist Conflict Resolver.

Two lists share the name Waitlist.

| | Public queue | Staff hold |
| --- | --- | --- |
| Table | `public.waitlist` | `public.application_waitlist_holds` |
| Who | A person who signed up before they had an application | An application that already exists |
| Staff action | Promote creates or links an application | Add / Remove Waitlist opens or closes a hold |
| Booking | Not created | Not created |

A booking or a rental is a later step on an application. No waitlist server function inserts a booking or a rental.

## Signup entry points

### City hero, only when Cars Available is 0

`CityHeroLeadForm` loads `getAvailability` on mount. Waitlist mode is `availability === 0`. Any other value, including "not set" (`null`), still saves an application.

- `src/components/site/CityHeroLeadForm.tsx:56`, `:121-131`
- `src/lib/waitlist.functions.ts:29-45`
- `supabase/migrations/20260930222027_8aa77696-37ad-4595-a1b6-ba4b7dc384b1.sql:19-31` (`cars_available()` reads only `app_settings.value->>'cars_available'` for key `fleet_availability`)

`joinWaitlist` (`src/lib/waitlist.functions.ts:47-137`) lowercases the email, refuses a second `waiting` row for that email regardless of market (`:78-84`), and inserts `status: 'waiting'` with source `fleet_waitlist`, phone, pickup date, market, city, state, and UTM / gclid (`:86-104`). It then sends "You're on the REAL RENTALS waitlist" (`:123-134`). The hero requires a phone of at least 7 digits and a pickup date (`CityHeroLeadForm.tsx:92-99`). It does not collect `driver_status` and it does not show a queue position (`:122-123`, `WaitlistPanel.tsx:227-230`).

`landing_page` and `referrer` are accepted and dropped. The table has no such columns (`waitlist.functions.ts:102-103`, `src/integrations/supabase/types.ts:5794-5818`). A unique-index error whose message contains `duplicate` is treated as success (`:106-110`) and still sends the confirmation.

### Homepage Coming Soon cities

`LocationsSection` inserts from the browser. It does not call `joinWaitlist`.

- `src/components/site/LocationsSection.tsx:140-165`
- Anon may insert `full_name, email, phone, market_id, driver_status, source, utm_*, gclid` (`supabase/migrations/20260721192708_1efcc7f8-cfa7-4788-93eb-643981f90c06.sql:14-17`)
- `status` is omitted, so the default `waiting` applies (`20260930222027_...sql:4`)
- Source is `homepage_waitlist`. Phone is optional. `driver_status` is `active`, `pending`, `not_yet`, or `""` (`LocationsSection.tsx:136`, `:191-210`)
- No confirmation email. A database error is shown raw (`:160`)

`driver_status` is not selected by `listWaitlist`, not copied by promotion, and not shown in the admin table.

### Portal

A verified email with a waitlist row and no application sees `WaitlistCard` (`src/components/portal/ApplicantHome.tsx:36`, `:46`, `:157-230` on `7e3e6eb`). They can edit name, phone, city, state, and preferred start date (`updateMyWaitlist`, `src/lib/portal-access.functions.ts:107-146`). **Start My Application** links to bare `/apply` (`ApplicantHome.tsx:190-192`). That does not promote or link the waitlist row. Sign-in can find a waitlist email (`src/lib/portal-signin.server.ts:78-84`). If an application exists, the portal prefers it and hides the waitlist card (`portal-access.functions.ts:65-83`).

Login copy mentions a waitlist spot (`src/routes/login.tsx:23`, `:210`).

## Tables and row access

### `public.waitlist`

Created in `supabase/migrations/20260621011525_22b1864d-5a3f-45fc-a9bd-c0ca7d099cf3.sql:10-25`. Later columns: `status`, `pickup_date`, `notified_at`, `promoted_application_id`, `promoted_at` (`20260930222027_...sql:3-8`); `city`, `state` (`20260930223843_3c1454a2-4539-484a-9f94-627af1428c28.sql:1-2`); `review_reason`, `review_flagged_at` (`drizzle/migrations/0015_waitlist_promotion_identity_review.sql:1`).

Row-level security is on (`20260621011525_...sql:31`).

| Policy | Who | What |
| --- | --- | --- |
| "Anyone can join waitlist" | `anon`, `authenticated` INSERT | Email length 5–255 and an email shape (`20260721192409_e6878fdf-a4f4-41ec-9e23-870d17b3d35b.sql:36-41`). Replaces the earlier `char_length(email) > 3` check (`20260713042527_...sql:31-34`) and the original `WITH CHECK (true)` (`20260621011525_...sql:33-34`). |
| "Admins/team can view waitlist" | `authenticated` SELECT | `has_role` `admin` or `team` (`20260621011525_...sql:36-38`). A Coordinator is neither, so the browser client cannot read the queue. |
| "Admins manage waitlist" | `authenticated` ALL | `has_role` `admin` (`:40-43`). |
| "No direct waitlist deletes" | `anon`, `authenticated` DELETE | Restrictive `USING (false)` (`drizzle/migrations/0017_0017_driver_deletion_security_repair.sql:3-5`). `DELETE` and `TRUNCATE` are revoked from those roles. |

Anon insert was narrowed to the columns listed above (`20260721192708_...sql:3-17`). `joinWaitlist`, promote, notify, and the conflict write use the service role, which bypasses these policies. Those server functions check the staff tier themselves: `requireStaff` (Coordinator and up) for the list, `requireManager` (Owner `admin` or Manager `team`) for Cars Available, notify, promote, holds, and conflict review (`src/lib/roles.ts:17-20`, `src/lib/waitlist.functions.ts:178`, `:305`, `:343`, `:399`, `:472`, `:570`, `:639`).

One waiting row per lowercased email and market:

```12:14:supabase/migrations/20260930222027_8aa77696-37ad-4595-a1b6-ba4b7dc384b1.sql
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one_active_per_email
  ON public.waitlist (lower(email), market_id)
  WHERE status = 'waiting';
```

A `notified` or `promoted` row does not occupy the index. PostgreSQL treats NULL as distinct, so two `waiting` rows with the same email and a null `market_id` are not collapsed. The homepage form always sends `market_id`. `joinWaitlist` still refuses any second waiting email before insert.

### Holds and application columns

`application_waitlist_holds` (`drizzle/migrations/0014_waitlist_holds_and_safe_promotion.sql:5-22`): `id`, `application_id`, `added_at`, `added_by`, `removed_at`, `removed_by`. One open hold per application. Authenticated users may SELECT. The policy "Staff read waitlist holds" uses `private.is_staff()` (`:21-22`). Service role has full access. Trigger `waitlist_holds_guard` forbids deletes and forbids edits other than closing the hold (`:24-36`).

`applications.waitlist_signed_up_at` and `applications.waitlist_source` (`0014_...sql:1-3`) are copied on link and on create, and are not overwritten once set.

`promote_waitlist_entry` and `resolve_waitlist_phone_conflict` are `SECURITY DEFINER` and executable only by `service_role` (`0015_...sql:63-64`, `drizzle/migrations/0022_waitlist_resolve_phone_conflict.sql:88-89`).

Deleting a driver closes an open hold and rewrites the linked waitlist name, email, and phone to `Deleted Driver` / `deleted+<id>@invalid.example` (`drizzle/migrations/0016_0016_driver_deletion_stage1.sql:137-138`). `market_id` is left in place. Restore can reopen the hold that delete closed (`0017`).

## Statuses

`waitlist.status` is text, default `waiting`, with no `CHECK` in the waitlist migrations (`20260930222027_...sql:4`).

| Status | Meaning | Position |
| --- | --- | --- |
| `waiting` | In the queue. Only these rows get a position. | Per `market_id`, oldest `created_at` first. A null market shares the key `"_"`. Computed on read (`waitlist.functions.ts:195-202`, `:260-269`). |
| `notified` | Opening email was attempted. | Em dash (`WaitlistPanel.tsx:267-268`). |
| `promoted` | Linked to an application. | Em dash. |

`review_reason` is separate from status: `phone_only_match`, `email_phone_conflict`, or `email_match_phone_differs` (`0015_...sql:30-40`). It is cleared when a link succeeds.

Hold rows are not a waitlist status. The application `status` column is unchanged (`DriversPanel.tsx:381-382` on `7e3e6eb`). The Drivers chips hide a held person from their old status count (`:790-793`).

## Order and the admin queue

`listWaitlist` loads every waitlist row, oldest first, with no `.range()` (`waitlist.functions.ts:195-202`). Both that read and the Websites demand count (`src/components/admin/WebsitesPanel.tsx:32-40`) stop at the project's PostgREST row cap. This repo does not set `db-max-rows`. Supabase's default cap is 1000. This note did not measure the live cap. Past the cap, positions and demand counts are computed from a truncated read.

There is no Waitlist item in the main nav. `?tab=waitlist` resolves to Drivers with `filter=waitlist` (`src/components/admin/nav-config.ts:70-76` on `7e3e6eb`). That page shows held applications in the driver table and, below them, every public waitlist row (`DriversPanel.tsx:600`, `:1130`, `:1139-1148`). The chip adds unpromoted signups and open holds (`:373-379`, `:790-793`).

`WaitlistPanel` columns are Position, Driver, Wants To Start, Readiness, Status, and Joined (`WaitlistPanel.tsx:254-292`). Market, source, UTM, `driver_status`, and `review_reason` are not columns. Readiness appears only after `promoted_application_id` points at an application (`waitlist.functions.ts:206-225`, `:287-289`).

Cars Available is one global integer (`setCarsAvailable`, `waitlist.functions.ts:301-337`). The city hero still says the number is "in {city}" (`CityHeroLeadForm.tsx:203-210`). Fleet Available and Ready To Rent Now are displayed beside the override and are not what the public number uses (`WaitlistPanel.tsx:177-192`).

Settings → Website shows "Waitlist Demand (Coming Soon Cities)" as a count of every row with a `market_id`, any status (`WebsitesPanel.tsx:67-78`). Settings copy: `src/components/admin/SettingsWorkspace.tsx:20`. Delete Driver shows Waitlist History (`src/components/admin/DeleteDriverDialog.tsx:74`, `:86-87` on `7e3e6eb`).

Coordinator can open the queue and still sees Promote, Save, and Add Waitlist. The server rejects the write. `WaitlistPanel` is not told the caller's tier.

## Notifications

| Message | When | Where |
| --- | --- | --- |
| "You're on the REAL RENTALS waitlist" | After `joinWaitlist` inserts, including a unique-index race | `waitlist.functions.ts:123-134` |
| "A car just opened up — you're next" | Staff confirm the dialog | `:360-372` |
| Homepage Coming Soon signup | No email | `LocationsSection.tsx:145-164` |
| Promote | No email. The comment says "Sends nothing" | `waitlist.functions.ts:404` |
| Hold add / remove | No email | `:465` |
| SMS | Never. Waitlist mode hides SMS consent (`CityHeroLeadForm.tsx:234-238`). A new application is inserted with `sms_consent = false` (`0015_...sql:53-57`). | |

The opening email is not a button on the queue. The dialog opens only when a Manager saves Cars Available from `0` or `null` to a positive number while someone is `waiting` (`WaitlistPanel.tsx:99-104`). Dismissing it does not offer it again. `setNotifyOpen(true)` appears only in that branch.

`notifyWaitlistTop` takes the oldest `waiting` rows in the whole table, up to the limit, with no market filter (`waitlist.functions.ts:346-353`). The link is `siteOrigin()/apply` with no resume token (`:368`, `:522-524`). After the send attempt the row is always set to `notified` (`:375-380`), including when `sendEmail` fails. The comment above that update says a failed send is retried against rows still `waiting`. The update removes them from that set. The toast and the audit count only successful sends (`:374`, `:383-388`, `WaitlistPanel.tsx:121-125`).

The email says they were at the top, that the car is in their city, that the link opens the application they started, and that they stay at the top if the car is already claimed (`waitlist.functions.ts:366-370`). The code sends globally, links to a fresh `/apply`, and removes them from the waiting set.

## How a row becomes an application

Staff press **Promote To Applicant** (`WaitlistPanel.tsx:303-312`). That calls `promoteToApplicant` (`waitlist.functions.ts:394-448`), which calls `promote_waitlist_entry`. The function in force is `drizzle/migrations/0015_waitlist_promotion_identity_review.sql:3-64`.

It locks the waitlist row. If `promoted_application_id` is already set, it returns `already` (`waitlist.functions.ts:431`). Otherwise it matches applications with `status <> 'duplicate'`:

1. Email match, preferring a primary application, then the oldest (`0015_...sql:17-20`).
2. Phone match on the last 10 digits, and only when the waitlist phone has 10 digits (`:21-27`). A missing or short phone skips the phone checks.
3. Phone match and no email match → `phone_only_match`. Nothing is created (`:30-32`).
4. Phone match and email match on different people → `email_phone_conflict` (`:34-36`).
5. Same email, both phones 10 digits, phones differ → `email_match_phone_differs` (`:38-40`).
6. Email match that survived those checks → link that application and copy the waitlist signup date and source when those columns are still null (`:43-50`).
7. No email match → insert an application with `status = 'new'`, `current_step = 'rental'`, `sms_consent = false`, and the waitlist UTM and gclid (`:53-61`).

The waitlist row becomes `promoted` and stores `promoted_application_id` and `promoted_at`.

What this does not do: it does not insert a booking or a rental, it does not set `vehicle_id`, it does not create a login, and it does not email the person. When the insert path runs, the server issues a resume token (`waitlist.functions.ts:433-436`) and returns it to the staff caller. `handlePromote` never reads `token` (`WaitlistPanel.tsx:133-147`). The toast says the person is now under New.

The match queries in `0015` do not exclude `deleted_at`. A soft-deleted application with the same email can be the row that gets linked. The conflict function does exclude deleted and duplicate applications (`0022_...sql:30`).

After a real application exists, the normal application wizard and the later rental activation path are what produce a rental. That path is outside this queue.

### Holds

**Add Waitlist** / **Remove Waitlist** calls `setWaitlistHold` (`waitlist.functions.ts:465-506`, menu at `DriversPanel.tsx:1067-1072` on `7e3e6eb`). It does not create an application. Owner and Manager only.

## Waitlist Conflict Resolver

Documented here only. This note does not change the dialog or `resolve_waitlist_phone_conflict`.

Promotion returns `conflict: "email_match_phone_differs"` for that reason and `conflict: null` for the other two (`waitlist.functions.ts:419-429`). **Review Conflict** is shown only when that flag was set this session or `review_reason === "email_match_phone_differs"` (`WaitlistPanel.tsx:137-141`, `:294-302`).

`phone_only_match` and `email_phone_conflict` are stored (`0015_...sql:30-36`). After refresh the button goes back to **Promote To Applicant**. Pressing it flags the same row again. There is no resolver for those two reasons.

Review Conflict (`src/components/admin/WaitlistConflictDialog.tsx`) compares the waitlist row with the single non-deleted application that has that exact email (`getWaitlistConflict`, `waitlist.functions.ts:563-607`). Emails are masked (`:544-548`). Phones are shown in full. Confirm requires a phone choice and `affirmed: true` (`:631`). Using the waitlist phone requires a reason of at least 5 characters (`:635`, dialog `:154-165`).

The write is `resolve_waitlist_phone_conflict` (`0022_...sql:1-89`):

- The caller must have `user_roles.role` of `admin` or `team`. Execute is `service_role` only.
- Locks the waitlist row, then the application.
- Idempotent when this entry is already linked to this application. Rejects a link to a different application.
- Rejects a deleted or duplicate application, an email that no longer matches, stale last-10 phone digits, a second live application with the same email, and a waitlist phone that belongs to a different driver.
- Updates the waitlist signup columns, and the phone only when requested.
- Sets the waitlist row to `promoted`, clears `review_reason`, and inserts `audit_log` action `waitlist.conflict_resolved` in the same transaction.

Multiple email matches are reported as "resolve those first" (`waitlist.functions.ts:588`). This screen does not merge them (`:542`). Linking does not create an application, an account, or a message.

Audited actions on these paths: `availability.set`, `waitlist.notified`, `waitlist.promoted`, `waitlist.promotion_needs_review`, `waitlist.hold_added`, `waitlist.hold_removed`, `waitlist.conflict_resolved`, `portal.waitlist_self_update`.

Tests already on this commit: `scripts/waitlist-security.test.mjs` (the list fails closed), `scripts/waitlist-roles.test.ts` (Manager on hold, promote, notify, and Cars Available), `scripts/waitlist-conflict.test.ts` (the `0022` function on disposable Postgres), `scripts/waitlist-readiness.test.ts` (the readiness and Fleet Available counts the queue reuses).

## Data-quality gaps

Read from the code paths above. No production rows were counted.

1. **Two writers.** `joinWaitlist` lowercases email, dedupes any waiting email, and sends a confirmation. The homepage insert does none of those. The same person can be waiting in two markets only on the homepage path. A `notified` person can join again, because the unique index covers `waiting` only (`20260930222027_...sql:12-14`, `waitlist.functions.ts:78-84`).
2. **Fields that do not land.** `landing_page` and `referrer` are accepted and discarded (`waitlist.functions.ts:102-103`). `driver_status` is stored from the homepage form and never read. A skipped gig-app question stores `""` (`LocationsSection.tsx:136`, `:150`).
3. **Phone shape.** The hero accepts 7 or more digits. The homepage accepts a blank phone. Promotion treats a phone as comparable only at 10 digits, so a short or missing phone skips `email_match_phone_differs` and links on email alone (`0015_...sql:38`, `CityHeroLeadForm.tsx:96`).
4. **Email case and NULL markets.** The unique index uses `lower(email)`. The homepage insert does not lowercase. Two waiting rows with a null `market_id` are allowed by the index because NULL does not compare equal.
5. **Failed notify looks like success.** The row becomes `notified` even when the send fails, so it leaves the queue and is not retried. The audit count can be lower than the number of rows flipped (`waitlist.functions.ts:374-388`).
6. **Deleted drivers stay in the demand count.** Scrubbing clears name, email, and phone and leaves `market_id` (`0016_...sql:137-138`). Websites demand counts every status (`WebsitesPanel.tsx:32-40`).
7. **Promotion can attach a hidden driver.** `promote_waitlist_entry` does not filter `deleted_at` (`0015_...sql:17-20`). The conflict function does (`0022_...sql:30`).
8. **The Drivers chip is not either list.** It adds unpromoted signups and held applications (`DriversPanel.tsx:790-793` on `7e3e6eb`). One person can count twice. Promoted signups appear in the panel and not in the chip. An empty hold table says "No Drivers Yet" above a populated signup list (`:1130`).
9. **Queue position can be a partial read.** `listWaitlist` has no `.range()` (`waitlist.functions.ts:197-202`). Positions are assigned only to the rows that came back.
10. **The public number is not a city count.** One `cars_available` integer is described as cars available in the city on the hero (`CityHeroLeadForm.tsx:203-210`). The opening email uses the row's `city`, which the homepage form never sets (`waitlist.functions.ts:366`).
11. **Review reasons for two of the three conflicts are stored and then not shown.** After refresh, only `email_match_phone_differs` keeps Review Conflict (`WaitlistPanel.tsx:294`).
12. **The confirmation promises a way off the list.** It says reply to leave (`waitlist.functions.ts:131`). No inbound handler and no portal leave action exist. The portal card always says "On The Waitlist", including when status is `notified` (`ApplicantHome.tsx` WaitlistCard).

## Top 5 improvements, by renter conversion

Ranked by how directly each one moves a person who wants a car from the queue into an application they can finish, which is the step that later becomes a booking. Effort is the size of the change. Risk is what can go wrong if it ships. A migration means a new SQL migration or a replaced deployed function. None of these five edits the Waitlist Conflict Resolver.

### 1. Make the opening email a real claim, and only mark Notified after it sends

This is the moment a car is supposed to turn a waiting person into an applicant. Today the oldest waiting person in any city is emailed a bare `/apply` link, told they stay at the top, and removed from the queue even when the send fails (`waitlist.functions.ts:346-380`). Staff can send that email only by raising Cars Available off zero (`WaitlistPanel.tsx:99-104`).

Send per market, the same key position already uses. Put a resume or apply link that belongs to that person on the button. Set `notified` only when `sendEmail` returns ok, and add Email The List so a dismissed dialog is not the only chance.

- Effort: medium. `notifyWaitlistTop`, the dialog, and the email copy.
- Risk: medium. This sends live email. A wrong market filter emails the wrong city.
- Migration: no. `status` is already free text, and the update already exists.

### 2. Hand the new applicant the link promotion already mints

Promote is the staff step that creates the application a booking later hangs on. The server issues a resume token and the panel discards it (`waitlist.functions.ts:433-436`, `WaitlistPanel.tsx:133-147`). The person is not told they can continue, so the new `status = 'new'` application stalls.

Show Copy Link on the success toast, and send one email that uses that token. Linking an existing application should not mint a second credential. `openMyApplication` already does that for a signed-in applicant (`portal-access.functions.ts:87-105`).

- Effort: small for Copy Link. Medium if the email is added.
- Risk: medium. The token resumes the application. Emailing it is a live message to the address on the new row.
- Migration: no.

### 3. Send Coming Soon signups through `joinWaitlist`

Homepage Coming Soon visitors are a second public queue with no confirmation (`LocationsSection.tsx:145-164`). They do not get the email that tells them a car will be offered to them, and a short or blank phone lets promotion link them on email alone (`0015_...sql:38`). A person attached to the wrong driver, or never told they are waiting, does not become a renter.

Use the server function: confirmation, the email dedupe, no raw database error, and the same 10-digit phone the promote function already compares. Stop asking `driver_status` until something reads it, or show it on the queue.

- Effort: medium. `LocationsSection` plus the server input.
- Risk: medium. It changes a public form and who receives the confirmation.
- Migration: no. Keeping the unused `driver_status` column needs no migration.

### 4. Let the portal continue the same application the queue will promote

`WaitlistCard` sends a verified waitlist email to bare `/apply` (`ApplicantHome.tsx:190-192`). That wizard does not link `promoted_application_id`. The person can start a second application while the queue row stays `waiting`, and staff promote may then collide with it. Self-serve is the path that does not wait for a Manager to press Promote.

For a verified email, start or open the application `promote_waitlist_entry` would create or link, and return its resume token. Do not add a second resolver. The existing promote function already refuses the three ambiguous identity cases and creates nothing in those cases (`0015_...sql:29-40`).

- Effort: medium. Portal card plus a server function that calls the existing promote function for the caller's own waiting row.
- Risk: medium. A verified email that matches an existing driver will link, which is what staff Promote already does. The three review reasons still create nothing.
- Migration: no, unless the deleted-application fix below ships in the same function replacement.

### 5. Refuse a soft-deleted application inside `promote_waitlist_entry`

If the only email match is a deleted driver, promotion links the waitlist row and takes the person off the queue onto a driver staff no longer see (`0015_...sql:17-20`). They never reach an application that can be approved and booked. `resolve_waitlist_phone_conflict` already refuses those rows (`0022_...sql:30`). This change is the promote function, not the conflict function.

Add `deleted_at IS NULL` to both match queries. A deleted email match should fall through to a new application or to review.

- Effort: small. One function replacement, covered by the disposable harness.
- Risk: medium. The same promote click can create a new application where it used to link a deleted one.
- Migration: yes.

## What this note did not do

No production SQL, no hosted read, and no code change. The Conflict Resolver is described and left as it is. Live queue length, how many rows are stuck on `phone_only_match` or `email_phone_conflict`, and whether the API row cap has been raised are not known from this review.
