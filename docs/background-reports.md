# Background Reports (Driver Profile → Screening Tab)

Dolmar, t582u / t592u (Nov 21 2026): pull screening reports into the system,
call it **"Background"** on the site (not the provider's name) so other
services can be added, take **DMV reports** too, and allow **multiple files**.

Migration: `supabase/migrations/20261121193000_background_reports.sql` (NOT applied).

## What is stored

- `public.background_reports`: one entry per check.
  - `provider`: `rentid` | `fl_dmv` (FLHSMV license check) | `other` (+ `provider_name`).
  - `report_type`: `background_screening` | `dmv_license_check` | `other`.
  - `reference` (order / reference number), status `ordered` (receipt only) or `reported`.
  - Optional results **as the provider reported them**: license status / state,
    check date, criminal record + provider count + distinct case list, ID result.
  - RentID only: `order_key` (order without `INV-`, unique: one order = one driver)
    and `report_ref` (portal page `rent-id.io/rentid/req_<id>_j<order>`).
- `public.background_report_documents`: any number of files per entry. Each
  file is a normal `documents` row, category `screening`, visibility admin
  (team only), review status uploaded.
- Manager+ read (RLS `private.is_manager()`); only the service role writes.

**Never a decision.** Nothing writes `background_check_status`, `mvr_status`,
license or insurance verification, review status or approval. A DMV license
status here is display only. Recording pass/fail stays with staff (and the
separate `screening-result` endpoint, its own switch).

## Staff

Screening tab → **Background Reports** → **Add Background Report** (Manager+):
Source, Report Type, drop or browse several files (PDF / images, up to 10 at a
time, 20 MB each), optional reference, check date, license status, criminal
record, cases (one per line: `Offense Date | Charges | Degree | Disposition |
Court / County | Case #`). Pasting the report text fills the fields. **Add
Files** on an entry adds more files later.

## FLEET

`POST /api/public/fleet/background-report` (Bearer FLEET_API_KEY). Off until
the Owner turns on **Background Reports (FLEET)** (`background_report_imports`);
files also need **Document Uploads (FLEET)**.

Body: `provider` (default `rentid`), `report_type`, `provider_name` (other),
`lead_id` or `renter_name` (exact, unique match only; two matches → 409, none →
404), `order_id`/`reference`, `report_url` (RentID only), `ordered_at`,
`products`, `checked_at`, `license_status`, `license_state`, `criminal_record`,
`criminal_case_count`, `criminal_cases[]` (`case_number, internal_id, charges,
degree, offense_date, file_date, disposition, court`), `identity_result`,
`note`, `idempotency_key`, `files[]` (`file_name, content_base64`, up to 10)
or a single `content_base64` + `file_name`. A RentID order repeats into the
same entry; other providers repeat into the same entry only with the same
`idempotency_key`.

## RentID specifics

- Portal: https://rent-id.io/rentid (team@ login, emailed code). Not
  app.rentid.io (empty business account). PDF certificate per order.
- Receipts (team@, noreply@verify.rentid.io, `Order #INV-…`): order, renter
  name, products; no result. `CRD-…` = credit purchases.
- No usable API or webhooks (Enterprise API is sales-only).
- Cases have no name or DOB, and the same case is often listed twice (AOC
  `10004830MMMO` vs Clerk `032010MM004830XXOXMX`); `dedupeCases` merges them
  (key `10|MM|4830`) and keeps the other number as `alt_case_numbers`. The
  provider's own count stays in `criminal_case_count`.
