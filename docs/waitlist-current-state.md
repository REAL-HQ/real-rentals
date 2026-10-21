# Waitlist current state

Read-only review of live `7e3e6eb` (`Merge pull request #68 from REAL-HQ/release/rc2-dark-features`, tip of `codex/revenue-publication` at the time of this note). No schema was applied, no hosted database was queried, and no row counts below come from production. Line numbers are that commit.

Two different things share the word Waitlist. They are not one queue.

| | Public queue | Staff hold |
| --- | --- | --- |
| Table | `public.waitlist` | `public.application_waitlist_holds` |
| Who is on it | Someone who signed up before they had an application | An application that already exists |
| What Promote does | Creates or links an application | Does not apply. Add / Remove Waitlist only opens or closes a hold |
| What a booking is | Not created here | Not created here |

A booking or a rental is a later step on an application. Nothing in the waitlist server functions inserts a booking or a rental.

## 1. How a public entry is created

There are two writers.

### City hero, only when Cars Available is 0

`CityHeroLeadForm` loads `getAvailability` on mount. `waitlistMode` is `availability === 0`. Any other value, including "not set" (`null`), still saves an application.

- `src/components/site/CityHeroLeadForm.tsx:56` and `:121-131`
- `src/lib/waitlist.functions.ts:29-45` (`cars_available()`; an error or a non-number returns `null`, which leaves the hero in application mode)
- `supabase/migrations/20260930222027_8aa77696-37ad-4595-a1b6-ba4b7dc384b1.sql:19-31` (the function reads only `app_settings.value->>'cars_available'` for key `fleet_availability`)

`joinWaitlist` (`src/lib/waitlist.functions.ts:47-137`):

1. Lowercases the email.
2. If any row with that email is already `status = 'waiting'`, returns success and does not insert and does not email (`:78-84`). The check ignores market.
3. Inserts `status: 'waiting'`, `source` defaulting to `fleet_waitlist`, plus phone, pickup date, market, city, state, and UTM / gclid (`:86-104`).
4. `landing_page` and `referrer` are accepted and then dropped. The comment says the table has no such columns (`:102-103`). The generated row type confirms that (`src/integrations/supabase/types.ts:5794-5818`).
5. Sends "You're on the REAL RENTALS waitlist" (`:123-134`). The copy says they can leave by replying. No inbound handler for that reply exists on this path.
6. A unique-index violation whose message contains `duplicate` is treated as success (`:106-110`) and still falls through to the confirmation email.

The hero requires a phone of at least 7 digits and a pickup date (`CityHeroLeadForm.tsx:92-99`). It does not collect `driver_status`. It does not show a position (`:122-123`, panel copy at `WaitlistPanel.tsx:227-230`).

### Homepage Coming Soon cities

`LocationsSection` inserts straight from the browser with the anon key. It does not call `joinWaitlist`.

- `src/components/site/LocationsSection.tsx:140-165`
- Columns granted to anon: `full_name, email, phone, market_id, driver_status, source, utm_*, gclid` (`supabase/migrations/20260721192708_1efcc7f8-cfa7-4788-93eb-643981f90c06.sql:14-17`)
- `status` is omitted, so the column default `waiting` applies (`20260930222027_...sql:4`)
- Source is `homepage_waitlist`. Phone is optional. `driver_status` is `active`, `pending`, `not_yet`, or `""` if they skip the gig-app question (`LocationsSection.tsx:136`, `:191-210`)
- No confirmation email. A database error is toasted raw (`:160`)
- No server-side "already on the list" response

`driver_status` is not selected by `listWaitlist`, not copied by `promote_waitlist_entry`, and not shown in the admin table. It is stored and then unused.

### The one-active-email rule

```12:14:supabase/migrations/20260930222027_8aa77696-37ad-4595-a1b6-ba4b7dc384b1.sql
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one_active_per_email
  ON public.waitlist (lower(email), market_id)
  WHERE status = 'waiting';
```

Consequences, from the index definition and the two writers:

- The same email may wait in two markets if the insert does not go through `joinWaitlist`. The server function refuses that; the homepage form does not.
- A `notified` or `promoted` row does not occupy the index, so the same email can join again and get a second `waiting` row, plus another confirmation email.
- PostgreSQL unique indexes treat NULL as distinct. Two `waiting` rows with the same email and a null `market_id` are not collapsed by this index. The homepage form always sends `market_id`. The server function's email check still collapses them.

## 2. How entries are ordered

Position is computed on read. It is not stored.

