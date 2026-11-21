# RentID in FLEET's applicant review (switch OFF)

Rosa ran RentID by hand in the RentID portal (verify.rentid.io, account
team@drivereal.com, billed to Dolmar): **Driver's License Status** (Florida
DMV, 1 credit + $0.50 state fee) and **Criminal Record Check** (1 credit), per
applicant. Receipts arrive at team@ from noreply@verify.rentid.io with the
order number (INV-XXXXXXXX) and the renter's name, but **not the result**; the
result lives only in the portal. Nothing was ever written back to the
application, so `background_check_status` and `mvr_status` stayed `pending`.

## What this change builds (OFF until switched on)

`app_settings.fleet_rentid` (no row = off):

```json
{ "record_results": false, "require_for_approval": false }
```

1. **Write path** `POST /api/public/fleet/screening-result` (Bearer
   FLEET_API_KEY; 403 while `record_results` is off). Body:
   `lead_id, provider: "rentid", order_id: "INV-…", license_status,
   criminal_record, checked_at, note`. Mapping onto the existing columns
   (CHECK `pending|passed|failed`):

   | RentID | Column | Value |
   | --- | --- | --- |
   | License status active | `mvr_status` | passed |
   | suspended / revoked / expired / inactive / invalid | `mvr_status` | failed |
   | provisional / restricted / unavailable (state not covered) | — | not written, stays pending |
   | Criminal record not detected | `background_check_status` | passed |
   | detected | `background_check_status` | failed |
   | unavailable | — | not written |

   `failed` is a hard blocker (`screening_flagged`): FLEET sends needs_staff and
   any decline stays with staff. A `failed` value is never turned back into
   `passed` through this endpoint. Every write is audited
   (`application.rentid_result_recorded`, with the RentID order number).
   `mvr_status` holds the license-status result, not a full MVR.

2. **Approval requirement** (`require_for_approval`): FLEET's approve is
   refused until both columns are `passed`. Waiting on RentID keeps the
   applicant in FLEET's list with `recommendation: not_ready` and blockers
   `rentid_background_check_status_required` / `rentid_mvr_status_required`.

## What is needed to automate the check itself

RentID's public site advertises an enterprise "Driver Verifications API"
(`POST /api/driver-verifications`, reply fields `driver_id,
verification_check, license_status, name, verified_at`), but there are no
public developer docs, no self-serve API key, and no published auth scheme.
Access is through RentID sales ("Enterprise" plan / "technology partners").

To have the site run RentID itself (no human in the portal):

1. Dolmar asks RentID (support@rentid.io or Contact Sales) for API access on
   the existing team@drivereal.com account: the API docs, base URL, auth
   method, sandbox, and whether License Status + Criminal Record can be run
   from driver data (name, DOB, license number/state) without the renter
   completing a link, plus result webhooks.
2. The API key goes into Lovable secrets (e.g. `RENTID_API_KEY`), never in
   chat or code.
3. A small server client then calls RentID and records the result through
   the same mapping above.

Until then, the portal stays the source: whoever runs the check (Rosa, or
FLEET if it is given its own portal login) posts the result with the order
number through the write path.

## RentID Reports On The Driver Profile (Dolmar, t582u, Nov 21 2026)

Where the data is (checked Nov 21 2026):

- **Portal:** the REAL RENTALS history lives at https://rent-id.io/rentid
  (sign in with team@drivereal.com, one-time code emailed to team@). Not
  app.rentid.io, which is a separate empty business account; do not finish its
  setup wizard. Each order has a page
  `https://rent-id.io/rentid/req_<id>_j<order lowercase>` (e.g.
  `req_1793719376790_jn4khlc48` = order N4KHLC48) and a downloadable PDF
  certificate.
- **Criminal cases** show case number, internal id, charges, degree, offense
  and file dates, disposition and court/county. No name or DOB per case, so a
  case is only as reliable as RentID's identity match. The same case is often
  listed twice from two sources (AOC `10004830MMMO` vs Clerk
  `032010MM004830XXOXMX`); `dedupeCases` merges them (key `10|MM|4830`) and
  keeps the other number as `alt_case_numbers`. RentID's own count is kept
  as `criminal_case_count`.
- **Email:** only receipts (`Your receipt from Rentid, Inc. Order #INV-…` from
  noreply@verify.rentid.io): order, renter name, products, invoice PDF. No
  result. `CRD-…` receipts are credit purchases, not screenings. team@ is
  Gmail, not the Resend intake inbox, so receipts are not auto-ingested.
- **API:** none we can use. The Enterprise "Driver Verifications API" is
  sales-only (no docs, no key, no webhooks).

What this builds (migration `supabase/migrations/20261121193000_rentid_reports.sql`, NOT applied):

- `public.rentid_reports`: one row per RentID order (unique `order_key`, the
  order without `INV-`), on one driver: status `ordered` (receipt only) or
  `reported`, report link, license status/state, criminal record + count +
  case list, ID result, the report file (`documents` row, category
  `screening`, team only, not reviewed), who filed it. Manager+ read (RLS
  `private.is_manager()`); service role writes.
- **Staff:** Screening tab → **RentID Reports** → **Attach RentID Report**
  (Manager+). Screenshot or PDF certificate, order number or report link,
  results; pasting the portal text fills the fields; cases one per line
  (`Offense Date | Charges | Degree | Disposition | Court / County | Case #`).
- **FLEET:** `POST /api/public/fleet/rentid-report` (Bearer FLEET_API_KEY),
  Off until the Owner turns on **RentID Reports (FLEET)** (`rentid_report_imports`).
  Body: `lead_id` or `renter_name` (exact, unique match only), `order_id` or
  `report_url`, optional `ordered_at`, `products`, `checked_at`,
  `license_status`, `license_state`, `criminal_record`, `criminal_case_count`,
  `criminal_cases[]` (`case_number, internal_id, charges, degree,
  offense_date, file_date, disposition, court`), `identity_result`, `note`,
  `content_base64` + `file_name` (filed through the driver-document path, so
  the Document Uploads switch must be On too). Repeats update the same row.
- **Never a decision.** Nothing writes `background_check_status`,
  `mvr_status`, insurance, review status or approval. Recording the pass/fail
  columns stays with the separate `screening-result` endpoint (its own
  switch) and staff.
