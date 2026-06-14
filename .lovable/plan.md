
# Admin Refactor — Fleet Operations Platform

Scaling the admin from form-based panels into operational areas: **Drivers, Vehicles, Partners, Payments, Settings**.

## 1. Navigation

Replace 5 tabs (Applications, Vehicles, Fleet Owners, Investors, Contact) with:

- **Drivers** · **Vehicles** · **Partners** · **Payments** · **Settings**

`src/routes/admin.tsx` — update `TABS` array + panel routing.

## 2. Database migration

A single migration adds the operational fields. No table renames (keeps existing `applications` data as the driver record).

**`applications` → driver lifecycle fields**
- `status` enum widened: `new | reviewing | approved | active | suspended | declined | closed`
- `deposit_status` (`not_paid | partially_paid | paid | refunded`), `deposit_amount`, `deposit_paid`
- `weekly_rent`, `payment_status` (`current | late | past_due | collections`)
- `background_check_status`, `mvr_status` (`pending | passed | failed`)
- `incident_count` int default 0
- (existing) `vehicle_id`, `notes` reused

**New `partners` table** (replaces split fleet_owners/investors usage going forward; existing tables kept read-only as legacy leads)
- `name, email, phone, partner_type` (`vehicle_owner | capital_partner | private_lender | jv_partner | other`)
- `capital_committed, vehicles_contributed, monthly_payment, notes, documents jsonb, status`
- RLS: admin-only read/write via `has_role(auth.uid(),'admin')`. GRANTs to authenticated + service_role.

**New `payments` table**
- `driver_id` (→ applications), `vehicle_id`, `amount`, `type` (`rent | deposit | late_fee`), `due_date`, `paid_date`, `status` (`paid | current | late | past_due | collections`), `payment_method`, `late_fees`, `balance_due`, `notes`
- RLS: admin-only. GRANTs to authenticated + service_role.

**New `app_settings` table** (single-row key/value json) for rental terms, deposit defaults, payment settings, notifications, etc.

## 3. Panels

- `DriversPanel.tsx` — renamed from ApplicationsPanel; 7 status filter chips with counts; expanded modal with new fields (deposit, rent, payment, BG check, MVR, incidents, vehicle info resolved from `vehicles` join showing `year make model · VIN`).
- `VehiclesPanel.tsx` — unchanged.
- `PartnersPanel.tsx` — new; CRUD on `partners` with type filter; also shows legacy fleet_owner_submissions + investor_leads as "Legacy submissions" sub-list (read-only, with "Convert to Partner" action).
- `PaymentsPanel.tsx` — new; table view with driver name, vehicle, amount, due date, status, method, late fees, balance; filter by status, sort by due date.
- `SettingsPanel.tsx` — new; sections for Rental Terms, Deposit Defaults, Payment Settings, Admin Users (list user_roles), Notifications, App Settings, Partner Settings. Persists to `app_settings`.

## 4. Removed
- Contact tab removed from admin nav. `contact_leads` table is kept (public contact form still writes to it); a future enhancement can surface them inside Drivers/Partners/Leads. For now they remain accessible only via DB.

## Technical notes

- Status enums stored as TEXT with CHECK constraints (easier to evolve than PG enums).
- Vehicle resolution in Drivers modal: join via existing `vehicles` table on `vehicle_id`.
- All new tables: admin-only RLS using existing `has_role()` security-definer function. Standard GRANTs included.
- `updated_at` trigger reused via existing pattern.
- No edits to existing `src/integrations/supabase/*` autogen files; types regenerate after migration.
- White dropdowns rule preserved — all new selects use shadcn `Select` (already styled white).

## Out of scope (call out)
- Real payment processing/Stripe integration — Payments tab is tracking only.
- Routing contact submissions into Drivers/Partners automatically — surfaced as legacy lists for now.
- Bulk import of vehicles/drivers.