`listWaitlist` loads every waitlist row, oldest `created_at` first, with no `.range()` (`src/lib/waitlist.functions.ts:195-202`). For each row still `waiting`, it assigns position 1, 2, 3… inside `market_id`. A null market shares the key `"_"` (`:260-269`). `notified` and `promoted` get position `null` and the table shows an em dash (`WaitlistPanel.tsx:267-268`).

`notifyWaitlistTop` does not use that position. It takes the oldest `waiting` rows in the whole table, up to the requested limit, with no market, city, or pickup-date filter (`waitlist.functions.ts:346-353`).

Cars Available is one global integer (`setCarsAvailable`, `:301-337`). The city hero still says "Only N cars available in {city}" (`CityHeroLeadForm.tsx:203-210`). N is not that city's count.

The Websites demand chips count every waitlist row with a `market_id`, including notified, promoted, and scrubbed rows (`src/components/admin/WebsitesPanel.tsx:32-40`, `:68-76`). Rows with a null market are omitted. That select is also unbounded.

Both unbounded selects stop at the project's PostgREST row cap. This repo does not set `db-max-rows`. Supabase's default cap is 1000. This note did not measure the live cap. If the queue is larger than the cap, positions and demand counts are computed from a truncated read.

## 3. How an entry becomes an application

Staff press **Promote To Applicant** (`WaitlistPanel.tsx:303-312`). That calls `promoteToApplicant` (`waitlist.functions.ts:394-448`), which calls `promote_waitlist_entry`. The function in force is the replacement in `drizzle/migrations/0015_waitlist_promotion_identity_review.sql:3-64`. It is `SECURITY DEFINER`, executable only by `service_role`.

The function locks the waitlist row. If `promoted_application_id` is already set, it returns `already` and the server function stops (`waitlist.functions.ts:431`). Otherwise it matches applications with `status <> 'duplicate'`:

1. Email: `lower(a.email) = lower(w.email)`, preferring a primary application, then the oldest (`0015_...sql:17-20`).
2. Phone: last 10 digits, and only when the waitlist phone has 10 digits (`:21-27`). A missing or short phone skips the phone checks.
3. Phone match and no email match → `phone_only_match`. Nothing is created (`:30-32`).
4. Phone match and email match on different people → `email_phone_conflict` (`:34-36`).
5. Same email, both phones 10 digits, phones differ → `email_match_phone_differs` (`:38-40`).
6. Email match that survived those checks → link that application. Copy `waitlist_signed_up_at` and `waitlist_source` only when those application columns are still null (`:43-50`).
7. No email match → `INSERT` an application with `status = 'new'`, `current_step = 'rental'`, `sms_consent = false`, the waitlist's UTM and gclid, and `source` from the waitlist row (`:53-61`).

The waitlist row becomes `promoted` and stores `promoted_application_id` and `promoted_at`.

What this does not do:

- It does not insert a booking or a rental, and it does not set `vehicle_id`.
- It does not create a login.
- It does not email the person. The server comment says "Sends nothing" (`waitlist.functions.ts:404`).
- When the insert path runs, the server issues a resume token (`:433-436`) and returns it to the staff caller. `handlePromote` never reads `token` (`WaitlistPanel.tsx:133-147`). The toast says they are now under New.

The match queries in `0015` do not exclude `deleted_at`. A soft-deleted application with the same email can be the row that gets linked, and the waitlist entry then leaves the queue onto a driver staff no longer see in the active list. `resolve_waitlist_phone_conflict` does exclude deleted and duplicate applications (`drizzle/migrations/0022_waitlist_resolve_phone_conflict.sql:30`).

After a real application exists, the normal application wizard and the later rental activation path are what produce a rental. That path is outside this queue. Portal sign-in can find a waitlist email (`src/lib/portal-signin.server.ts:78-84`). The portal prefers an application over a waitlist row (`src/lib/portal-access.functions.ts:65-83`). A waitlist-only person sees `WaitlistCard`, which links to bare `/apply` (`src/components/portal/ApplicantHome.tsx:157-191` on `7e3e6eb`). Starting that application does not promote or link the waitlist row.

### Staff holds are a separate list

**Add Waitlist** / **Remove Waitlist** on a driver calls `setWaitlistHold` (`waitlist.functions.ts:465-506`). It inserts or closes `application_waitlist_holds`. One open hold per application (`drizzle/migrations/0014_waitlist_holds_and_safe_promotion.sql:6-15`). A trigger forbids deletes and forbids edits other than the close (`:24-36`). The application's `status` column is not changed (`DriversPanel.tsx:381-382` on `7e3e6eb`). The Drivers chips do hide that person from their old status count (`:790-793`).

Owner and Manager only (`requireManager`). Coordinator can see the queue (`requireStaff` on `listWaitlist`) and still sees Promote, Save, and Add Waitlist. The server rejects the write. `WaitlistPanel` is not told the caller's tier.

Deleting a driver closes an open hold and scrubs linked waitlist name, email, and phone to `Deleted Driver` / `deleted+<id>@invalid.example` (`drizzle/migrations/0016_0016_driver_deletion_stage1.sql:137-138`, restated in `0017`). Direct deletes of `waitlist` are revoked (`0017_0017_driver_deletion_security_repair.sql:3-5`). Restore can reopen the hold that the delete closed (`0017` around the restore function). `market_id` is not cleared, so a scrubbed row can still increment a Websites demand count.

## 4. Notifications

| Message | When | From |
| --- | --- | --- |
| "You're on the REAL RENTALS waitlist" | After `joinWaitlist` inserts, including a unique-index race | `waitlist.functions.ts:123-134` |
| "A car just opened up — you're next" | Staff confirm the dialog | `waitlist.functions.ts:360-372` |
| Homepage Coming Soon signup | No email | `LocationsSection.tsx:145-164` |
| Promote | No email | `waitlist.functions.ts:404` |
| Hold add / remove | No email | `waitlist.functions.ts:465` |
| SMS | Never. The hero hides the SMS consent field in waitlist mode (`CityHeroLeadForm.tsx:234-238`). Promotion writes `sms_consent = false`. | |

The opening email is not a button on the queue. The dialog opens only when a Manager saves Cars Available from `0` or `null` to a positive number while someone is `waiting` (`WaitlistPanel.tsx:99-104`). Dismissing it, or saving the same positive number again, does not offer it again. There is no later "Email The List" control. `setNotifyOpen(true)` appears only in that save branch.

The email says they were at the top, that the car is in their city, that `/apply` opens "the application you started", and that if the car is already claimed they stay at the top (`waitlist.functions.ts:366-370`). In code:

- Recipients are the oldest `waiting` rows globally, not the top of that city (`:346-353`).
- The link is `siteOrigin()/apply` with no resume token (`:368`, `siteOrigin` at `:522-524`). A waitlist-only person has no application to resume.
- After the send attempt, the row is always updated to `notified` (`:375-380`). They leave the position counter. They do not stay at the top.
- The comment above that update says a failed send is retried by running the action again against rows still `waiting`. The update runs whether `res.ok` is true or false, so a failed send is not retried.
- The audit summary and the toast count `sent`, which increments only on `res.ok` (`:374`, `:383-388`, `WaitlistPanel.tsx:121-125`). Rows flipped can be higher than the number staff just saw.

There is no per-person notify, no SMS, and no "you're next" message tied to an actual vehicle becoming Available. Fleet Available and Ready To Rent Now are displayed beside the override (`WaitlistPanel.tsx:177-192`) and are not what the public number or the email uses.

## 5. Admin views

There is no Waitlist item in the main nav. Old `?tab=waitlist` resolves to Drivers with `filter=waitlist` (`src/components/admin/nav-config.ts:70-76` on `7e3e6eb`).

`/admin?tab=drivers&filter=waitlist` (`DriversPanel.tsx:360-371` on `7e3e6eb`) shows two lists:

1. The driver table, filtered to applications with an open hold (`DriversPanel.tsx:600`, `filter === "waitlist"`).
2. Under that, `WaitlistPanel` titled "Waitlist Signups" / "People Who Joined The Waitlist Before Applying" (`:1139-1148`). That panel lists every public waitlist row, including promoted ones.

The Waitlist chip count is `(rows whose status is not promoted) + (applications with an open hold)` (`:373-379` and `:790-793`). A person who is both an unpromoted signup and a held application is counted twice. Promoted signups appear in the panel and not in the chip. When there are signups but no holds, the driver table says "No Drivers Yet" (`:1130`) above a populated signup list.

`WaitlistPanel` columns: Position, Driver (name, email, phone), Wants To Start (`pickup_date`), Readiness (only after `promoted_application_id` points at an application), Status (`Waiting` / `Notified` / `Promoted`), Joined (`created_at`). Market, source, UTM, `driver_status`, and `review_reason` are not columns. Readiness for an unlinked row is "not started" (`WaitlistPanel.tsx:280-286`, type comment at `waitlist.functions.ts:158-159`).

Other surfaces:

- Settings → Website, "Waitlist Demand (Coming Soon Cities)" (`WebsitesPanel.tsx:67-78`). Settings copy: `src/components/admin/SettingsWorkspace.tsx:20`.
- Delete Driver shows Waitlist History and says an active hold closes and linked waitlist contact is scrubbed (`src/components/admin/DeleteDriverDialog.tsx:74` and `:86-87` on `7e3e6eb`).
- Portal `WaitlistCard` lets a verified email edit name, phone, city, state, and preferred start date (`ApplicantHome.tsx:157-230` on `7e3e6eb`; `updateMyWaitlist` at `portal-access.functions.ts:107-146`). The card always says "On The Waitlist", including when status is `notified`. There is no leave-the-list control. Saving is audited as `portal.waitlist_self_update`.

`listWaitlist` is the heavy read: every waitlist row, then readiness batches, then every vehicle, active rentals, passed pre-delivery inspections, and `vehicle_rental_ready_missing` for eligible cars (`waitlist.functions.ts:206-258`). A failed fleet read throws "Waitlist data unavailable" and the panel clears both the fleet numbers and the queue (`WaitlistPanel.tsx:58-61`). `scripts/waitlist-security.test.mjs` locks the fail-closed behavior. `scripts/waitlist-roles.test.ts` locks Manager on hold, promote, notify, and Cars Available. `scripts/waitlist-conflict.test.ts` runs the `0022` function against disposable Postgres. `scripts/waitlist-readiness.test.ts` locks the shared readiness and Fleet Available counts the queue reuses.

## 6. Conflict resolver

Promotion refuses to guess in three cases. The UI can resolve only one.

`promoteToApplicant` returns `conflict: "email_match_phone_differs"` for that reason and `conflict: null` for `phone_only_match` and `email_phone_conflict` (`waitlist.functions.ts:419-429`). The panel opens **Review Conflict** only when `conflict` was set this session or `review_reason === "email_match_phone_differs"` (`WaitlistPanel.tsx:137-141` and `:294-302`).

For the other two reasons the row is flagged in SQL (`0015_...sql:30-36`) and the staff toast is the error string. After refresh, `review_reason` is loaded (`waitlist.functions.ts:200`) and then ignored. The button goes back to **Promote To Applicant**. Pressing it flags the same row again. There is no resolver for those two reasons.

Review Conflict (`src/components/admin/WaitlistConflictDialog.tsx`) is a side-by-side of the waitlist row and the single non-deleted application with that exact email (`getWaitlistConflict`, `waitlist.functions.ts:563-607`). Emails are masked (`:544-548`). Phones are shown in full. Documents and rentals are counted for the application only.

Confirm requires an explicit choice and the literal affirmation `affirmed: true` (`:631`). "Link — Keep Existing Phone" needs no reason. "Link — Use Waitlist Phone" needs a reason of at least 5 characters and a waitlist phone (`:635`, dialog `:154-165`). The write is `resolve_waitlist_phone_conflict` (`0022_...sql:1-89`):

- Caller must have `user_roles.role` of `admin` or `team` (Owner or Manager). `service_role` only.
- Locks waitlist, then application.
- Idempotent if this entry is already linked to this application. Rejects a link to a different application.
- Rejects a deleted or duplicate application, an email that no longer matches, stale last-10 phone digits, a second live application with the same email, and a waitlist phone that belongs to a different driver.
- Updates `waitlist_signed_up_at` / `waitlist_source`, and phone only when requested.
- Sets the waitlist row `promoted` and clears `review_reason`.
- Inserts `audit_log` action `waitlist.conflict_resolved` in the same transaction, with identity affirmed, the reason, and last-4 of the old and new phone.

The dialog tells staff to resolve multiple email matches first (`waitlist.functions.ts:588`). This screen does not merge them. The file comment says not to call `mergeDuplicateApplications` here (`:542`).

Linking does not create an application, an account, or a message (`:539-542`).

## 7. Data fields

### `public.waitlist`

From the original table (`supabase/migrations/20260621011525_22b1864d-5a3f-45fc-a9bd-c0ca7d099cf3.sql:10-25`) plus later columns. Types: `src/integrations/supabase/types.ts:5794-5818`.

| Field | Role |
| --- | --- |
| `id` | uuid primary key |
| `full_name`, `email`, `phone` | Identity. Email is not forced lowercase on the homepage insert. Phone is optional there and required on the hero. |
| `market_id` | FK to `markets`, `ON DELETE SET NULL`. Nulls share one position bucket and do not satisfy the unique index against each other. |
| `city`, `state` | Hero sets them. Homepage does not. The opening email uses `city` only. |
| `pickup_date` | "Wants To Start". Required on the hero, absent on the homepage form. |
| `driver_status` | Homepage only. Unused after insert. |
| `source` | `fleet_waitlist`, `homepage_waitlist`, or whatever the client sends (max 60 on the server fn). Copied onto the application as `waitlist_source` and, on create, as `applications.source`. |
| `status` | `waiting` (default), `notified`, `promoted`. No `CHECK` constraint in the waitlist migrations. |
| `notified_at` | Set when notify flips the row, including after a failed send. |
| `promoted_application_id`, `promoted_at` | Set by promote or by the conflict function. FK to `applications`. |
| `review_reason`, `review_flagged_at` | `phone_only_match`, `email_phone_conflict`, `email_match_phone_differs`. Cleared on a successful link. |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid` | Copied onto a newly created application. Not shown in the admin table. |
| `created_at` | Queue order. |
| `landing_page`, `referrer` | Not columns. Accepted by `joinWaitlist` and discarded. |

### Application columns and holds

- `applications.waitlist_signed_up_at`, `applications.waitlist_source` (`0014_...sql:1-3`). Written on link and on create. Not overwritten once set.
- `application_waitlist_holds`: `id`, `application_id`, `added_at`, `added_by`, `removed_at`, `removed_by`. Both removal columns are null or both are set. One open hold per application.

### Audited actions

`availability.set`, `waitlist.notified`, `waitlist.promoted`, `waitlist.promotion_needs_review`, `waitlist.hold_added`, `waitlist.hold_removed`, `waitlist.conflict_resolved`, `portal.waitlist_self_update`.

## 8. Known bugs and friction

1. A failed opening email still sets `notified`, so that person leaves the queue and is not retried. The toast and the audit count can be lower than the number of rows flipped (`waitlist.functions.ts:374-388`).
2. The opening email describes a queue the code does not run: global oldest-first, a bare `/apply` link, and "you stay at the top" after the row has been removed from the waiting set (`:346-380`).
3. Staff can send that email only by raising Cars Available off `0` or empty. There is no second chance on the queue (`WaitlistPanel.tsx:99-104`).
4. `phone_only_match` and `email_phone_conflict` are stored and then presented as a normal Promote button (`WaitlistPanel.tsx:294-312`).
5. `promote_waitlist_entry` can link a soft-deleted application (`0015_...sql:17-20`). The conflict function refuses those rows (`0022_...sql:30`).
6. The Drivers Waitlist chip adds unpromoted signups and held applications (`DriversPanel.tsx:790-793` on `7e3e6eb`). The page under it is two lists that do not match that number.
7. Homepage Coming Soon signups skip dedupe, confirmation, and the unused-field comments of `joinWaitlist`. `driver_status` is collected and never read. A unique-index failure is shown as a raw database message.
8. `landing_page` and `referrer` are silently dropped (`waitlist.functions.ts:102-103`). The confirmation email tells people to reply to leave, and the portal has no leave action (`ApplicantHome.tsx` WaitlistCard).
9. The resume token created on promote is discarded (`WaitlistPanel.tsx:133-147`). The person is not told they were promoted.
10. `listWaitlist` and the Websites demand count are unbounded, and the demand count includes every status (`WebsitesPanel.tsx:32-40`). `listWaitlist` also recomputes fleet readiness for the whole fleet on every queue load (`waitlist.functions.ts:227-258`).
11. The public scarcity line attributes the global Cars Available integer to one city (`CityHeroLeadForm.tsx:203-210`).
12. A short or missing phone skips the "email matches, phone differs" review and links on email alone (`0015_...sql:38`). The homepage form allows that phone.
13. Coordinator sees Promote, Cars Available, and Add Waitlist, then gets a server rejection. The panel does not take `canManageWaitlist`.

## 9. Ranked improvement options

Ranked for a later Waitlist pass. This document does not implement them. Effort is the size of the change. Risk is what can go wrong if it ships. SQL means a migration or a change to a deployed function, not a hosted read.

### 1. Make the opening email true, and only mark Notified after it sends

Per-market recipient list (the same key as position), a real next step instead of bare `/apply`, and `status = 'notified'` only when `sendEmail` returns ok. Add an Email The List action so staff are not stuck after dismissing the dialog. Keep the failed rows `waiting`.

- Effort: medium. `notifyWaitlistTop`, the dialog, and the email copy.
- Risk: medium. This sends live email. A wrong market filter emails the wrong city.
- SQL: no. `status` is already free text and the update already exists.

### 2. Stop the dead-end Promote loop for the two unresolved reasons

Show `phone_only_match` and `email_phone_conflict` on the row and replace Promote with a disabled state that names the reason. Do not build a merge button in that pass. A real resolver for "these are different people" is a separate identity feature.

- Effort: small for the label and the button. Large if a second resolver is added.
- Risk: low for the label. High for any new link or merge, because it writes identity.
- SQL: no for the label (`review_reason` is already stored). Yes for a new resolver function.

### 3. Refuse deleted applications inside `promote_waitlist_entry`

Add `deleted_at IS NULL` to both match queries in the `0015` function, matching `0022`. A deleted email match should fall through to a new application or to review, not to a hidden driver.

- Effort: small. One function replacement, covered by the disposable conflict harness.
- Risk: medium. The same promote click can create a new application where it used to link a deleted one.
- SQL: yes.

### 4. Make the Drivers Waitlist chip match the two lists

Count signups and holds separately, or label the chip "N signups · M holds". Point the empty driver-table copy at the signup list when the hold set is empty.

- Effort: small. `DriversPanel` filter count and empty state.
- Risk: low. Display only. Holds and statuses stay as they are.
- SQL: no.

### 5. Send Coming Soon signups through `joinWaitlist`

One writer: confirmation email, the email dedupe, no raw database error, and a decision on `driver_status` (keep it and show it, or stop asking). Homepage phone should follow the same 10-digit rule the promote function already uses, so a short phone cannot skip review.

- Effort: medium. `LocationsSection` plus the server input. The anon column grant can stay until the client insert is gone.
- Risk: medium. It changes a public form and who receives the confirmation.
- SQL: no, unless `driver_status` is dropped. Keeping the column needs no migration.

### 6. Hand the staff member the resume link, and tell the applicant they were promoted

`promoteToApplicant` already returns a token when it created the application. Surface Copy Link on the toast, and send one email that uses that token. Linking an existing application should not mint a second credential; `openMyApplication` already does that for a signed-in applicant.

- Effort: small for Copy Link. Medium if the email is added.
- Risk: medium. The token resumes the application. Emailing it is a live message to the address on the new row.
- SQL: no.

### 7. Honor "reply to leave" with an actual leave action

A portal control, or a signed link in the confirmation, that sets `status` to a non-waiting value and writes an audit row. The partial unique index then frees the email. Do not delete the row; deletion is already revoked.

- Effort: medium. Portal card plus a server function. Inbound email parsing is a larger version of the same idea.
- Risk: medium. A guessable link would let someone else remove a spot. The link has to be signed, and the portal path has to stay on the verified email.
- SQL: no. `status` has no check constraint in the waitlist migrations. A constraint or a `left_at` column would be optional SQL.

### 8. Page the queue and count demand as people still waiting

Use the existing paged read for `listWaitlist` and for the Websites count. Count `waiting` rows only, and say so on the chip. Leave the fleet numbers on a separate load so a vehicle-read failure does not blank the queue.

- Effort: medium. `listWaitlist` and `WebsitesPanel`.
- Risk: low. Read path. Position must be computed from the full waiting set, not from one page, or the numbers restart on each page.
- SQL: no. An index on `(status, created_at)` would be optional.

### 9. Stop calling the global number a per-city count

Change the hero sentence so Cars Available is the company-wide override it already is. A per-market number is a later product choice: the setting is one jsonb value, and position is already per market.

- Effort: small for the sentence. Medium for a per-market override, because notify, the hero, and the save dialog all assume one integer.
- Risk: low for the sentence. Medium for per-market numbers, because the public form and the email both change.
- SQL: no for the sentence. Per-market can stay inside `app_settings.value` without a new table. A constraint would be optional SQL.

### 10. Persist attribution, or stop accepting it

Either add `landing_page` and `referrer` and copy them the way UTM is copied onto a new application, or remove them from the `joinWaitlist` input so the payload matches the table.

- Effort: small.
- Risk: low. Staff do not see these fields today.
- SQL: yes if the columns are added. No if the input fields are removed.

## What this note did not do

No production SQL, no hosted read, and no code change. Live queue length, how many rows are stuck in `phone_only_match`, and whether the API row cap has been raised are not known from this review.
